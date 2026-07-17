/**
 * Pure handler functions for AppShell drag-and-drop and batch operations.
 * State remains in AppShell.svelte; this file exports only functions.
 */
import { get } from "svelte/store";
import { page } from "$app/stores";
import { goto } from "$app/navigation";
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import { pathIsChat } from "$lib/layout/navigation-model";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { dbg } from "$lib/utils/debug";
import type { RunsSidebarStore } from "$lib/layout/runs-sidebar-store.svelte";
import type { SessionFolderStore } from "$lib/layout/session-folder-store.svelte";
import type { EnrichedProjectFolder } from "$lib/utils/sidebar-groups";

// ── Drag handlers ──

export function handleSessionDragStart(
  setDrag: (runId: string, label: string, x: number, y: number) => void,
  runId: string,
  label: string,
  e: PointerEvent,
) {
  setDrag(runId, label, e.clientX, e.clientY);
  import("$lib/utils/session-drag-state").then((m) => m.setSessionDragActive(true));
}

export function handleSessionDragMove(
  setPos: (x: number, y: number) => void,
  e: PointerEvent,
) {
  setPos(e.clientX, e.clientY);
}

export async function handleSessionDragEnd(
  clearDrag: () => void,
  e: PointerEvent,
  _rss: RunsSidebarStore,
  _sfs: SessionFolderStore,
) {
  clearDrag();
  const {
    setSessionDragOverSplit,
    setSessionDragActive,
    findSessionDropTarget,
    findSessionSplitDropTarget,
  } = await import("$lib/utils/session-drag-state");
  setSessionDragOverSplit(false);
  setSessionDragActive(false);
  const pathname = get(page).url.pathname;
  const overSplit = pathIsChat(pathname) && findSessionSplitDropTarget(e.clientX, e.clientY);
  const dropTarget = overSplit ? null : findSessionDropTarget(e.clientX, e.clientY);
  if (overSplit) {
    const { addSplitPane: _addSplitPane } = await import("$lib/split/split-workspace-lifecycle");
    // Need runId from caller — pass it through clearDrag or separate param
    // For now, this path is handled in the component
    return;
  }
  if (!dropTarget) return;
  // runId and run lookup handled in component
}

export async function executeFolderDrop(
  runId: string,
  dropTarget: { type: string; folderId?: string; workspaceKey?: string },
  rss: RunsSidebarStore,
  sfs: SessionFolderStore,
) {
  const run = rss.runs.find((r) => r.id === runId);
  if (!run) return;
  try {
    if (dropTarget.type === "folder") {
      const { moveRunToFolder } = await import("$lib/api");
      await moveRunToFolder(runId, dropTarget.folderId);
      rss.applyFolderMoveLocally([runId], dropTarget.folderId);
      sfs.ensureSubFolderExpanded(dropTarget.folderId);
    } else {
      const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
      const folderKey = cwd === "" ? "uncategorized" : `cwd:${cwd}`;
      if (folderKey !== dropTarget.workspaceKey) return;
      const { moveRunToFolder } = await import("$lib/api");
      await moveRunToFolder(runId, null);
      rss.applyFolderMoveLocally([runId], null);
    }
    window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
  } catch (err) {
    dbg("layout", "session pointer-drop moveRunToFolder failed", { err });
  }
}

// ── Batch selection helpers ──

export function toggleSelectConversation(
  groupKey: string,
  e: MouseEvent,
  currentSelected: Set<string>,
  lastKey: string,
  enrichedProjectFolders: EnrichedProjectFolder[],
): { selected: Set<string>; lastKey: string } {
  const allKeys: string[] = [];
  for (const folder of enrichedProjectFolders) {
    for (const conv of folder.conversations) allKeys.push(conv.groupKey);
    for (const sf of folder.subFolders ?? []) {
      for (const conv of sf.conversations) allKeys.push(conv.groupKey);
    }
  }
  if (currentSelected.size > 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    const newSet = new Set(currentSelected);
    if (newSet.has(groupKey)) newSet.delete(groupKey);
    else newSet.add(groupKey);
    return { selected: newSet, lastKey: groupKey };
  }
  if (e.shiftKey && lastKey) {
    const fromIdx = allKeys.indexOf(lastKey);
    const toIdx = allKeys.indexOf(groupKey);
    if (fromIdx >= 0 && toIdx >= 0) {
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const newSet = new Set(currentSelected);
      for (let i = start; i <= end; i++) newSet.add(allKeys[i]);
      return { selected: newSet, lastKey: groupKey };
    }
  } else if (e.metaKey || e.ctrlKey) {
    const newSet = new Set(currentSelected);
    if (newSet.has(groupKey)) newSet.delete(groupKey);
    else newSet.add(groupKey);
    return { selected: newSet, lastKey: groupKey };
  }
  return { selected: new Set<string>(), lastKey: groupKey };
}

export function collectSelectedRunIds(
  selectedKeys: Set<string>,
  enrichedProjectFolders: EnrichedProjectFolder[],
): string[] {
  const ids: string[] = [];
  for (const folder of enrichedProjectFolders) {
    for (const conv of folder.conversations) {
      if (selectedKeys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
    }
    for (const sf of folder.subFolders ?? []) {
      for (const conv of sf.conversations) {
        if (selectedKeys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
      }
    }
  }
  return ids;
}

export async function batchSoftDelete(
  rss: RunsSidebarStore,
  ids: string[],
  selectedRunId: string,
) {
  if (ids.length === 0) return;
  await rss.softDelete(ids);
  if (ids.includes(selectedRunId)) goto("/chat");
}

export async function batchHardDeleteAction(
  rss: RunsSidebarStore,
  ids: string[],
  selectedRunId: string,
) {
  if (ids.length === 0) return;
  await rss.hardDelete(ids);
  if (ids.includes(selectedRunId)) goto("/chat");
}
