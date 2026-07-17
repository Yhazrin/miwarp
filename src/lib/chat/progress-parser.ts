/**
 * v1.0.6 / 5.2 Codex Progress: parse todo / step lists from Agent output.
 *
 * Sources, in priority order:
 *  1. `TodoWrite` / `TaskCreate` / `TaskUpdate` events (preferred — structured).
 *  2. Markdown `- [ ]` / `- [x]` blocks in message text (fallback).
 *
 * The parser is intentionally lenient: it accepts a wide range of inputs
 * (text or events) and returns a stable shape suitable for the right-side
 * Progress tab.
 */

type TodoStatus "pending" | "in_progress" | "completed" | "failed";

export interface ProgressTodo {
  id: string;
  content: string;
  status: TodoStatus;
  /** Best-effort: the timeline entry id where this todo first appeared. */
  sourceEntryId?: string;
}

export interface TaskEventLike {
  type: string;
  task_id?: string;
  subject?: string;
  content?: string;
  status?: string;
  entryId?: string;
}

/**
 * Extract a todo list from a slice of text (markdown bullet list form).
 * Returns an empty array when no todos are found.
 *
 * Recognized:
 *   - [ ] pending
 *   - [x] / [X] completed
 *   - [-] cancelled (mapped to failed for the UI)
 *   - [~] / [/] in_progress
 */
export function parseTodosFromText(text: string, entryId?: string): ProgressTodo[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const todos: ProgressTodo[] = [];
  let counter = 0;
  const todoPattern = new RegExp(String.raw`^\s*-\s*\[( |x|X|-|~|/)\]\s+(.+?)\s*$`);
  for (const line of lines) {
    const m = line.match(todoPattern);
    if (!m) continue;
    const marker = m[1];
    const content = m[2];
    let status: TodoStatus;
    switch (marker) {
      case "x":
      case "X":
        status = "completed";
        break;
      case "-":
        status = "failed";
        break;
      case "~":
      case "/":
        status = "in_progress";
        break;
      default:
        status = "pending";
    }
    todos.push({
      id: `md:${entryId ?? "x"}:${counter++}`,
      content,
      status,
      sourceEntryId: entryId,
    });
  }
  return todos;
}

/**
 * Reduce a list of structured task events into a current todo list.
 * Later events override earlier ones (Last-write-wins keyed by task_id).
 */
export function parseTodosFromEvents(events: TaskEventLike[]): ProgressTodo[] {
  const byId = new Map<string, ProgressTodo>();
  for (const ev of events) {
    if (ev.type !== "task_created" && ev.type !== "task_updated") continue;
    const id = ev.task_id;
    if (!id) continue;
    if (ev.type === "task_created") {
      byId.set(id, {
        id,
        content: ev.subject ?? ev.content ?? "(untitled)",
        status: "pending",
        sourceEntryId: ev.entryId,
      });
    } else {
      const prev = byId.get(id) ?? {
        id,
        content: ev.subject ?? ev.content ?? "(untitled)",
        status: "pending" as TodoStatus,
      };
      const next = ev.status?.toLowerCase();
      let status: TodoStatus = prev.status;
      if (next === "completed" || next === "done") status = "completed";
      else if (next === "in_progress" || next === "active") status = "in_progress";
      else if (next === "failed" || next === "error" || next === "cancelled") status = "failed";
      else if (next === "pending") status = "pending";
      byId.set(id, {
        ...prev,
        content: ev.content ?? prev.content,
        status,
        sourceEntryId: ev.entryId ?? prev.sourceEntryId,
      });
    }
  }
  return [...byId.values()];
}

/** Merge text-derived todos (fallback) with structured events (primary).
 *  Structured events take precedence on id collision. */
export function mergeTodos(events: TaskEventLike[], textTodos: ProgressTodo[]): ProgressTodo[] {
  const structured = parseTodosFromEvents(events);
  const structuredIds = new Set(structured.map((t) => t.id));
  // Drop text todos that conflict with structured ones (avoid duplicates).
  const textOnly = textTodos.filter((t) => !structuredIds.has(t.id));
  return [...structured, ...textOnly];
}
