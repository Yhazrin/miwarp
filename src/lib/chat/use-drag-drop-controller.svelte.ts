/**
 * Composable: Tauri native file drag-and-drop handling.
 *
 * Manages page-level drag state and processes dropped files/directories
 * with concurrency-limited parallel processing.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import { mapSettled } from "$lib/utils/async-utils";
import * as api from "$lib/api";
import { t } from "$lib/i18n/index.svelte";

export function useDragDropController(opts: {
  getPromptRef: () =>
    | {
        addPathRefs: (refs: Array<{ path: string; name: string; isDir: boolean }>) => void;
        addFiles: (files: File[]) => Promise<void>;
        showToast: (msg: string) => void;
      }
    | undefined;
}) {
  let pageDragActive = $state(false);
  let dragProcessingCount = $state(0);
  const dragProcessing = $derived(dragProcessingCount > 0);

  async function handleTauriDrop(payload: { paths: string[] }) {
    pageDragActive = false;
    const paths = payload.paths;
    const input = opts.getPromptRef();
    if (!paths?.length || !input) return;

    dragProcessingCount++;
    dbg("chat", "tauri-drop", { count: paths.length });

    try {
      const classified = await mapSettled(
        paths,
        async (p) => {
          const name = p.split(/[/\\]/).pop() || "file";
          const isDir = await api.checkIsDirectory(p);
          return { p, name, isDir };
        },
        5,
      );

      const dirRefs: Array<{ path: string; name: string; isDir: true }> = [];
      const fileEntries: Array<{ p: string; name: string }> = [];

      for (let i = 0; i < classified.length; i++) {
        const result = classified[i];
        const p = paths[i];
        const name = p.split(/[/\\]/).pop() || "file";
        if (result.status === "fulfilled") {
          if (result.value.isDir) {
            dirRefs.push({ path: p, name, isDir: true });
            dbg("chat", "tauri-drop: dir", { name });
          } else {
            fileEntries.push({ p, name });
          }
        } else {
          fileEntries.push({ p, name });
          dbgWarn("chat", "tauri-drop: classify failed, treating as file", {
            name,
            error: result.reason,
          });
        }
      }

      const fileResults = await mapSettled(
        fileEntries,
        async ({ p, name }) => {
          const [base64, mime] = await api.readFileBase64(p);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          return { file: new File([bytes], name, { type: mime }), name, mime, size: bytes.length };
        },
        2,
      );

      const filesToProcess: File[] = [];
      const fileRefs: Array<{ path: string; name: string; isDir: false }> = [];

      for (let i = 0; i < fileResults.length; i++) {
        const result = fileResults[i];
        const { p, name } = fileEntries[i];
        if (result.status === "fulfilled") {
          filesToProcess.push(result.value.file);
          dbg("chat", "tauri-drop: file", {
            name: result.value.name,
            mime: result.value.mime,
            size: result.value.size,
          });
        } else {
          fileRefs.push({ path: p, name, isDir: false });
          dbgWarn("chat", "tauri-drop: fallback to path ref", { name, error: result.reason });
        }
      }

      if (opts.getPromptRef() !== input) {
        dbgWarn("chat", "tauri-drop: promptRef stale after processing, discarding");
        return;
      }

      const allPathRefs = [...dirRefs, ...fileRefs];
      if (allPathRefs.length > 0) {
        input.addPathRefs(allPathRefs);
      }

      if (filesToProcess.length > 0) {
        await input.addFiles(filesToProcess);
      }

      if (allPathRefs.length > 0) {
        const parts: string[] = [];
        if (dirRefs.length > 0) {
          parts.push(t("drag_foldersInserted", { count: String(dirRefs.length) }));
        }
        if (fileRefs.length > 0) {
          parts.push(t("drag_filesAsPathRef", { count: String(fileRefs.length) }));
        }
        input.showToast(parts.join(t("common_listSeparator")));
      }
    } finally {
      dragProcessingCount--;
    }
  }

  return {
    get pageDragActive() {
      return pageDragActive;
    },
    set pageDragActive(v: boolean) {
      pageDragActive = v;
    },
    get dragProcessing() {
      return dragProcessing;
    },
    handleTauriDrop,
  };
}
