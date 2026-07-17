/**
 * app-window-controller — owns the root-layout window-level side effects
 * that aren't part of any single store / sidebar. Encapsulates:
 *
 *   - perf-harness install (debug only)
 *   - root-overscroll prevention (macOS / iOS rubber-band)
 *   - splash-screen teardown (one-shot)
 *   - performance-mode class application (immediate, before settings load)
 *   - sound-feedback listener boot + click/keydown unlock
 *   - external-link click interceptor (route external http/https to system browser)
 *   - global error / unhandled-rejection log capture
 *   - app-version read for the version chip
 *
 * Why a single controller:
 *   The original +layout.svelte `onMount` registered 8+ window-level
 *   listeners, a poll interval, and several transport subscriptions in
 *   one 250-line block. That made it impossible to reason about teardown
 *   ordering, and a single bug in the cleanup chain would silently leak
 *   listeners across hot reloads. This controller exposes a single
 *   `install()` / `dispose()` pair so the layout's onMount returns one
 *   cleanup function instead of 14.
 *
 * Why not in a Svelte 5 rune store:
 *   None of the side effects need reactive state — they are pure effects
 *   on `window` / `document`. Using `$state` / `$effect` would only
 *   obscure the teardown pairing. Keep this as a vanilla controller.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import { isPerfEnabled } from "$lib/utils/perf";
import { installWindowHarness } from "$lib/perf/harness";
import { applyVisualPerformance } from "$lib/services/window-display";
import { installPreventRootOverscroll } from "$lib/utils/prevent-root-overscroll";
import { getTransport } from "$lib/transport";
import { showToast } from "$lib/stores/toast-store.svelte";
import { t } from "$lib/i18n/index.svelte";
import { initBackendCapabilities } from "$lib/backend-capabilities.svelte";
import { loadAgentSettingsCache } from "$lib/stores/agent-settings-cache.svelte";
import { loadCliInfo } from "$lib/stores/cli-info.svelte";
import { themeStore } from "$lib/stores/theme-store.svelte";
import { readBundledAppVersion } from "$lib/services/app-version.svelte";

export interface WindowControllerOptions {
  /** Called when the bundled app version is read (one-shot). */
  onAppVersion?: (version: string | null) => void;
  /** Called when the user settings update event fires. */
  onUserSettingsChanged?: (settings: unknown) => void;
}

export interface WindowController {
  dispose: () => void;
  /** Drop-in replacement for the layout's onMount return value. */
  cleanup: () => void;
}

/**
 * Install all root-layout window-level effects. Returns a single dispose()
 * for the layout's onMount cleanup.
 *
 * Order matters:
 *   1. Perf harness (debug only)
 *   2. Overscroll prevention (does not depend on anything)
 *   3. Splash teardown (depends on DOM, immediate)
 *   4. Performance-mode class (immediate, before settings IPC resolves)
 *   5. Sound listener boot (network-bound, fire-and-forget)
 *   6. Sound unlock listeners (pointerdown / keydown, once)
 *   7. External link interceptor (document capture)
 *   8. Global error / rejection log (window)
 *   9. Transport listeners (ocv:status-changed / cli-auto-sync / product-bootstrap)
 *  10. App-version read (fire-and-forget)
 */
