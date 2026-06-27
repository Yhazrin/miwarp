/**
 * History controller for PromptInput.
 *
 * Implements Up/Down navigation through `userHistory`. Uses the existing
 * `input-history` utilities; the controller wraps them with:
 *   - draft capture/restore (so the user's in-progress text isn't lost)
 *   - multi-line edge detection (defer to next frame when textarea wraps)
 *   - the absolute-edge immediate path
 *   - post-action cursor positioning
 *
 * This controller is a plain class (no runes) so it can be tested in the
 * vitest node env without the Svelte runtime.
 */
import { dbg } from "$lib/utils/debug";
import {
  type HistoryAction,
  type HistoryState,
  checkAndReset,
  createHistoryState,
  getHistoryAction,
  hasMultipleVisualLines,
  resetHistory,
  shouldIntercept,
} from "$lib/utils/input-history";
import type { PromptInputSnapshot } from "$lib/types";
import { stripKeyboardControlChars } from "./text-input-controller";

export interface HistoryControllerDeps {
  /** Read the current input text + draft source. */
  getInputText: () => string;
  setInputText: (text: string) => void;
  /** Build a snapshot of the current draft (text + attachments + pastes). */
  getSnapshot: () => PromptInputSnapshot;
  /** Restore a previously captured draft. */
  restoreSnapshot: (snap: PromptInputSnapshot) => void;
  /** Read/clear pending paste blocks. */
  getPastedBlocks: () => unknown[];
  setPastedBlocks: (blocks: unknown[]) => void;
  /** Read/clear pending attachments. */
  getAttachments: () => unknown[];
  setAttachments: (atts: unknown[]) => void;
  /** Get the textarea for cursor positioning. */
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  /** Notify parent to run autoResize after text change. */
  scheduleAutoResize: () => void;
  /** User history (parent-owned). */
  userHistory: () => string[];
  /** Stable scope key (e.g. run ID) to reset state on session change. */
  scopeKey: () => string;
}

export class HistoryController {
  private state: HistoryState = createHistoryState();

  constructor(private readonly deps: HistoryControllerDeps) {}

  /** Re-check scope/length and reset if changed. Returns true if reset. */
  syncScope(): boolean {
    return checkAndReset(this.state, this.deps.userHistory().length, this.deps.scopeKey());
  }

  /** Reset history navigation back to the draft. */
  reset(): void {
    resetHistory(this.state);
  }

  /** Returns true if a keydown should be intercepted for history navigation. */
  shouldHandleKey(
    key: string,
    e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
    menus: { atMenuOpen: boolean; slashMenuOpen: boolean },
  ): boolean {
    return shouldIntercept(
      key,
      e,
      { ...menus, modeDropdownOpen: false },
      this.deps.getTextareaEl()?.selectionStart ?? 0,
      this.deps.getTextareaEl()?.selectionEnd ?? 0,
      this.deps.userHistory().length,
    );
  }

  /** Public entry point — same signature as the parent's `applyHistoryAction`. */
  apply(action: NonNullable<HistoryAction>): void {
    if (action.type === "boundary") {
      dbg("prompt-history", "boundary", { index: this.state.index });
      return;
    }

    if (action.type === "enter") {
      this.state.draft = this.deps.getSnapshot();
      this.state.index = action.index;
      dbg("prompt-history", "up: enter history", {
        index: 0,
        total: this.deps.userHistory().length,
      });
    } else if (action.type === "up") {
      this.state.index = action.index;
      dbg("prompt-history", "up", { index: action.index });
    } else if (action.type === "down") {
      this.state.index = action.index;
      dbg("prompt-history", "down", { index: action.index });
    } else if (action.type === "restore-draft") {
      this.state.index = -1;
      if (this.state.draft) {
        dbg("prompt-history", "restore-draft", {
          textLen: this.state.draft.text.length,
          atts: this.state.draft.attachments.length,
          pastes: this.state.draft.pastedBlocks.length,
        });
        this.deps.restoreSnapshot(this.state.draft);
        this.state.draft = null;
        return; // restoreSnapshot handles autoResize + focus
      }
      this.deps.setInputText("");
      this.deps.setAttachments([]);
      this.deps.setPastedBlocks([]);
    }

    if (action.type !== "restore-draft") {
      const history = this.deps.userHistory();
      if (this.state.index >= history.length) {
        dbg("prompt-history", "stale index, resetting", {
          index: this.state.index,
          len: history.length,
        });
        resetHistory(this.state);
        return;
      }
      this.deps.setInputText(stripKeyboardControlChars(history[this.state.index]));
      this.deps.setAttachments([]);
      this.deps.setPastedBlocks([]);
    }

    const el = this.deps.getTextareaEl();
    requestAnimationFrame(() => {
      this.deps.scheduleAutoResize();
      if (el) {
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
  }

  /**
   * High-level handler used by the text-input router. Returns true if it
   * consumed the key (and parent should preventDefault).
   */
  handleKey(
    key: "ArrowUp" | "ArrowDown",
    menus: { atMenuOpen: boolean; slashMenuOpen: boolean },
  ): boolean {
    if (
      !this.shouldHandleKey(
        key,
        { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
        menus,
      )
    ) {
      return false;
    }
    const el = this.deps.getTextareaEl();
    if (!el) return false;

    if (hasMultipleVisualLines(el)) {
      const posBefore = el.selectionStart;
      const atAbsoluteEdge =
        (key === "ArrowUp" && posBefore === 0) ||
        (key === "ArrowDown" && posBefore === el.value.length);
      if (atAbsoluteEdge) {
        const action = getHistoryAction(
          key,
          this.state,
          this.deps.userHistory().length,
          el.value,
          posBefore,
        );
        if (action) {
          this.apply(action);
          return true;
        }
      }
      // Let browser move the cursor; check on next frame
      requestAnimationFrame(() => {
        const live = this.deps.getTextareaEl();
        if (!live || live.selectionStart !== posBefore) return;
        const action = getHistoryAction(
          key,
          this.state,
          this.deps.userHistory().length,
          live.value,
          live.selectionStart,
        );
        if (action) this.apply(action);
      });
      return false; // let browser handle cursor first
    }

    // Single visual line: handle immediately
    const action = getHistoryAction(
      key,
      this.state,
      this.deps.userHistory().length,
      el.value,
      el.selectionStart,
    );
    if (action) {
      this.apply(action);
      return true;
    }
    return false;
  }
}
