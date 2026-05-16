/**
 * Composable: file handling for PromptInput.
 *
 * Manages file attachments (binary + text), clipboard paste, drag-drop,
 * token estimation, and file toast notifications.
 */
import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import { formatPasteSize } from "$lib/utils/format";
import { uuid } from "$lib/utils/uuid";
import { convertFile } from "$lib/utils/file-convert";
import type { ClipboardFileInfo } from "$lib/api";
import type { PromptInputStore } from "$lib/stores";
import {
  BINARY_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_PASTE_BLOCKS,
  PDF_MAX_BINARY_SIZE,
  PDF_MAX_PATH_SIZE,
  isTextFile,
  isPdf,
  isConvertibleFile,
  isConvertibleByExt,
  isSpreadsheetExt,
  getFileExtension,
  classifyByMime,
  getFileSizeLimit,
  getSizeLimitByMime,
} from "$lib/utils/file-types";

export function useFileHandling(opts: {
  store: PromptInputStore;
  disabled: () => boolean;
  contextWindow: () => number;
}) {
  const { store } = opts;

  // ── Toast ──
  let toastMessage = $state<string | null>(null);
  let toastVariant = $state<"error" | "info">("error");
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  function showFileToast(msg: string, variant: "error" | "info" = "error") {
    toastMessage = msg;
    toastVariant = variant;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastMessage = null;
    }, 3500);
  }

  // ── File input ──
  let fileInput = $state<HTMLInputElement | undefined>();

  // ── Drag-drop ──
  let dragCounter = $state(0);
  const dragActive = $derived(dragCounter > 0);

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    processFiles(files);
  }

  // ── Token estimation ──
  function estimateTokens(text: string): number {
    let chars = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      chars += code >= 0x4e00 && code <= 0x9fff ? 2 : 1;
    }
    return Math.ceil(chars / 4);
  }

  let tokenEstimate = $state(0);
  let tokenDebounce: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const allText = [store.inputText, ...store.pastedBlocks.map((b) => b.text)].join("\n");
    if (tokenDebounce) clearTimeout(tokenDebounce);
    tokenDebounce = setTimeout(() => {
      tokenEstimate = allText ? estimateTokens(allText) : 0;
    }, 300);
  });

  const tokenPercent = $derived(
    opts.contextWindow() > 0 && tokenEstimate > 0
      ? Math.round((tokenEstimate / opts.contextWindow()) * 100)
      : 0,
  );
  const tokenWarning = $derived(tokenPercent > 80);
  const showTokenEstimate = $derived(tokenEstimate > 0);

  // ── Helpers ──

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

  function wrapPathInBackticks(p: string): string {
    let maxRun = 0;
    let currentRun = 0;
    for (const ch of p) {
      if (ch === "`") {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    const fence = "`".repeat(maxRun + 1);
    const needsPadding = p.startsWith("`") || p.endsWith("`");
    return needsPadding ? `${fence} ${p} ${fence}` : `${fence}${p}${fence}`;
  }

  // ── File processing ──

  async function processFiles(files: FileList | File[]) {
    let binaryRemaining = MAX_ATTACHMENTS - store.pendingAttachments.length;
    let textRemaining = MAX_PASTE_BLOCKS - store.pastedBlocks.length;
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      const detectedPdf = !isPdf(file.type) && getFileExtension(file.name) === "pdf";
      const effectivePdf = isPdf(file.type) || detectedPdf;

      // PDF >20MB ≤100MB: save to temp, use path-reference
      if (effectivePdf && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showFileToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }));
          continue;
        }
        if (binaryRemaining <= 0) {
          showFileToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }));
          break;
        }
        binaryRemaining--;
        try {
          const buffer = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          const tempPath = await api.saveTempAttachment(file.name, base64);
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: "application/pdf",
              size: file.size,
              filePath: tempPath,
            },
          ];
          dbg("prompt", "pdf-temp-path-ref", { name: file.name, size: file.size, path: tempPath });
        } catch (e) {
          binaryRemaining++;
          dbgWarn("prompt", "pdf-temp-save-failed", { name: file.name, error: e });
          showFileToast(t("prompt_fileTooLarge", { limit: "20", name: file.name }));
        }
        continue;
      }

      // Size check
      const sizeLimit = getFileSizeLimit(file);
      if (file.size > sizeLimit) {
        const limitMB = sizeLimit / (1024 * 1024);
        showFileToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }));
        continue;
      }

      // Binary attachment: images + PDF (≤20MB)
      if (BINARY_ATTACHMENT_TYPES.includes(file.type) || detectedPdf) {
        if (binaryRemaining <= 0) {
          showFileToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }));
          break;
        }
        binaryRemaining--;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] ?? "";
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name || `attachment.${file.type.split("/")[1] || "bin"}`,
              type: detectedPdf ? "application/pdf" : file.type,
              size: file.size,
              contentBase64: base64,
            },
          ];
          dbg("prompt", "add-binary-file", { name: file.name, type: file.type, size: file.size });
        };
        reader.readAsDataURL(file);
        continue;
      }

      // Text file → pastedBlock
      if (isTextFile(file)) {
        if (textRemaining <= 0) {
          showFileToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }));
          break;
        }
        textRemaining--;
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const lines = text.split("\n");
          const lineCount = lines.length;
          const charCount = text.length;
          const ext = getFileExtension(file.name);
          const preview = file.name || `file.${ext}`;

          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount,
              preview,
              ext,
            },
          ];
          dbg("prompt", "add-text-file", {
            name: file.name,
            lines: lineCount,
            chars: charCount,
          });
        };
        reader.readAsText(file);
        continue;
      }

      // Convertible → await conversion, then add as pastedBlock
      if (isConvertibleFile(file)) {
        if (textRemaining <= 0) {
          showFileToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }));
          break;
        }
        textRemaining--;
        try {
          const { text } = await convertFile(file);
          const lineCount = text.split("\n").length;
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "converted-file", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++;
          showFileToast(t("prompt_conversionFailed", { name: file.name }));
          dbgWarn("prompt", "conversion-failed", { name: file.name, error: e });
        }
        continue;
      }

      // Unsupported
      rejected.push(getFileExtension(file.name) || file.type || "unknown");
    }
    if (rejected.length > 0) {
      showFileToast(t("prompt_unsupportedFile", { ext: rejected[0] }));
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    processFiles(files);
    input.value = "";
  }

  function removeAttachment(id: string) {
    store.pendingAttachments = store.pendingAttachments.filter((a) => a.id !== id);
  }

  // ── Clipboard paste ──

  function handlePaste(e: ClipboardEvent) {
    // Step 1: Check for clipboard binary files (images, PDF) BEFORE text
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
        if (filesToProcess.length > 0) processFiles(filesToProcess);
        return;
      }
    }

    // Step 2: Text paste handling
    const text = e.clipboardData?.getData("text/plain");

    if (!text) {
      e.preventDefault();
      tryNativeClipboardPaste();
      return;
    }

    const lines = text.split("\n");
    const lineCount = lines.length;
    const charCount = text.length;

    if (lineCount < 5 && charCount < 500) {
      const snapshot = store.inputText;
      const cursorPos = store.textareaEl?.selectionStart ?? store.inputText.length;
      tryNativeClipboardPaste(snapshot, cursorPos);
      return;
    }

    // Long text → intercept, compress into chip
    e.preventDefault();
    if (store.pastedBlocks.length >= MAX_PASTE_BLOCKS) {
      showFileToast(t("prompt_maxPasteBlocks", { count: String(MAX_PASTE_BLOCKS) }));
      return;
    }

    const firstLine = lines[0].trim();
    const preview = firstLine.length > 40 ? firstLine.slice(0, 40) + "..." : firstLine;

    store.pastedBlocks = [
      ...store.pastedBlocks,
      {
        id: uuid().slice(0, 8),
        text,
        lineCount,
        charCount,
        preview,
      },
    ];

    dbg("prompt", "paste-compressed", { lineCount, charCount, blocks: store.pastedBlocks.length });
  }

  async function tryNativeClipboardPaste(snapshot?: string, cursorPos?: number) {
    try {
      const files = await withTimeout(api.getClipboardFiles(), 250);
      if (files.length === 0) return;

      dbg("prompt", "native-clipboard-files", { count: files.length });

      if (snapshot !== undefined) {
        store.inputText = snapshot;
        if (store.textareaEl && cursorPos !== undefined) {
          requestAnimationFrame(() => {
            store.textareaEl!.selectionStart = store.textareaEl!.selectionEnd = cursorPos;
          });
        }
      }
      await processClipboardPaths(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (snapshot === undefined && msg.includes("not yet supported")) {
        showFileToast(t("prompt_clipboardUnsupported"));
      }
      dbg("prompt", "native clipboard failed/timeout", e);
    }
  }

  async function processClipboardPaths(files: ClipboardFileInfo[]) {
    let binaryRemaining = MAX_ATTACHMENTS - store.pendingAttachments.length;
    let textRemaining = MAX_PASTE_BLOCKS - store.pastedBlocks.length;
    const rejected: string[] = [];

    for (const file of files) {
      const clipboardPdf =
        file.mime_type !== "application/pdf" && getFileExtension(file.name).toLowerCase() === "pdf";
      const effectiveMime = clipboardPdf ? "application/pdf" : file.mime_type;

      // PDF path-reference: >20MB ≤100MB
      if (isPdf(effectiveMime) && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showFileToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }));
          continue;
        }
        if (binaryRemaining <= 0) {
          showFileToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }));
          break;
        }
        binaryRemaining--;
        store.pendingAttachments = [
          ...store.pendingAttachments,
          {
            id: uuid().slice(0, 8),
            name: file.name,
            type: effectiveMime,
            size: file.size,
            filePath: file.path,
          },
        ];
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
        showFileToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }));
        continue;
      }
      const cls = classifyByMime(effectiveMime);

      if (cls === "binary") {
        if (binaryRemaining <= 0) {
          showFileToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }));
          break;
        }
        binaryRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, false);
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: effectiveMime,
              size: file.size,
              contentBase64: content.content_base64,
            },
          ];
          dbg("prompt", "clipboard-binary", { name: file.name, type: effectiveMime });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "text") {
        if (textRemaining <= 0) {
          showFileToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }));
          break;
        }
        textRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, true);
          const text = content.content_text ?? "";
          const lineCount = text.split("\n").length;
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "clipboard-text", { name: file.name, lines: lineCount });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "convertible" || isConvertibleByExt(getFileExtension(file.name))) {
        if (textRemaining <= 0) {
          showFileToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }));
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
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "clipboard-converted", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++;
          showFileToast(t("prompt_conversionFailed", { name: file.name }));
          dbgWarn("prompt", "clipboard-convert-error", { name: file.name, error: e });
        }
      } else {
        rejected.push(getFileExtension(file.name) || "unknown");
      }
    }
    if (rejected.length > 0) {
      showFileToast(t("prompt_unsupportedFile", { ext: rejected[0] }));
    }
  }

  function removePastedBlock(id: string) {
    store.pastedBlocks = store.pastedBlocks.filter((b) => b.id !== id);
  }

  function removePathRef(id: string) {
    store.pendingPathRefs = store.pendingPathRefs.filter((r) => r.id !== id);
  }

  // ── Public helpers ──

  function addFiles(files: FileList | File[]) {
    return processFiles(files);
  }

  function addPathRefs(refs: Array<{ path: string; name: string; isDir: boolean }>) {
    const newRefs = refs.map((ref) => ({
      id: uuid().slice(0, 8),
      name: ref.name,
      path: ref.path,
      isDir: ref.isDir,
    }));
    store.pendingPathRefs = [...store.pendingPathRefs, ...newRefs];
    dbg("prompt", "add-path-refs", { count: refs.length });
  }

  function showToast(message: string, variant: "error" | "info" = "info") {
    showFileToast(message, variant);
  }

  /** Get attachments and path refs for send, then clear them. */
  function getAttachmentsForSend(): {
    regularAtts: Array<{ name: string; type: string; size: number; contentBase64: string }>;
    pathRefParts: string[];
    pathRefAttParts: string[];
  } {
    const regularAtts = store.pendingAttachments
      .filter((a) => a.contentBase64)
      .map((a) => ({
        name: a.name,
        type: a.type,
        size: a.size,
        contentBase64: a.contentBase64!,
      }));
    const pathRefAttParts = store.pendingAttachments
      .filter((a) => a.filePath && !a.contentBase64)
      .map((a) => `[PDF: ${a.filePath}]`);
    const pathRefParts = store.pendingPathRefs.map((r) => wrapPathInBackticks(r.path));
    return { regularAtts, pathRefParts, pathRefAttParts };
  }

  const canSend = $derived(
    !opts.disabled() &&
      (!!store.inputText.trim() ||
        store.pastedBlocks.length > 0 ||
        store.pendingAttachments.some((a) => a.filePath) ||
        store.pendingPathRefs.length > 0),
  );

  return {
    get toastMessage() {
      return toastMessage;
    },
    get toastVariant() {
      return toastVariant;
    },
    get fileInput() {
      return fileInput;
    },
    set fileInput(v: HTMLInputElement | undefined) {
      fileInput = v;
    },
    get dragActive() {
      return dragActive;
    },
    get tokenEstimate() {
      return tokenEstimate;
    },
    get tokenPercent() {
      return tokenPercent;
    },
    get tokenWarning() {
      return tokenWarning;
    },
    get showTokenEstimate() {
      return showTokenEstimate;
    },
    get canSend() {
      return canSend;
    },
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    handleFileSelect,
    processFiles,
    removeAttachment,
    removePastedBlock,
    removePathRef,
    addFiles,
    addPathRefs,
    showToast,
    getAttachmentsForSend,
    showFileToast,
    wrapPathInBackticks,
    // Re-exports for template
    isSpreadsheetExt,
    formatPasteSize,
  };
}
