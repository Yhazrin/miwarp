<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import type { DiagnosticsReport, UserSettings } from "$lib/types";
  import { buildDoctorReport } from "$lib/utils/doctor";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import { pushSessionIslandNotify } from "$lib/stores/session-island-notify.svelte";

  interface Props {
    settings: UserSettings | null;
  }

  let { settings }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);
  let report = $state<DiagnosticsReport | null>(null);
  let dataDir = $state("");
  let markdownReport = $state("");
  let copied = $state(false);
  let refreshGeneration = 0;
  // One-click update state. Lives in the doctor panel because the version
  // check and the update button share the same render path.
  let updating = $state(false);
  let updateError = $state<string | null>(null);
  let updateSuccessMessage = $state<string | null>(null);
  let updateSuccessTimer: ReturnType<typeof setTimeout> | undefined;

  const resolvedPerfMode = $derived.by(() => {
    const mode = settings?.visual_performance_mode ?? "auto";
    if (mode !== "auto") return mode;
    if (typeof document === "undefined") return "auto";
    const root = document.documentElement;
    if (root.classList.contains("perf-performance")) return "performance (auto)";
    if (root.classList.contains("perf-balanced")) return "balanced (auto)";
    if (root.classList.contains("perf-quality")) return "quality (auto)";
    return "auto";
  });

  const activePlatform = $derived(
    settings?.active_platform_id?.trim() || t("settings_doctor_platformNone"),
  );

  /** Semver-aware `installed < latest` comparison. Falls back to string
   *  compare when either side is missing or unparseable. */
  function isUpdateAvailable(
    installed: string | null | undefined,
    latest: string | null | undefined,
  ): boolean {
    if (!installed || !latest) return false;
    const parse = (v: string): number[] | null => {
      const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const a = parse(installed);
    const b = parse(latest);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  const updateAvailable = $derived(
    isUpdateAvailable(report?.cli.version ?? null, report?.cli.latest ?? null),
  );

  async function refresh() {
    const gen = ++refreshGeneration;
    loading = true;
    error = null;
    try {
      const [diag, dir] = await Promise.all([api.runDiagnostics(""), api.getDataDirectory()]);
      if (gen !== refreshGeneration) return;
      report = diag;
      dataDir = dir;
      markdownReport = await buildDoctorReport("");
      if (gen !== refreshGeneration) return;
    } catch (e) {
      if (gen !== refreshGeneration) return;
      error = e instanceof Error ? e.message : String(e);
      report = null;
    } finally {
      if (gen === refreshGeneration) loading = false;
    }
  }

  async function copyReport() {
    if (!markdownReport) return;
    try {
      await navigator.clipboard.writeText(markdownReport);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* ignore */
    }
  }

  function showUpdateSuccess(message: string) {
    updateError = null;
    clearTimeout(updateSuccessTimer);
    if (
      pushSessionIslandNotify({
        text: message,
        tone: "info",
      })
    ) {
      updateSuccessMessage = null;
      return;
    }
    updateSuccessMessage = message;
    updateSuccessTimer = setTimeout(() => {
      updateSuccessMessage = null;
      updateSuccessTimer = undefined;
    }, 3500);
  }

  async function runCliUpdate() {
    if (updating) return;
    updating = true;
    updateError = null;
    updateSuccessMessage = null;
    clearTimeout(updateSuccessTimer);
    try {
      const result = await api.updateClaudeCli();
      if (result.success) {
        showUpdateSuccess(t("settings_doctor_updateSuccess"));
      } else {
        const detail = (result.stderr || result.stdout || "").trim().slice(0, 200);
        updateError = detail || t("settings_doctor_updateFailed");
      }
      // Re-run diagnostics so the version display + button state refresh.
      await refresh();
    } catch (e) {
      updateError = e instanceof Error ? e.message : String(e);
    } finally {
      updating = false;
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      refreshGeneration += 1;
      clearTimeout(updateSuccessTimer);
    };
  });

  function mcpSummary(r: DiagnosticsReport): string {
    const issues = r.configs.mcp_issues.length;
    if (issues > 0) return t("settings_doctor_mcpIssues", { count: String(issues) });
    if (r.services.mcp_registry === true) return t("settings_doctor_mcpOk");
    if (r.services.mcp_registry === false) return t("settings_doctor_mcpUnreachable");
    return t("settings_doctor_mcpUnknown");
  }
</script>

<div class="space-y-4 rounded-lg border border-border/50 bg-muted/20 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold text-foreground">{t("settings_doctor_title")}</h3>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("settings_doctor_desc")}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onclick={refresh} {loading} disabled={loading}>
        {t("settings_doctor_refresh")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onclick={copyReport}
        disabled={!markdownReport || loading}
      >
        {copied ? t("settings_doctor_copied") : t("settings_doctor_copy")}
      </Button>
    </div>
  </div>

  {#if error}
    <p class="text-sm text-destructive">{error}</p>
  {:else if loading && !report}
    <p class="text-sm text-muted-foreground">{t("settings_doctor_loading")}</p>
  {:else if report}
    <dl class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-md bg-background/60 px-3 py-2 sm:col-span-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("settings_doctor_cli")}
            </dt>
            <dd class="mt-1 text-sm font-medium">
              {#if report.cli.found}
                {#if report.cli.version}
                  {t("doctor_cliFound", { version: report.cli.version })}
                {:else}
                  {t("doctor_cliNotFound")}
                {/if}
              {:else}
                <span class="text-destructive">{t("doctor_cliNotFound")}</span>
              {/if}
            </dd>
            {#if report.cli.path}
              <dd
                class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                title={report.cli.path}
              >
                {t("doctor_cliPath", { path: report.cli.path })}
              </dd>
            {/if}
            {#if report.cli.latest}
              <dd class="mt-1 text-[11px]">
                {#if updateAvailable}
                  <span class="text-miwarp-status-warning font-medium">
                    {t("doctor_cliUpdateAvailable", { latest: report.cli.latest })}
                  </span>
                {:else if report.cli.found}
                  <span class="text-muted-foreground">{t("doctor_cliUpToDate")}</span>
                {/if}
              </dd>
            {/if}
            {#if report.cli.auto_update_channel}
              <dd class="mt-0.5 text-[10px] text-muted-foreground/70">
                {t("doctor_cliAutoUpdate", { channel: report.cli.auto_update_channel })}
              </dd>
            {/if}
            {#if updateSuccessMessage}
              <dd class="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {updateSuccessMessage}
              </dd>
            {/if}
            {#if updateError}
              <dd class="mt-1 text-[11px] text-destructive">{updateError}</dd>
            {/if}
          </div>
          {#if report.cli.found}
            <Button
              variant={updateAvailable ? "default" : "outline"}
              size="sm"
              onclick={runCliUpdate}
              loading={updating}
              disabled={updating}
            >
              {updating ? t("settings_doctor_updating") : t("settings_doctor_update")}
            </Button>
          {/if}
        </div>
      </div>

      <div class="rounded-md bg-background/60 px-3 py-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_auth")}
        </dt>
        <dd class="mt-1 text-sm">
          {#if report.auth.has_oauth}
            {t("doctor_authOauthNoAccount")}
          {:else if report.auth.has_api_key}
            {t("doctor_authApiKey", {
              source: report.auth.api_key_source ?? "?",
              hint: report.auth.api_key_hint ?? "***",
            })}
          {:else}
            <span class="text-muted-foreground">{t("doctor_authNoOauth")}</span>
          {/if}
        </dd>
      </div>

      <div class="rounded-md bg-background/60 px-3 py-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_platform")}
        </dt>
        <dd class="mt-1 text-sm font-medium">{activePlatform}</dd>
      </div>

      <div class="rounded-md bg-background/60 px-3 py-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_perf")}
        </dt>
        <dd class="mt-1 text-sm font-medium">{resolvedPerfMode}</dd>
      </div>

      <div class="rounded-md bg-background/60 px-3 py-2 sm:col-span-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_dataDir")}
        </dt>
        <dd class="mt-1 truncate font-mono text-xs" title={dataDir}>{dataDir || "—"}</dd>
      </div>

      <div class="rounded-md bg-background/60 px-3 py-2 sm:col-span-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_mcp")}
        </dt>
        <dd class="mt-1 text-sm">{mcpSummary(report)}</dd>
      </div>
    </dl>
  {/if}
</div>
