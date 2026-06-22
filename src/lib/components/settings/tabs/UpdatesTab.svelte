<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { cliUpdateRegistry, type CliToolEntry } from "$lib/stores/cli-update-registry.svelte";
  import { openExternalUpdateUrl } from "$lib/utils/app-updater";

  const phaseLabel = $derived.by(() => {
    const phase = appUpdateCoordinator.phase;
    switch (phase) {
      case "checking":
        return t("appUpdate_checking");
      case "downloading":
        return t("appUpdate_downloading", {
          percent: String(appUpdateCoordinator.state.progress ?? 0),
        });
      case "installing":
        return t("appUpdate_installing");
      default:
        return "";
    }
  });

  const actionLabel = $derived.by(() => {
    const offer = appUpdateCoordinator.state.offer;
    if (!offer) return "";
    return offer.kind === "in_app" ? t("appUpdate_install") : t("appUpdate_download");
  });

  function strategyLabel(s: CliToolEntry["strategy"]): string {
    switch (s) {
      case "native_update":
        return t("updateCenter_strategyNative");
      case "official_installer":
        return t("updateCenter_strategyInstaller");
      case "repo_guided":
        return t("updateCenter_strategyGuided");
    }
  }

  function statusLabel(s: CliToolEntry["status"]): string {
    switch (s) {
      case "checking":
        return t("appUpdate_checking");
      case "up_to_date":
        return t("updateCenter_statusUpToDate");
      case "update_available":
        return t("updateCenter_statusUpdateAvailable");
      case "error":
        return t("updateCenter_statusError");
      default:
        return t("updateCenter_statusUnknown");
    }
  }

  function statusColor(s: CliToolEntry["status"]): string {
    switch (s) {
      case "up_to_date":
        return "text-emerald-500";
      case "update_available":
        return "text-amber-500";
      case "error":
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  }

  function guidanceLabel(tool: CliToolEntry): string {
    switch (tool.strategy) {
      case "native_update":
        return tool.updateCommand
          ? t("updateCenter_guidanceNative", { command: tool.updateCommand })
          : "";
      case "official_installer":
        return t("updateCenter_guidanceInstaller");
      case "repo_guided":
        return t("updateCenter_guidanceRepo");
    }
  }

  async function openDocs(url: string) {
    await openExternalUpdateUrl(url);
  }
</script>

<div class="space-y-6">
  <!-- MiWarp App Update -->
  <section>
    <h3 class="mb-3 text-sm font-medium text-foreground">{t("updateCenter_appSection")}</h3>

    <div class="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-3">
      {#if appUpdateCoordinator.phase === "idle"}
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">{t("updateCenter_appIdle")}</span>
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            onclick={() => appUpdateCoordinator.checkForUpdate()}
            disabled={appUpdateCoordinator.isBusy}
          >
            {t("updateCenter_checkForUpdates")}
          </button>
        </div>
      {:else if appUpdateCoordinator.phase === "checking"}
        <div class="flex items-center gap-3">
          <div
            class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
          ></div>
          <span class="text-sm text-muted-foreground">{t("appUpdate_checking")}</span>
        </div>
      {:else if appUpdateCoordinator.phase === "available" && appUpdateCoordinator.state.offer}
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">
              {t("appUpdate_available", { version: appUpdateCoordinator.state.offer.version })}
            </span>
          </div>
          {#if appUpdateCoordinator.state.offer.kind === "in_app" && appUpdateCoordinator.state.offer.notes}
            <div
              class="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto"
            >
              {appUpdateCoordinator.state.offer.notes}
            </div>
          {/if}
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              onclick={() => appUpdateCoordinator.installUpdate()}
              disabled={appUpdateCoordinator.isBusy}
            >
              {actionLabel}
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              onclick={() => appUpdateCoordinator.snooze()}
              disabled={appUpdateCoordinator.isBusy}
            >
              {t("updateCenter_snooze")}
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              onclick={() => appUpdateCoordinator.dismiss()}
              disabled={appUpdateCoordinator.isBusy}
            >
              {t("appUpdate_dismiss")}
            </button>
          </div>
        </div>
      {:else if appUpdateCoordinator.phase === "downloading" || appUpdateCoordinator.phase === "installing"}
        <div class="space-y-3">
          <div class="flex items-center gap-3">
            <div
              class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
            ></div>
            <span class="text-sm text-muted-foreground">{phaseLabel}</span>
          </div>
          {#if appUpdateCoordinator.state.progress != null}
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all duration-300"
                style="width: {appUpdateCoordinator.state.progress}%"
              ></div>
            </div>
          {/if}
        </div>
      {:else if appUpdateCoordinator.phase === "ready_to_restart"}
        <div class="space-y-3">
          <span class="text-sm text-emerald-600 dark:text-emerald-400"
            >{t("updateCenter_restartReady")}</span
          >
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onclick={() => appUpdateCoordinator.restartApplication()}
          >
            {t("updateCenter_restartNow")}
          </button>
        </div>
      {:else if appUpdateCoordinator.phase === "up_to_date"}
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">
            {t("appUpdate_upToDate", {
              version: appUpdateCoordinator.state.upToDateVersion || "-",
            })}
          </span>
        </div>
      {:else if appUpdateCoordinator.phase === "failed"}
        <div class="space-y-2">
          <span class="text-sm text-red-600 dark:text-red-400">{t("appUpdate_checkFailed")}</span>
          {#if appUpdateCoordinator.state.error}
            <p class="text-xs text-red-500/80">{appUpdateCoordinator.state.error}</p>
          {/if}
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            onclick={() => appUpdateCoordinator.retry()}
          >
            {t("updateCenter_retry")}
          </button>
        </div>
      {/if}

      <!-- Auto-check preference -->
      <div class="flex items-center justify-between border-t border-border/30 pt-3">
        <span class="text-sm text-foreground">{t("updateCenter_autoCheck")}</span>
        <input
          type="checkbox"
          checked={appUpdateCoordinator.getAutoCheckEnabled()}
          onchange={(e) =>
            appUpdateCoordinator.setAutoCheckEnabled((e.target as HTMLInputElement).checked)}
          class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
        />
      </div>
    </div>
  </section>

  <!-- CLI Tools -->
  <section>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-foreground">{t("updateCenter_cliSection")}</h3>
      <button
        type="button"
        class="rounded-md border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        onclick={() => cliUpdateRegistry.checkAll()}
      >
        {t("updateCenter_checkAll")}
      </button>
    </div>

    <div class="space-y-2">
      {#each cliUpdateRegistry.entries as tool (tool.id)}
        <div class="rounded-lg border border-border/50 bg-muted/20 px-4 py-2.5 space-y-1">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">{tool.name}</span>
              <span class="text-[10px] text-muted-foreground/60"
                >{strategyLabel(tool.strategy)}</span
              >
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[10px] {statusColor(tool.status)}">{statusLabel(tool.status)}</span>
              <button
                type="button"
                class="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                onclick={() => cliUpdateRegistry.checkTool(tool.id)}
                disabled={tool.status === "checking"}
              >
                {t("updateCenter_check")}
              </button>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {#if tool.installedVersion}
              <span>v{tool.installedVersion}</span>
            {/if}
            {#if tool.status === "update_available" && tool.latestVersion}
              <span class="text-amber-500">→ v{tool.latestVersion}</span>
            {/if}
            {#if tool.updateCommand}
              <code class="text-[10px] bg-muted px-1 rounded font-mono">{tool.updateCommand}</code>
            {/if}
          </div>
          {#if guidanceLabel(tool)}
            <p class="text-[10px] text-muted-foreground/80">{guidanceLabel(tool)}</p>
          {/if}
          <button
            type="button"
            class="text-[10px] text-primary hover:underline"
            onclick={() => openDocs(tool.docsUrl)}
          >
            {t("updateCenter_viewDocs")}
          </button>
          {#if tool.error}
            <p class="text-[10px] text-red-500/80">{tool.error}</p>
          {/if}
        </div>
      {/each}
    </div>
  </section>
</div>
