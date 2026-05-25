<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface BranchNode {
    id: string;
    parentId: string | null;
    label: string;
    timestamp: number;
    turnCount: number;
    isActive: boolean;
    isMain: boolean;
  }

  interface BranchTimelineProps {
    branches: BranchNode[];
    currentBranchId: string;
    onSelectBranch?: (branchId: string) => void;
    onCreateFork?: () => void;
    class?: string;
  }

  let {
    branches = [],
    currentBranchId = "",
    onSelectBranch,
    onCreateFork,
    class: className = "",
  }: BranchTimelineProps = $props();

  // Group branches by parent
  const branchTree = $derived.by(() => {
    const root: BranchNode | null = branches.find((b) => b.parentId === null && b.isMain) ?? null;
    const children = new Map<string, BranchNode[]>();

    for (const branch of branches) {
      if (branch.parentId) {
        const list = children.get(branch.parentId) ?? [];
        list.push(branch);
        children.set(branch.parentId, list);
      }
    }

    return { root, children };
  });

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function renderBranch(branch: BranchNode, depth: number = 0): any[] {
    // This is a simplified tree representation
    return [{ branch, depth }];
  }

  // Get the tree structure as flat items with indentation info
  const flatTree = $derived.by(() => {
    const items: Array<{ branch: BranchNode; depth: number }> = [];

    function traverse(node: BranchNode, depth: number) {
      items.push({ branch: node, depth });
      const children = branchTree.children.get(node.id) ?? [];
      for (const child of children) {
        traverse(child, depth + 1);
      }
    }

    if (branchTree.root) {
      traverse(branchTree.root, 0);
    }

    return items;
  });

  // Calculate visual metrics
  const maxTurnCount = $derived(Math.max(...branches.map((b) => b.turnCount), 1));
</script>

<div
  class="session-branch-timeline {className}"
  role="tree"
  aria-label={t("branch.timeline") || "Branch timeline"}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
    <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {t("branch.sessionBranches") || "Session Branches"}
    </h3>
    {#if onCreateFork}
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        onclick={onCreateFork}
        title={t("branch.createFork") || "Create new fork"}
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
          <path d="M12 12v3" />
        </svg>
        <span>{t("branch.fork") || "Fork"}</span>
      </button>
    {/if}
  </div>

  <!-- Branch list -->
  <div class="flex-1 overflow-y-auto p-2 space-y-1">
    {#if flatTree.length === 0}
      <div class="text-xs text-muted-foreground/50 text-center py-4">
        {t("branch.noBranches") || "No branches yet"}
      </div>
    {:else}
      {#each flatTree as { branch, depth } (branch.id)}
        {@const isSelected = branch.id === currentBranchId}
        {@const isParent = branches.some((b) => b.parentId === branch.id)}

        <button
          class="branch-node w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all duration-200
            {isSelected
            ? 'bg-primary/20 border border-primary/30'
            : 'hover:bg-muted border border-transparent'}
            {!branch.isMain && depth > 0 ? 'ml-4' : ''}"
          style="margin-left: {depth * 16}px"
          onclick={() => onSelectBranch?.(branch.id)}
          role="treeitem"
          aria-selected={isSelected}
        >
          <!-- Branch indicator -->
          <div class="flex-shrink-0 w-4 flex items-center justify-center">
            {#if !branch.isMain}
              <svg
                class="w-3 h-3 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="6" r="2" />
                <path d="M6 8v4a4 4 0 0 0 4 4h4" />
              </svg>
            {:else}
              <div
                class="w-2 h-2 rounded-full {isSelected ? 'bg-primary' : 'bg-muted-foreground/30'}"
              ></div>
            {/if}
          </div>

          <!-- Branch info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-foreground truncate">
                {branch.label}
              </span>
              {#if branch.isActive}
                <span class="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
                ></span>
              {/if}
            </div>
            <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{branch.turnCount} turns</span>
              <span>·</span>
              <span title={formatTime(branch.timestamp)}>{getRelativeTime(branch.timestamp)}</span>
            </div>
          </div>

          <!-- Turn count bar -->
          <div class="flex-shrink-0 w-12">
            <div class="h-1 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all {isSelected
                  ? 'bg-primary'
                  : 'bg-muted-foreground/30'}"
                style="width: {(branch.turnCount / maxTurnCount) * 100}%"
              ></div>
            </div>
          </div>
        </button>
      {/each}
    {/if}
  </div>

  <!-- Legend -->
  <div
    class="px-3 py-2 border-t border-border/50 flex items-center gap-4 text-[10px] text-muted-foreground"
  >
    <div class="flex items-center gap-1">
      <div class="w-2 h-2 rounded-full bg-primary"></div>
      <span>{t("branch.mainBranch") || "Main"}</span>
    </div>
    <div class="flex items-center gap-1">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="M6 8v4a4 4 0 0 0 4 4h4" />
      </svg>
      <span>{t("branch.forkedBranch") || "Fork"}</span>
    </div>
  </div>
</div>

<style>
  .branch-node:hover {
    transform: translateX(2px);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .animate-pulse {
    animation: pulse 2s ease-in-out infinite;
  }
</style>
