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
 * The chat route registers a "shrink" handler here on mount. When the
 * layout's newChat fires, it invokes the handler to drop `renderLimit`
 * to a small cap (24) BEFORE navigating — so the long-running timeline
 * has been visually collapsed and Svelte can finish flushing the
 * shrunken DOM in the frame between shrink and goto. This keeps the
 * click feeling instant on huge runs.
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
