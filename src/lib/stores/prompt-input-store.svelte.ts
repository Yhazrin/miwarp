/**
 * Shared reactive state for the PromptInput component.
 *
 * Centralises state that multiple sub-components (InputArea, SlashCommandMenu,
 * MentionMenu, AttachmentTray) need to read/write, and that the parent page
 * may need to snapshot or restore (e.g. stash/unstash on session switch).
 */
import type { PromptInputSnapshot } from "$lib/types";

/** A binary file attachment queued for the next send. */
export interface PendingAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  contentBase64?: string;
  filePath?: string;
}

/** A pasted text block displayed as a chip above the textarea. */
export interface PastedBlock {
  id: string;
  text: string;
  lineCount: number;
  charCount: number;
  preview: string;
  ext?: string;
}

/** A reference to a directory or large file (shown as a chip). */
export interface PathRef {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
}

export class PromptInputStore {
  /** Direct ref to the <textarea> element. */
  textareaEl: HTMLTextAreaElement | undefined = $state(undefined);

  /** Current value of the input textarea. */
  inputText: string = $state("");

  /** Active permission mode (synced from parent prop). */
  permissionMode: string = $state("");

  // ── Attachment queue ──

  pendingAttachments: PendingAttachment[] = $state([]);
  pastedBlocks: PastedBlock[] = $state([]);
  pendingPathRefs: PathRef[] = $state([]);

  // ── Derived helpers ──

  /** Whether any content is queued (text, attachments, paste blocks, or path refs). */
  get hasContent(): boolean {
    return (
      this.inputText.trim().length > 0 ||
      this.pendingAttachments.length > 0 ||
      this.pastedBlocks.length > 0 ||
      this.pendingPathRefs.length > 0
    );
  }

  /** Cursor position within the textarea (selectionStart), or -1 if no textarea. */
  get cursorPosition(): number {
    return this.textareaEl?.selectionStart ?? -1;
  }

  // ── Snapshot / restore (compatible with types.PromptInputSnapshot) ──

  getSnapshot(): PromptInputSnapshot {
    return {
      text: this.inputText,
      attachments: [...this.pendingAttachments],
      pastedBlocks: [...this.pastedBlocks],
      pathRefs: [...this.pendingPathRefs],
    };
  }

  restoreSnapshot(snap: PromptInputSnapshot): void {
    this.inputText = snap.text;
    this.pendingAttachments = [...(snap.attachments as PendingAttachment[])];
    this.pastedBlocks = [...(snap.pastedBlocks as PastedBlock[])];
    this.pendingPathRefs = [...((snap.pathRefs ?? []) as PathRef[])];
  }

  /** Clear all input state. */
  clearAll(): void {
    this.inputText = "";
    this.pendingAttachments = [];
    this.pendingPathRefs = [];
    this.pastedBlocks = [];
  }
}
