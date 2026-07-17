/**
 * Mention controller for PromptInput.
 *
 * Drives the `@`-triggered file/agent reference menu:
 *   - scan backwards from cursor for nearest `@` preceded by whitespace / start
 *   - debounced listDirectory fetch via Tauri API
 *   - directory vs file handling (dir keeps menu open with `/` appended)
 *   - keyboard navigation (Up/Down/Enter/Tab/Esc)
 *
 * Disabled in remote mode (no local listDirectory).
 *
 * Uses $state runes → file must end in `.svelte.ts`.
 */
import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";
import type { DirEntry } from "$lib/types";

export type MentionCloseReason = "escape" | "select" | "click-outside" | "no-at" | "disabled";

export interface MentionControllerDeps {
  getInputText: () => string;
  setInputText: (text: string) => void;
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  getCwd: () => string;
  isRemote: () => boolean;
  /** Force-close sibling slash menu. */
  onCloseSiblingMenu?: () => void;
}

const DEBOUNCE_MS = 150;
const MAX_RESULTS = 10;

export class MentionController {
  open = $state(false);
  query = $state("");
  results: DirEntry[] = $state([]);
  selectedIndex = $state(0);
  loading = $state(false);
  startPos = $state(-1);
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: MentionControllerDeps) {}

  get hasResults(): boolean {
    return this.results.length > 0;
  }

  /** Resolve a relative query against cwd → absolute path for listDirectory. */
  private resolvePath(query: string): string {
    const cwd = this.deps.getCwd();
    if (!query) return cwd;
    if (query.startsWith("/")) return query;
    const base = cwd.endsWith("/") ? cwd : cwd + "/";
    return base + query;
  }

  /** Detection: called from text-input controller on every input. */
  detect(cursorPos: number): void {
    const text = this.deps.getInputText();

    // Scan backwards for @ preceded by whitespace or at position 0
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        if (i === 0 || /\s/.test(text[i - 1])) {
          atPos = i;
        }
        break;
      }
      if (/\s/.test(ch)) break; // whitespace before @ — no active mention
    }

    if (atPos >= 0) {
      const query = text.slice(atPos + 1, cursorPos);
      if (!this.open) this.openMenu(atPos);
      this.query = query;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.fetch(query);
      }, DEBOUNCE_MS);
    } else if (this.open) {
      this.close("no-at");
    }
  }

  openMenu(pos: number): void {
    // Audit #6: disable @ completion in remote mode
    if (this.deps.isRemote()) return;
    this.deps.onCloseSiblingMenu?.();
    this.open = true;
    this.startPos = pos;
    this.query = "";
    this.results = [];
    this.selectedIndex = 0;
    dbg("at-mention", "open", { pos });
  }

  close(reason: MentionCloseReason): void {
    if (!this.open) return;
    dbg("at-mention", `close:${reason}`);
    this.open = false;
    this.query = "";
    this.results = [];
    this.selectedIndex = 0;
    this.startPos = -1;
    this.loading = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  select(entry: DirEntry): void {
    const el = this.deps.getTextareaEl();
    if (this.startPos < 0 || !el) return;
    const cursorPos = el.selectionStart ?? this.deps.getInputText().length;
    const prefix = this.deps.getInputText().slice(0, this.startPos + 1);
    const suffix = this.deps.getInputText().slice(cursorPos);

    const lastSlash = this.query.lastIndexOf("/");
    const dirPrefix = lastSlash >= 0 ? this.query.slice(0, lastSlash + 1) : "";
    const relativePath = dirPrefix + entry.name;

    if (entry.is_dir) {
      // Append / and keep menu open for deeper navigation
      this.deps.setInputText(prefix + relativePath + "/" + suffix);
      requestAnimationFrame(() => {
        const live = this.deps.getTextareaEl();
        if (live) {
          const newPos = this.startPos + 1 + relativePath.length + 1;
          live.selectionStart = live.selectionEnd = newPos;
          live.focus();
        }
        this.detect(this.startPos + 1 + relativePath.length + 1);
      });
    } else {
      this.deps.setInputText(prefix + relativePath + suffix);
      this.close("select");
      requestAnimationFrame(() => {
        const live = this.deps.getTextareaEl();
        if (live) {
          const newPos = this.startPos + 1 + relativePath.length;
          live.selectionStart = live.selectionEnd = newPos;
          live.focus();
        }
      });
    }
    dbg("at-mention", "select", { name: entry.name, isDir: entry.is_dir });
  }

  /** Returns true if the controller consumed the key. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      this.close("escape");
      return true;
    }
    if (this.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.select(this.results[this.selectedIndex]);
        return true;
      }
    }
    return false;
  }

  private async fetch(query: string): Promise<void> {
    this.loading = true;
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
      const absPath = this.resolvePath(dirQuery);
      dbg("at-mention", "fetch", { absPath, prefix });
      const listing = await api.listDirectory(absPath, true);
      this.results = listing.entries
        .filter((e) => e.name.toLowerCase().startsWith(prefix))
        .slice(0, MAX_RESULTS);
      this.selectedIndex = 0;
    } catch (e) {
      dbg("at-mention", "fetch error", e);
      this.results = [];
    } finally {
      this.loading = false;
    }
  }
}
