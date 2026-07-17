/**
 * Auto-scroll composable — extracted from +page.svelte.
 *
 * Manages the auto-scroll effect that pins the chat area to the bottom
 * during streaming, and the permission-pending auto-scroll behavior.
 */
import { dbg } from "$lib/utils/debug";

export interface AutoScrollDeps {
  store: {
    readonly run: { readonly id: string } | null;
    readonly useStreamSession: boolean;
    readonly timeline: readonly unknown[];
    readonly streamingText: string;
    readonly hasPendingPermission: boolean;
  };
  getChatAreaRef: () => HTMLDivElement | undefined;
  scrollState: {
    isChatAutoScroll: boolean;
    readingHistory: boolean;
    showChatScrollHint: boolean;
    prevTl: number;
    prevSt: number;
    prevPermissionRunId: string;
    prevHadPermission: boolean;
    restoringScroll: boolean;
    scrollToInFlight: boolean;
  };
  pinChatToBottom: () => void;
  followChatBottom: () => void;
  scrollChatToBottom: () => void;
}

export function createAutoScroll(deps: AutoScrollDeps) {
  // Auto-scroll chat (only when user is near bottom)
  $effect(() => {
    if (deps.store.useStreamSession && deps.getChatAreaRef()) {
      const tl = deps.store.timeline.length;
      const st = deps.store.streamingText.length;
      const _rid = deps.store.run?.id;
      const tlChanged = tl !== deps.scrollState.prevTl;
      const stChanged = st !== deps.scrollState.prevSt;
      deps.scrollState.prevTl = tl;
      deps.scrollState.prevSt = st;
      if (!tlChanged && !stChanged) return;

      if (deps.scrollState.isChatAutoScroll && !deps.scrollState.readingHistory) {
        if (tlChanged) {
          requestAnimationFrame(() => {
            if (
              deps.getChatAreaRef() &&
              deps.scrollState.isChatAutoScroll &&
              !deps.scrollState.readingHistory
            ) {
              deps.pinChatToBottom();
            }
          });
        } else if (stChanged) {
          deps.followChatBottom();
        }
      } else {
        deps.scrollState.showChatScrollHint = true;
      }
    }
  });

  // Reset scroll state on run change
  $effect(() => {
    void deps.store.run?.id;
    if (!deps.scrollState.restoringScroll) {
      deps.scrollState.isChatAutoScroll = !deps.scrollState.scrollToInFlight;
      deps.scrollState.readingHistory = false;
    }
    deps.scrollState.showChatScrollHint = false;
    deps.scrollState.prevTl = 0;
    deps.scrollState.prevSt = 0;
  });

  // Permission pending auto-scroll
  $effect(() => {
    const runId = deps.store.run?.id ?? "";
    const needsApproval = deps.store.hasPendingPermission;

    if (runId !== deps.scrollState.prevPermissionRunId) {
      deps.scrollState.prevPermissionRunId = runId;
      deps.scrollState.prevHadPermission = false;
    }

    if (needsApproval && !deps.scrollState.prevHadPermission) {
      if (!deps.getChatAreaRef() || deps.scrollState.readingHistory) return;
      requestAnimationFrame(() => {
        if (!deps.scrollState.readingHistory) deps.scrollChatToBottom();
      });
      dbg("chat", "permission pending -> autoscroll to inline card", { runId });
    }

    deps.scrollState.prevHadPermission = needsApproval;
  });
}
