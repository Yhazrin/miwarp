<script lang="ts">
  import { onMount } from "svelte";
  import { readAppReadme, refreshAppReadme } from "$lib/api";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { renderMarkdown } from "$lib/utils/markdown";
  import { currentLocale, t } from "$lib/i18n/index.svelte";
  import { getTransport } from "$lib/transport";
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  let {
    open = $bindable(false),
    onOpenUpdateCenter,
  }: { open: boolean; onOpenUpdateCenter?: () => void } = $props();

  let appVersion = $state("");
  let readmeSource = $state("");
  let readmeOrigin = $state<"remote" | "remote-cache" | "local-fallback" | null>(null);
  let readmeLoading = $state(false);
  let readmeRefreshing = $state(false);
  let readmeError = $state("");

  const updateButtonLabel = $derived.by(() => {
    if (appUpdateCoordinator.isBusy) {
      return t("appUpdate_checking");
    }
    return t("appUpdate_manual");
  });

  onMount(async () => {
    try {
      appVersion = await getTransport().getAppVersion();
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

  const readmeOriginLabel = $derived.by(() => {
    switch (readmeOrigin) {
      case "remote":
        return t("about_readmeOriginRemote");
      case "remote-cache":
        return t("about_readmeOriginRemoteCache");
      case "local-fallback":
        return t("about_readmeOriginLocalFallback");
      default:
        return "";
    }
  });

  async function loadReadme(locale = currentLocale(), refresh = false) {
    if (refresh) {
      readmeRefreshing = true;
    } else {
      readmeLoading = true;
    }
    readmeError = "";
    try {
      const result = refresh ? await refreshAppReadme(locale) : await readAppReadme(locale);
      readmeSource = result.content;
      readmeOrigin = result.origin;
    } catch (err) {
      readmeSource = "";
      readmeOrigin = null;
      readmeError = err instanceof Error ? err.message : String(err);
    } finally {
      readmeLoading = false;
      readmeRefreshing = false;
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
      {#if readmeOriginLabel && !readmeLoading}
        <span
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
          title={readmeOriginLabel}
        >
          <span
            class="inline-block h-1.5 w-1.5 rounded-full {readmeOrigin === 'remote'
              ? 'bg-emerald-500'
              : readmeOrigin === 'remote-cache'
                ? 'bg-amber-500'
                : 'bg-slate-400'}"
          ></span>
          {readmeOriginLabel}
        </span>
      {/if}
      <button
        type="button"
        class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        onclick={() => void loadReadme(currentLocale(), true)}
        disabled={readmeRefreshing}
        aria-label={t("about_refreshReadme")}
        title={t("about_refreshReadme")}
      >
        {#if readmeRefreshing}
          <Spinner size="sm" />
        {:else}
          {t("about_refreshReadme")}
        {/if}
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
