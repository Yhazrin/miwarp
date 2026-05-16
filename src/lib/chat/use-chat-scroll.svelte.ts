/**
 * Composable: chat area scroll management.
 *
 * Tracks auto-scroll state, scroll-to-bottom hint, and handles permission-pending
 * auto-scroll. The progressive timeline composable's `rearmLoadMore` is called
 * from `handleChatScroll` to coordinate scroll-driven load-more behavior.
 */
import { dbg } from "$lib/utils/debug";

const SCROLL_BOTTOM_THRESHOLD = 40;

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

  // Auto-scroll: follow new content when near bottom
  $effect(() => {
    if (opts.isStreamSession()) {
      const tl = opts.timelineLength();
      const st = opts.streamingTextLength();
      const changed = tl !== prevTl || st !== prevSt;
      prevTl = tl;
      prevSt = st;
      if (isChatAutoScroll) {
        requestAnimationFrame(() => {
          const el = opts.chatAreaRef();
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else if (changed) {
        showChatScrollHint = true;
      }
    }
  });

  // Reset scroll state on run change
  $effect(() => {
    void opts.runId();
    isChatAutoScroll = !opts.scrollToInFlight();
    showChatScrollHint = false;
    prevTl = 0;
    prevSt = 0;
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
      requestAnimationFrame(() => {
        scrollChatToBottom();
      });
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
    const el = opts.chatAreaRef();
    if (el) {
      el.scrollTop = el.scrollHeight;
      showChatScrollHint = false;
      isChatAutoScroll = true;
    }
  }

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
