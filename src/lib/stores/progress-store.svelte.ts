/**
 * v1.0.6 / 5.2 Codex Progress: per-session progress state.
 *
 * The store sits next to SessionStore but stays independent — the chat
 * reducer should not have to grow new fields just to surface a side panel.
 *
 * Data flow:
 *   - Reducer calls `setStructuredEvents(runId, events)` for TodoWrite / task events.
 *   - `setMarkdownTodos(runId, todos)` is fed from a chat-page parser pass.
 *   - `todosFor(runId)` returns the merged list for the right panel.
 */
import { mergeTodos, type ProgressTodo, type TaskEventLike } from "$lib/chat/progress-parser";

interface RunProgress {
  structured: TaskEventLike[];
  markdown: ProgressTodo[];
}

class ProgressStore {
  private _byRun = $state(new Map<string, RunProgress>());

  /** Append structured task events. Last-write-wins on duplicates. */
  pushStructuredEvents(runId: string, events: TaskEventLike[]): void {
    if (!runId || events.length === 0) return;
    const prev = this._byRun.get(runId) ?? { structured: [], markdown: [] };
    const next = new Map(this._byRun);
    next.set(runId, {
      structured: [...prev.structured, ...events],
      markdown: prev.markdown,
    });
    this._byRun = next;
  }

  /** Replace markdown todos (e.g. after re-parsing a long assistant message). */
  setMarkdownTodos(runId: string, todos: ProgressTodo[]): void {
    if (!runId) return;
    const prev = this._byRun.get(runId) ?? { structured: [], markdown: [] };
    const next = new Map(this._byRun);
    next.set(runId, { structured: prev.structured, markdown: todos });
    this._byRun = next;
  }

  /** Returns the merged todo list for the given run. */
  todosFor(runId: string): ProgressTodo[] {
    const rec = this._byRun.get(runId);
    if (!rec) return [];
    return mergeTodos(rec.structured, rec.markdown);
  }

  /** Clear state for a run (e.g. after delete or run switch). */
  clear(runId: string): void {
    if (!this._byRun.has(runId)) return;
    const next = new Map(this._byRun);
    next.delete(runId);
    this._byRun = next;
  }
}

export const progressStore = new ProgressStore();
