<script lang="ts">
  /**
   * v1.0.6 / 5.7: Render a single memory semantic block.
   * Adapts visual style based on block type.
   */
  import type { MemoryBlock } from "$lib/utils/memory-blocks";
  import Self from "./MemoryBlockItem.svelte";

  let {
    block,
    depth = 0,
  }: {
    block: MemoryBlock;
    depth?: number;
  } = $props();

  const indentClass = $derived(depth > 0 ? `pl-${Math.min(depth * 3, 12)}` : "");
</script>

{#if block.type === "heading"}
  {#if block.level === 1}
    <h1 class="mt-3 mb-1 text-base font-semibold text-foreground {indentClass}">
      {block.content}
    </h1>
  {:else if block.level === 2}
    <h2 class="mt-2.5 mb-1 text-sm font-semibold text-foreground {indentClass}">
      {block.content}
    </h2>
  {:else}
    <h3 class="mt-2 mb-0.5 text-xs font-medium text-foreground/80 {indentClass}">
      {block.content}
    </h3>
  {/if}
  {#if block.children.length > 0}
    {#each block.children as child (child.id)}
      <Self block={child} depth={depth + 1} />
    {/each}
  {/if}
{:else if block.type === "list"}
  <div class="flex items-start gap-1.5 py-0.5 text-xs text-foreground/80 {indentClass}">
    <span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40"></span>
    <span class="whitespace-pre-wrap">{block.content.replace(/^\s*[-*+]\s/, "")}</span>
  </div>
{:else if block.type === "code"}
  <pre
    class="my-1 overflow-x-auto rounded bg-muted/50 px-2 py-1 text-[11px] font-mono text-foreground/70 {indentClass}"
    >{block.content}</pre>
{:else if block.type === "paragraph"}
  <p class="py-0.5 text-xs leading-relaxed text-foreground/70 {indentClass}">
    {block.content}
  </p>
{/if}
