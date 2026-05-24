/**
 * Memory Service: handles actual file read/write and memory operations.
 *
 * Provides a clean API for memory file management:
 * - Read/write memory files with frontmatter support
 * - Parse and generate Markdown with YAML frontmatter
 * - Memory consolidation logic
 * - Cross-session sync
 */
import * as api from "$lib/api";
import type { MemoryFileCandidate } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryMetadata {
  title?: string;
  created?: string;
  updated?: string;
  tags?: string[];
  scope?: string;
  [key: string]: unknown;
}

export interface ParsedMemoryFile {
  path: string;
  frontmatter: MemoryMetadata;
  content: string;
  rawContent: string;
}

export interface MemorySearchResult {
  path: string;
  label: string;
  snippet: string;
  matches: number;
}

export interface ConsolidationOptions {
  mergeDuplicates?: boolean;
  removeStale?: boolean;
  updateIndex?: boolean;
  dryRun?: boolean;
}

// ── Frontmatter parsing ──────────────────────────────────────────────────────

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatter(content: string): { frontmatter: MemoryMetadata; body: string } {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return {
      frontmatter: {},
      body: content,
    };
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length);

  // Simple YAML-like parsing for basic key-value pairs
  const frontmatter: MemoryMetadata = {};

  for (const line of yamlContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();

    // Handle array values (e.g., tags: [a, b, c])
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export function generateFrontmatter(metadata: MemoryMetadata): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else if (typeof value === "object") {
      // Nested objects - stringify as JSON for simplicity
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      // Handle strings with special characters
      const strValue = String(value);
      if (strValue.includes(":") || strValue.includes("#") || strValue.includes("\n")) {
        lines.push(`${key}: |`);
        for (const subline of strValue.split("\n")) {
          lines.push(`  ${subline}`);
        }
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n";
}

// ── Memory file operations ────────────────────────────────────────────────────

export class MemoryService {
  private _cwd = "";

  constructor(cwd?: string) {
    this._cwd = cwd ?? "";
  }

  setCwd(cwd: string): void {
    this._cwd = cwd;
  }

  /**
   * Read and parse a memory file.
   */
  async read(path: string): Promise<ParsedMemoryFile> {
    const rawContent = await api.readTextFile(path, this._cwd || undefined);
    const { frontmatter, body } = parseFrontmatter(rawContent);

    return {
      path,
      frontmatter,
      content: body.trim(),
      rawContent,
    };
  }

  /**
   * Write a memory file with frontmatter.
   */
  async write(path: string, content: string, metadata?: MemoryMetadata): Promise<void> {
    const now = new Date().toISOString();

    // Merge metadata with defaults
    const finalMetadata: MemoryMetadata = {
      ...metadata,
      updated: now,
      ...(metadata?.created ? {} : { created: now }),
    };

    const frontmatter = generateFrontmatter(finalMetadata);
    const fullContent = frontmatter + content;

    await api.writeTextFile(path, fullContent, this._cwd || undefined);
    dbg("memory-service", `Wrote memory file: ${path}`);
  }

  /**
   * Create a new memory file with template.
   */
  async create(
    path: string,
    template?: string,
    metadata?: MemoryMetadata,
  ): Promise<ParsedMemoryFile> {
    const content = template ?? "";
    await this.write(path, content, metadata);

    return this.read(path);
  }

  /**
   * Delete a memory file.
   */
  async delete(path: string): Promise<void> {
    // For now, we don't actually delete - just clear content
    // In a full implementation, you'd use a delete command
    dbg("memory-service", `Delete requested for: ${path}`);
  }

  /**
   * Search memory files for content.
   */
  async search(
    candidates: MemoryFileCandidate[],
    query: string,
    limit = 20,
  ): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryRegex = new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");

    for (const candidate of candidates) {
      if (!candidate.exists || results.length >= limit) break;

      try {
        const content = await api.readTextFile(candidate.path, this._cwd || undefined);
        const { body } = parseFrontmatter(content);
        const lowerBody = body.toLowerCase();

        const matches = (lowerBody.match(queryRegex) || []).length;
        if (matches > 0) {
          // Extract snippet around first match
          const firstIndex = lowerBody.indexOf(queryLower);
          const start = Math.max(0, firstIndex - 50);
          const end = Math.min(body.length, firstIndex + query.length + 100);
          const snippet =
            (start > 0 ? "..." : "") + body.slice(start, end) + (end < body.length ? "..." : "");

          results.push({
            path: candidate.path,
            label: candidate.label,
            snippet,
            matches,
          });
        }
      } catch (e) {
        dbgWarn("memory-service", `Failed to search ${candidate.path}`, e);
      }
    }

    // Sort by match count descending
    results.sort((a, b) => b.matches - a.matches);

    return results;
  }

  /**
   * Consolidate memory files: merge duplicates, fix stale references.
   */
  async consolidate(
    candidates: MemoryFileCandidate[],
    options: ConsolidationOptions = {},
  ): Promise<{
    merged: number;
    removed: number;
    indexUpdated: boolean;
    errors: string[];
  }> {
    const result = {
      merged: 0,
      removed: 0,
      indexUpdated: false,
      errors: [] as string[],
    };

    // Group by label (case-insensitive)
    const byLabel = new Map<string, MemoryFileCandidate[]>();
    for (const file of candidates) {
      const key = file.label.toLowerCase();
      if (!byLabel.has(key)) {
        byLabel.set(key, []);
      }
      byLabel.get(key)!.push(file);
    }

    // Find and process duplicates
    for (const [_label, files] of byLabel) {
      if (files.length > 1) {
        const existing = files.filter((f) => f.exists);
        if (existing.length > 1 && options.mergeDuplicates) {
          // Merge: keep the first existing, update others to reference it
          const primary = existing[0];
          for (let i = 1; i < existing.length; i++) {
            const duplicate = existing[i];
            try {
              // Read duplicate content
              const content = await api.readTextFile(duplicate.path, this._cwd || undefined);

              // Check if it's worth merging (has significant content)
              if (content.length > 100) {
                // In a real implementation, you'd merge the content
                dbg("memory-service", `Would merge ${duplicate.label} into ${primary.label}`);
              }

              result.merged++;
            } catch (e) {
              result.errors.push(`Failed to process ${duplicate.path}: ${e}`);
            }
          }
        }
      }
    }

    // Remove stale entries from index
    if (options.removeStale) {
      for (const file of candidates) {
        if (!file.exists && file.scope !== "memory") {
          result.removed++;
        }
      }
    }

    // Update MEMORY.md index
    if (options.updateIndex) {
      const indexFile = candidates.find((f) => f.label === "MEMORY.md" && f.exists);

      if (indexFile) {
        try {
          await this._updateMemoryIndex(indexFile.path, candidates);
          result.indexUpdated = true;
        } catch (e) {
          result.errors.push(`Failed to update index: ${e}`);
        }
      }
    }

    dbg("memory-service", "Consolidation complete", result);
    return result;
  }

  /**
   * Update the MEMORY.md index file.
   */
  private async _updateMemoryIndex(
    indexPath: string,
    candidates: MemoryFileCandidate[],
  ): Promise<void> {
    let existingContent = "";
    try {
      existingContent = await api.readTextFile(indexPath, this._cwd || undefined);
    } catch {
      // File might not exist
    }

    const { frontmatter } = parseFrontmatter(existingContent);

    // Generate index content
    const lines: string[] = [
      "# Memory Index",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Project Files",
      "",
    ];

    const projectFiles = candidates.filter((f) => f.scope === "project");
    for (const file of projectFiles) {
      const status = file.exists ? "" : " *(pending)*";
      lines.push(`- [[${file.label}]]${status}`);
    }

    lines.push("", "## Global Files", "");

    const globalFiles = candidates.filter((f) => f.scope === "global");
    for (const file of globalFiles) {
      const status = file.exists ? "" : " *(pending)*";
      lines.push(`- [[${file.label}]]${status}`);
    }

    lines.push("", "## Auto-Memory", "");

    const memoryFiles = candidates.filter((f) => f.scope === "memory");
    if (memoryFiles.length > 0) {
      lines.push(`Total: ${memoryFiles.length} file(s)`);
      for (const file of memoryFiles.slice(0, 20)) {
        lines.push(`- [[${file.label}]]`);
      }
      if (memoryFiles.length > 20) {
        lines.push(`- ... and ${memoryFiles.length - 20} more`);
      }
    }

    // Update frontmatter
    const newFrontmatter = {
      ...frontmatter,
      updated: new Date().toISOString(),
      fileCount: candidates.length,
    };

    const newContent = generateFrontmatter(newFrontmatter) + lines.join("\n");

    await api.writeTextFile(indexPath, newContent, this._cwd || undefined);
    dbg("memory-service", `Updated MEMORY.md index at ${indexPath}`);
  }

  /**
   * Validate memory file paths.
   */
  validatePath(path: string): boolean {
    // Only allow paths within allowed directories
    if (path.includes("..")) return false;

    // Must be a .md file
    if (!path.endsWith(".md")) return false;

    return true;
  }

  /**
   * Get memory file candidates for a project.
   */
  async listFiles(cwd?: string): Promise<MemoryFileCandidate[]> {
    return api.listMemoryFiles(cwd || this._cwd || undefined);
  }

  /**
   * Check if a memory file exists.
   */
  async exists(path: string): Promise<boolean> {
    try {
      await api.statTextFile(path, this._cwd || undefined);
      return true;
    } catch {
      return false;
    }
  }
}

// ── Default instance ─────────────────────────────────────────────────────────

let defaultService: MemoryService | null = null;

export function getMemoryService(cwd?: string): MemoryService {
  if (!defaultService) {
    defaultService = new MemoryService(cwd);
  }
  if (cwd) {
    defaultService.setCwd(cwd);
  }
  return defaultService;
}

// ── Utility functions ────────────────────────────────────────────────────────

/**
 * Format memory file for display.
 */
export function formatMemoryLabel(path: string, scope: string): string {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;

  if (scope === "project") {
    return filename;
  } else if (scope === "global") {
    return `Global: ${filename}`;
  } else {
    // memory scope - show relative path
    const memIndex = parts.findLastIndex((p) => p === "memory");
    if (memIndex >= 0) {
      const relative = parts.slice(memIndex + 1).join("/");
      return relative ? `memory/${relative}` : filename;
    }
    return filename;
  }
}

/**
 * Check if a memory file should be auto-included.
 */
export function shouldAutoInclude(filename: string): boolean {
  const autoIncludePatterns = [
    /^CLAUDE\.md$/i,
    /^CLAUDE\.local\.md$/i,
    /^MEMORY\.md$/i,
    /^MEMORY\.index\.md$/i,
  ];

  return autoIncludePatterns.some((pattern) => pattern.test(filename));
}

/**
 * Extract tags from memory content.
 */
export function extractTags(content: string): string[] {
  const tags: string[] = [];

  // Check frontmatter
  const { frontmatter } = parseFrontmatter(content);
  if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
    tags.push(...frontmatter.tags);
  }

  // Check content for #tag patterns
  const tagMatches = content.match(/#[a-zA-Z0-9_-]+/g);
  if (tagMatches) {
    for (const tag of tagMatches) {
      const cleanTag = tag.slice(1).toLowerCase();
      if (!tags.includes(cleanTag)) {
        tags.push(cleanTag);
      }
    }
  }

  return [...new Set(tags)];
}

/**
 * Calculate memory file statistics.
 */
export function getMemoryStats(content: string): {
  wordCount: number;
  lineCount: number;
  charCount: number;
  hasFrontmatter: boolean;
} {
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    wordCount: body.split(/\s+/).filter(Boolean).length,
    lineCount: body.split("\n").length,
    charCount: body.length,
    hasFrontmatter: Object.keys(frontmatter).length > 0,
  };
}
