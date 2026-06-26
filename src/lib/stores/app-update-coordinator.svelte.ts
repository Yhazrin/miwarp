/**
 * AppUpdateCoordinator — single source of truth for MiWarp app update lifecycle.
 *
 * Phases: idle → checking → available | up_to_date | failed
 *                        → downloading → installing → ready_to_restart
 *
 * Features:
 * - Single-flight check (deduplicates concurrent calls)
 * - Progress tracking during download/install
 * - Retry on failure
 * - Snooze/dismiss with localStorage persistence
 * - Silent startup check controlled by persisted user settings
 * - Timer cleanup on destroy
 */
import {
  checkAppUpdateStatus,
  installInAppUpdate,
  openExternalUpdateUrl,
  relaunchApplication,
  type AppUpdateOffer,
  type AppUpdateProgress,
} from "$lib/utils/app-updater";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready_to_restart"
  | "up_to_date"
  | "failed";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  offer: AppUpdateOffer | null;
  progress: number | null;
  error: string | null;
  upToDateVersion: string | null;
  lastCheckedAt: number | null;
}

const SNOOZE_KEY = "ocv:update-snoozed";
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_CHECK_DELAY_MS = 5000;

function readSnoozedVersion(): string | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const { version, until } = JSON.parse(raw) as { version: string; until: number };
    if (Date.now() < until) return version;
    localStorage.removeItem(SNOOZE_KEY);
    return null;
  } catch {
    return null;
  }
}

function writeSnooze(version: string): void {
  try {
    localStorage.setItem(
      SNOOZE_KEY,
      JSON.stringify({ version, until: Date.now() + SNOOZE_DURATION_MS }),
    );
  } catch {
    // storage full or private mode — silently ignore
  }
}

function readAutoCheckInterval(): number {
  try {
    const raw = localStorage.getItem("ocv:update-auto-check-interval");
    if (!raw) return AUTO_CHECK_INTERVAL_MS;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : AUTO_CHECK_INTERVAL_MS;
  } catch {
    return AUTO_CHECK_INTERVAL_MS;
  }
}

function isDismissed(version: string): boolean {
  try {
    return sessionStorage.getItem(`ocv:update-dismissed:${version}`) === "1";
  } catch {
    return false;
  }
}

class AppUpdateCoordinator {
  private _state = $state<AppUpdateState>({
    phase: "idle",
    offer: null,
    progress: null,
    error: null,
    upToDateVersion: null,
    lastCheckedAt: null,
  });

  private _checkInFlight: Promise<AppUpdateState> | null = null;
  private _startupTimer: ReturnType<typeof setTimeout> | null = null;
  private _intervalTimer: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;
  private _autoCheckEnabled = $state(true);

  get phase(): AppUpdatePhase {
    return this._state.phase;
  }

  get state(): AppUpdateState {
    return this._state;
  }

  get hasUpdate(): boolean {
    return (
      this._state.phase === "available" &&
      this._state.offer !== null &&
      !isDismissed(this._state.offer.version)
    );
  }

  get isBusy(): boolean {
    return (
      this._state.phase === "checking" ||
      this._state.phase === "downloading" ||
      this._state.phase === "installing"
    );
  }

  /** Start silent startup check + periodic interval. Call after user settings load. */
  startAutoCheck(enabled = true): void {
    this._destroyed = false;
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    this.setAutoCheckEnabled(enabled);

    if (!enabled) return;

    this._startupTimer = setTimeout(() => {
      if (this._destroyed) return;
      this.checkForUpdate({ silent: true });
    }, STARTUP_CHECK_DELAY_MS);

    this._scheduleInterval();
  }

