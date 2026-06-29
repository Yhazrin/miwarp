<script lang="ts">
  /**
   * Shared skeleton — block / panel variant.
   *
   * Pair with `SkeletonLine` (text line) and `SkeletonCircle` (avatar / icon)
   * when building loading placeholders for routes that don't already have a
   * domain-specific skeleton (e.g. `StreamingSkeleton`). All three honor
   * `prefers-reduced-motion: reduce` via the global `*` rule in `app.css`
   * (animation-duration collapses to 0.001ms), so no per-component override
   * is needed.
   */
  let {
    width = "100%",
    height = "4rem",
    rounded = "rounded-lg",
    class: className = "",
  }: {
    width?: string;
    height?: string;
    rounded?: string;
    class?: string;
  } = $props();
</script>

<div
  class="animate-pulse bg-muted {rounded} {className}"
  style="width: {width}; height: {height}"
  aria-hidden="true"
></div>
