<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  let {
    open = $bindable(false),
    title = "",
    closeable = true,
    size = "default",
    noPadding = false,
    type: _type = "default",
    onclose: _onclose,
    children,
  }: {
    open?: boolean;
    title?: string;
    closeable?: boolean;
    size?: "default" | "sm" | "lg" | "xl";
    noPadding?: boolean;
    type?: "default" | "info" | "warning" | "error";
    onclose?: () => void;
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
      _onclose?.();
    }
  }

  function handleBackdropClick() {
    if (!closeable) return;
    open = false;
    _onclose?.();
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
      class="fixed inset-0 bg-miwarp-overlay backdrop-blur-md"
      onclick={handleBackdropClick}
      role="presentation"
    ></div>

    <!-- Content -->
    <div
      class="elevation-3 relative z-50 w-full animate-modal-in rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] backdrop-blur-2xl {size ===
      'sm'
        ? 'max-w-sm'
        : size === 'lg'
          ? 'max-w-xl'
          : size === 'xl'
            ? 'max-w-2xl'
            : 'max-w-lg'} {noPadding ? '' : 'p-6'}"
      style="background: hsl(var(--miwarp-bg-deep) / 0.94);"
    >
      {#if title}
        <h2 class="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {/if}
      {#if closeable}
        <button
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md
                 text-miwarp-text-tertiary transition-colors
                 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary"
          onclick={() => {
            open = false;
            _onclose?.();
          }}
          aria-label={t("common_close")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    </div>
  </div>
{/if}
