/**
 * Memory Store: reactive state management for the memory system.
 *
 * Manages:
 * - Memory file candidates (project, global, auto-memory)
 * - Current selection and loading state
 * - Memory consolidation state
 * - Cross-session sync state
 *
 * Uses Svelte 5 $state runes for reactivity.
 */
import * as api from "$lib/api";
import type { MemoryFileCandidate } from "$lib/types";
import { EVT_MEMORY_FILE_SAVED, EVT_MEMORY_FILE_CREATED } from "$lib/utils/bus-events";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Types ────────────────────────────────────────────────────────────────────

export type MemoryScope = "project" | "global" | "memory";

export interface MemoryEntry {
  path: string;
  label: string;
  scope: MemoryScope;
  exists: boolean;
  lastModified?: string;
  size?: number;
}

export interface ConsolidationResult {
  duplicatesMerged: number;
  staleEntriesRemoved: number;
  indexUpdated: boolean;
  errors: string[];
}

export interface MemorySyncState {
  lastSync: string | null;
  pendingChanges: number;
  syncInProgress: boolean;
  lastError: string | null;
}

// ── Memory Store ─────────────────────────────────────────────────────────────

class MemoryStore {
  // File candidates
  private _candidates = $state<MemoryFileCandidate[]>([]);
  private _selectedPath = $state("");
  private _showCreate = $state(false);

  // Loading states
  private _loadingCandidates = $state(false);
  private _loadingContent = $state(false);

  // Current content (for editing)
  private _content = $state("");
  private _savedContent = $state("");

  // Dirty state
  private _isDirty = $derived(this._content !== this._savedContent);

  // Consolidation state
  private _consolidating = $state(false);
  private _lastConsolidation = $state<string | null>(null);

  // Sync state
  private _syncState = $state<MemorySyncState>({
    lastSync: null,
    pendingChanges: 0,
    syncInProgress: false,
    lastError: null,
  });

  // Current project cwd
  private _cwd = $state("");

  // Error state
  private _error = $state<string | null>(null);

  // ── Getters ──────────────────────────────────────────────────────────────

  get candidates(): MemoryFileCandidate[] {
    return this._candidates;
  }

  get selectedPath(): string {
    return this._selectedPath;
  }

  get showCreate(): boolean {
    return this._showCreate;
  }

  get loadingCandidates(): boolean {
    return this._loadingCandidates;
  }

  get loadingContent(): boolean {
    return this._loadingContent;
  }

  get content(): string {
    return this._content;
  }

