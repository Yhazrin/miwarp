<script lang="ts">
  import { getToasts, dismissToast, type ToastType } from "$lib/stores/toast-store.svelte";
  import { onMount } from "svelte";

  const toasts = $derived(getToasts());

  function iconFor(type: ToastType): string {
    switch (type) {
      case "success":
        return "M9 12l2 2 4-4";
      case "error":
        return "M18 6L6 18M6 6l12 12";
      case "warning":
        return "M12 9v4m0 4h.01";
      case "info":
      default:
        return "M12 16v-4m0-4h.01";
    }
  }

  function colorClass(type: ToastType): string {
    switch (type) {
      case "success":
        return "border-l-miwarp-status-success";
      case "error":
        return "border-l-miwarp-status-error";
      case "warning":
        return "border-l-miwarp-status-warning";
      case "info":
      default:
        return "border-l-miwarp-status-info";
    }
  }

  let timers = $state<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  $effect(() => {
    for (const toast of toasts) {
      if (!timers.has(toast.id)) {
        const timer = setTimeout(() => {
          dismissToast(toast.id);
          timers.delete(toast.id);
        }, toast.duration);
        timers.set(toast.id, timer);
      }
    }
  });

  onMount(() => {
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  });
</script>

{#if toasts.length > 0}
  <div
    class="fixed bottom-20 right-4 z-[200] flex flex-col gap-2 pointer-events-none"
    aria-live="polite"
  >
    {#each toasts as toast (toast.id)}
      <div
        class="pointer-events-auto motion-slide-up flex items-start gap-2.5 px-3.5 py-2.5
          bg-card/95 backdrop-blur-sm border border-border/50 border-l-2 {colorClass(toast.type)}
          rounded-lg shadow-lg max-w-[340px]"
        role="alert"
      >
        <svg
          class="h-4 w-4 shrink-0 mt-0.5 text-{toast.type === 'success'
            ? 'miwarp-status-success'
            : toast.type === 'error'
              ? 'miwarp-status-error'
              : toast.type === 'warning'
                ? 'miwarp-status-warning'
                : 'miwarp-status-info'}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d={iconFor(toast.type)} />
        </svg>
        <span class="text-sm text-foreground/90 flex-1">{toast.message}</span>
        <button
          class="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          onclick={() => dismissToast(toast.id)}
          aria-label="Dismiss"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}
