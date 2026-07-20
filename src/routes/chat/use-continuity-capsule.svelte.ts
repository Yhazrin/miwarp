/**
 * Continuity Capsule composable — extracted from +page.svelte.
 *
 * Manages per-run state persistence (drafts, anchors, inspector snapshot)
 * so a reload can restore the user's exact position.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import {
  ContinuityCapsuleController,
  type ContinuitySaveInput,
  type PendingRestore,
} from "$lib/chat/continuity-capsule-controller";
import {
  sanitizeDraft as sanitizeDraftForCapsule,
  type ContinuityAnchor,
  type ContinuityDraft,
} from "$lib/chat/continuity-capsule";
import type { PromptInputSnapshot } from "$lib/types";

export interface ContinuityCapsuleDeps {
  store: {
    readonly run: { readonly id: string } | null;
    readonly effectiveCwd: string;
    readonly timeline: readonly unknown[];
    readonly phase: string;
  };
  tl: {
    toolFilter: string | null;
    renderLimit: number;
    loadingRunId: string | null;
    setToolFilter: (f: string | null) => void;
  };
  chatState: {
    processVisibility: string; // ProcessVisibility
    toolPanelActiveTab: unknown;
    requestedPreviewPath: string | null;
    sidebarCollapsed: boolean;
  };
  scrollState: {
    isChatAutoScroll: boolean;
    readingHistory: boolean;
  };
  getPromptRef: () =>
    | {
        getInputSnapshot?: () => unknown;
        restoreSnapshot?: (snap: PromptInputSnapshot) => void;
      }
    | undefined;
  getChatAreaRef: () => HTMLDivElement | undefined;
}

export function createContinuityCapsule(deps: ContinuityCapsuleDeps) {
  let currentAnchor: ContinuityAnchor | null = $state(null);
  let _restoreAppliedFor = $state("");

  // Deferred reference to scrollToMessage (set by caller after scrollNav creation)
  let _scrollToMessage: ((id: string) => Promise<void>) | null = null;

  function buildDraftFromPrompt(): ContinuityDraft | null {
    const prompt = deps.getPromptRef();
    if (!prompt || typeof prompt.getInputSnapshot !== "function") return null;
    let snap: PromptInputSnapshot | null = null;
    try {
      snap = prompt.getInputSnapshot() as PromptInputSnapshot;
    } catch (e) {
      dbgWarn("chat", "continuity.snapshot.failed", { error: String(e) });
      return null;
    }
    return sanitizeDraftForCapsule(snap);
  }

  function captureContinuityInput(): ContinuitySaveInput | null {
    const runId = deps.store.run?.id;
    if (!runId) return null;
    return {
      runId,
      cwd: deps.store.effectiveCwd ?? "",
      draft: buildDraftFromPrompt(),
      toolFilter: deps.tl.toolFilter,
      processVisibility: deps.chatState.processVisibility as ProcessVisibility,
      anchor: currentAnchor,
      inspector: {
        toolPanelActiveTab: deps.chatState.toolPanelActiveTab as ToolActivityPanelTab,
        requestedPreviewPath: deps.chatState.requestedPreviewPath ?? null,
        sidebarCollapsed: deps.chatState.sidebarCollapsed,
      },
    };
  }

  const controller = new ContinuityCapsuleController({
    capture: captureContinuityInput,
    debounceMs: 500,
    onLog: (event, detail) => dbg("continuity", event, detail),
  });

  // Attach on mount; dispose on unmount
  $effect(() => {
    controller.attach();
    return () => {
      controller.flush("dispose");
      controller.dispose();
    };
  });

  // Track first visible row → anchor (rAF-coalesced)
  $effect(() => {
    const _timeline = deps.store.timeline;
    const _area = deps.getChatAreaRef();
    if (!_area) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const area = deps.getChatAreaRef();
      if (!area) return;
      const rootTop = area.getBoundingClientRect().top + 1;
      const el = area.querySelector<HTMLElement>("[data-entry-id]");
      if (!el) {
        currentAnchor = null;
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= rootTop) {
        currentAnchor = null;
        return;
      }
      const entryId = el.getAttribute("data-entry-id") ?? "";
      if (!entryId) {
        currentAnchor = null;
        return;
      }
      currentAnchor = { entryId, offsetPx: Math.max(0, Math.round(rect.top - rootTop)) };
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  });

  // Debounced save on state changes
  $effect(() => {
    const id = deps.store.run?.id;
    if (!id) return;
    void deps.store.effectiveCwd;
    void deps.tl.toolFilter;
    void deps.tl.renderLimit;
    void deps.chatState.toolPanelActiveTab;
    void deps.chatState.sidebarCollapsed;
    void deps.chatState.requestedPreviewPath;
    void deps.chatState.processVisibility;
    void currentAnchor;
    controller.scheduleSave(id);
  });

  function applyRestore(runId: string, restore: PendingRestore): void {
    dbg("continuity", "restore.apply", { runId, savedAt: restore.savedAt });
    // Draft first
    if (restore.draft) {
      const prompt = deps.getPromptRef();
      if (prompt?.restoreSnapshot) {
        const snap: PromptInputSnapshot = {
          text: restore.draft.text,
          attachments: restore.draft.attachments,
          pastedBlocks: restore.draft.pastedBlocks,
          pathRefs: restore.draft.pathRefs,
        };
        try {
          prompt.restoreSnapshot(snap);
        } catch (e) {
          dbgWarn("chat", "continuity.restore.draft.failed", { error: String(e) });
        }
      }
    }
    // Tool filter
    if (restore.toolFilter) {
      deps.tl.setToolFilter(restore.toolFilter);
    } else {
      deps.tl.setToolFilter(null);
    }
    // Inspector panel state
    deps.chatState.toolPanelActiveTab = restore.inspector.toolPanelActiveTab;
    deps.chatState.requestedPreviewPath = restore.inspector.requestedPreviewPath;
    deps.chatState.sidebarCollapsed = restore.inspector.sidebarCollapsed;
    // Anchor scroll
    if (restore.anchor) {
      const anchor = restore.anchor;
      let attempts = 0;
      const tryRestore = () => {
        attempts++;
        const match = (deps.store.timeline as Array<{ id?: string }>).find(
          (e) => e.id === anchor.entryId,
        );
        if (match) {
          deps.scrollState.isChatAutoScroll = false;
          deps.scrollState.readingHistory = true;
          _scrollToMessage?.(anchor.entryId).catch((e: unknown) => {
            dbgWarn("chat", "continuity.anchor.scroll.failed", { error: String(e) });
          });
        } else if (attempts < 6) {
          setTimeout(tryRestore, 80);
        } else {
          dbg("continuity", "restore.anchor.missing", { entryId: anchor.entryId });
          requestAnimationFrame(() => {
            const area = deps.getChatAreaRef();
            if (area) area.scrollTop = area.scrollHeight;
            deps.scrollState.isChatAutoScroll = true;
            deps.scrollState.readingHistory = false;
          });
        }
      };
      tryRestore();
    }
  }

  // Apply pending restore once run is loaded
  $effect(() => {
    const id = deps.store.run?.id;
    if (!id) return;
    if (_restoreAppliedFor === id) return;
    if (deps.tl.loadingRunId) return;
    if (deps.store.phase === "loading") return;
    if (deps.store.timeline.length === 0) return;
    const restore = controller.consumePendingRestore();
    _restoreAppliedFor = id;
    if (restore && restore.runId === id) {
      applyRestore(id, restore);
    }
  });

  return {
    get currentAnchor() {
      return currentAnchor;
    },
    get restoreAppliedFor() {
      return _restoreAppliedFor;
    },
    set restoreAppliedFor(v: string) {
      _restoreAppliedFor = v;
    },
    controller,
    /** Set after scrollNav is created to resolve circular dependency. */
    setScrollToMessage(fn: (id: string) => Promise<void>) {
      _scrollToMessage = fn;
    },
    buildDraftFromPrompt,
  };
}
