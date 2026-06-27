<script lang="ts">
  import { onMount } from "svelte";
  import { readAppReadme } from "$lib/api";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { renderMarkdown } from "$lib/utils/markdown";
  import { currentLocale, t } from "$lib/i18n/index.svelte";
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  let {
    open = $bindable(false),
    onOpenUpdateCenter,
  }: { open: boolean; onOpenUpdateCenter?: () => void } = $props();

  let appVersion = $state("");
  let readmeSource = $state("");
  let readmeLoading = $state(false);
  let readmeError = $state("");

  const updateButtonLabel = $derived.by(() => {
    if (appUpdateCoordinator.isBusy) {
      return t("appUpdate_checking");
    }
    return t("appUpdate_manual");
  });

  onMount(async () => {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      appVersion = await getVersion();
    } catch {
      appVersion = "";
    }
  });

  function processReadme(html: string): string {
    return html
      .replace(/src="static\//g, 'src="/')
      .replace(/<p align="center">[\s\S]*?<\/p>/g, (match) =>
        match.includes("README") ? "" : match,
      )
      .replace(/<a href="LICENSE">([^<]*)<\/a>/g, "$1")
      .trim();
  }

  let readmeHtml = $derived(readmeSource ? processReadme(renderMarkdown(readmeSource)) : "");

  async function loadReadme(locale = currentLocale()) {
    readmeLoading = true;
    readmeError = "";
    try {
      readmeSource = await readAppReadme(locale);
    } catch (err) {
      readmeSource = "";
      readmeError = err instanceof Error ? err.message : String(err);
    } finally {
      readmeLoading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    void loadReadme(currentLocale());
  });

  async function updateToLatest() {
    if (appUpdateCoordinator.isBusy) return;
    await appUpdateCoordinator.checkForUpdate();
    onOpenUpdateCenter?.();
  }
</script>

<MiDialog bind:open size="lg" contentClass="overflow-hidden">
  <div class="flex items-center justify-between border-b border-border px-6 py-4">
    <div class="flex items-center gap-3">
      <span class="text-xs text-muted-foreground">{appVersion ? `MiWarp v${appVersion}` : ""}</span>
      <button
        type="button"
        class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        onclick={updateToLatest}
        disabled={appUpdateCoordinator.isBusy}
      >
        {updateButtonLabel}
      </button>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-6 py-4">
    {#if readmeLoading}
      <div class="flex h-40 items-center justify-center gap-3">
        <Spinner size="sm" />
        <span class="text-sm text-muted-foreground">{t("common_loading")}</span>
      </div>
    {:else if readmeError}
      <div class="flex h-40 flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-destructive">{t("release_loadFailed")}</p>
        <p class="max-w-md text-xs text-muted-foreground break-words">{readmeError}</p>
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          onclick={() => void loadReadme()}
        >
          {t("common_retry")}
        </button>
      </div>
    {:else}
      <article class="prose prose-sm dark:prose-invert max-w-none">
        {@html readmeHtml}
      </article>
    {/if}
  </div>

  <div
    class="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-muted-foreground"
  >
    <span>Apache License 2.0</span>
    <span>Copyright 2025-2026 MiWarp Contributors</span>
  </div>
</MiDialog>
