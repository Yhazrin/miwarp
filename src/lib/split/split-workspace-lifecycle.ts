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
import {
  buildChatUrl,
  isSplitModeUrl,
  readLayoutFromUrl,
  readPaneSetFromUrl,
  type PaneSetPayload,
} from "./split-workspace-url";

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

/**
 * Run `fn` while the URL-sync lock is held. Used by URL writers inside the
 * lifecycle so chat-page $effect doesn't observe our own mutation and
 * immediately re-reconcile. Always restores the previous lock state on exit
 * (supports nested calls).
 */
export function withSplitUrlSyncLock<T>(fn: () => T): T {
  const prev = urlSyncLock;
  urlSyncLock = true;
  try {
    return fn();
  } finally {
    urlSyncLock = prev;
  }
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
    panes: splitWorkspaceStore.enabled
      ? splitWorkspaceStore.panes.map((p) => ({ id: p.paneId, r: p.runId }))
      : undefined,
    activePaneId: splitWorkspaceStore.enabled ? splitWorkspaceStore.activePaneId : undefined,
    layout: splitWorkspaceStore.enabled ? splitWorkspaceStore.layoutMode : null,
  });
  if (next.href === d.getPageUrl().href) return;
  // Briefly hold the URL sync lock so the chat-page $effect doesn't observe
  // our own URL mutation and immediately call `reconcileSplitFromUrl` back
  // into the store we just mutated. (URL → effect → reconcile → store → URL
  // round-trip otherwise re-runs the same logic with no net change but can
  // race with concurrent user navigation.)
  withSplitUrlSyncLock(() => {
    d.replaceState(next, {});
  });
}

async function loadPane(pane: PaneState): Promise<void> {
  const d = requireDeps();
  const sessionStore = d.getSessionStore();
  // Capture store-wide gen at call site; discard post-await if user
  // switched panes while we were waiting.
  const ctx = { switchGeneration: splitWorkspaceStore.switchGeneration };
  if (pane.runtimeState === "active") {
    const currentId = sessionStore.run?.id;
    if (currentId === pane.runId && sessionStore.timeline.length > 0) {
      pane.loadState = "ready";
      pane.errorState = null;
      return;
    }
    await splitPaneSessionAdapter.activate(sessionStore, pane, ctx, d.getXtermRef());
  } else {
    await splitPaneSessionAdapter.fetchSnapshot(sessionStore, pane, ctx);
  }
}

/**
 * Enter split mode with a full pane set (P2-1). If `paneSet` is omitted we
 * fall back to `opts.activeRunId` (legacy single-pane seed). Pass the parsed
 * `?panes=` payload from the URL when restoring from a deep link so all
 * panes (and the active selection) survive a reload.
 */
async function enterSplitWorkspaceInternal(
  opts: EnterOptions & {
    paneSet?: PaneSetPayload | null;
    layout?: "single" | "dual" | "triple" | "quad" | null;
  },
): Promise<void> {
  if (splitWorkspaceStore.enabled) return;
  const d = requireDeps();
  urlSyncLock = true;
  try {
    // When paneSet is provided, seed ALL panes via addPane() so the
    // active-run-id logic doesn't accidentally overwrite one of the URLs's
    // pane runIds. Without paneSet, seed a single pane from activeRunId.
    const runId = opts.activeRunId ?? d.getCurrentRunId();
    const targetPaneSet =
      opts.paneSet ??
      (runId ? { v: 1 as const, items: [{ id: "_seed", r: runId }], active: "_seed" } : null);

    // Initial URL write with a placeholder pane so the URL is canonical
    // before the store creates real pane ids (the store assigns fresh ids
    // via `makePaneId`, so the canonical URL only lands after the store is
    // populated and we re-sync below).
    d.replaceState(
      buildChatUrl(d.getPageUrl(), {
        split: true,
        runId: targetPaneSet?.items.find((it) => it.id === targetPaneSet.active)?.r ?? runId,
        panes: targetPaneSet ? targetPaneSet.items : undefined,
        activePaneId: targetPaneSet?.active ?? null,
        layout: opts.layout ?? null,
      }),
      {},
    );
    splitWorkspaceStore.enter({
      cwd: opts.cwd ?? d.getCwd(),
      // Only seed via enter() when paneSet is absent (single-pane legacy path).
      activeRunId: opts.paneSet ? null : runId,
    });
    if (targetPaneSet) {
      for (const ref of targetPaneSet.items) {
        splitWorkspaceStore.addPane(ref.r, { silent: true, makeActive: false });
      }
    }
    // Re-apply the active pane from the URL.
    if (targetPaneSet?.active) {
      const target = splitWorkspaceStore.panes.find((p) => p.runId === targetPaneSet.active);
      // The paneSet.active is the URL's pane *id*, not runId. We map back
      // to runId via items so the right pane gets activated.
      const targetActiveRef = targetPaneSet.items.find((it) => it.id === targetPaneSet.active);
      const targetByRun = splitWorkspaceStore.panes.find((p) => p.runId === targetActiveRef?.r);
      if (targetByRun) splitWorkspaceStore.setActive(targetByRun.paneId);
      else if (target) splitWorkspaceStore.setActive(target.paneId);
    }
    // Re-apply layout from URL (defaults to single).
    if (opts.layout) splitWorkspaceStore.setLayoutMode(opts.layout);
    for (const pane of splitWorkspaceStore.panes) {
      await loadPane(pane);
    }
    // Now that the store has real pane ids, write the canonical URL.
    syncSplitUrlFromStore();
  } finally {
    urlSyncLock = false;
  }
}