export function installAppWindowController(opts: WindowControllerOptions = {}): WindowController {
  const cleanups: Array<() => void> = [];
  let destroyed = false;

  // 1. Perf harness (debug only)
  if (isPerfEnabled()) {
    void readBundledAppVersion().then((version) => {
      if (destroyed) return;
      installWindowHarness(version || "dev");
    });
  }

  // 2. Overscroll prevention
  cleanups.push(installPreventRootOverscroll());

  // 3. Splash teardown — remove synchronously. The previous opacity-fade
  // approach had a 320ms window during which HMR or navigation could
  // briefly show the splash logo to the user. `display: none` removes
  // it from the layout immediately, then we drop the node.
  if (typeof document !== "undefined") {
    const splash = document.getElementById("app-splash");
    if (splash) {
      splash.style.display = "none";
      splash.remove();
    }
  }

  // 4. Performance mode class (immediate, no IPC wait)
  applyVisualPerformance();

  // 5. Sound listener boot (fire-and-forget)
  void import("$lib/services/sound-feedback-listener")
    .then((m) => m.startSoundFeedbackListener())
    .catch((e) => {
      if (typeof console !== "undefined") {
        console.debug("[layout] sound listener init failed:", e);
      }
    });

  // 6. Sound unlock on first interaction
  const unlockSoundOnce = () => {
    void import("$lib/services/sound-feedback-service").then((m) => m.unlockSoundEngine());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", unlockSoundOnce, { once: true, capture: true });
    window.addEventListener("keydown", unlockSoundOnce, { once: true, capture: true });
    cleanups.push(() => {
      window.removeEventListener("pointerdown", unlockSoundOnce, { capture: true });
      window.removeEventListener("keydown", unlockSoundOnce, { capture: true });
    });
  }

  // 7. External link interceptor
  if (typeof document !== "undefined") {
    const handleExternalLink = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin === window.location.origin) return;
      e.preventDefault();
      dbg("layout", "external-link: opening in system browser", { href });
      import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(href))
        .catch((err) => {
          dbgWarn("layout", "external-link: plugin-shell failed, fallback to window.open", err);
          window.open(href, "_blank");
        });
    };
    document.addEventListener("click", handleExternalLink, true);
    cleanups.push(() => document.removeEventListener("click", handleExternalLink, true));
    dbg("layout", "external-link interceptor mounted");
  }

  // 8. Global error / rejection log
  if (typeof window !== "undefined") {
    const onError = (e: ErrorEvent) => {
      dbgWarn("layout", "global error", e.message, e.filename, e.lineno);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      dbgWarn("layout", "unhandled rejection", e.reason);
      // Don't call e.preventDefault() — let rejections surface in devtools
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });
  }

  // 9. Transport listeners (ocv:status-changed / cli-auto-sync / product-bootstrap)
  if (typeof window !== "undefined") {
    const transport = getTransport();
    const unlisteners: Array<() => void> = [];
    const tryListen = <T>(name: string, handler: (payload: T) => void) => {
      transport
        .listen<T>(name, handler)
        .then((fn) => {
          if (destroyed) {
            fn();
            return;
          }
          unlisteners.push(fn);
        })
        .catch((e) => dbgWarn("layout", `transport.listen(${name}) failed`, e));
    };
    tryListen<unknown>("ocv:status-changed", (payload) => {
      dbg("layout", "status-changed", payload);
      // Hook left for the layout to plug in (e.g. reload runs). Default
      // behaviour: just log; downstream listeners (sidebar store) handle
      // their own side-effects via the dedicated `ocv:runs-changed` event.
      void payload;
    });
    tryListen<unknown>("ocv:cli-auto-sync", (payload) => {
      dbg("layout", "cli-auto-sync", payload);
    });
    tryListen<{
      skillsInstalled?: string[];
      appendPromptApplied?: boolean;
    }>("product-bootstrap-applied", (result) => {
      const skillCount = result.skillsInstalled?.length ?? 0;
      if (skillCount > 0 || result.appendPromptApplied) {
        showToast(
          t("productBootstrap_appliedToast", {
            skills: String(skillCount),
            style: result.appendPromptApplied
              ? t("productBootstrap_styleOn")
              : t("productBootstrap_styleOff"),
          }),
          "success",
        );
      }
    });
    cleanups.push(() => {
      for (const u of unlisteners) u();
    });
  }

  // 10. App-version read (fire-and-forget)
  void readBundledAppVersion().then((version) => {
    if (!destroyed) opts.onAppVersion?.(version);
  });

  // 11. Background store loads (fire-and-forget) — backend capabilities,
  //     agent settings cache, cli info, theme. Attention queue reconciliation
  //     is demand-loaded from layout-bootstrap-demand when /workbench opens.
  void (async () => {
    try {
      await initBackendCapabilities();
    } catch {
      /* ignore */
    }
  })();
  void loadAgentSettingsCache();
  void loadCliInfo();
  try {
    themeStore.init();
  } catch {
    /* ignore */
  }

  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    for (const fn of cleanups) {
      try {
        fn();
      } catch (e) {
        dbgWarn("layout", "app-window-controller cleanup failed", e);
      }
    }
    cleanups.length = 0;
  };

  return {
    dispose,
    cleanup: dispose,
  };
}

/**
 * Re-export the app-update coordinator so callers can wire `setAutoCheckEnabled`
 * from the settings-changed handler without importing it twice.
 */
;
