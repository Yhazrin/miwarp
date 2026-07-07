<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";

  const offer = $derived(appUpdateCoordinator.state.offer);
  const visible = $derived(
    appUpdateCoordinator.hasUpdate && !!offer && $page.url.pathname !== "/settings",
  );

  function closeNotice(): void {
    appUpdateCoordinator.dismissPrompt();
  }

  async function openSettingsUpdates(): Promise<void> {
    appUpdateCoordinator.dismissPrompt();
    await goto("/settings?tab=updates");
  }
</script>

{#if visible && offer}
  <div
    class="pointer-events-none fixed inset-0 z-[9000] flex items-center justify-center px-4 py-6"
    aria-live="polite"
  >
    <div
      class="pointer-events-auto w-full max-w-[360px] rounded-lg border border-border bg-background shadow-2xl shadow-black/20"
      role="dialog"
      aria-label={t("appUpdate_noticeTitle", { version: offer.version })}
    >
      <div class="flex items-start gap-3 px-4 py-4">
        <div
          class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        >
          <Icon name="download" size="md" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-foreground">
            {t("appUpdate_noticeTitle", { version: offer.version })}
          </h2>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            {t("appUpdate_noticeBody")}
          </p>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onclick={openSettingsUpdates}
            >
              {t("appUpdate_goToSettings")}
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onclick={closeNotice}
            >
              {t("appUpdate_dismiss")}
            </button>
          </div>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onclick={closeNotice}
          aria-label={t("appUpdate_dismiss")}
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
    </div>
  </div>
{/if}