export async function enterSplitWorkspace(opts: EnterOptions = {}): Promise<void> {
  return enterSplitWorkspaceInternal(opts);
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
    await splitPaneSessionAdapter.switchActive(
      d.getSessionStore(),
      leaving,
      pane,
      { switchGeneration: splitWorkspaceStore.switchGeneration },
      d.getXtermRef(),
    );
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
    { switchGeneration: splitWorkspaceStore.switchGeneration },
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
      await splitPaneSessionAdapter.activate(
        d.getSessionStore(),
        nextActive,
        { switchGeneration: splitWorkspaceStore.switchGeneration },
        d.getXtermRef(),
      );
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
    // split:false → buildChatUrl strips panes/layout automatically.
    d.replaceState(
      buildChatUrl(d.getPageUrl(), {
        split: false,
        runId: activeRunId ?? d.getCurrentRunId(),
        panes: undefined,
        activePaneId: undefined,
        layout: null,
      }),
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
  const paneSet = readPaneSetFromUrl(params);
  const layout = readLayoutFromUrl(params);

  // Case 1: wantSplit && !enabled — enter. Pass the URL-derived pane set so
  // a deep link with multiple panes restores all of them.
  if (wantSplit && !splitWorkspaceStore.enabled) {
    const d = requireDeps();
    const activeRunId = paneSet?.active
      ? (paneSet.items.find((it) => it.id === paneSet.active)?.r ?? d.getCurrentRunId())
      : (paneSet?.items[0]?.r ?? d.getCurrentRunId());
    await enterSplitWorkspaceInternal({
      activeRunId,
      cwd: d.getCwd(),
      paneSet,
      layout,
    });
    return;
  }

  // Case 2: !wantSplit && enabled — exit.
  if (!wantSplit && splitWorkspaceStore.enabled) {
    await exitSplitWorkspace({ restoreRun: true });
    return;
  }

  // Case 3: wantSplit && enabled — reconcile active run with URL.
  if (!wantSplit || !splitWorkspaceStore.enabled) return;
  const urlRun = params.get("run") ?? paneSet?.items.find((it) => it.id === paneSet.active)?.r;
  if (!urlRun) return;
  const d = requireDeps();
  const activePane =
    splitWorkspaceStore.panes.find((p) => p.paneId === splitWorkspaceStore.activePaneId) ?? null;
  if (activePane && activePane.runId === urlRun) {
    // Active pane matches; still sync layout if URL differs.
    if (layout && layout !== splitWorkspaceStore.layoutMode) {
      splitWorkspaceStore.setLayoutMode(layout);
    }
    return;
  }
  const targetPane = splitWorkspaceStore.panes.find((p) => p.runId === urlRun) ?? null;
  if (targetPane) {
    if (targetPane.paneId !== activePane?.paneId) {
      await activateSplitPane(targetPane.paneId);
    }
    if (layout && layout !== splitWorkspaceStore.layoutMode) {
      splitWorkspaceStore.setLayoutMode(layout);
    }
    return;
  }
  if (activePane) {
    // URL run not in workspace; rewrite URL to match active pane.
    withSplitUrlSyncLock(() => {
      const next = buildChatUrl(d.getPageUrl(), {
        split: true,
        runId: activePane.runId,
        panes: splitWorkspaceStore.panes.map((p) => ({ id: p.paneId, r: p.runId })),
        activePaneId: splitWorkspaceStore.activePaneId,
        layout: splitWorkspaceStore.layoutMode,
      });
      if (next.href !== d.getPageUrl().href) d.replaceState(next, {});
    });
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

/**
 * Re-fetch a single inactive pane's snapshot. Used by SplitChatPane's
 * 30s polling (P2-3) so inactive panes pick up new bus events the user
 * hasn't activated yet. No-op if the pane is no longer inactive or has no
 * cached snapshot to refresh.
 *
 * Exposed as a lifecycle helper so the pane component doesn't need direct
 * access to the sessionStore (which is registered via deps).
 */
export async function refreshInactivePaneSnapshot(paneId: PaneId): Promise<void> {
  const d = deps ? deps : requireDeps();
  const pane = splitWorkspaceStore.panes.find((p) => p.paneId === paneId);
  if (!pane) return;
  if (pane.runtimeState !== "inactive") return;
  if (!pane.cachedSnapshot) return;
  await splitPaneSessionAdapter.fetchSnapshot(
    d.getSessionStore(),
    pane,
    { switchGeneration: splitWorkspaceStore.switchGeneration },
    true,
  );
}