  get savedContent(): string {
    return this._savedContent;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get consolidating(): boolean {
    return this._consolidating;
  }

  get lastConsolidation(): string | null {
    return this._lastConsolidation;
  }

  get syncState(): MemorySyncState {
    return this._syncState;
  }

  get cwd(): string {
    return this._cwd;
  }

  get error(): string | null {
    return this._error;
  }

  projectFiles = $derived.by(() => this._candidates.filter((f) => f.scope === "project"));

  globalFiles = $derived.by(() => this._candidates.filter((f) => f.scope === "global"));

  memoryFiles = $derived.by(() => this._candidates.filter((f) => f.scope === "memory"));

  existingFiles = $derived.by(() => this._candidates.filter((f) => f.exists));

  // ── Setters ─────────────────────────────────────────────────────────────

  setContent(content: string): void {
    this._content = content;
  }

  setSavedContent(content: string): void {
    this._savedContent = content;
  }

  setSelectedPath(path: string): void {
    this._selectedPath = path;
    this._error = null;
  }

  setShowCreate(show: boolean): void {
    this._showCreate = show;
  }

  setError(error: string | null): void {
    this._error = error;
  }

  setLoadingContent(loading: boolean): void {
    this._loadingContent = loading;
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  /**
   * Load memory file candidates for the given project directory.
   */
  async loadCandidates(cwd: string): Promise<void> {
    this._loadingCandidates = true;
    this._error = null;
    try {
      const candidates = await api.listMemoryFiles(cwd || undefined);
      this._candidates = candidates;
      this._cwd = cwd;
      dbg("memory-store", `Loaded ${candidates.length} candidates for cwd=${cwd}`);
    } catch (e) {
      const msg = String(e);
      dbgWarn("memory-store", "Failed to load candidates", msg);
      this._error = msg;
      this._candidates = [];
    } finally {
      this._loadingCandidates = false;
    }
  }

  /**
   * Load content for a specific memory file.
   */
  async loadContent(path: string, cwd?: string): Promise<void> {
    if (!path) {
      this._content = "";
      this._savedContent = "";
      this._selectedPath = "";
      return;
    }

    this._loadingContent = true;
    this._selectedPath = path;
    this._error = null;

    try {
      const text = await api.readTextFile(path, cwd || this._cwd || undefined);
      this._content = text;
      this._savedContent = text;
      dbg("memory-store", `Loaded content for ${path}`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("No such file") || msg.includes("not found")) {
        this._content = "";
        this._savedContent = "";
      } else {
        dbgWarn("memory-store", "Failed to load content", msg);
        this._error = msg;
        this._content = "";
        this._savedContent = "";
      }
    } finally {
      this._loadingContent = false;
    }
  }

  /**
   * Save content to the current memory file.
   */
  async saveContent(path: string, content: string, cwd?: string): Promise<boolean> {
    this._error = null;
    try {
      await api.writeTextFile(path, content, cwd || this._cwd || undefined);
      this._content = content;
      this._savedContent = content;
      this._syncState.pendingChanges++;

      // Notify components to refresh
      window.dispatchEvent(new Event(EVT_MEMORY_FILE_SAVED));

      dbg("memory-store", `Saved content to ${path}`);
      return true;
    } catch (e) {
      const msg = String(e);
      dbgWarn("memory-store", "Failed to save content", msg);
      this._error = msg;
      return false;
    }
  }

  /**
   * Create a new memory file with optional template content.
   */
  async createFile(path: string, template?: string, cwd?: string): Promise<boolean> {
    this._error = null;
    try {
      const content = template ?? this._getDefaultTemplate(path);
      await api.writeTextFile(path, content, cwd || this._cwd || undefined);

      // Refresh candidates
      if (this._cwd) {
        await this.loadCandidates(this._cwd);
      }

      // Load the new file
      await this.loadContent(path, cwd);

      // Notify components
      window.dispatchEvent(new Event(EVT_MEMORY_FILE_CREATED));

      dbg("memory-store", `Created new memory file: ${path}`);
      return true;
    } catch (e) {
      const msg = String(e);
      dbgWarn("memory-store", "Failed to create file", msg);
      this._error = msg;
      return false;
    }
  }

  /**
   * Consolidate memory files: merge duplicates, remove stale entries, update index.
   */
  async consolidateMemory(): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      duplicatesMerged: 0,
      staleEntriesRemoved: 0,
      indexUpdated: false,
      errors: [],
    };

    this._consolidating = true;
    this._error = null;

    try {
      // Group files by name (ignoring path)
      const byName = new Map<string, MemoryFileCandidate[]>();
      for (const file of this._candidates) {
        const label = file.label.toLowerCase();
        if (!byName.has(label)) {
          byName.set(label, []);
        }
        byName.get(label)!.push(file);
      }

      // Find duplicates (same name, different paths)
      for (const [, files] of byName) {
        if (files.length > 1) {
          // Keep the most recent/appropriate file
          const existing = files.filter((f) => f.exists);
          if (existing.length > 1) {
            result.duplicatesMerged++;
            dbg("memory-store", `Found duplicate: ${files[0].label}`);
          }
        }
      }

      // Check for stale entries (files that no longer exist)
      for (const file of this._candidates) {
        if (!file.exists && file.scope !== "memory") {
          result.staleEntriesRemoved++;
        }
      }

      // Update MEMORY.md index if it exists
      const indexFile = this._candidates.find((f) => f.label === "MEMORY.md" && f.exists);
      if (indexFile) {
        await this._updateIndex(indexFile.path);
        result.indexUpdated = true;
      }

      this._lastConsolidation = new Date().toISOString();
      dbg("memory-store", "Consolidation complete", result);

      // Refresh candidates after consolidation
      if (this._cwd) {
        await this.loadCandidates(this._cwd);
      }
    } catch (e) {
      const msg = String(e);
      dbgWarn("memory-store", "Consolidation failed", msg);
      result.errors.push(msg);
      this._error = msg;
    } finally {
      this._consolidating = false;
    }

    return result;
  }

  /**
   * Sync memory state across sessions.
   */
  async syncMemory(): Promise<void> {
    this._syncState.syncInProgress = true;
    this._syncState.lastError = null;

    try {
      // Refresh candidates from disk
      if (this._cwd) {
        await this.loadCandidates(this._cwd);
      }

      this._syncState.lastSync = new Date().toISOString();
      this._syncState.pendingChanges = 0;

      dbg("memory-store", "Memory synced successfully");
    } catch (e) {
      const msg = String(e);
      dbgWarn("memory-store", "Memory sync failed", msg);
      this._syncState.lastError = msg;
    } finally {
      this._syncState.syncInProgress = false;
    }
  }

  /**
   * Update the MEMORY.md index with current file list.
   */
  private async _updateIndex(indexPath: string): Promise<void> {
    try {
      // Read current content
      let content = "";
      try {
        content = await api.readTextFile(indexPath, this._cwd || undefined);
      } catch {
        // File might not exist yet
        content = "";
      }

      // Generate new index
      const newContent = this._generateIndexContent(content);

      // Write updated index
      await api.writeTextFile(indexPath, newContent, this._cwd || undefined);
      dbg("memory-store", `Updated MEMORY.md index at ${indexPath}`);
    } catch (e) {
      dbgWarn("memory-store", "Failed to update index", e);
      throw e;
    }
  }

