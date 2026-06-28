/**
 * layout-bootstrap-demand — defer expensive layout bootstrap work (runs IPC,
 * teams subscription, attention reconciliation) until the active route actually
 * needs it. The root layout used to fire all three on every cold start even
 * when the user landed on /personal or /settings.
 *
 * Single-flight: concurrent ensure* calls dedupe through module-local guards.
 * Pure TypeScript — no Svelte runes.
 */
import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
import type { TeamStore } from "$lib/stores/team-store.svelte";
import { dbg } from "$lib/utils/debug";
import type { RunsSidebarStore } from "./runs-sidebar-store.svelte";
import type { SessionFolderStore } from "./session-folder-store.svelte";
import { createTeamSubscription, type TeamSubscription } from "./team-subscription.svelte";

export function routeNeedsRunsBootstrap(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/chat" ||
    pathname.startsWith("/explorer") ||
    pathname.startsWith("/workbench") ||
    pathname.startsWith("/scheduled-tasks")
  );
}

export function routeNeedsTeamsBootstrap(pathname: string): boolean {
  return pathname.startsWith("/teams");
}

export function routeNeedsAttentionBootstrap(pathname: string): boolean {
  return pathname.startsWith("/workbench");
}

export type BootstrapDemandDeps = {
  teamStore: Pick<
    TeamStore,
    "loadTeams" | "forceRefresh" | "handleTeamUpdate" | "handleTaskUpdate"
  >;
  runsStore: Pick<RunsSidebarStore, "loadRuns" | "loadSidebarFavorites" | "startPoll">;
  sessionFolderStore: Pick<SessionFolderStore, "load">;
};

export type BootstrapDemandController = {
  ensureRunsBootstrap: () => void;
  ensureTeamsBootstrap: () => void;
  ensureAttentionBootstrap: () => void;
  ensureForRoute: (pathname: string) => void;
  dispose: () => void;
};

export function createBootstrapDemandController(
  deps: BootstrapDemandDeps,
): BootstrapDemandController {
  let runsStarted = false;
  let stopRunsPoll: (() => void) | null = null;
  let teamSub: TeamSubscription | null = null;
  let attentionStarted = false;

  function ensureRunsBootstrap(): void {
    if (runsStarted) return;
    runsStarted = true;
    dbg("bootstrap", "demand: runs sidebar");
    stopRunsPoll = deps.runsStore.startPoll();
    void deps.runsStore.loadRuns();
    void deps.runsStore.loadSidebarFavorites();
    void deps.sessionFolderStore.load();
  }

  function ensureTeamsBootstrap(): void {
    if (teamSub) return;
    dbg("bootstrap", "demand: teams subscription");
    teamSub = createTeamSubscription(deps.teamStore, () => true);
  }

  function ensureAttentionBootstrap(): void {
    if (attentionStarted) return;
    attentionStarted = true;
    dbg("bootstrap", "demand: attention reconciliation");
    void (async () => {
      try {
        await attentionQueueStore.reconcile();
        await attentionQueueStore.loadSnapshot();
        await attentionQueueStore.subscribe();
      } catch {
        /* desktop-only durable queue; ignore when transport unavailable */
      }
    })();
  }

  function ensureForRoute(pathname: string): void {
    if (routeNeedsRunsBootstrap(pathname)) ensureRunsBootstrap();
    if (routeNeedsTeamsBootstrap(pathname)) ensureTeamsBootstrap();
    if (routeNeedsAttentionBootstrap(pathname)) ensureAttentionBootstrap();
  }

  return {
    ensureRunsBootstrap,
    ensureTeamsBootstrap,
    ensureAttentionBootstrap,
    ensureForRoute,
    dispose: () => {
      stopRunsPoll?.();
      stopRunsPoll = null;
      teamSub?.dispose();
      teamSub = null;
    },
  };
}
