<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import type { DiagnosticsReport, UserSettings } from "$lib/types";
  import { buildDoctorReport } from "$lib/utils/doctor";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";

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

  async function refresh() {
    loading = true;
    error = null;
    try {
      const [diag, dir] = await Promise.all([api.runDiagnostics(""), api.getDataDirectory()]);
      report = diag;
      dataDir = dir;
      markdownReport = await buildDoctorReport("");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      report = null;
    } finally {
      loading = false;
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

  onMount(() => {
    void refresh();
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
      <div class="rounded-md bg-background/60 px-3 py-2">
        <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("settings_doctor_cli")}
        </dt>
        <dd class="mt-1 text-sm font-medium">
          {#if report.cli.found}
            {report.cli.version ?? "—"}
          {:else}
            <span class="text-destructive">{t("doctor_cliNotFound")}</span>
          {/if}
        </dd>
        {#if report.cli.path}
          <dd
            class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
            title={report.cli.path}
          >
            {report.cli.path}
          </dd>
        {/if}
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
