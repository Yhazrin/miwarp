/**
 * Command History pattern for SessionStore.
 *
 * Provides undo/redo capability for session operations.
 * Uses the Memento pattern for state snapshots and Command pattern for operations.
 *
 * Usage:
 * ```ts
 * const history = new CommandHistory<string, SessionSnapshot>({ maxSize: 50 });
 * history.push("send_message", snapshot);
 * const undone = history.undo(); // Returns { type, snapshot } or undefined
 * ```
 */

/** A snapshot of state that can be restored. */
export interface Snapshot<T> {
  /** Serialized state for comparison and restoration */
  serialize(): string;
  /** Deep clone for immutability */
  clone(): T;
}

/** A command with its associated state snapshot. */
export interface HistoryEntry<TState, TCommand extends string = string> {
  /** Command identifier */
  readonly type: TCommand;
  /** State snapshot before the command executed */
  readonly before: TState;
  /** Optional state snapshot after the command (for redo support) */
  readonly after?: TState;
  /** Timestamp when command was executed */
  readonly timestamp: number;
  /** Optional metadata about the command */
  readonly metadata?: Record<string, unknown>;
}

/** Configuration for CommandHistory */
export interface CommandHistoryOptions {
  /** Maximum number of entries to keep (default: 100) */
  maxSize?: number;
  /** Whether to keep 'after' snapshots (default: false) */
  keepAfterStates?: boolean;
  /** Commands that should not be undoable */
  excludedCommands?: Set<string>;
}

const DEFAULT_MAX_SIZE = 100;

export class CommandHistory<TState, TCommand extends string = string> {
  /** Stack of executed commands (for undo) */
  private undoStack: HistoryEntry<TState, TCommand>[] = [];
  /** Stack of undone commands (for redo) */
  private redoStack: HistoryEntry<TState, TCommand>[] = [];
  private readonly maxSize: number;
  private readonly keepAfterStates: boolean;
  private readonly excludedCommands: Set<string>;

  constructor(options: CommandHistoryOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.keepAfterStates = options.keepAfterStates ?? false;
    this.excludedCommands = options.excludedCommands ?? new Set();
  }

  /** Push a new command onto the history. Clears redo stack. */
  push(type: TCommand, before: TState, after?: TState, metadata?: Record<string, unknown>): void {
    // Skip excluded commands
    if (this.excludedCommands.has(type)) return;

    const entry: HistoryEntry<TState, TCommand> = {
      type,
      before,
      after: this.keepAfterStates ? after : undefined,
      timestamp: Date.now(),
      metadata,
    };

    this.undoStack.push(entry);

    // Enforce max size
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    // Clear redo stack when new command is pushed
    this.redoStack = [];
  }

  /**
   * Undo the last command. Returns the entry with its 'before' state.
   * The caller should restore state from entry.before.
   */
  undo(): HistoryEntry<TState, TCommand> | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;

    // Push to redo stack
    this.redoStack.push(entry);
    return entry;
  }

  /**
   * Redo the last undone command. Returns the entry with its 'after' state (or 'before' if not kept).
   */
  redo(): HistoryEntry<TState, TCommand> | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;

    // Push back to undo stack
    this.undoStack.push(entry);
    return entry;
  }

  /** Check if undo is available */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Check if redo is available */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Get the number of available undo operations */
  undoCount(): number {
    return this.undoStack.length;
  }

  /** Get the number of available redo operations */
  redoCount(): number {
    return this.redoStack.length;
  }

  /** Preview the next undo entry without actually undoing */
  peekUndo(): HistoryEntry<TState, TCommand> | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  /** Preview the next redo entry without actually redoing */
  peekRedo(): HistoryEntry<TState, TCommand> | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Get all undo entries (most recent first) */
  getUndoHistory(): ReadonlyArray<HistoryEntry<TState, TCommand>> {
    return [...this.undoStack].reverse();
  }

  /** Clear all history */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Get summary for debugging */
  getSummary(): { undoCount: number; redoCount: number; maxSize: number } {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      maxSize: this.maxSize,
    };
  }
}

/**
 * SessionSnapshot: a memento-style snapshot of SessionStore state.
 * Used for undo/redo operations.
 */
export interface SessionStateSnapshot {
  phase: string;
  timelineLength: number;
  toolsLength: number;
  runId: string | null;
  messageCount: number;
}

/**
 * Create a snapshot from SessionStore fields.
 */
export function createSessionSnapshot(state: {
  phase: string;
  timeline: unknown[];
  tools: unknown[];
  run: { id: string } | null;
}): SessionStateSnapshot {
  return {
    phase: state.phase,
    timelineLength: state.timeline.length,
    toolsLength: state.tools.length,
    runId: state.run?.id ?? null,
    messageCount: state.timeline.filter((e: unknown) => (e as { kind?: string })?.kind === "user")
      .length,
  };
}

/**
 * Commands that can be tracked in session history.
 */
export type SessionCommand =
  | "send_message"
  | "approve_tool"
  | "deny_tool"
  | "start_session"
  | "stop_session"
  | "fork_session"
  | "resume_session"
  | "clear_context"
  | "switch_mode";

/** Commands that should not be undoable (for reference/documentation) */
export const UNDOABLE_COMMANDS = new Set<SessionCommand>([
  "send_message",
  "start_session",
  "fork_session",
  "resume_session",
  "clear_context",
]);

/**
 * Create a CommandHistory specialized for session operations.
 */
export function createSessionCommandHistory(
  maxSize = 50,
): CommandHistory<SessionStateSnapshot, SessionCommand> {
  return new CommandHistory({
    maxSize,
    excludedCommands: new Set(["approve_tool", "deny_tool", "switch_mode"]),
  });
}

/**
 * Command descriptions for UI display.
 */
export const COMMAND_LABELS: Record<SessionCommand, string> = {
  send_message: "Send Message",
  approve_tool: "Approve Tool",
  deny_tool: "Deny Tool",
  start_session: "Start Session",
  stop_session: "Stop Session",
  fork_session: "Fork Session",
  resume_session: "Resume Session",
  clear_context: "Clear Context",
  switch_mode: "Switch Mode",
};
