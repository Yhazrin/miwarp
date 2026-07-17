<!--
  Root layout — init-only.

  All chrome state and side-effects live in `src/lib/layout/` (the
  layout-scoped stores and controllers). The shell template (icon rail,
  sidebar, content panel, modals, toast host) lives in `AppShell.svelte`.

  Responsibilities of this file:
    1. Initialise the i18n runtime (must run before any t() usage).
    2. Instantiate the shared TeamStore + KeybindingStore and expose
       them via setContext so child pages can pick them up.
    3. Pre-seed the RUNS_CACHE_CONTEXT_KEY gate (so /workbench can await
       the layout's already-loaded runs and skip its own list_runs IPC).
    4. Wire the SETTINGS_CACHE_CONTEXT_KEY (so /settings can read the
       layout's already-loaded UserSettings on first paint).
    5. Start the runs sidebar store loadRuns() + poll, the session
       folder store load(), the project-selection store init(), the
       window-controller install (perf harness, splash teardown,
       external-link interceptor, sound listener, error capture), and
       the team subscription.
    6. Re-emit localStorage / window events into the stores.
    7. Render the AppShell with the children snippet.

  After this file is fully migrated the layout script is < 200 lines
  and the template is exactly 4 lines.
-->
<script lang="ts">
  import "../app.css";
  import { initLocale } from "$lib/i18n/index.svelte";
  initLocale();

  import { themeStore } from "$lib/stores/theme-store.svelte";
  if (typeof window !== "undefined") {
    void themeStore.init();
  }

  import { onMount, setContext } from "svelte";
  import { page } from "$app/stores";
  import { get } from "svelte/store";
  import { goto, replaceState } from "$app/navigation";
  import { afterNavigate } from "$app/navigation";
  import { dbg } from "$lib/utils/debug";

  import AppShell from "$lib/layout/AppShell.svelte";
  import { projectSelectionStore } from "$lib/layout/project-selection-store.svelte";
  import { runsSidebarStore } from "$lib/layout/runs-sidebar-store.svelte";
  import { sessionFolderStore } from "$lib/layout/session-folder-store.svelte";
  import { explorerTreeStore } from "$lib/layout/explorer-tree-store.svelte";
  import { installAppWindowController } from "$lib/layout/app-window-controller";
  import {
    createSettingsLoader,
    applyUserSettings,
    applySettingsChanged,
  } from "$lib/layout/layout-bootstrap";
  import {
    EVT_RUNS_CHANGED,
    EVT_CWD_CHANGED,
    EVT_FAVORITES_CHANGED,
    EVT_OPEN_PERMISSIONS,
    EVT_SHOW_WIZARD,
    EVT_EXPLORER_FILE_SELECTED,
  } from "$lib/utils/bus-events";
  import { getChatTimelineResetHandle } from "$lib/chat/chat-timeline-reset-registry";
  import { createBootstrapDemandController } from "$lib/layout/layout-bootstrap-demand";
  import { useKeybindingShortcuts } from "$lib/layout/use-keybinding-shortcuts.svelte";
  import { initSplitWorkspaceLifecycle } from "$lib/split/split-workspace-lifecycle";
  import { getActiveSessionIdentity } from "$lib/utils/active-session";
  import { TeamStore } from "$lib/stores/team-store.svelte";
  import { KeybindingStore } from "$lib/stores/keybindings.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { applyZoom, applyVisualPerformance } from "$lib/services/window-display";
  import { t } from "$lib/i18n/index.svelte";

  import {
    RUNS_CACHE_CONTEXT_KEY,
    SETTINGS_CACHE_CONTEXT_KEY,
    BOOTSTRAP_DEMAND_CONTEXT_KEY,
    type RunsCacheContext,
    type SettingsCacheContext,
  } from "$lib/layout-chrome-context";

  import type { UserSettings } from "$lib/types";
  import { readActiveSessionId } from "$lib/utils/chat-persistence";
  import { USER_SETTINGS_CHANGED_EVENT } from "$lib/api";

  // ── Shared stores (lifetime = layout lifetime) ─────────────────
  const teamStore = new TeamStore();
  setContext("teamStore", teamStore);
  const keybindingStore = new KeybindingStore();
  setContext("keybindings", keybindingStore);

  // ── Layout-scoped stores: wire cross-store refs here ───────────
  sessionFolderStore.runsStore = runsSidebarStore;
  sessionFolderStore.getProjectCwd = () => projectSelectionStore.projectCwd;
  sessionFolderStore.onRunsReloadRequested = async () => {
    await runsSidebarStore.loadRuns();
  };

  // ── Settings cache context ─────────────────────────────────────
  const settingsLoader = createSettingsLoader();
  let settings = $state<UserSettings | null>(null);
  setContext<SettingsCacheContext>(SETTINGS_CACHE_CONTEXT_KEY, {
    get settings() {
      return settings;
    },
    whenReady: async () => settingsLoader.start(),
    refresh: async () => {
      const next = await settingsLoader.refresh();
      if (next) settings = next;
      return next;
    },
  });

  // ── Runs cache context (gate for downstream pages) ─────────────
  setContext<RunsCacheContext>(RUNS_CACHE_CONTEXT_KEY, {
    get runs() {
      return runsSidebarStore.runs;
    },
    whenReady: async () => runsSidebarStore.whenRunsReady(),
  });

  const bootstrapDemand = createBootstrapDemandController({
    teamStore,
    runsStore: runsSidebarStore,
    sessionFolderStore,
  });
  setContext(BOOTSTRAP_DEMAND_CONTEXT_KEY, bootstrapDemand);

  let { children } = $props();

  // P0-debug: log every navigation so we can see whether /workbench
  // routing actually fires. Quiet by default; set localStorage.miwarpDebug
  // = "nav" to enable.
  if (typeof window !== "undefined" && localStorage.getItem("miwarpDebug")?.includes("nav")) {
    afterNavigate(({ from, to }) => {
      console.log("[nav]", { from: from?.url.pathname, to: to?.url.pathname });
    });
  }

  // Keep `<html>` theme attrs in sync with themeStore (bubbles, fonts, surfaces).
  // init() loads persisted state; this effect covers setTheme/setMode/setColorScheme
  // and recovers if a late init() or hydration left the DOM on codex defaults.
  $effect(() => {
    if (typeof document === "undefined") return;
    void themeStore.currentTheme;
    void themeStore.mode;
    void themeStore.colorScheme;
    void themeStore.effectiveMode;
    themeStore.applyToDom();
  });

  // ── Mount ──────────────────────────────────────────────────────
  onMount(() => {
    // 1. Project-selection: rehydrate from localStorage
    projectSelectionStore.init();

    // 2. Settings: kick off the single-flight load. Apply side-effects
    //    (zoom, visual-perf, credentials migration, update coordinator
    //    auto-check) once resolved.
    void settingsLoader.start().then(async (loaded) => {
      if (!loaded) return;
      // Publish immediately so child routes (/personal, /settings) can sync-
      // hydrate on first paint without waiting for applyUserSettings side effects.
      settings = loaded;
      const applied = await applyUserSettings(loaded);
      settings = applied.settings;
      await applyUserSettingsForShell(applied.settings);
    });

    // 3. Demand bootstrap: runs / teams / attention load when the active
    //    route needs them (AppShell re-triggers on navigation).
    bootstrapDemand.ensureForRoute(window.location.pathname);

    // 5. Explorer tree: subscribe to EVT_EXPLORER_FILE_SELECTED
    const stopExplorerFileSync = explorerTreeStore.installExplorerFileSync();

    // 6. Window-level effects (perf harness, splash, sound, external
    //    link, error capture, transport listeners, version read).
    const windowCtl = installAppWindowController({
      onAppVersion: (v) => {
        // AppShell exposes the chip via its own bundledAppVersion state;
        // we only emit through a CustomEvent to keep the store decoupled.
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("miwarp:layout-app-version", { detail: v }));
      },
    });

    // 7. Split-workspace lifecycle (chat → /chat?split=1). Registered
    //    here so the URL-sync machinery is alive on cold start before
    //    the chat route mounts. Identity (runId / cwd) is read lazily
    //    through `getActiveSessionIdentity` so we don't pull SessionStore
    //    into the root's eager import graph.
    initSplitWorkspaceLifecycle({
      getPageUrl: () => get(page).url,
      replaceState,
      getCwd: () => getActiveSessionIdentity().cwd,
      getCurrentRunId: () => getActiveSessionIdentity().runId,
    });

    // 9. Keybindings shortcuts (global app chrome callbacks)
    const unregisterKeybindings = useKeybindingShortcuts(keybindingStore, {
      toggleSidebar: () => {
        // AppShell reads sidebarOpen from its own $state; we toggle it
        // via a window event because AppShell owns the state.
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("miwarp:layout-toggle-sidebar"));
      },
      toggleCommandPalette: () => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("miwarp:layout-toggle-command-palette"));
      },
      newChat: () => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("miwarp:layout-new-chat"));
      },
    });

    // 10. Window event re-emitters (the stores don't auto-subscribe to
    //     window events; the layout owns this bridge).
    const onRunsChanged = () => {
      bootstrapDemand.ensureRunsBootstrap();
      void runsSidebarStore.loadRuns();
      void sessionFolderStore.load();
    };
    const onFavoritesChanged = () => {
      void runsSidebarStore.loadSidebarFavorites();
    };
    const onShowWizard = () => {
      // AppShell owns the showSetupWizard flag; re-emit as a CustomEvent.
      window.dispatchEvent(new CustomEvent("miwarp:layout-show-wizard"));
    };
    const onCwdChanged = () => {
      projectSelectionStore.syncFromStorage();
    };
    const onOpenPermissions = () => {
      window.dispatchEvent(new CustomEvent("miwarp:layout-open-permissions"));
    };
    const onExplorerFileSelected = (e: Event) => {
      // AppShell owns the highlight; we re-emit as CustomEvent for now.
      window.dispatchEvent(
        new CustomEvent("miwarp:layout-explorer-file-selected", {
          detail: (e as CustomEvent).detail,
        }),
      );
    };
    const onUserSettingsChanged = (e: Event) => {
      const next = (e as CustomEvent<UserSettings>).detail;
      if (!next) return;
      settings = next;
      applySettingsChanged(next);
      applyZoom(next.ui_zoom);
      applyVisualPerformance(next.visual_performance_mode);
      appUpdateCoordinator.setAutoCheckEnabled(next.app_auto_update_check_enabled ?? true);
    };
    const onPerfModeChanged = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (mode) applyVisualPerformance(mode);
    };

    window.addEventListener(EVT_RUNS_CHANGED, onRunsChanged);
    window.addEventListener(EVT_FAVORITES_CHANGED, onFavoritesChanged);
    window.addEventListener(EVT_SHOW_WIZARD, onShowWizard);
    window.addEventListener(EVT_CWD_CHANGED, onCwdChanged);
    window.addEventListener(EVT_OPEN_PERMISSIONS, onOpenPermissions);
    window.addEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);
    window.addEventListener("miwarp:visual-performance-changed", onPerfModeChanged);

    // 11. Restore last active session on cold start
    {
      const url = new URL(window.location.href);
      const hasRunParam = url.searchParams.has("run");
      const isChatRoute = url.pathname === "/chat" || url.pathname === "/";
      if (!hasRunParam && isChatRoute) {
        const lastSession = readActiveSessionId();
        if (lastSession) {
          dbg("layout", "auto-restore last session", { lastSession });
          getChatTimelineResetHandle()?.shrinkVisibleRender(24);
          requestAnimationFrame(() => {
            const href = `/chat?run=${encodeURIComponent(lastSession)}`;
            goto(href, { replaceState: true });
          });
        }
      }
    }

    return () => {
      stopExplorerFileSync();
      windowCtl.dispose();
      bootstrapDemand.dispose();
      unregisterKeybindings();
      projectSelectionStore.dispose();
      sessionFolderStore.dispose();
      explorerTreeStore.dispose();
      window.removeEventListener(EVT_RUNS_CHANGED, onRunsChanged);
      window.removeEventListener(EVT_FAVORITES_CHANGED, onFavoritesChanged);
      window.removeEventListener(EVT_SHOW_WIZARD, onShowWizard);
      window.removeEventListener(EVT_CWD_CHANGED, onCwdChanged);
      window.removeEventListener(EVT_OPEN_PERMISSIONS, onOpenPermissions);
      window.removeEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);
      window.removeEventListener("miwarp:visual-performance-changed", onPerfModeChanged);
      appUpdateCoordinator.destroy();
    };
  });

  /**
   * Apply UserSettings side-effects (zoom, visual-perf, update-coordinator
   * auto-check). Kept inline so the layout doesn't grow into a settings
   * service of its own.
   *
   * P1 决策 #2: dev mode 默认关闭自动检查 — Vite (import.meta.env.DEV
   * === true) 启动时短路关闭。用户仍可在 Settings → Update Center
   * 显式开启。生产 release 保持默认 ON（用户态）。
   */
  async function applyUserSettingsForShell(s: UserSettings): Promise<void> {
    applyZoom(s.ui_zoom);
    applyVisualPerformance(s.visual_performance_mode);
    const userPref = s.app_auto_update_check_enabled ?? true;
    const devOverrideOff = import.meta.env.DEV;
    appUpdateCoordinator.startAutoCheck(userPref && !devOverrideOff);
  }
</script>

<svelte:head>
  <title>{t("layout_appName")}</title>
</svelte:head>

<AppShell>
  {@render children()}
</AppShell>
