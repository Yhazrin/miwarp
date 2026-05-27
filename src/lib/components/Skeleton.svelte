<script>
  /** @type {number} */
  export let lines = 3;
  /** @type {boolean} */
  export let avatar = false;
  /** @type {string} */
  export let className = '';
</script>

<div class="skeleton-container {className}" role="status" aria-label="Loading">
  {#if avatar}
    <div class="skeleton-row">
      <div class="skeleton-circle" style="width: 32px; height: 32px;"></div>
      <div class="skeleton-col">
        <div class="skeleton-line" style="width: 40%;"></div>
        <div class="skeleton-line" style="width: 25%;"></div>
      </div>
    </div>
  {/if}

  {#each Array(lines) as _, i}
    <div
      class="skeleton-line"
      style="width: {i === lines - 1 ? '60%' : '100%'};"
    ></div>
  {/each}
</div>

<style>
  .skeleton-container {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: var(--radius-lg, 12px);
    background: hsl(var(--miwarp-bg-surface, 220 10% 18%));
    border: 1px solid hsl(var(--miwarp-glass-border, 220 30% 50%) / 0.08);
    position: relative;
    overflow: hidden;
  }

  .skeleton-container::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      hsl(var(--miwarp-text-tertiary, 220 10% 42%) / 0.06) 50%,
      transparent 100%
    );
    animation: shimmer 1.5s ease-in-out infinite;
    pointer-events: none;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .skeleton-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .skeleton-line {
    height: 12px;
    border-radius: 4px;
    background: hsl(var(--miwarp-text-tertiary, 220 10% 42%) / 0.15);
  }

  .skeleton-circle {
    border-radius: 999px;
    background: hsl(var(--miwarp-text-tertiary, 220 10% 42%) / 0.15);
    flex-shrink: 0;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-container::after {
      animation: none;
    }
  }
</style>
