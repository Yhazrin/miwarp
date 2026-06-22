<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";

  let { onOpenCenter }: { onOpenCenter?: () => void } = $props();
</script>

{#if appUpdateCoordinator.hasUpdate && appUpdateCoordinator.state.offer}
  <button
    type="button"
    class="pointer-events-auto flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm transition-colors hover:bg-primary/10"
    onclick={() => onOpenCenter?.()}
    title={t("appUpdate_available", { version: appUpdateCoordinator.state.offer.version })}
  >
    <span class="relative flex h-2 w-2">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40"
      ></span>
      <span class="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
    </span>
    <span class="hidden sm:inline">{t("updateCenter_badge")}</span>
  </button>
{/if}
