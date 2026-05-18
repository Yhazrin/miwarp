/**
 * Composable: chat area scroll management.
 *
 * Tracks auto-scroll state, scroll-to-bottom hint, and handles permission-pending
 * auto-scroll. The progressive timeline composable's `rearmLoadMore` is called
 * from `handleChatScroll` to coordinate scroll-driven load-more behavior.
 */
import { dbg } from "$lib/utils/debug";
import { onDestroy, untrack } from "svelte";

const SCROLL_BOTTOM_THRESHOLD = 96;

export function useChatScroll(opts: {
  chatAreaRef: () => HTMLDivElement | undefined;
  isStreamSession: () => boolean;
  timelineLength: () => number;
  streamingTextLength: () => number;
  runId: () => string;
  hasInlinePermission: () => boolean;
  scrollToInFlight: () => boolean;
  rearmLoadMore: () => void;
}) {
  let isChatAutoScroll = $state(true);
  let showChatScrollHint = $state(false);

  // Internal previous-value trackers for the auto-scroll effect
  let prevTl = 0;
  let prevSt = 0;
  let scrollRaf: number | null = null;
  let settleRaf: number | null = null;

  function cancelScheduledScroll() {
    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    if (settleRaf !== null) {
      cancelAnimationFrame(settleRaf);
      settleRaf = null;
    }
  }

  function commitScrollToBottom() {
    const el = opts.chatAreaRef();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function scheduleScrollToBottom() {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      commitScrollToBottom();

      // Markdown finalization, tool details, and image sizing can settle one frame later.
      if (settleRaf === null) {
        settleRaf = requestAnimationFrame(() => {
          settleRaf = null;
          if (isChatAutoScroll) commitScrollToBottom();
        });
      }
    });
  }

  // Auto-scroll: follow new content when near bottom.
  // IMPORTANT: Do not subscribe this effect to `isChatAutoScroll`. Programmatic
  // scrollTop updates fire `scroll` → handleChatScroll → writes isChatAutoScroll,
  // which would re-run this effect forever (effect_update_depth_exceeded).
  $effect(() => {
    if (!opts.isStreamSession()) return;
    const tl = opts.timelineLength();
    const st = opts.streamingTextLength();
    const changed = tl !== prevTl || st !== prevSt;
    if (!changed) return;
    prevTl = tl;
    prevSt = st;
    untrack(() => {
      if (isChatAutoScroll) {
        scheduleScrollToBottom();
      } else {
        showChatScrollHint = true;
      }
    });
  });

  // Reset scroll state on run change
  $effect(() => {
    void opts.runId();
    isChatAutoScroll = !opts.scrollToInFlight();
    showChatScrollHint = false;
    prevTl = 0;
    prevSt = 0;
    cancelScheduledScroll();
  });

  // Permission pending auto-scroll (inline AskUserQuestion / ExitPlanMode)
  let prevPermissionRunId = "";
  let prevHadPermission = false;

  $effect(() => {
    const rid = opts.runId();
    const hasInline = opts.hasInlinePermission();

    if (rid !== prevPermissionRunId) {
      prevPermissionRunId = rid;
      prevHadPermission = false;
    }

    if (hasInline && !prevHadPermission) {
      const el = opts.chatAreaRef();
      if (!el) return;
      scheduleScrollToBottom();
      dbg("chat", "inline permission pending -> autoscroll", { runId: rid });
    }

    prevHadPermission = hasInline;
  });

  function handleChatScroll() {
    const el = opts.chatAreaRef();
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    isChatAutoScroll = dist < SCROLL_BOTTOM_THRESHOLD;
    if (isChatAutoScroll) showChatScrollHint = false;
    opts.rearmLoadMore();
  }

  function scrollChatToBottom() {
    cancelScheduledScroll();
    commitScrollToBottom();
    showChatScrollHint = false;
    isChatAutoScroll = true;
  }

  onDestroy(cancelScheduledScroll);

  return {
    get isChatAutoScroll() {
      return isChatAutoScroll;
    },
    set isChatAutoScroll(v: boolean) {
      isChatAutoScroll = v;
    },
    get showChatScrollHint() {
      return showChatScrollHint;
    },
    set showChatScrollHint(v: boolean) {
      showChatScrollHint = v;
    },
    handleChatScroll,
    scrollChatToBottom,
  };
}
