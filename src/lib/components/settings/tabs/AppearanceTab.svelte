<script lang="ts">
  /**
   * v1.0.6 follow-up: extracted from settings +page.svelte's
   * `activeTab === "general"` branch. Renders language + UI zoom +
   * theme editor (the latter delegates to ThemeCard).
   *
   * v1.0.6 follow-up #2: re-added the lost Sidebar & Display toggles
   * (icon rail, mascot, token report, visual perf mode, CLI auto-sync)
   * that disappeared in the v1.0.6 refactor. The session mode toggle
   * stays OUT of settings — it moved to the new-session card on the
   * chat welcome screen.
   *
   * State is lifted to the orchestrator (+page.svelte).
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { LOCALE_REGISTRY, getEntry, currentLocale, switchLocale } from "$lib/i18n/index.svelte";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import SettingsToggle from "../SettingsToggle.svelte";
  import {
    normalizeSessionIslandAlignment,
    SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
    type SessionIslandAlignment,
  } from "$lib/utils/session-island-alignment";

  let {
    settings,
    onSaveGeneralPatch = async (_patch: Record<string, unknown>) => {},
    onZoom = (_factor: number) => {},
  }: {
    settings: UserSettings | null;
    onSaveGeneralPatch?: (patch: Record<string, unknown>) => Promise<void>;
    onZoom?: (factor: number) => void;
  } = $props();

  // UI zoom slider: while the user is dragging, only update the local preview
  // (the percentage label and the slider's own thumb). The actual webview
  // reflow + settings save are deferred to `change` / pointer release so the
  // page doesn't stutter on every input event.
  let zoomDraft = $state<number | null>(null);
  const zoomValue = $derived(zoomDraft ?? settings?.ui_zoom ?? 1);

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function pickLocale(code: string) {
    switchLocale(code);
    void onSaveGeneralPatch({ ui_locale: code });
  }

  // v1.0.6 follow-up: visual performance mode has 4 options. Lifted out
  // so the template stays readable.
  const VISUAL_PERF_MODES = [
    {
      value: "auto",
      labelKey: "settings_visualPerfMode_auto",
      descKey: "settings_visualPerfMode_autoDesc",
    },
    {
      value: "quality",
      labelKey: "settings_visualPerfMode_quality",
      descKey: "settings_visualPerfMode_qualityDesc",
    },
    {
      value: "balanced",
      labelKey: "settings_visualPerfMode_balanced",
      descKey: "settings_visualPerfMode_balancedDesc",
    },
    {
      value: "performance",
      labelKey: "settings_visualPerfMode_performance",
      descKey: "settings_visualPerfMode_performanceDesc",
    },
  ] as const;

  async function pickVisualPerfMode(mode: string) {
    await onSaveGeneralPatch({ visual_performance_mode: mode });
    window.dispatchEvent(
      new CustomEvent("miwarp:visual-performance-changed", { detail: { mode } }),
    );
  }

  const SESSION_ISLAND_ALIGNMENTS = [
    {
      value: "center" as const,
      labelKey: "settings_sessionIslandAlignment_center",
      descKey: "settings_sessionIslandAlignment_centerDesc",
    },
    {
      value: "right" as const,
      labelKey: "settings_sessionIslandAlignment_right",
      descKey: "settings_sessionIslandAlignment_rightDesc",
    },
  ];

  let islandAlignmentDraft = $state<SessionIslandAlignment | null>(null);

  const activeIslandAlignment = $derived(
    normalizeSessionIslandAlignment(islandAlignmentDraft ?? settings?.session_island_alignment),
  );

  async function pickSessionIslandAlignment(alignment: SessionIslandAlignment) {
    islandAlignmentDraft = alignment;
    try {
      await onSaveGeneralPatch({ session_island_alignment: alignment });
      window.dispatchEvent(
        new CustomEvent(SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT, { detail: { alignment } }),
      );
    } catch {
      // The settings orchestrator owns error reporting; do not broadcast an unsaved value.
    } finally {
      islandAlignmentDraft = null;
    }
  }
</script>

<div class="space-y-6">
  <!-- Language Card -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_general_language")}
    </h2>
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium">{t("settings_general_displayLanguage")}</p>
        <p class="text-xs text-muted-foreground"></p>
      </div>
      <div class="flex flex-wrap gap-1">
        {#each LOCALE_REGISTRY as entry (entry.code)}
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
              {currentLocale() === entry.code
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
            onclick={() => pickLocale(entry.code)}
          >
            {getEntry(entry.code)?.nativeName ?? entry.code}
          </button>
        {/each}
      </div>
    </div>
  </Card>

  <!-- Display Card (UI zoom) -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_general_display")}
    </h2>
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium">{t("settings_general_uiZoom")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {t("settings_general_uiZoomDesc")}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input
          type="range"
          min="0.7"
          max="1.6"
          step="0.05"
          value={zoomValue}
          oninput={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            // Only update the local draft — the real reflow + save happens
            // on `change` (mouse-up / blur / keyboard commit).
            zoomDraft = v;
          }}
          onchange={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            zoomDraft = null;
            onZoom(v);
            void onSaveGeneralPatch({ ui_zoom: v });
          }}
          onpointerup={() => {
            // Defensive: some platforms don't fire `change` on programmatic
            // pointer release. Re-apply + save so the final value sticks.
            if (zoomDraft !== null) {
              const v = zoomDraft;
              zoomDraft = null;
              onZoom(v);
              void onSaveGeneralPatch({ ui_zoom: v });
            }
          }}
          class="w-40 accent-primary"
        />
        <span class="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {Math.round(zoomValue * 100)}%
        </span>
      </div>
    </div>
  </Card>

  <!-- Window material: native OS blur for the entire left sidebar. -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_appearance_window")}
    </h2>
    <SettingsToggle
      checked={settings?.native_window_glass_enabled !== false}
      label={t("settings_appearance_nativeWindowGlass")}
      description={t("settings_appearance_nativeWindowGlassDesc")}
      onchange={(value) => onSaveGeneralPatch({ native_window_glass_enabled: value })}
    />
    {#if settings?.native_window_glass_enabled !== false}
      <div class="flex items-center justify-between gap-4 pt-2">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">{t("settings_appearance_nativeWindowMaterial")}</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            {t("settings_appearance_nativeWindowMaterialDesc")}
          </p>
        </div>
        <div class="flex flex-wrap gap-1">
          {#each [{ value: "header_view", labelKey: "settings_appearance_materialHeaderView" }, { value: "sidebar", labelKey: "settings_appearance_materialSidebar" }] as opt (opt.value)}
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
                {(settings?.native_window_glass_material ?? 'header_view') === opt.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
              onclick={() => onSaveGeneralPatch({ native_window_glass_material: opt.value })}
            >
              {t(opt.labelKey as MessageKey)}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </Card>

  <!--
    v1.0.6 follow-up: re-added Sidebar & Display toggles that were lost
    in the v1.0.6 refactor. All four are independent UI preferences and
    share the same save helper. The session mode selector used to live
    in this area too — it has been removed per the v1.0.6 follow-up
    (the picker is now on the chat welcome screen, default "single").
  -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_general_display")}
    </h2>

    <SettingsToggle
      checked={settings?.icon_rail_enabled !== false}
      label={t("settings_iconRailEnabled")}
      description={t("settings_iconRailEnabledDesc")}
      onchange={(value) => onSaveGeneralPatch({ icon_rail_enabled: value })}
    />

    <SettingsToggle
      checked={settings?.mascot_enabled !== false}
      label={t("settings_mascotEnabled")}
      description={t("settings_mascotEnabledDesc")}
      onchange={(value) => onSaveGeneralPatch({ mascot_enabled: value })}
    />

    <SettingsToggle
      checked={settings?.show_token_usage_report !== false}
      label={t("settings_showTokenReport")}
      description={t("settings_showTokenReportDesc")}
      onchange={(value) => onSaveGeneralPatch({ show_token_usage_report: value })}
    />

    <div class="space-y-2 pt-2">
      <div>
        <p class="text-sm font-medium">{t("settings_sessionIslandAlignment")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {t("settings_sessionIslandAlignmentDesc")}
        </p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each SESSION_ISLAND_ALIGNMENTS as opt (opt.value)}
          {@const active = activeIslandAlignment === opt.value}
          <button
            type="button"
            aria-pressed={active}
            class="rounded-lg border p-3 text-left transition-colors {active
              ? 'border-primary/50 bg-muted/55 shadow-sm ring-1 ring-primary/20'
              : 'border-border/40 bg-background/40 hover:bg-muted/30'}"
            onclick={() => pickSessionIslandAlignment(opt.value)}
          >
            <div
              class="session-island-alignment-preview mb-2.5 rounded-md border border-border/35 bg-muted/25 p-2"
              aria-hidden="true"
            >
              <div class="relative h-10 rounded-sm bg-background/60">
                <span
                  class="absolute top-1.5 h-2 rounded-full bg-primary/70 {opt.value === 'center'
                    ? 'left-1/2 w-10 -translate-x-1/2'
                    : 'right-1.5 w-8'}"
                ></span>
              </div>
            </div>
            <div class="text-sm font-medium text-foreground">{t(opt.labelKey as MessageKey)}</div>
            <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t(opt.descKey as MessageKey)}
            </p>
          </button>
        {/each}
      </div>
    </div>

    <div class="space-y-2 pt-2">
      <div>
        <p class="text-sm font-medium">{t("settings_visualPerfMode")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {t("settings_visualPerfModeDesc")}
        </p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each VISUAL_PERF_MODES as mode (mode.value)}
          {@const active = (settings?.visual_performance_mode ?? "auto") === mode.value}
          <button
            type="button"
            class="rounded-lg border p-3 text-left transition-colors {active
              ? 'border-border bg-muted/55 shadow-sm'
              : 'border-border/40 bg-background/40 hover:bg-muted/30'}"
            onclick={() => pickVisualPerfMode(mode.value)}
          >
            <div class="text-sm font-medium text-foreground">{t(mode.labelKey as MessageKey)}</div>
            <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t(mode.descKey as MessageKey)}
            </p>
          </button>
        {/each}
      </div>
    </div>
  </Card>

  <!--
    v1.0.6 follow-up: re-added CLI auto-sync controls that were lost
    in the v1.0.6 refactor. Periodically pulls new messages from Claude
    Code transcript files into imported MiWarp sessions.
  -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_cliAutoSyncEnabled")}
    </h2>
    <SettingsToggle
      checked={settings?.cli_auto_sync_enabled !== false}
      label={t("settings_cliAutoSyncEnabled")}
      description={t("settings_cliAutoSyncEnabledDesc")}
      onchange={(value) => onSaveGeneralPatch({ cli_auto_sync_enabled: value })}
    />
    {#if settings?.cli_auto_sync_enabled !== false}
      <div class="flex flex-col gap-1.5 pl-1">
        <label class="text-sm font-medium" for="cli-auto-sync-interval">
          {t("settings_cliAutoSyncInterval")}
        </label>
        <input
          id="cli-auto-sync-interval"
          type="number"
          min="1"
          max="120"
          step="1"
          value={settings?.cli_auto_sync_interval_minutes ?? 5}
          onchange={(e) => {
            const raw = parseInt((e.target as HTMLInputElement).value, 10);
            const v = isNaN(raw) ? 5 : Math.max(1, Math.min(120, raw));
            void onSaveGeneralPatch({ cli_auto_sync_interval_minutes: v });
          }}
          class="w-24 rounded-md border bg-transparent px-2 py-1 text-sm"
        />
        <p class="text-xs text-muted-foreground">{t("settings_cliAutoSyncIntervalDesc")}</p>
      </div>
      <SettingsToggle
        checked={settings?.cli_auto_sync_import_new !== false}
        label={t("settings_cliAutoSyncImportNew")}
        description={t("settings_cliAutoSyncImportNewDesc")}
        onchange={(value) => onSaveGeneralPatch({ cli_auto_sync_import_new: value })}
      />
    {/if}
  </Card>
</div>
