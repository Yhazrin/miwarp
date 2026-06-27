/**
 * Split workspace lifecycle — URL sync, pane loading, enter/exit orchestration.
 *
 * Keeps side effects out of SplitWorkspaceStore (state only). Chat page
 * registers deps on mount; DnD overlay and toolbar call these helpers.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import { sessionStore as defaultSessionStore } from "$lib/stores";
import {
  splitWorkspaceStore,
  type AddPaneOptions,
  type EnterOptions,
  type PaneId,
  type PaneState,
} from "./split-workspace-store.svelte";
import { splitPaneSessionAdapter, type XtermLike } from "./split-pane-session-adapter";
import { buildChatUrl, isSplitModeUrl } from "./split-workspace-url";

export interface SplitWorkspaceLifecycleDeps {
  getSessionStore: () => SessionStore;
  getPageUrl: () => URL;
  replaceState: (url: URL, state: Record<string, unknown>) => void;
  getXtermRef: () => XtermLike | undefined;
  getCwd: () => string | null;
  getCurrentRunId: () => string | null;
}

let deps: SplitWorkspaceLifecycleDeps | null = null;
let xtermRefGetter: (() => XtermLike | undefined) | null = null;
/** Guards chat `$effect` while we mutate URL + store in one transaction. */
let urlSyncLock = false;

/** Called once from root layout — pointer-drag split depends on this. */
export function initSplitWorkspaceLifecycle(
  partial: Omit<SplitWorkspaceLifecycleDeps, "getSessionStore" | "getXtermRef">,
): void {
  deps = {
    ...partial,
    getSessionStore: () => defaultSessionStore,
    getXtermRef: () => xtermRefGetter?.() ?? undefined,
  };
}

/** Chat page wires the live xterm ref when mounted. */
export function setSplitWorkspaceXtermRef(getter: (() => XtermLike | undefined) | null): void {
  xtermRefGetter = getter;
}

export function registerSplitWorkspaceLifecycle(next: SplitWorkspaceLifecycleDeps): void {
  deps = next;
}

export function unregisterSplitWorkspaceLifecycle(): void {
  deps = null;
  xtermRefGetter = null;
}

export function isSplitUrlSyncLocked(): boolean {
  return urlSyncLock;
}

function requireDeps(): SplitWorkspaceLifecycleDeps {
  if (!deps) throw new Error("[split] lifecycle not registered");
  return deps;
}

function activeRunIdFromStore(): string | null {
  const active =
    splitWorkspaceStore.panes.find((p) => p.paneId === splitWorkspaceStore.activePaneId) ?? null;
  return active?.runId ?? null;
}

export function syncSplitUrlFromStore(): void {
  const d = requireDeps();
  const runId = splitWorkspaceStore.enabled
    ? (activeRunIdFromStore() ?? d.getCurrentRunId())
    : d.getCurrentRunId();
  const next = buildChatUrl(d.getPageUrl(), {
    split: splitWorkspaceStore.enabled,
    runId,
  });
  if (next.href === d.getPageUrl().href) return;
  d.replaceState(next, {});
}

async function loadPane(pane: PaneState): Promise<void> {
  const d = requireDeps();
  const sessionStore = d.getSessionStore();
  if (pane.runtimeState === "active") {
    const currentId = sessionStore.run?.id;
    if (currentId === pane.runId && sessionStore.timeline.length > 0) {
      pane.loadState = "ready";
      pane.errorState = null;
      return;
    }
    await splitPaneSessionAdapter.activate(sessionStore, pane, d.getXtermRef());
  } else {
    await splitPaneSessionAdapter.fetchSnapshot(sessionStore, pane);
  }
}

export async function enterSplitWorkspace(opts: EnterOptions = {}): Promise<void> {
  if (splitWorkspaceStore.enabled) return;
  const d = requireDeps();
  urlSyncLock = true;
  try {
    const runId = opts.activeRunId ?? d.getCurrentRunId();
    d.replaceState(buildChatUrl(d.getPageUrl(), { split: true, runId }), {});
    splitWorkspaceStore.enter({
      cwd: opts.cwd ?? d.getCwd(),
      activeRunId: runId,
    });
    for (const pane of splitWorkspaceStore.panes) {
      await loadPane(pane);
    }
  } finally {
    urlSyncLock = false;
  }
}

