<script lang="ts">
  let {
    open = $bindable(false),
    title = "",
    closeable = true,
    children,
  }: {
    open?: boolean;
    title?: string;
    closeable?: boolean;
    children?: import("svelte").Snippet;
  } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();

  // Auto-focus dialog container when opened so Escape hits onkeydown here
  $effect(() => {
    if (open) {
      dialogEl?.focus();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (!closeable) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      open = false;
    }
  }

  function handleBackdropClick() {
    if (!closeable) return;
    open = false;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={handleKeydown}
  >
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/50 backdrop-blur-md"
      onclick={handleBackdropClick}
      role="presentation"
    ></div>

    <!-- Content -->
    <div class="glass-panel elevation-3 relative z-50 w-full max-w-lg p-6 animate-modal-in">
      {#if title}
        <h2 class="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {/if}
      {#if closeable}
        <button
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md
                 text-miwarp-text-tertiary transition-colors
                 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary"
          onclick={() => (open = false)}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    </div>
  </div>
{/if}
