<script lang="ts">
  /**
   * v1.0.6 / 5.8: Shimmer placeholder shown while streaming text is very short (< 100 chars).
   * Gives visual feedback that "content is coming" without the jarring blank <pre>.
   * Fades out once real content arrives.
   */

  let {
    class: className = "",
    lines = 3,
  }: {
    class?: string;
    /** Number of skeleton lines to render. */
    lines?: number;
  } = $props();

  // Vary line widths for a natural look
  const widths = ["90%", "75%", "60%", "85%", "50%"];
</script>

<div
  class="streaming-skeleton flex flex-col gap-2 {className}"
  role="status"
  aria-label="Loading content"
>
  {#each { length: lines } as _, i}
    <div
      class="skeleton-line h-3.5 rounded bg-muted/60"
      style="width: {widths[i % widths.length]}"
    ></div>
  {/each}
</div>

<style>
  .streaming-skeleton {
    animation: skeleton-fade-in 0.2s ease-out;
  }

  .skeleton-line {
    position: relative;
    overflow: hidden;
  }

  .skeleton-line::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      hsl(var(--muted-foreground) / 0.08) 40%,
      hsl(var(--muted-foreground) / 0.15) 50%,
      hsl(var(--muted-foreground) / 0.08) 60%,
      transparent 100%
    );
    animation: shimmer-slide 2s ease-in-out infinite;
  }

  @keyframes skeleton-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes shimmer-slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
