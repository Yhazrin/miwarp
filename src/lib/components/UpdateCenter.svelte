<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { cliUpdateRegistry, type CliToolEntry } from "$lib/stores/cli-update-registry.svelte";
  import { getUserSettings, updateUserSettings, type UpdateCliResult } from "$lib/api";
  import { openExternalUpdateUrl } from "$lib/utils/app-updater";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { getTransport } from "$lib/transport";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let appVersion = $state("");
  let autoCheckEnabled = $state(true);
  let savingAutoCheck = $state(false);

  onMount(async () => {
    try {
      appVersion = await getTransport().getAppVersion();
    } catch {
      appVersion = "";
    }
    try {
      const settings = await getUserSettings();
      autoCheckEnabled = settings.app_auto_update_check_enabled ?? true;
      appUpdateCoordinator.setAutoCheckEnabled(autoCheckEnabled);
    } catch {
      autoCheckEnabled = appUpdateCoordinator.getAutoCheckEnabled();
    }
    cliUpdateRegistry.loadCache();
  });

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
      case "npm_global":
        return t("updateCenter_strategyNpmGlobal");
      case "homebrew_cask":
        return t("updateCenter_strategyHomebrewCask");
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
      case "installed":
        return t("updateCenter_statusInstalled");
      case "up_to_date":
        return t("updateCenter_statusUpToDate");
      case "update_available":
        return t("updateCenter_statusUpdateAvailable");
      case "installing":
        return t("updateCenter_installing");
      case "install_done":
        return t("updateCenter_installDone");
      case "install_failed":
        return t("updateCenter_installFailed");
      case "error":
        return t("updateCenter_statusError");
      default:
        return t("updateCenter_statusUnknown");
    }
  }

  function statusColor(s: CliToolEntry["status"]): string {
    switch (s) {
      case "installed":
        return "text-sky-500";
      case "up_to_date":
        return "text-emerald-500";
      case "update_available":
        return "text-amber-500";
      case "install_done":
        return "text-emerald-500";
      case "install_failed":
        return "text-red-500";
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
      case "npm_global":
      case "homebrew_cask":
        // Action button is the primary surface — no inline guidance needed.
        return "";
      case "official_installer":
        return t("updateCenter_guidanceInstaller");
      case "repo_guided":
        return t("updateCenter_guidanceRepo");
    }
  }

  function installMethodLabel(method: string | undefined): string {
    if (!method || method === "unknown") return "";
    switch (method) {
      case "npm":
        return t("updateCenter_installedViaNpm");
      case "brew_cask":
        return t("updateCenter_installedViaBrewCask");
      case "dmg":
        return t("updateCenter_installedViaDmg");
      case "deb":
        return t("updateCenter_installedViaDeb");
      case "rpm":
        return t("updateCenter_installedViaRpm");
      case "appimage":
        return t("updateCenter_installedViaAppImage");
      case "msi":
        return t("updateCenter_installedViaMsi");
      default:
        return t("updateCenter_installedViaUnknown");
    }
  }

  function actionLabelFor(tool: CliToolEntry): string {
    if (!tool.installedVersion) return t("updateCenter_actionInstall");
    if (tool.status === "update_available" && tool.latestVersion) {
      return t("updateCenter_actionUpdate", { version: tool.latestVersion });
    }
    return t("updateCenter_actionUpToDate");
  }

  function actionDisabled(tool: CliToolEntry): boolean {
    if (tool.status === "installing" || tool.status === "checking") return true;
    if (!cliUpdateRegistry.canAutoUpdate(tool.id)) return true;
    if (tool.installedVersion && tool.status === "up_to_date") return true;
    return false;
  }

  async function handleOneClick(tool: CliToolEntry) {
    try {
      const result: UpdateCliResult = await cliUpdateRegistry.installOrUpdate(tool.id);
      if (result.success) {
        showToast(t("updateCenter_installDone"), "success");
      } else {
        showToast(t("updateCenter_installFailed"), "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function openDocs(url: string) {
    await openExternalUpdateUrl(url);
  }

  async function handleAutoCheckChange(enabled: boolean) {
    autoCheckEnabled = enabled;
    appUpdateCoordinator.setAutoCheckEnabled(enabled);
    savingAutoCheck = true;
    try {
      const settings = await updateUserSettings({ app_auto_update_check_enabled: enabled });
      autoCheckEnabled = settings.app_auto_update_check_enabled ?? enabled;
    } finally {
      savingAutoCheck = false;
    }
  }
</script>

<MiDialog bind:open size="lg" contentClass="overflow-hidden">
  <div class="flex items-center justify-between border-b border-border px-6 py-4">
    <div class="flex items-center gap-3">
      <Icon name="refresh-cw" size="md" class="text-muted-foreground" />
      <h2 class="text-base font-semibold text-foreground">{t("updateCenter_title")}</h2>
    </div>
    {#if appVersion}
      <span class="text-xs text-muted-foreground">v{appVersion}</span>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
    <!-- MiWarp App Update Section -->
    <section>
      <h3 class="mb-3 text-sm font-medium text-foreground">{t("updateCenter_appSection")}</h3>

      {#if appUpdateCoordinator.phase === "idle"}
        <div
          class="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
        >
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
        <div
          class="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
        >
          <div
            class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
          ></div>
          <span class="text-sm text-muted-foreground">{t("appUpdate_checking")}</span>
        </div>
      {:else if appUpdateCoordinator.phase === "available" && appUpdateCoordinator.state.offer}
        <div class="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">
              {t("appUpdate_available", { version: appUpdateCoordinator.state.offer.version })}
            </span>
          </div>
          {#if appUpdateCoordinator.state.offer.kind === "in_app" && appUpdateCoordinator.state.offer.notes}
            <div class="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
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
        <div class="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-3">
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
        <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-3">
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
        <div class="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
          <span class="text-sm text-muted-foreground">
            {t("appUpdate_upToDate", {
              version: appUpdateCoordinator.state.upToDateVersion || appVersion || "-",
            })}
          </span>
        </div>
      {:else if appUpdateCoordinator.phase === "failed"}
        <div class="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 space-y-2">
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
    </section>

    <!-- CLI Tools Update Section -->
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
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground">{tool.name}</span>
                  <span class="text-[10px] text-muted-foreground/60"
                    >{strategyLabel(tool.strategy)}</span
                  >
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {#if tool.installedVersion}
                    <span>v{tool.installedVersion}</span>
                  {/if}
                  {#if tool.status === "update_available" && tool.latestVersion}
                    <span class="text-amber-500">→ v{tool.latestVersion}</span>
                  {/if}
                  {#if installMethodLabel(tool.installMethod)}
                    <span class="text-[10px] text-muted-foreground/70"
                      >{installMethodLabel(tool.installMethod)}</span
                    >
                  {/if}
                  {#if tool.updateCommand}
                    <code class="text-[10px] bg-muted px-1 rounded font-mono"
                      >{tool.updateCommand}</code
                    >
                  {/if}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="text-[10px] {statusColor(tool.status)}"
                  >{statusLabel(tool.status)}</span
                >
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
            {#if guidanceLabel(tool)}
              <p class="text-[10px] text-muted-foreground/80">{guidanceLabel(tool)}</p>
            {/if}
            {#if tool.error}
              <p class="text-[10px] text-red-500/80">{tool.error}</p>
            {/if}
            <div class="flex items-center gap-3 pt-1">
              {#if cliUpdateRegistry.canAutoUpdate(tool.id)}
                <button
                  type="button"
                  class="rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  onclick={() => handleOneClick(tool)}
                  disabled={actionDisabled(tool)}
                >
                  {tool.status === "installing"
                    ? t("updateCenter_installing")
                    : actionLabelFor(tool)}
                </button>
              {/if}
              <button
                type="button"
                class="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                onclick={() => openDocs(tool.docsUrl)}
              >
                {t("updateCenter_viewDocs")}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- Preferences Section -->
    <section>
      <h3 class="mb-3 text-sm font-medium text-foreground">{t("updateCenter_prefsSection")}</h3>
      <div class="space-y-2">
        <label
          class="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-2.5"
        >
          <span class="text-sm text-foreground">{t("updateCenter_autoCheck")}</span>
          <input
            type="checkbox"
            checked={autoCheckEnabled}
            disabled={savingAutoCheck}
            onchange={(e) => handleAutoCheckChange((e.target as HTMLInputElement).checked)}
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
        </label>
      </div>
    </section>
  </div>

  <div class="border-t border-border px-6 py-3 text-xs text-muted-foreground">
    {t("updateCenter_footer")}
  </div>
</MiDialog>
