<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Blur amount in pixels (default: 16) */
    blur?: number;
    /** Background opacity 0-1 (default: 0.72) */
    opacity?: number;
    /** Elevation level for shadow depth */
    elevation?: 1 | 2 | 3;
    /** Show border */
    bordered?: boolean;
    /** Additional CSS classes */
    class?: string;
    /** Accent border on the left side */
    accentLeft?: boolean;
    /** Glow effect */
    glow?: boolean;
    children?: Snippet;
  }

  let {
    blur = 16,
    opacity = 0.72,
    elevation = 1,
    bordered = true,
    class: className = '',
    accentLeft = false,
    glow = false,
    children,
  }: Props = $props();

  const shadowMap = {
    1: '0 1px 3px hsla(0,0%,0%,0.3), 0 1px 2px hsla(0,0%,0%,0.2)',
    2: '0 4px 12px hsla(0,0%,0%,0.35), 0 2px 4px hsla(0,0%,0%,0.2)',
    3: '0 8px 24px hsla(0,0%,0%,0.4), 0 4px 8px hsla(0,0%,0%,0.25)',
  };
</script>

<div
  class="glass-panel-component {className}"
  class:accent-border-left={accentLeft}
  class:glow-active={glow}
  style="
    backdrop-filter: blur({blur}px);
    -webkit-backdrop-filter: blur({blur}px);
    background: hsla(var(--miwarp-glass-bg), {opacity});
    {bordered
      ? 'border: 1px solid hsla(var(--miwarp-glass-border), var(--miwarp-glass-border-opacity, 0.12));'
      : 'border: none;'}
    box-shadow: {shadowMap[elevation]};
    border-radius: var(--radius);
    transition: box-shadow 200ms ease-out, border-color 200ms ease-out;
  "
>
  {@render children?.()}
</div>

<style>
  .glass-panel-component {
    position: relative;
    overflow: hidden;
  }
  .glass-panel-component:hover {
    border-color: hsla(var(--miwarp-glass-border), 0.2);
  }
</style>
