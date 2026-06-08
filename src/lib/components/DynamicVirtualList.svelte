<script lang="ts" generics="T">
  /**
   * v1.0.6 / 3.1: Variable-height virtual list.
   * Unlike VirtualList (fixed itemHeight), this component uses ResizeObserver
   * to track actual item heights and only renders visible items.
   *
   * Use for lists where items have significantly different heights
   * (e.g., chat messages, tool cards, code blocks).
   */
  import type { Snippet } from "svelte";

  type Props = {
    items: T[];
    /** Key extractor for stable identity across re-renders. */
    getKey: (item: T, index: number) => string | number;
    /** Estimated initial height for items not yet measured. */
    estimatedHeight?: number;
    /** Number of items to render above/below the visible area. */
    overscan?: number;
    class?: string;
    item: Snippet<[T, number]>;
  };

  let {
    items,
    getKey,
    estimatedHeight = 60,
    overscan = 5,
    class: className = "",
    item: itemSnippet,
  }: Props = $props();

  let containerEl: HTMLElement | null = $state(null);
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  // Measured heights per item key
  const heights = new Map<string | number, number>();

  function getHeight(key: string | number): number {
    return heights.get(key) ?? estimatedHeight;
  }

  // Compute cumulative offsets
  const offsets = $derived.by(() => {
    const result: number[] = [];
    let cum = 0;
    for (let i = 0; i < items.length; i++) {
      result.push(cum);
      cum += getHeight(getKey(items[i], i));
    }
    return result;
  });

  const totalHeight = $derived(() => {
    if (items.length === 0) return 0;
    const lastKey = getKey(items[items.length - 1], items.length - 1);
    return (offsets[items.length - 1] ?? 0) + getHeight(lastKey);
  });

  // Binary search for the first visible item
  const startIndex = $derived(() => {
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((offsets[mid] ?? 0) + getHeight(getKey(items[mid], mid)) < scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return Math.max(0, lo - overscan);
  });

  const endIndex = $derived(() => {
    const bottom = scrollTop + containerHeight;
    let lo = startIndex();
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((offsets[mid] ?? 0) > bottom) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return Math.min(items.length, lo + overscan);
  });

  const visibleItems = $derived(() => {
    const start = startIndex();
    const end = endIndex();
    return items.slice(start, end).map((item, i) => ({
      item,
      index: start + i,
      key: getKey(item, start + i),
    }));
  });

  const offsetY = $derived(offsets[startIndex()] ?? 0);

  function handleScroll() {
    if (containerEl) scrollTop = containerEl.scrollTop;
  }

  // ResizeObserver for container
  let ro: ResizeObserver | null = null;
  $effect(() => {
    if (!containerEl) return;
    containerHeight = containerEl.clientHeight;
    ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        containerHeight = e.contentRect.height;
      }
    });
    ro.observe(containerEl);
    return () => {
      ro?.disconnect();
      ro = null;
    };
  });

  // ResizeObserver for individual items
  const itemObservers = new Map<string | number, ResizeObserver>();

  function observeItem(node: HTMLElement, key: string | number) {
    const existing = itemObservers.get(key);
    if (existing) existing.disconnect();

    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.contentRect.height;
        if (h > 0 && Math.abs(h - getHeight(key)) > 1) {
          heights.set(key, h);
        }
      }
    });
    obs.observe(node);
    itemObservers.set(key, obs);

    return {
      destroy() {
        obs.disconnect();
        itemObservers.delete(key);
      },
    };
  }

  // Cleanup all observers on unmount
  $effect(() => {
    return () => {
      for (const obs of itemObservers.values()) obs.disconnect();
      itemObservers.clear();
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
  <div style="height: {totalHeight()}px; position: relative;">
    <div style="position: absolute; top: {offsetY}px; left: 0; right: 0;">
      {#each visibleItems() as vi (vi.key)}
        <div use:observeItem={vi.key} role="listitem">
          {@render itemSnippet(vi.item, vi.index)}
        </div>
      {/each}
    </div>
  </div>
</div>
