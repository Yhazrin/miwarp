/**
 * Drag-drop controller for PromptInput.
 *
 * Tracks the drag counter (WebView fires enter/leave for every child element,
 * so a counter is the canonical way to know when the drag actually leaves the
 * zone), and forwards `drop` events to the attachment controller.
 *
 * Disabled when Tauri has `dragDropEnabled: true` — Tauri intercepts OS-level
 * drag events and forwards them via the `tauri://drag-drop` event. In that
 * mode, the parent (Workbench) handles drops via `handle-tauri-drop.ts`.
 *
 * Uses $state runes → file must end in `.svelte.ts`.
 */
import { dbg } from "$lib/utils/debug";
import type { AttachmentController } from "./attachment-controller";

export class DragDropController {
  counter = $state(0);
  get active(): boolean {
    return this.counter > 0;
  }

  constructor(private readonly attachmentCtl: AttachmentController) {}

  handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    this.counter++;
  }

  handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.counter--;
  }

  handleDragOver(e: DragEvent): void {
    e.preventDefault();
  }

  handleDrop(e: DragEvent): void {
    e.preventDefault();
    this.counter = 0;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    dbg("prompt", "drop", { count: files.length });
    void this.attachmentCtl.processFiles(files);
  }
}
