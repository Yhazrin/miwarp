<script lang="ts">
  /**
   * Notification Capsule — single-slot, top-centered, status-colored.
   *
   * Reuses the session-island shell tokens so a notification morph feels
   * like the same surface as the chat status bar's start/end flash.
   * Position: pinned to `--session-statusbar-top`, horizontally centered
   * above the main content so it lines up with the SessionStatusBar on
   * the chat page (and gracefully centers on every other route).
   */
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getCurrentToast, dismissToast, type ToastType } from "$lib/stores/toast-store.svelte";
  import { t } from "$lib/i18n/index.svelte";

  const toast = $derived(getCurrentToast());

  function shellClass(type: ToastType): string {
    switch (type) {
      case "success":
        return "notification-capsule-success";
      case "error":
        return "notification-capsule-error";
      case "warning":
        return "notification-capsule-warning";
      case "info":
      default:
        return "notification-capsule-info";
    }
  }

  function iconPath(type: ToastType): string {
    switch (type) {
      case "success":
        return "M5 12l4.5 4.5L19 7";
      case "error":
        return "M6 6l12 12M18 6L6 18";
      case "warning":
        return "M12 8v5m0 3h.01";
      case "info":
      default:
        return "M12 8h.01M11 12h1v5h1";
    }
  }

  function accentClass(type: ToastType): string {
    switch (type) {
      case "success":
        return "text-miwarp-status-success";
      case "error":
        return "text-miwarp-status-error";
      case "warning":
        return "text-miwarp-status-warning";
      case "info":
      default:
        return "text-miwarp-status-info";
    }
  }
</script>

{#if toast}
  <!--
    Anchored at the same vertical offset as the chat SessionIsland
    (`--session-statusbar-top`). Centered horizontally above all page
    content so it's the single, predictable place a notification appears.
  -->
  <div
    class="notification-capsule-host pointer-events-none fixed inset-x-0 z-[200] flex justify-center"
    style="top: var(--session-statusbar-top, calc(12px / var(--miwarp-ui-zoom, 1)));"
    aria-live="polite"
  >
    <div
      transition:fly={{ y: -12, duration: 240, easing: cubicOut }}
      class="notification-capsule pointer-events-auto session-island-shell session-island-align-right {shellClass(
        toast.type,
      )}"
      role="status"
    >
      <div class="flex items-center gap-2.5 px-3.5 py-2">
        <svg
          class="h-4 w-4 shrink-0 {accentClass(toast.type)}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
          <path d={iconPath(toast.type)} />
        </svg>
        <div class="flex min-w-0 flex-1 flex-col leading-tight">
          <span class="truncate text-[13px] font-medium text-foreground">
            {toast.message}
          </span>
          {#if toast.description}
            <span class="truncate text-[11px] text-muted-foreground">
              {toast.description}
            </span>
          {/if}
        </div>
        {#if toast.action}
          <button
            type="button"
            class="no-drag shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => {
              toast.action?.onClick();
              dismissToast();
            }}
          >
            {toast.action.label}
          </button>
        {/if}
        <button
          type="button"
          class="no-drag shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => dismissToast()}
          aria-label={t("common_dismiss")}
          title={t("common_dismiss")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}
