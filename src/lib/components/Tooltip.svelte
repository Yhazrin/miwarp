<script lang="ts">
  import { fade } from "svelte/transition";

  let {
    text = "",
    placement = "top" as "top" | "bottom" | "left" | "right",
    delay = 300,
    class: className = "",
    children,
  } = $props();

  let show = $state(false);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function enter() {
    timeout = setTimeout(() => {
      show = true;
    }, delay);
  }

  function leave() {
    if (timeout) clearTimeout(timeout);
    show = false;
  }
</script>

<div
  class="relative inline-flex {className}"
  onmouseenter={enter}
  onmouseleave={leave}
  onfocus={enter}
  onblur={leave}
  role="presentation"
>
  {@render children()}
  {#if show && text}
    <div
      role="tooltip"
      aria-describedby="tooltip-content"
      transition:fade={{ duration: 100 }}
      class="absolute z-50 px-2 py-1 text-xs font-medium rounded-md
        bg-popover text-popover-foreground border border-border shadow-md
        whitespace-nowrap pointer-events-none
        {placement === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5' : ''}
        {placement === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-1.5' : ''}
        {placement === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-1.5' : ''}
        {placement === 'right' ? 'left-full top-1/2 -translate-y-1/2 ml-1.5' : ''}
      "
    >
      <span id="tooltip-content">{text}</span>
      <div
        class="absolute w-1.5 h-1.5 bg-popover border-border rotate-45
          {placement === 'top'
          ? 'top-full left-1/2 -translate-x-1/2 -mt-0.5 border-r border-b'
          : ''}
          {placement === 'bottom'
          ? 'bottom-full left-1/2 -translate-x-1/2 -mb-0.5 border-l border-t'
          : ''}
          {placement === 'left'
          ? 'left-full top-1/2 -translate-y-1/2 -ml-0.5 border-t border-r'
          : ''}
          {placement === 'right'
          ? 'right-full top-1/2 -translate-y-1/2 -mr-0.5 border-b border-l'
          : ''}
        "
      ></div>
    </div>
  {/if}
</div>
