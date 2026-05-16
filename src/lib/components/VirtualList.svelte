<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  type Props = {
    items: T[];
    itemHeight: number;
    class?: string;
    overscan?: number;
    item: Snippet<[T, number]>;
  };

  let {
    items,
    itemHeight,
    class: className = "",
    overscan = 3,
    item: itemSnippet,
  }: Props = $props();

  let containerEl: HTMLElement | null = $state(null);
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  const totalHeight = $derived(items.length * itemHeight);

  const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
  const endIndex = $derived(
    Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan),
  );
  const visibleItems = $derived(
    items.slice(startIndex, endIndex).map((item, i) => ({ item, index: startIndex + i })),
  );
  const offsetY = $derived(startIndex * itemHeight);

  function handleScroll() {
    if (containerEl) scrollTop = containerEl.scrollTop;
  }

  let ro: ResizeObserver | null = null;

  $effect(() => {
    if (!containerEl) return;
    containerHeight = containerEl.clientHeight;
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });
    ro.observe(containerEl);
    return () => {
      ro?.disconnect();
      ro = null;
    };
  });
</script>

<div
  bind:this={containerEl}
  class={className}
  style="overflow-y: auto; will-change: transform;"
  onscroll={handleScroll}
  role="list"
>
  <div style="height: {totalHeight}px; position: relative;">
    <div style="position: absolute; top: {offsetY}px; left: 0; right: 0;">
      {#each visibleItems as vi (vi.index)}
        <div style="height: {itemHeight}px;" role="listitem">
          {@render itemSnippet(vi.item, vi.index)}
        </div>
      {/each}
    </div>
  </div>
</div>
