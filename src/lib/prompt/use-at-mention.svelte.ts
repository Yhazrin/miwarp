/**
 * Composable: @-mention file path completion for PromptInput.
 *
 * Manages the "@" trigger menu for filesystem path completion.
 */
import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";
import type { DirEntry } from "$lib/types";
import type { PromptInputStore } from "$lib/stores";

export function useAtMention(opts: {
  store: PromptInputStore;
  isRemote: () => boolean;
  cwd: () => string;
  closeSlashMenu: (reason: string) => void;
  closeModeDropdown: () => void;
}) {
  const { store } = opts;

  // ── State ──
  let atMenuOpen = $state(false);
  let atQuery = $state("");
  let atResults = $state<DirEntry[]>([]);
  let atSelectedIndex = $state(0);
  let atLoading = $state(false);
  let atStartPos = $state(-1);
  let atDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Functions ──

  function closeAtMenu(reason: string) {
    if (!atMenuOpen) return;
    dbg("at-mention", `close:${reason}`);
    atMenuOpen = false;
    atQuery = "";
    atResults = [];
    atSelectedIndex = 0;
    atStartPos = -1;
    atLoading = false;
    if (atDebounceTimer) {
      clearTimeout(atDebounceTimer);
      atDebounceTimer = null;
    }
  }

  function openAtMenu(pos: number) {
    if (opts.isRemote()) return;
    opts.closeSlashMenu("at-open");
    opts.closeModeDropdown();
    atMenuOpen = true;
    atStartPos = pos;
    atQuery = "";
    atResults = [];
    atSelectedIndex = 0;
    dbg("at-mention", "open", { pos });
  }

  function resolveAtPath(query: string): string {
    if (!query) return opts.cwd();
    if (query.startsWith("/")) return query;
    const base = opts.cwd().endsWith("/") ? opts.cwd() : opts.cwd() + "/";
    return base + query;
  }

  async function fetchAtResults(query: string) {
    atLoading = true;
    try {
      const lastSlash = query.lastIndexOf("/");
      let dirQuery: string;
      let prefix: string;
      if (lastSlash >= 0) {
        dirQuery = query.slice(0, lastSlash + 1);
        prefix = query.slice(lastSlash + 1).toLowerCase();
      } else {
        dirQuery = "";
        prefix = query.toLowerCase();
      }
      const absPath = resolveAtPath(dirQuery);
      dbg("at-mention", "fetch", { absPath, prefix });
      const listing = await api.listDirectory(absPath, true);
      const filtered = listing.entries
        .filter((e) => e.name.toLowerCase().startsWith(prefix))
        .slice(0, 10);
      atResults = filtered;
      atSelectedIndex = 0;
    } catch (e) {
      dbg("at-mention", "fetch error", e);
      atResults = [];
    } finally {
      atLoading = false;
    }
  }

  function handleAtInput(cursorPos: number) {
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = store.inputText[i];
      if (ch === "@") {
        if (i === 0 || /\s/.test(store.inputText[i - 1])) {
          atPos = i;
        }
        break;
      }
      if (/\s/.test(ch)) break;
    }

    if (atPos >= 0) {
      const query = store.inputText.slice(atPos + 1, cursorPos);
      if (!atMenuOpen) openAtMenu(atPos);
      atQuery = query;

      if (atDebounceTimer) clearTimeout(atDebounceTimer);
      atDebounceTimer = setTimeout(() => {
        fetchAtResults(query);
      }, 150);
    } else if (atMenuOpen) {
      closeAtMenu("no-at");
    }
  }

  function selectAtEntry(entry: DirEntry) {
    if (atStartPos < 0 || !store.textareaEl) return;
    const cursorPos = store.textareaEl.selectionStart ?? store.inputText.length;
    const prefix = store.inputText.slice(0, atStartPos + 1);
    const suffix = store.inputText.slice(cursorPos);

    const lastSlash = atQuery.lastIndexOf("/");
    const dirPrefix = lastSlash >= 0 ? atQuery.slice(0, lastSlash + 1) : "";
    const relativePath = dirPrefix + entry.name;

    if (entry.is_dir) {
      store.inputText = prefix + relativePath + "/" + suffix;
      requestAnimationFrame(() => {
        if (store.textareaEl) {
          const newPos = atStartPos + 1 + relativePath.length + 1;
          store.textareaEl.selectionStart = store.textareaEl.selectionEnd = newPos;
          store.textareaEl.focus();
        }
        handleAtInput(atStartPos + 1 + relativePath.length + 1);
      });
    } else {
      store.inputText = prefix + relativePath + suffix;
      closeAtMenu("select");
      requestAnimationFrame(() => {
        if (store.textareaEl) {
          const newPos = atStartPos + 1 + relativePath.length;
          store.textareaEl.selectionStart = store.textareaEl.selectionEnd = newPos;
          store.textareaEl.focus();
        }
      });
    }
    dbg("at-mention", "select", { name: entry.name, isDir: entry.is_dir });
  }

  return {
    get atMenuOpen() {
      return atMenuOpen;
    },
    get atQuery() {
      return atQuery;
    },
    get atResults() {
      return atResults;
    },
    get atSelectedIndex() {
      return atSelectedIndex;
    },
    set atSelectedIndex(v: number) {
      atSelectedIndex = v;
    },
    get atLoading() {
      return atLoading;
    },
    closeAtMenu,
    handleAtInput,
    selectAtEntry,
  };
}
