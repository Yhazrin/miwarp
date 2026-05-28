<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fade, fly } from "svelte/transition";

  let {
    open = $bindable(false),
    title = "",
    closeable = true,
    size: _size = "default",
    type: _type = "default",
    onClose: _onClose,
    children,
  }: {
    open?: boolean;
    title?: string;
    closeable?: boolean;
    size?: "default" | "sm" | "lg" | "xl";
    type?: "default" | "info" | "warning" | "error";
    onClose?: () => void;
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

    // Focus trap: keep Tab cycling within the modal
    if (e.key === "Tab" && dialogEl) {
      const focusable = dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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
    transition:fade={{ duration: 200 }}
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
      class="elevation-3 relative z-50 w-full max-w-lg p-6 rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] backdrop-blur-2xl"
      transition:fly={{ y: 10, duration: 200 }}
      style="background: hsl(var(--miwarp-bg-deep) / 0.94);"
    >
      {#if title}
        <h2 class="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {/if}
      {#if closeable}
        <button type="button"
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md
                 text-miwarp-text-tertiary transition-colors
                 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary"
          onclick={() => (open = false)}
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
