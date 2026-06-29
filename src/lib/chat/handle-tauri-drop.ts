import * as api from "$lib/api";
import { isSessionDragActive } from "$lib/utils/session-drag-state";
import { mapSettled } from "$lib/utils/async-utils";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { showToast } from "$lib/stores/toast-store.svelte";

interface PathRef {
  path: string;
  name: string;
  isDir: boolean;
}

interface PromptInputRef {
  addPathRefs(refs: PathRef[]): void;
  addFiles(files: File[]): Promise<void>;
}

export interface TauriDropContext {
  promptRef: PromptInputRef | undefined;
  t: (key: string, params?: Record<string, string>) => string;
  onProcessingStart: () => void;
  onProcessingEnd: () => void;
  onDragEnd: () => void;
}

export async function handleTauriDrop(
  ctx: TauriDropContext,
  payload: { paths: string[] },
): Promise<void> {
  const { promptRef: input, t, onProcessingStart, onProcessingEnd, onDragEnd } = ctx;

  onDragEnd();
  if (isSessionDragActive()) return;
  const paths = payload.paths;
  if (!paths?.length || !input) return;

  onProcessingStart();
  dbg("chat", "tauri-drop", { count: paths.length });

  try {
    // Phase 1: parallel classify (concurrency=5 to avoid IPC flood on large batches)
    const classified = await mapSettled(
      paths,
      async (p) => {
        const name = p.split(/[/\\]/).pop() || "file";
        const isDir = await api.checkIsDirectory(p);
        return { p, name, isDir };
      },
      5,
    );

    const dirRefs: PathRef[] = [];
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

    // Phase 1.5: issue a one-time drop grant for every file the user
    // just dropped into the window. The grant is bound to the exact
    // canonical paths of this drop and expires in 30 s, so the
    // subsequent readFileBase64 calls (Phase 2) can succeed without
    // re-opening the SSRF-like hole the P0-1 hardening closed.
    // Browser-mode IPC / WebSocket callers cannot obtain a grant, so
    // the boundary check still applies for them.
    let dropGrantId: string | null = null;
    if (fileEntries.length > 0) {
      try {
        dropGrantId = await api.issueDropGrant(fileEntries.map(({ p }) => p));
        dbg("chat", "tauri-drop: grant issued", {
          grantIdPrefix: dropGrantId.slice(0, 12),
          count: fileEntries.length,
        });
      } catch (err) {
        dbgWarn("chat", "tauri-drop: issueDropGrant failed; reads will use fallback", {
          error: err,
        });
        dropGrantId = null;
      }
    }

    // Phase 2: parallel file read (concurrency=2 to limit memory)
    const fileResults = await mapSettled(
      fileEntries,
      async ({ p, name }) => {
        const [base64, mime] = await api.readFileBase64(p, undefined, dropGrantId ?? undefined);
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        return { file: new File([bytes], name, { type: mime }), name, mime, size: bytes.length };
      },
      2,
    );

    const filesToProcess: File[] = [];
    const fileRefs: PathRef[] = [];

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

    // Add path refs (dirs + failed files)
    const allPathRefs = [...dirRefs, ...fileRefs];
    if (allPathRefs.length > 0) {
      input.addPathRefs(allPathRefs);
    }

    // Normal files → existing addFiles pipeline
    if (filesToProcess.length > 0) {
      await input.addFiles(filesToProcess);
    }

    // Single summary toast
    if (allPathRefs.length > 0) {
      const parts: string[] = [];
      if (dirRefs.length > 0) {
        parts.push(t("drag_foldersInserted", { count: String(dirRefs.length) }));
      }
      if (fileRefs.length > 0) {
        parts.push(t("drag_filesAsPathRef", { count: String(fileRefs.length) }));
      }
      showToast(parts.join(t("common_listSeparator")));
    }
  } finally {
    onProcessingEnd();
  }
}