export async function addSplitPane(runId: string, opts: AddPaneOptions = {}): Promise<void> {
  if (!runId) return;
  if (!splitWorkspaceStore.enabled) {
    const d = requireDeps();
    const currentRunId = d.getCurrentRunId();
    if (currentRunId && currentRunId !== runId) {
      await enterSplitWorkspace({ activeRunId: currentRunId, cwd: d.getCwd() });
      await addSplitPane(runId, { ...opts, makeActive: false });
    } else {
      await enterSplitWorkspace({ activeRunId: runId, cwd: d.getCwd() });
    }
    return;
  }

  const d = requireDeps();
  const prevActiveId = splitWorkspaceStore.activePaneId;
  const makeActive = opts.makeActive ?? false;
  const pane = splitWorkspaceStore.addPane(runId, { ...opts, makeActive });
  if (!pane) return;

  syncSplitUrlFromStore();

  if (pane.paneId === prevActiveId) {
    if (pane.loadState !== "ready") await loadPane(pane);
    return;
  }

  const leaving =
    prevActiveId != null
      ? (splitWorkspaceStore.panes.find((p) => p.paneId === prevActiveId) ?? null)
      : null;

  if (pane.runtimeState === "active") {
    await splitPaneSessionAdapter.switchActive(d.getSessionStore(), leaving, pane, d.getXtermRef());
    return;
  }

  await loadPane(pane);
}

export async function activateSplitPane(paneId: PaneId): Promise<void> {
  const d = requireDeps();
  const entering = splitWorkspaceStore.panes.find((p) => p.paneId === paneId);
  if (!entering || entering.runtimeState === "active") return;
  const leaving =
    splitWorkspaceStore.panes.find((p) => p.paneId === splitWorkspaceStore.activePaneId) ?? null;
  splitWorkspaceStore.setActive(paneId);
  syncSplitUrlFromStore();
  await splitPaneSessionAdapter.switchActive(
    d.getSessionStore(),
    leaving,
    entering,
    d.getXtermRef(),
  );
}

export async function closeSplitPane(paneId: PaneId): Promise<void> {
  const d = requireDeps();
  const pane = splitWorkspaceStore.panes.find((p) => p.paneId === paneId);
  if (!pane) return;
  const wasActive = pane.runtimeState === "active";
  splitPaneSessionAdapter.cancel(pane);
  splitWorkspaceStore.removePane(paneId);

  if (!splitWorkspaceStore.enabled) {
    await exitSplitWorkspace({ restoreRun: true });
    return;
  }

  syncSplitUrlFromStore();

  if (wasActive) {
    const nextActive =
      splitWorkspaceStore.panes.find((p) => p.paneId === splitWorkspaceStore.activePaneId) ?? null;
    if (nextActive) {
      await splitPaneSessionAdapter.activate(d.getSessionStore(), nextActive, d.getXtermRef());
    }
  }
}

export async function exitSplitWorkspace(opts: { restoreRun?: boolean } = {}): Promise<void> {
  const d = requireDeps();
  const activeRunId = activeRunIdFromStore();
  splitPaneSessionAdapter.cancelAll(splitWorkspaceStore.panes);
  splitWorkspaceStore.exit();
  urlSyncLock = true;
  try {
    d.replaceState(
      buildChatUrl(d.getPageUrl(), { split: false, runId: activeRunId ?? d.getCurrentRunId() }),
      {},
    );
  } finally {
    urlSyncLock = false;
  }
  if (opts.restoreRun !== false && activeRunId) {
    await d.getSessionStore().loadRun(activeRunId, d.getXtermRef());
  }
}

/** Called from chat `$effect` when URL changes (back/forward, sidebar navigation). */
export async function reconcileSplitFromUrl(params: URLSearchParams): Promise<void> {
  if (urlSyncLock || !deps) return;
  const wantSplit = isSplitModeUrl(params);
  if (wantSplit && !splitWorkspaceStore.enabled) {
    const d = requireDeps();
    const runId = params.get("run") ?? d.getCurrentRunId();
    await enterSplitWorkspace({ activeRunId: runId, cwd: d.getCwd() });
  } else if (!wantSplit && splitWorkspaceStore.enabled) {
    await exitSplitWorkspace({ restoreRun: true });
  }
}

export async function toggleSplitWorkspace(): Promise<void> {
  if (splitWorkspaceStore.enabled) {
    await exitSplitWorkspace({ restoreRun: true });
  } else {
    await enterSplitWorkspace();
  }
}

export async function setSplitLayoutMode(
  mode: import("./split-workspace-store.svelte").LayoutMode,
): Promise<void> {
  splitWorkspaceStore.setLayoutMode(mode);
}
