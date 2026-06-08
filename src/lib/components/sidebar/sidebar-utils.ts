import type { SessionFolder } from "$lib/types";

/** Normalize a path for cross-platform key matching. */
function normKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Resolve the display name for a session.
 * Tries: name, session_title, folder-annotated cwd, cwd basename.
 */
export function sessionDisplayName(cwd: string, folders: SessionFolder[]): string {
  const folder = folders.find((f) => normKey(f.workspaceId) === normKey(cwd));
  if (folder && folder.workspaceId !== cwd && cwd.length > folder.workspaceId.length) {
    // cwd is a sub-path of a known folder — extract the relative part
    const rel = cwd.slice(folder.workspaceId.length).replace(/^[/\\]+/, "");
    if (rel) return rel;
  }
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? cwd;
}

/** Simple levenshtein-free substring + prefix match score. */
export function matchScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  return 0;
}
