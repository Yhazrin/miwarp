/**
 * Scroll management composable for the chat page.
 * Encapsulates auto-scroll state, reading history tracking,
 * and scroll-related effects.
 */
export interface ScrollState {
  isChatAutoScroll: boolean;
  readingHistory: boolean;
  showChatScrollHint: boolean;
  showScrollButton: boolean;
  /** Non-reactive flag: suppresses auto-scroll reset during search scroll-to navigation. */
  scrollToInFlight: boolean;
  /** Non-reactive flag: suppresses auto-scroll during scroll restoration from cache. */
  restoringScroll: boolean;
}

export function createScrollState(getStore: () => { timeline: { length: number }; streamingText: string; run: { id: string } | null; hasPendingPermission: boolean }, _getChatAreaRef: () => HTMLDivElement | undefined) {
  let isChatAutoScroll = $state(true);
  let readingHistory = $state(false);
  let showChatScrollHint = $state(false);
  const showScrollButton = $derived(!isChatAutoScroll && getStore().timeline.length > 0);
  // Non-reactive flags
  let scrollToInFlight = false;
  let restoringScroll = false;

  // Auto-scroll tracking
  let prevTl = 0;
  let prevSt = 0;

  // Permission pending auto-scroll tracking
  let prevPermissionRunId = "";
  let prevHadPermission = false;

  function resetScrollFlags() {
    scrollToInFlight = false;
    restoringScroll = false;
  }

  function setScrollToInFlight(v: boolean) {
    scrollToInFlight = v;
  }

  function setRestoringScroll(v: boolean) {
    restoringScroll = v;
  }

  function setIsChatAutoScroll(v: boolean) {
    isChatAutoScroll = v;
  }

  function setReadingHistory(v: boolean) {
    readingHistory = v;
  }

  function setShowChatScrollHint(v: boolean) {
    showChatScrollHint = v;
  }

  return {
    get isChatAutoScroll() { return isChatAutoScroll; },
    set isChatAutoScroll(v: boolean) { isChatAutoScroll = v; },
    get readingHistory() { return readingHistory; },
    set readingHistory(v: boolean) { readingHistory = v; },
    get showChatScrollHint() { return showChatScrollHint; },
    set showChatScrollHint(v: boolean) { showChatScrollHint = v; },
    get showScrollButton() { return showScrollButton; },
    get scrollToInFlight() { return scrollToInFlight; },
    set scrollToInFlight(v: boolean) { scrollToInFlight = v; },
    get restoringScroll() { return restoringScroll; },
    set restoringScroll(v: boolean) { restoringScroll = v; },
    get prevTl() { return prevTl; },
    set prevTl(v: number) { prevTl = v; },
    get prevSt() { return prevSt; },
    set prevSt(v: number) { prevSt = v; },
    get prevPermissionRunId() { return prevPermissionRunId; },
    set prevPermissionRunId(v: string) { prevPermissionRunId = v; },
    get prevHadPermission() { return prevHadPermission; },
    set prevHadPermission(v: boolean) { prevHadPermission = v; },
    resetScrollFlags,
    setScrollToInFlight,
    setRestoringScroll,
    setIsChatAutoScroll,
    setReadingHistory,
    setShowChatScrollHint,
  };
}

export type ChatScrollState = ReturnType<typeof createScrollState>;
