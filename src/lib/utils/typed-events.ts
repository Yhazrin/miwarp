/**
 * Typed window event-bus shell (v1).
 *
 * Wraps the existing `window.dispatchEvent` / `addEventListener` "ocv:*" /
 * "miwarp:*" event bus with **strong payload types** so:
 *
 *   - `appEvents.emit('project-changed', { cwd })` — payload is checked at compile time.
 *   - `appEvents.on('project-changed', (detail) => …)` — `detail` is typed.
 *   - Handlers get an unsubscribe function (no leaks).
 *
 * This is **a shell only** — it does NOT replace the 133 existing
 * `window.dispatchEvent` call sites. New code is encouraged to use
 * `appEvents`; old code continues to work as-is. Migration is incremental.
 *
 * Migration rules:
 *   - New code: import and use `appEvents.emit / appEvents.on`.
 *   - Old code: keep `window.dispatchEvent(new Event(EVT_X))` until each
 *     site is migrated individually. Both styles interoperate because
 *     `appEvents` is implemented on top of the same window bus.
 *
 * Adding a new event:
 *   1. Add the constant to `bus-events.ts` (e.g. `export const EVT_FOO = "ocv:foo"`).
 *   2. Add the event name and payload shape to `AppEventMap` below.
 *   3. Use `appEvents.emit(EVT_FOO, payload)` and `appEvents.on(EVT_FOO, handler)`.
 *
 * Payload semantics:
 *   - Events dispatched via `new Event(name)` carry **no** `detail`. We model
 *     these as `void` so handlers receive a single argument that is `undefined`.
 *   - Events dispatched via `new CustomEvent(name, { detail })` carry a
 *     typed `detail` object.
 */
import {
  EVT_CWD_CHANGED,
  EVT_EXPLORER_DIFF,
  EVT_EXPLORER_FILE,
  EVT_EXPLORER_FILE_SELECTED,
  EVT_EXPORT_HTML,
  EVT_EXPORT_HTML_ACK,
  EVT_FAVORITES_CHANGED,
  EVT_FILE_DIRTY,
  EVT_FOCUS_PENDING_TOOL,
  EVT_MEMORY_FILE_CREATED,
  EVT_MEMORY_FILE_SAVED,
  EVT_MEMORY_FILE_SELECTED,
  EVT_MEMORY_SELECT,
  EVT_NEW_SESSION,
  EVT_OPEN_MULTI_AGENT,
  EVT_OPEN_PERMISSIONS,
  EVT_PROJECT_CHANGED,
  EVT_RUNS_CHANGED,
  EVT_SHOW_WIZARD,
  EVT_STATUSBAR_TOGGLE,
  EVT_SUMMARIZE_CHAT,
  EVT_SUMMARIZE_CHAT_ACK,
  EVT_TOGGLE_PROGRESS_PANEL,
  EVT_WORKBENCH_STAGE_PROMPT,
} from "./bus-events";

// ── Strong payload types ────────────────────────────────────────────────

/**
 * Map of event-name → detail payload. Each key MUST match the corresponding
 * constant exported from `bus-events.ts` so callers cannot accidentally
 * emit "project-changed" with a misspelled payload type.
 *
 * `void` means the event has no `detail` (dispatched via `new Event(name)`).
 */
export interface AppEventMap {
  [EVT_RUNS_CHANGED]: void;
  [EVT_FOCUS_PENDING_TOOL]: { toolUseId: string };
  [EVT_CWD_CHANGED]: void;
  [EVT_PROJECT_CHANGED]: { cwd: string };
  [EVT_WORKBENCH_STAGE_PROMPT]: { prompt: string };
  [EVT_FAVORITES_CHANGED]: void;
  [EVT_OPEN_PERMISSIONS]: void;
  [EVT_STATUSBAR_TOGGLE]: { expanded: boolean };
  [EVT_SUMMARIZE_CHAT]: void;
  [EVT_SUMMARIZE_CHAT_ACK]: void;
  [EVT_MEMORY_FILE_SELECTED]: void;
  [EVT_MEMORY_FILE_SAVED]: void;
  [EVT_MEMORY_SELECT]: void;
  [EVT_MEMORY_FILE_CREATED]: void;
  [EVT_EXPLORER_FILE]: { path: string };
  [EVT_EXPLORER_DIFF]: void;
  [EVT_EXPLORER_FILE_SELECTED]: { path: string };
  [EVT_FILE_DIRTY]: void;
  [EVT_SHOW_WIZARD]: void;
  [EVT_OPEN_MULTI_AGENT]: void;
  [EVT_EXPORT_HTML]: void;
  [EVT_EXPORT_HTML_ACK]: void;
  [EVT_NEW_SESSION]: void;
  [EVT_TOGGLE_PROGRESS_PANEL]: void;
}

// ── Public API ─────────────────────────────────────────────────────────

type EventName = keyof AppEventMap;

/**
 * Emit a typed window event. The payload type is enforced at compile time:
 *
 *   appEvents.emit(EVT_PROJECT_CHANGED, { cwd: "/x" });      // ✅ ok
 *   appEvents.emit(EVT_PROJECT_CHANGED, { wrong: true });     // ❌ TS error
 *
 * `void`-shaped slots require `undefined` as the second argument; we still
 * dispatch a real `CustomEvent` for the listener to consume consistently.
 */
function emit<K extends EventName>(name: K, detail: AppEventMap[K]): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Subscribe to a typed window event. Returns an unsubscribe function.
 *
 *   const off = appEvents.on(EVT_PROJECT_CHANGED, ({ cwd }) => …);
 *   // later:
 *   off();
 *
 * Handlers receive the typed `detail` payload. For `void`-shaped events the
 * argument is `undefined` (the type system enforces this at the call site).
 */
function on<K extends EventName>(name: K, handler: (detail: AppEventMap[K]) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<AppEventMap[K]>).detail as AppEventMap[K];
    handler(detail);
  };
  window.addEventListener(name, listener);
  return () => {
    window.removeEventListener(name, listener);
  };
}

export const appEvents = { emit, on } as const;
