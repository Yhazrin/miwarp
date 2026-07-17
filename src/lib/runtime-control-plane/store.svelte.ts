import * as api from "$lib/api";
import type {
  ConfigTransactionPreview,
  ConfigTransactionResult,
  RuntimeControlPlaneList,
  RuntimeHubHealthResponse,
  RuntimeSnapshot,
  SessionRuntimeOverride,
} from "./types";

const SESSION_OVERRIDE_KEY = "ocv:session-runtime-override";

export class RuntimeControlPlaneStore {
  list = $state<RuntimeControlPlaneList | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  selectedRuntimeId = $state<string | null>(null);
  pendingPreview = $state<ConfigTransactionPreview | null>(null);
  lastTransaction = $state<ConfigTransactionResult | null>(null);
  sessionOverride = $state<SessionRuntimeOverride | null>(null);
  private inFlight: Promise<void> | null = null;

  init(): void {
    this.sessionOverride = readSessionOverride();
    void this.refresh();
  }

  refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh(force).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performRefresh(force: boolean): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.list = await api.runtimeHubList(force);
      if (!this.selectedRuntimeId && this.list.runtimes.length > 0) {
        this.selectedRuntimeId = this.list.defaultRuntimeId;
      }
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }

  get selected(): RuntimeSnapshot | null {
    if (!this.list || !this.selectedRuntimeId) return null;
    return this.list.runtimes.find((r) => r.runtimeId === this.selectedRuntimeId) ?? null;
  }

  async setDefault(runtimeId: string): Promise<void> {
    await api.runtimeHubSetDefault(runtimeId);
    await this.refresh(true);
  }

  async previewConfig(runtimeId: string, patch: Record<string, unknown>): Promise<void> {
    this.pendingPreview = await api.runtimeHubPreviewConfig(runtimeId, patch);
  }

  async applyConfig(runtimeId: string, patch: Record<string, unknown>): Promise<void> {
    this.lastTransaction = await api.runtimeHubApplyConfig(runtimeId, patch);
    if (this.lastTransaction.success) {
      this.pendingPreview = null;
      await this.refresh(true);
    }
  }

  async diagnose(runtimeId: string): Promise<RuntimeHubHealthResponse> {
    return api.runtimeHubHealth(runtimeId, true);
  }

  setSessionOverride(override: SessionRuntimeOverride | null): void {
    this.sessionOverride = override;
    try {
      if (override) {
        localStorage.setItem(SESSION_OVERRIDE_KEY, JSON.stringify(override));
      } else {
        localStorage.removeItem(SESSION_OVERRIDE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }

  effectiveRuntimeId(fallback: string): string {
    return this.sessionOverride?.runtimeId ?? fallback;
  }

  effectiveModel(fallback?: string | null): string | null {
    return this.sessionOverride?.model ?? fallback ?? null;
  }

  effectiveProvider(fallback?: string | null): string | null {
    return this.sessionOverride?.provider ?? fallback ?? null;
  }
}

function readSessionOverride(): SessionRuntimeOverride | null {
  try {
    const raw = localStorage.getItem(SESSION_OVERRIDE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionRuntimeOverride;
  } catch {
    return null;
  }
}

const runtimeControlPlaneStore = new RuntimeControlPlaneStore();
