import type { EnrichedProjectFolder, ProjectFolder } from "$lib/utils/sidebar-groups";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

export type WorkspaceFolderSortOrder =
  | "last_active"
  | "name_asc"
  | "name_desc"
  | "created_asc"
  | "created_desc";

export const DEFAULT_WORKSPACE_FOLDER_SORT: WorkspaceFolderSortOrder = "last_active";

const VALID_SORT_ORDERS = new Set<string>([
  "last_active",
  "name_asc",
  "name_desc",
  "created_asc",
  "created_desc",
]);

export function normalizeWorkspaceFolderSortOrder(
  value: string | undefined | null,
): WorkspaceFolderSortOrder {
  if (value && VALID_SORT_ORDERS.has(value)) {
    return value as WorkspaceFolderSortOrder;
  }
  return DEFAULT_WORKSPACE_FOLDER_SORT;
}

export interface WorkspaceFolderSortContext {
  aliases?: Record<string, string>;
}

type SortableFolder = Pick<
  ProjectFolder,
  "cwd" | "isUncategorized" | "latestActivityAt" | "conversations"
> &
  Partial<Pick<EnrichedProjectFolder, "subFolders">>;

function folderDisplayName(folder: SortableFolder, aliases: Record<string, string>): string {
  if (folder.isUncategorized) return "";
  const normalized = normalizeCwd(folder.cwd);
  const alias = aliases[normalized]?.trim();
  const label = alias || normalized.replace(/\\/g, "/").split("/").pop() || normalized;
  return label.toLocaleLowerCase();
}

function folderEarliestActivityAt(folder: SortableFolder): string {
  let earliest = "";
  const consider = (iso: string) => {
    if (!iso) return;
    if (!earliest || iso.localeCompare(earliest) < 0) earliest = iso;
  };

  for (const conv of folder.conversations) {
    for (const run of conv.runs) {
      consider(run.started_at);
    }
  }

  for (const sf of folder.subFolders ?? []) {
    for (const conv of sf.conversations) {
      for (const run of conv.runs) {
        consider(run.started_at);
      }
    }
  }

  return earliest;
}

function compareFolders(
  a: SortableFolder,
  b: SortableFolder,
  order: WorkspaceFolderSortOrder,
  aliases: Record<string, string>,
): number {
  if (a.isUncategorized && !b.isUncategorized) return 1;
  if (!a.isUncategorized && b.isUncategorized) return -1;

  switch (order) {
    case "name_asc":
      return folderDisplayName(a, aliases).localeCompare(folderDisplayName(b, aliases));
    case "name_desc":
      return folderDisplayName(b, aliases).localeCompare(folderDisplayName(a, aliases));
    case "created_asc": {
      const ea = folderEarliestActivityAt(a);
      const eb = folderEarliestActivityAt(b);
      if (ea !== eb) return ea.localeCompare(eb);
      return folderDisplayName(a, aliases).localeCompare(folderDisplayName(b, aliases));
    }
    case "created_desc": {
      const ea = folderEarliestActivityAt(a);
      const eb = folderEarliestActivityAt(b);
      if (ea !== eb) return eb.localeCompare(ea);
      return folderDisplayName(a, aliases).localeCompare(folderDisplayName(b, aliases));
    }
    case "last_active":
    default: {
      const la = a.latestActivityAt;
      const lb = b.latestActivityAt;
      if (la !== lb) return lb.localeCompare(la);
      return folderDisplayName(a, aliases).localeCompare(folderDisplayName(b, aliases));
    }
  }
}

/** Sort workspace folders for sidebar / workspace list rendering. Uncategorized stays last. */
export function sortProjectFolders<T extends SortableFolder>(
  folders: T[],
  order: WorkspaceFolderSortOrder | string | undefined | null,
  ctx: WorkspaceFolderSortContext = {},
): T[] {
  const normalized = normalizeWorkspaceFolderSortOrder(
    typeof order === "string" ? order : undefined,
  );
  const aliases = ctx.aliases ?? {};
  return [...folders].sort((a, b) => compareFolders(a, b, normalized, aliases));
}
