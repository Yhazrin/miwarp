import type { MemoryFileCandidate } from "$lib/types";

/**
 * Filter memory file candidates for sidebar display.
 *
 * - Always shows files that exist on disk.
 * - Shows non-existing (creatable) files only when `showCreate` is true,
 *   OR when the file is currently selected (to keep highlight visible).
 */
export function filterVisibleCandidates(
  files: MemoryFileCandidate[],
  showCreate: boolean,
  selectedPath: string,
): MemoryFileCandidate[] {
  return files.filter((f) => f.exists || showCreate || f.path === selectedPath);
}

// ── Memory consolidation helpers ────────────────────────────────────────────

export interface MemoryGroup {
  label: string;
  files: MemoryFileCandidate[];
}

/**
 * Group memory files by label (case-insensitive).
 * Used for finding duplicate files across different directories.
 */
export function groupByLabel(files: MemoryFileCandidate[]): MemoryGroup[] {
  const groups = new Map<string, MemoryFileCandidate[]>();

  for (const file of files) {
    const key = file.label.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(file);
  }

  return Array.from(groups.entries()).map(([label, groupFiles]) => ({
    label,
    files: groupFiles,
  }));
}

/**
 * Find duplicate memory files (same label, different paths).
 * Returns groups that have multiple existing files.
 */
export function findDuplicates(files: MemoryFileCandidate[]): MemoryGroup[] {
  const groups = groupByLabel(files);

  return groups.filter((group) => {
    const existing = group.files.filter((f) => f.exists);
    return existing.length > 1;
  });
}

/**
 * Get the primary (best) file from a duplicate group.
 * Prefers project scope, then global, then memory.
 * Among same scope, prefers the shorter path.
 */
export function getPrimaryFile(group: MemoryGroup): MemoryFileCandidate | null {
  const existing = group.files.filter((f) => f.exists);
  if (existing.length === 0) return null;

  // Sort by scope priority and path length
  const scopePriority: Record<string, number> = {
    project: 0,
    global: 1,
    memory: 2,
  };

  existing.sort((a, b) => {
    const priorityA = scopePriority[a.scope] ?? 3;
    const priorityB = scopePriority[b.scope] ?? 3;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same scope - prefer shorter path
    return a.path.length - b.path.length;
  });

  return existing[0];
}

/**
 * Calculate similarity between two memory files based on content.
 * Returns a score between 0 (completely different) and 1 (identical).
 */
export function calculateSimilarity(contentA: string, contentB: string): number {
  // Quick length-based check
  if (contentA.length === 0 && contentB.length === 0) return 1;
  if (contentA.length === 0 || contentB.length === 0) return 0;

  // Normalize content (remove frontmatter, trim)
  const normalize = (text: string): string => {
    return text
      .replace(/^---\n[\s\S]*?\n---\n?/, "") // Remove frontmatter
      .replace(/^#+\s*/gm, "") // Remove headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convert links to text
      .replace(/[*_`]/g, "") // Remove formatting
      .trim()
      .toLowerCase();
  };

  const normalizedA = normalize(contentA);
  const normalizedB = normalize(contentB);

  if (normalizedA === normalizedB) return 1;

  // Jaccard similarity on words
  const wordsA = new Set(normalizedA.split(/\s+/).filter(Boolean));
  const wordsB = new Set(normalizedB.split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Check if a memory file is stale (not accessed in a while).
 * Returns true if the file hasn't been modified in `maxAgeDays` days.
 */
export function isStale(file: MemoryFileCandidate, _maxAgeDays = 90): boolean {
  if (!file.exists) return true;

  // We don't have modification time in MemoryFileCandidate
  // For now, memory scope files are considered less stable
  return file.scope === "memory";
}

/**
 * Sort memory files for display priority.
 * Order: MEMORY.md, project files, global files, memory files.
 * Within each group: alphabetical.
 */
export function sortByDisplayPriority(files: MemoryFileCandidate[]): MemoryFileCandidate[] {
  const scopeOrder: Record<string, number> = {
    project: 0,
    global: 1,
    memory: 2,
  };

  return [...files].sort((a, b) => {
    // MEMORY.md always first
    const aIsMemoryIndex = a.label === "MEMORY.md";
    const bIsMemoryIndex = b.label === "MEMORY.md";
    if (aIsMemoryIndex && !bIsMemoryIndex) return -1;
    if (bIsMemoryIndex && !aIsMemoryIndex) return 1;

    // Sort by scope
    const scopeA = scopeOrder[a.scope] ?? 3;
    const scopeB = scopeOrder[b.scope] ?? 3;
    if (scopeA !== scopeB) return scopeA - scopeB;

    // Within same scope: existing files first, then alphabetical
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Generate a summary of memory file state for debugging/logging.
 */
export function summarizeMemoryFiles(files: MemoryFileCandidate[]): string {
  const existing = files.filter((f) => f.exists);
  const missing = files.filter((f) => !f.exists);
  const byScope: Record<string, number> = {};

  for (const file of files) {
    byScope[file.scope] = (byScope[file.scope] ?? 0) + 1;
  }

  return [
    `Total: ${files.length} files`,
    `Existing: ${existing.length}`,
    `Missing: ${missing.length}`,
    `By scope: ${JSON.stringify(byScope)}`,
  ].join(", ");
}

/**
 * Find the best memory file to display for a given scope.
 */
export function findBestFile(
  files: MemoryFileCandidate[],
  scope: "project" | "global" | "memory",
): MemoryFileCandidate | null {
  const scoped = files.filter((f) => f.scope === scope);
  const existing = scoped.filter((f) => f.exists);

  if (existing.length > 0) {
    return existing[0];
  }

  // Fall back to non-existing if no existing files
  return scoped[0] ?? null;
}

/**
 * Extract memory file metadata from path.
 */
export function parseMemoryPath(path: string): {
  directory: string;
  filename: string;
  isGlobal: boolean;
  isProject: boolean;
  isMemory: boolean;
} {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;

  const isMemory = path.includes("/memory/") || path.includes("\\memory\\");

  // Detect home directory prefix to distinguish global (~/.claude/) from project paths
  const isHomePath = /\/home\/|\/Users\//.test(path);
  const isGlobal = isHomePath && path.includes(".claude/") && !path.includes("projects/");
  const isProject =
    !isGlobal && !isMemory && (parts.some((p) => p === ".claude") || filename === "CLAUDE.md");

  return {
    directory: parts.join("/"),
    filename,
    isGlobal,
    isProject,
    isMemory,
  };
}
