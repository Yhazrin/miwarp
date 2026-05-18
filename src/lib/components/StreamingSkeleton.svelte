<script lang="ts">
  let {
    lines = 3,
    minHeight = "1.2em",
    class: className = "",
  }: {
    lines?: number;
    minHeight?: string;
    class?: string;
  } = $props();
</script>

<div class="space-y-1.5 {className}">
  {#each Array(lines) as _, i}
    <div
      class="skeleton-shimmer"
      style="width: {i === lines - 1 ? '60%' : '100%'}; min-height: {minHeight};"
    ></div>
  {/each}
</div>
