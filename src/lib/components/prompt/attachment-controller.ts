/**
 * Attachment controller for PromptInput.
 *
 * Owns all file → attachment / pastedBlock / pathRef conversions:
 *   - processFiles: from <input type="file"> or drag/drop
 *   - processClipboardPaths: from native clipboard (Tauri)
 *   - paste: short text + image/pdf from clipboard
 *   - addPathRefs: directory or large file references (no content)
 *
 * The controller reads `pendingAttachments`, `pastedBlocks`, `pendingPathRefs`
 * directly from the store (no local copy) so the UI reacts instantly.
 *
 * Plain class (no runes) so it can be unit-tested in the vitest node env
 * without the Svelte runtime. The store reads/writes go through dependency
 * accessors supplied by the parent shell.
 */
import * as api from "$lib/api";
import { t } from "$lib/i18n/index.svelte";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { convertFile } from "$lib/utils/file-convert";
import {
  BINARY_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_PASTE_BLOCKS,
  PDF_MAX_BINARY_SIZE,
  PDF_MAX_PATH_SIZE,
  classifyByMime,
  getFileExtension,
  getFileSizeLimit,
  getSizeLimitByMime,
  isConvertibleByExt,
  isConvertibleFile,
  isPdf,
  isTextFile,
} from "$lib/utils/file-types";
import { showToast } from "$lib/stores/toast-store.svelte";
import { uuid } from "$lib/utils/uuid";
import type {
  PastedBlock,
  PathRef,
  PendingAttachment,
} from "$lib/stores/prompt-input-store.svelte";
import { stripKeyboardControlChars } from "./text-input-controller";

const PASTE_PREVIEW_MAX = 40;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export interface AttachmentControllerDeps {
  getAttachments: () => PendingAttachment[];
  setAttachments: (atts: PendingAttachment[]) => void;
  getPastedBlocks: () => PastedBlock[];
  setPastedBlocks: (blocks: PastedBlock[]) => void;
  getPathRefs: () => PathRef[];
  setPathRefs: (refs: PathRef[]) => void;
  getInputText: () => string;
  setInputText: (text: string) => void;
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  /** Notify parent to run autoResize after text change. */
  scheduleAutoResize: () => void;
  /** Notify parent that input text changed (for onValueChange). */
  onInputTextChanged?: () => void;
}

export class AttachmentController {
  constructor(private readonly deps: AttachmentControllerDeps) {}

  // ── Removal ──

  removeAttachment(id: string): void {
    this.deps.setAttachments(this.deps.getAttachments().filter((a) => a.id !== id));
  }

  removePastedBlock(id: string): void {
    this.deps.setPastedBlocks(this.deps.getPastedBlocks().filter((b) => b.id !== id));
  }

  removePathRef(id: string): void {
    this.deps.setPathRefs(this.deps.getPathRefs().filter((r) => r.id !== id));
  }

  // ── File picker / drag-drop entry ──