  /**
   * Generate MEMORY.md index content from current candidates.
   */
  private _generateIndexContent(existingContent: string): string {
    const lines: string[] = [
      "# Memory Index",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Project Memory Files",
      "",
    ];

    // Project files
    const projectFiles = this._candidates.filter((f) => f.scope === "project");
    if (projectFiles.length === 0) {
      lines.push("No project memory files.");
    } else {
      for (const file of projectFiles) {
        const status = file.exists ? "" : " *(not created yet)*";
        lines.push(`- \`${file.label}\`${status}`);
      }
    }

    lines.push("", "## Global Memory Files", "");

    // Global files
    const globalFiles = this._candidates.filter((f) => f.scope === "global");
    if (globalFiles.length === 0) {
      lines.push("No global memory files.");
    } else {
      for (const file of globalFiles) {
        const status = file.exists ? "" : " *(not created yet)*";
        lines.push(`- \`${file.label}\`${status}`);
      }
    }

    lines.push("", "## Auto Memory Files", "");

    // Auto-memory files
    const memoryFiles = this._candidates.filter((f) => f.scope === "memory");
    if (memoryFiles.length === 0) {
      lines.push("No auto-memory files.");
    } else {
      lines.push(`Found ${memoryFiles.length} memory file(s).`);
    }

    // Preserve existing frontmatter if present
    const frontmatterMatch = existingContent.match(/^---\n[\s\S]*?\n---\n/);
    if (frontmatterMatch) {
      return frontmatterMatch[0] + "\n" + lines.join("\n");
    }

    return lines.join("\n");
  }

  /**
   * Get default template for a new memory file.
   */
  private _getDefaultTemplate(path: string): string {
    const name = path.split("/").pop() ?? "Memory";
    const now = new Date().toISOString();

    // Special template for MEMORY.md
    if (name === "MEMORY.md") {
      return `---
title: Memory Index
created: ${now}
updated: ${now}
---

# Memory

This file indexes all memory files for the project.

## Files

- CLAUDE.md - Project documentation
- CLAUDE.local.md - Local overrides

## Notes

Add your memory notes below.

`;
    }

    // Default template for other memory files
    return `---
title: ${name.replace(/\.md$/, "")}
created: ${now}
tags: []
---

# ${name.replace(/\.md$/, "")}

Add your memory content here.

`;
  }

  /**
   * Auto-select the first appropriate memory file.
   */
  async autoSelect(): Promise<string | null> {
    // Prefer project files that exist
    const projectExisting = this.projectFiles.filter((f) => f.exists);
    if (projectExisting.length > 0) {
      const selected = projectExisting[0];
      await this.loadContent(selected.path);
      return selected.path;
    }

    // Fall back to any existing file
    if (this.existingFiles.length > 0) {
      const selected = this.existingFiles[0];
      await this.loadContent(selected.path);
      return selected.path;
    }

    // No files exist yet
    this._selectedPath = "";
    this._content = "";
    this._savedContent = "";
    return null;
  }

  /**
   * Clear all state.
   */
  clear(): void {
    this._candidates = [];
    this._selectedPath = "";
    this._content = "";
    this._savedContent = "";
    this._error = null;
    this._cwd = "";
  }

  /**
   * Check if a file can be created.
   */
  canCreateFile(path: string): boolean {
    const existing = this._candidates.find((f) => f.path === path);
    return !existing?.exists;
  }

  /**
   * Get a file by path.
   */
  getFile(path: string): MemoryFileCandidate | undefined {
    return this._candidates.find((f) => f.path === path);
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

export const memoryStore = new MemoryStore();

// ── Reactive helpers for components ─────────────────────────────────────────

export function useMemoryStore() {
  return {
    get candidates() {
      return memoryStore.candidates;
    },
    get selectedPath() {
      return memoryStore.selectedPath;
    },
    get content() {
      return memoryStore.content;
    },
    get isDirty() {
      return memoryStore.isDirty;
    },
    get loading() {
      return memoryStore.loadingContent || memoryStore.loadingCandidates;
    },
    get error() {
      return memoryStore.error;
    },
    get consolidating() {
      return memoryStore.consolidating;
    },
    get syncState() {
      return memoryStore.syncState;
    },
    get projectFiles() {
      return memoryStore.projectFiles;
    },
    get globalFiles() {
      return memoryStore.globalFiles;
    },
    get memoryFiles() {
      return memoryStore.memoryFiles;
    },
  };
}
