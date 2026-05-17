<script lang="ts">
  import type { MemoryBlock } from "$lib/utils/memory-items";
  import Icon from "./icons/Icon.svelte";

  let {
    block,
    depth = 0,
    onToggle,
    onCopy,
  }: {
    block: MemoryBlock;
    depth?: number;
    onToggle?: (id: string) => void;
    onCopy?: (text: string) => void;
  } = $props();

  let collapsed = $state(block.collapsed ?? false);

  const indentClass = $derived(
    depth === 0 ? "" : depth === 1 ? "pl-4" : depth === 2 ? "pl-7" : "pl-10",
  );

  const typeLabel = $derived(() => {
    if (block.type === "heading") return `H${block.level ?? 1}`;
    if (block.type === "bullet") return "•";
    if (block.type === "numbered") return block.id.split("-").pop() ?? "#";
    return "¶";
  });

  const hasChildren = $derived(block.children.length > 0);
</script>

<div class="group {indentClass}">
  <div
    class="flex items-start gap-1.5 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
  >
    <span class="text-muted-foreground/40 text-[10px] shrink-0 w-4 text-right mt-0.5">
      {typeLabel()}
    </span>
    <span class="text-[11px] text-foreground/70 flex-1 line-clamp-2 leading-relaxed">
      {block.text}
    </span>
    {#if hasChildren}
      <button
        class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
        onclick={() => {
          collapsed = !collapsed;
          onToggle?.(block.id);
        }}
        aria-label={collapsed ? "Expand" : "Collapse"}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} strokeWidth={1.8} />
      </button>
    {/if}
    <button
      class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
      onclick={() => onCopy?.(block.text)}
      aria-label="Copy"
    >
      <Icon name="copy" size={12} strokeWidth={1.8} />
    </button>
  </div>

  {#if hasChildren && !collapsed}
    <div class="border-l border-border/30 ml-2">
      {#each block.children as child (child.id)}
        <svelte:self block={child} depth={depth + 1} {onToggle} {onCopy} />
      {/each}
    </div>
  {/if}
</div>