  async processFiles(files: FileList | File[]): Promise<void> {
    let binaryRemaining = MAX_ATTACHMENTS - this.deps.getAttachments().length;
    let textRemaining = MAX_PASTE_BLOCKS - this.deps.getPastedBlocks().length;
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      const detectedPdf = !isPdf(file.type) && getFileExtension(file.name) === "pdf";
      const effectivePdf = isPdf(file.type) || detectedPdf;

      // PDF >20MB ≤100MB: save to temp, use path-reference
      if (effectivePdf && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }), "error");
          continue;
        }
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        try {
          const buffer = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          const tempPath = await api.saveTempAttachment(file.name, base64);
          this.deps.setAttachments([
            ...this.deps.getAttachments(),
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: "application/pdf",
              size: file.size,
              filePath: tempPath,
            },
          ]);
          dbg("prompt", "pdf-temp-path-ref", {
            name: file.name,
            size: file.size,
            path: tempPath,
          });
        } catch (e) {
          binaryRemaining++;
          dbgWarn("prompt", "pdf-temp-save-failed", { name: file.name, error: e });
          showToast(t("prompt_fileTooLarge", { limit: "20", name: file.name }), "error");
        }
        continue;
      }

      // 1) Size check — per type
      const sizeLimit = getFileSizeLimit(file);
      if (file.size > sizeLimit) {
        const limitMB = sizeLimit / (1024 * 1024);
        showToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }), "error");
        continue;
      }

      // 2) Binary attachment: images + PDF (≤20MB)
      if (BINARY_ATTACHMENT_TYPES.includes(file.type) || detectedPdf) {
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] ?? "";
          this.deps.setAttachments([
            ...this.deps.getAttachments(),
            {
              id: uuid().slice(0, 8),
              name: file.name || `attachment.${file.type.split("/")[1] || "bin"}`,
              type: detectedPdf ? "application/pdf" : file.type,
              size: file.size,
              contentBase64: base64,
            },
          ]);
          dbg("prompt", "add-binary-file", {
            name: file.name,
            type: file.type,
            size: file.size,
          });
        };
        reader.readAsDataURL(file);
        continue;
      }

      // 3) Text file → pastedBlock
      if (isTextFile(file)) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const lines = text.split("\n");
          const ext = getFileExtension(file.name);
          const preview = file.name || `file.${ext}`;
          this.deps.setPastedBlocks([
            ...this.deps.getPastedBlocks(),
            {
              id: uuid().slice(0, 8),
              text,
              lineCount: lines.length,
              charCount: text.length,
              preview,
              ext,
            },
          ]);
          dbg("prompt", "add-text-file", {
            name: file.name,
            lines: lines.length,
            chars: text.length,
          });
        };
        reader.readAsText(file);
        continue;
      }

      // 3.5) Convertible → await conversion
      if (isConvertibleFile(file)) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const { text } = await convertFile(file);
          const lineCount = text.split("\n").length;
          this.deps.setPastedBlocks([
            ...this.deps.getPastedBlocks(),
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ]);
          dbg("prompt", "converted-file", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++;
          showToast(t("prompt_conversionFailed", { name: file.name }), "error");
          dbgWarn("prompt", "conversion-failed", { name: file.name, error: e });
        }
        continue;
      }

      // 4) Unsupported
      rejected.push(getFileExtension(file.name) || file.type || "unknown");
    }
    if (rejected.length > 0) {
      showToast(t("prompt_unsupportedFile", { ext: rejected[0] }), "error");
    }
  }

  // ── Path refs (dragged directories / large files from Tauri) ──

  addPathRefs(refs: Array<{ path: string; name: string; isDir: boolean }>): void {
    const newRefs: PathRef[] = refs.map((ref) => ({
      id: uuid().slice(0, 8),
      name: ref.name,
      path: ref.path,
      isDir: ref.isDir,
    }));
    this.deps.setPathRefs([...this.deps.getPathRefs(), ...newRefs]);
    dbg("prompt", "add-path-refs", { count: refs.length });
  }

  // ── Paste handling ──

  /** Returns true if the controller consumed the event. */
  handlePaste(e: ClipboardEvent): boolean {
    // 1) Binary files from clipboard
    const items = e.clipboardData?.items;
    if (items) {
      const binaryItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i++) {
        if (BINARY_ATTACHMENT_TYPES.includes(items[i].type)) {
          binaryItems.push(items[i]);
        } else if (items[i].kind === "file") {
          const file = items[i].getAsFile();
          if (file && getFileExtension(file.name) === "pdf") {
            binaryItems.push(items[i]);
          }
        }
      }
      if (binaryItems.length > 0) {
        e.preventDefault();
        const filesToProcess: File[] = [];
        for (const item of binaryItems) {
          const file = item.getAsFile();
          if (file) filesToProcess.push(file);
        }
        if (filesToProcess.length > 0) void this.processFiles(filesToProcess);
        return true;
      }
    }

    // 2) Text paste handling
    let text = e.clipboardData?.getData("text/plain");
    if (text) {
      const clean = stripKeyboardControlChars(text);
      if (clean !== text) {
        e.preventDefault();
        text = clean;
        if (!text) return true;
        const el = this.deps.getTextareaEl();
        const start = el?.selectionStart ?? this.deps.getInputText().length;
        const end = el?.selectionEnd ?? start;
        const before = this.deps.getInputText().slice(0, start);
        const after = this.deps.getInputText().slice(end);
        const textLen = text.length;
        this.deps.setInputText(before + text + after);
        requestAnimationFrame(() => {
          const live = this.deps.getTextareaEl();
          if (!live) return;
          live.selectionStart = live.selectionEnd = start + textLen;
          this.deps.scheduleAutoResize();
        });
        this.deps.onInputTextChanged?.();
        return true;
      }
    }

    if (!text) {
      // Empty text — likely Finder file paste
      e.preventDefault();
      void this.tryNativeClipboardPaste();
      return true;
    }

    const lines = text.split("\n");
    const lineCount = lines.length;
    const charCount = text.length;

    if (lineCount < 5 && charCount < 500) {
      // Short text — async-check for native clipboard files
      const snapshot = this.deps.getInputText();
      const cursorPos =
        this.deps.getTextareaEl()?.selectionStart ?? this.deps.getInputText().length;
      void this.tryNativeClipboardPaste(snapshot, cursorPos);
      return false; // let browser insert text
    }

    // Long text → intercept, compress into chip
    e.preventDefault();
    if (this.deps.getPastedBlocks().length >= MAX_PASTE_BLOCKS) {
      showToast(t("prompt_maxPasteBlocks", { count: String(MAX_PASTE_BLOCKS) }), "error");
      return true;
    }

    const firstLine = lines[0].trim();
    const preview =
      firstLine.length > PASTE_PREVIEW_MAX
        ? firstLine.slice(0, PASTE_PREVIEW_MAX) + "..."
        : firstLine;
    this.deps.setPastedBlocks([
      ...this.deps.getPastedBlocks(),
      {
        id: uuid().slice(0, 8),
        text,
        lineCount,
        charCount,
        preview,
      },
    ]);
    dbg("prompt", "paste-compressed", {
      lineCount,
      charCount,
      blocks: this.deps.getPastedBlocks().length,
    });
    return true;
  }

  private async tryNativeClipboardPaste(snapshot?: string, cursorPos?: number): Promise<void> {
    try {
      const files = await withTimeout(api.getClipboardFiles(), 250);
      if (files.length === 0) return; // No files — text already inserted (or empty paste)
      dbg("prompt", "native-clipboard-files", { count: files.length });

      if (snapshot !== undefined) {
        this.deps.setInputText(snapshot);
        const el = this.deps.getTextareaEl();
        if (el && cursorPos !== undefined) {
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = cursorPos;
          });
        }
      }
      await this.processClipboardPaths(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (snapshot === undefined && msg.includes("not yet supported")) {
        showToast(t("prompt_clipboardUnsupported"), "error");
      }
      dbg("prompt", "native clipboard failed/timeout", e);
    }
  }

  private async processClipboardPaths(
    files: Array<{
      name: string;
      path: string;
      mime_type: string;
      size: number;
    }>,
  ): Promise<void> {
    let binaryRemaining = MAX_ATTACHMENTS - this.deps.getAttachments().length;
    let textRemaining = MAX_PASTE_BLOCKS - this.deps.getPastedBlocks().length;
    const rejected: string[] = [];

    for (const file of files) {
      const clipboardPdf =
        file.mime_type !== "application/pdf" && getFileExtension(file.name).toLowerCase() === "pdf";
      const effectiveMime = clipboardPdf ? "application/pdf" : file.mime_type;

      if (isPdf(effectiveMime) && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }), "error");
          continue;
        }
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        this.deps.setAttachments([
          ...this.deps.getAttachments(),
          {
            id: uuid().slice(0, 8),
            name: file.name,
            type: effectiveMime,
            size: file.size,
            filePath: file.path,
          },
        ]);
        dbg("prompt", "clipboard-pdf-path-ref", {
          name: file.name,
          size: file.size,
          path: file.path,
        });
        continue;
      }

      const sizeLimit = getSizeLimitByMime(effectiveMime);
      if (file.size > sizeLimit) {
        const limitMB = sizeLimit / (1024 * 1024);
        showToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }), "error");
        continue;
      }
      const cls = classifyByMime(effectiveMime);

      if (cls === "binary") {
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, false);
          this.deps.setAttachments([
            ...this.deps.getAttachments(),
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: effectiveMime,
              size: file.size,
              contentBase64: content.content_base64,
            },
          ]);
          dbg("prompt", "clipboard-binary", { name: file.name, type: effectiveMime });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "text") {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, true);
          const text = content.content_text ?? "";
          const lineCount = text.split("\n").length;
          this.deps.setPastedBlocks([
            ...this.deps.getPastedBlocks(),
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ]);
          dbg("prompt", "clipboard-text", { name: file.name, lines: lineCount });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "convertible" || isConvertibleByExt(getFileExtension(file.name))) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, false);
          const binary = atob(content.content_base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new File([bytes], file.name, { type: file.mime_type });
          const { text } = await convertFile(blob);
          const lineCount = text.split("\n").length;
          this.deps.setPastedBlocks([
            ...this.deps.getPastedBlocks(),
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ]);
          dbg("prompt", "clipboard-converted", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++;
          showToast(t("prompt_conversionFailed", { name: file.name }), "error");
          dbgWarn("prompt", "clipboard-convert-error", { name: file.name, error: e });
        }
      } else {
        rejected.push(getFileExtension(file.name) || "unknown");
      }
    }
    if (rejected.length > 0) {
      showToast(t("prompt_unsupportedFile", { ext: rejected[0] }), "error");
    }
  }
}
