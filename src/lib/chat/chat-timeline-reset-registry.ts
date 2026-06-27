/**
 * chat-timeline-reset-registry — bridge between the layout-level
 * "new session" click and the chat route's timeline state.
 *
 * The status bar's "+" button calls `layoutChrome.newChat()` which lives
 * in `routes/+layout.svelte`. That handler navigates to `/chat?new=1`,
 * but the chat route may still be rendering hundreds of timeline rows
 * from the previous long-running session. The render-to-navigate handoff
 * is what makes the click feel laggy on runs with >500 messages.
 *
 * The layout's session picker and new-chat button call `shrinkVisibleRender`
 * before navigating so long-running timelines collapse to 24 rows first.
 * Only the message list re-renders — the input dock and status bar stay mounted.
 *
 * Module-level singleton, same pattern as `chat-input-registry.ts`.
 */

export interface ChatTimelineResetHandle {
  /** Shrink the visible render window to a small cap (24 rows by default)
   *  so the previous session's tail no longer dominates the DOM cost of
   *  the upcoming navigation. Safe to call when the chat route is not
   *  mounted — caller is expected to fall through to navigation. */
  shrinkVisibleRender(cap?: number): void;
}

let current: ChatTimelineResetHandle | undefined;

export function setChatTimelineResetHandle(next: ChatTimelineResetHandle | undefined): void {
  current = next;
}

export function getChatTimelineResetHandle(): ChatTimelineResetHandle | undefined {
  return current;
}
