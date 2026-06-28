<script lang="ts">
  /**
   * Recursive tree-node renderer for the explorer's file sidebar. Pulled out of
   * AppShell.svelte so the parent file stays under the architecture budget and
   * the per-node error/loading UI stays next to its store contract.
   *
   * Behaviour notes:
   *   - Folder nodes with `loadState === "error"` render a warning glyph plus
   *     a Retry button that calls `onRetry(node)`. They never silently appear
   *     as an empty directory.
   *   - Folder nodes with `loadState === "loading"` show a spinning glyph
   *     in place of the chevron until the in-flight IPC completes.
   *   - Concurrent toggles while a load is in flight are ignored (the store
   *     short-circuits in `toggleFolder`).
   */
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { TreeNode } from "./explorer-tree-store.svelte";
  import ExplorerTreeNodes from "./ExplorerTreeNodes.svelte";

  let {
    nodes,
    selectedPath,
    onToggle,
    onSelect,
    onRetry,
  }: {
    nodes: TreeNode[];
    selectedPath: string;
    onToggle: (node: TreeNode) => void;
    onSelect: (node: TreeNode) => void;
    onRetry: (node: TreeNode) => void;
  } = $props();
</script>

{#snippet folderIcon()}
  <svg
    class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--miwarp-status-info)/0.7)]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path
      d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    />
  </svg>
{/snippet}

{#snippet fileIcon()}
  <svg
    class="h-3.5 w-3.5 shrink-0 opacity-40"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
{/snippet}

{#each nodes as node}
  {#if node.is_dir && node.loadState === "error"}
    <div
      class="flex w-full items-center gap-1 py-0.5 text-[13px] text-sidebar-foreground/80"
      style="padding-left: {8 + node.depth * 12}px"
    >
      <Icon name="triangle-alert" size="xs" class="shrink-0 text-destructive/70" />
      {@render folderIcon()}
      <span class="min-w-0 truncate flex-1">{node.name}</span>
      <button
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
        title={node.loadError ?? ""}
        onclick={() => onRetry(node)}
      >
        {t("common_retry")}
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="flex w-full items-center gap-1 py-0.5 text-[13px] transition-colors text-sidebar-foreground hover:bg-sidebar-accent/50 {selectedPath ===
      node.fullPath
        ? 'bg-sidebar-accent/70'
        : ''}"
      style="padding-left: {8 + node.depth * 12}px"
      onclick={() => (node.is_dir ? onToggle(node) : onSelect(node))}
    >
      {#if node.is_dir}
        {#if node.loadState === "loading"}
          <Icon name="loader-2" size="xs" class="shrink-0 animate-spin text-muted-foreground/70" />
        {:else}
          <Icon
            name="chevron-right"
            size="xs"
            class="shrink-0 transition-transform duration-150 {node.expanded ? 'rotate-90' : ''}"
          />
        {/if}
        {@render folderIcon()}
      {:else}
        <span class="w-3 shrink-0"></span>
        {@render fileIcon()}
      {/if}
      <span class="min-w-0 truncate">{node.name}</span>
    </button>
  {/if}
  {#if node.is_dir && node.expanded && node.loadState === "ready"}
    <ExplorerTreeNodes nodes={node.children} {selectedPath} {onToggle} {onSelect} {onRetry} />
  {/if}
{/each}