  /** Clean up timers. Call on app unmount. */
  destroy(): void {
    this._destroyed = true;
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }
  }

  private _scheduleInterval(): void {
    if (this._intervalTimer) clearInterval(this._intervalTimer);
    if (!this._autoCheckEnabled) return;
    const ms = readAutoCheckInterval();
    this._intervalTimer = setInterval(() => {
      if (this._destroyed) return;
      if (
        this._state.phase === "idle" ||
        this._state.phase === "up_to_date" ||
        this._state.phase === "failed"
      ) {
        this.checkForUpdate({ silent: true });
      }
    }, ms);
  }

  /** Manual or silent check. Single-flight: concurrent calls share the same promise. */
  async checkForUpdate(opts?: { silent?: boolean }): Promise<AppUpdateState> {
    if (this._checkInFlight) return this._checkInFlight;

    this._checkInFlight = this._doCheck(opts?.silent ?? false);
    try {
      return await this._checkInFlight;
    } finally {
      this._checkInFlight = null;
    }
  }

  private async _doCheck(silent: boolean): Promise<AppUpdateState> {
    // Check snooze
    const snoozedVersion = readSnoozedVersion();

    this._state = { ...this._state, phase: "checking", error: null, progress: null };

    try {
      const result = await checkAppUpdateStatus();

      if (result.error) {
        this._state = {
          ...this._state,
          phase: "failed",
          error: result.error,
          lastCheckedAt: Date.now(),
        };
        if (!silent) dbgWarn("app-update-coordinator", "check failed", result.error);
        return this._state;
      }

      if (result.offer) {
        // If this version is snoozed, treat as up-to-date
        if (snoozedVersion && result.offer.version === snoozedVersion) {
          this._state = {
            ...this._state,
            phase: "up_to_date",
            upToDateVersion: result.offer.currentVersion,
            lastCheckedAt: Date.now(),
          };
          return this._state;
        }

        // Session dismissal — skip until next browser session
        if (isDismissed(result.offer.version)) {
          this._state = {
            ...this._state,
            phase: "idle",
            offer: null,
            lastCheckedAt: Date.now(),
          };
          return this._state;
        }

        this._state = {
          ...this._state,
          phase: "available",
          offer: result.offer,
          upToDateVersion: null,
          lastCheckedAt: Date.now(),
        };
        if (!silent) dbg("app-update-coordinator", "update available", result.offer.version);
        return this._state;
      }

      this._state = {
        ...this._state,
        phase: "up_to_date",
        upToDateVersion: result.upToDateVersion,
        lastCheckedAt: Date.now(),
      };
      return this._state;
    } catch (e) {
      this._state = {
        ...this._state,
        phase: "failed",
        error: String(e),
        lastCheckedAt: Date.now(),
      };
      if (!silent) dbgWarn("app-update-coordinator", "check exception", e);
      return this._state;
    }
  }

  /** Install the in-app update (if available). Transitions through downloading → installing → ready_to_restart. */
  async installUpdate(): Promise<void> {
    if (this._state.phase !== "available" || !this._state.offer) return;

    if (this._state.offer.kind === "external") {
      await openExternalUpdateUrl(this._state.offer.downloadUrl);
      this._state = { ...this._state, phase: "idle", offer: null, progress: null, error: null };
      return;
    }

    this._state = { ...this._state, phase: "downloading", progress: 0, error: null };

    try {
      await installInAppUpdate((p: AppUpdateProgress) => {
        if (p.phase === "downloading") {
          this._state = { ...this._state, progress: p.percent };
        } else if (p.phase === "installing") {
          this._state = { ...this._state, phase: "installing", progress: 100 };
        } else if (p.phase === "ready_to_restart") {
          this._state = { ...this._state, phase: "ready_to_restart", progress: null };
        }
      });
    } catch (e) {
      this._state = {
        ...this._state,
        phase: "failed",
        error: String(e),
        progress: null,
      };
      dbgWarn("app-update-coordinator", "install failed", e);
    }
  }

  /** Relaunch the app after an in-app update is installed. */
  async restartApplication(): Promise<void> {
    if (this._state.phase !== "ready_to_restart") return;

    try {
      await relaunchApplication();
    } catch (e) {
      this._state = {
        ...this._state,
        phase: "failed",
        error: String(e),
        progress: null,
      };
      dbgWarn("app-update-coordinator", "restart failed", e);
    }
  }

  /** Dismiss the current offer (permanently for this version via sessionStorage, then reset to idle). */
  dismiss(): void {
    if (this._state.offer) {
      try {
        sessionStorage.setItem(`ocv:update-dismissed:${this._state.offer.version}`, "1");
      } catch {
        // ignore
      }
    }
    this._state = {
      ...this._state,
      phase: "idle",
      offer: null,
      progress: null,
      error: null,
    };
  }

  /** Snooze this version for 24 hours (localStorage) and reset to idle. */
  snooze(): void {
    if (this._state.offer) {
      writeSnooze(this._state.offer.version);
    }
    this._state = {
      ...this._state,
      phase: "idle",
      offer: null,
      progress: null,
      error: null,
    };
  }

  /** Retry after failure. */
  async retry(): Promise<void> {
    this._state = { ...this._state, phase: "idle", error: null };
    await this.checkForUpdate();
  }

  /** Reset to idle (e.g. user closes the update UI). */
  reset(): void {
    this._state = {
      ...this._state,
      phase: "idle",
      offer: null,
      progress: null,
      error: null,
    };
  }

  // ── Preference accessors ──

  getAutoCheckEnabled(): boolean {
    return this._autoCheckEnabled;
  }

  setAutoCheckEnabled(enabled: boolean): void {
    this._autoCheckEnabled = enabled;
    if (!enabled && this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (enabled) {
      this._scheduleInterval();
    } else if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }
  }
}

export const appUpdateCoordinator = new AppUpdateCoordinator();
