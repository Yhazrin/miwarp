<script lang="ts">
  /**
   * Shared skeleton — circle variant for avatars, icons, and status dots.
   * Always renders a 1:1 box; size is the diameter.
   */
  let {
    size = "2.5rem",
    class: className = "",
  }: {
    size?: string;
    class?: string;
  } = $props();
</script>

<div
  class="animate-pulse rounded-full bg-muted {className}"
  style="width: {size}; height: {size}"
  aria-hidden="true"
></div>
