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
  import SettingsOptionCard from "../SettingsOptionCard.svelte";
  import SettingsWireframePreview from "../SettingsWireframePreview.svelte";
  import {
    normalizeSessionIslandAlignment,
    SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
    type SessionIslandAlignment,
  } from "$lib/utils/session-island-alignment";
  import { themeStore } from "$lib/stores/theme-store.svelte";

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
      preview: "visual-perf-auto" as const,
    },
    {
      value: "quality",
      labelKey: "settings_visualPerfMode_quality",
      descKey: "settings_visualPerfMode_qualityDesc",
      preview: "visual-perf-quality" as const,
    },
    {
      value: "balanced",
      labelKey: "settings_visualPerfMode_balanced",
      descKey: "settings_visualPerfMode_balancedDesc",
      preview: "visual-perf-balanced" as const,
    },
    {
      value: "performance",
      labelKey: "settings_visualPerfMode_performance",
      descKey: "settings_visualPerfMode_performanceDesc",
      preview: "visual-perf-performance" as const,
    },
  ] as const;

  const WINDOW_MATERIALS = [
    {
      value: "sidebar",
      labelKey: "settings_appearance_materialSidebar",
      descKey: "settings_appearance_materialSidebarDesc",
      preview: "window-material-sidebar" as const,
    },
    {
      value: "header_view",
      labelKey: "settings_appearance_materialHeaderView",
      descKey: "settings_appearance_materialHeaderViewDesc",
      preview: "window-material-header" as const,
    },
  ] as const;

  const ICON_RAIL_OPTIONS = [
    {
      value: true,
      labelKey: "settings_iconRailEnabled_on",
      descKey: "settings_iconRailEnabled_onDesc",
      preview: "icon-rail-on" as const,
    },
    {
      value: false,
      labelKey: "settings_iconRailEnabled_off",
      descKey: "settings_iconRailEnabled_offDesc",
      preview: "icon-rail-off" as const,
    },
  ] as const;

  const WORKSPACE_FOLDER_SORT_OPTIONS = [
    {
      value: "last_active",
      labelKey: "settings_workspaceFolderSort_lastActive",
      descKey: "settings_workspaceFolderSort_lastActiveDesc",
    },
    {
      value: "name_asc",
      labelKey: "settings_workspaceFolderSort_nameAsc",
      descKey: "settings_workspaceFolderSort_nameAscDesc",
    },
    {
      value: "name_desc",
      labelKey: "settings_workspaceFolderSort_nameDesc",
      descKey: "settings_workspaceFolderSort_nameDescDesc",
    },
    {
      value: "created_asc",
      labelKey: "settings_workspaceFolderSort_createdAsc",
      descKey: "settings_workspaceFolderSort_createdAscDesc",
    },
    {
      value: "created_desc",
      labelKey: "settings_workspaceFolderSort_createdDesc",
      descKey: "settings_workspaceFolderSort_createdDescDesc",
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
      preview: "session-island-center" as const,
    },
    {
      value: "right" as const,
      labelKey: "settings_sessionIslandAlignment_right",
      descKey: "settings_sessionIslandAlignment_rightDesc",
      preview: "session-island-right" as const,
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
      <div class="space-y-2 pt-2">
        <div>
          <p class="text-sm font-medium">{t("settings_appearance_nativeWindowMaterial")}</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            {t("settings_appearance_nativeWindowMaterialDesc")}
          </p>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {#each WINDOW_MATERIALS as opt (opt.value)}
            {@const active = (settings?.native_window_glass_material ?? "sidebar") === opt.value}
            <SettingsOptionCard
              {active}
              title={t(opt.labelKey as MessageKey)}
              description={t(opt.descKey as MessageKey)}
              onclick={() => onSaveGeneralPatch({ native_window_glass_material: opt.value })}
            >
              {#snippet preview()}
                <SettingsWireframePreview variant={opt.preview} />
              {/snippet}
            </SettingsOptionCard>
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

    <div class="space-y-2">
      <div>
        <p class="text-sm font-medium">{t("settings_iconRailEnabled")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">{t("settings_iconRailEnabledDesc")}</p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each ICON_RAIL_OPTIONS as opt (opt.labelKey)}
          {@const active = (settings?.icon_rail_enabled !== false) === opt.value}
          <SettingsOptionCard
            {active}
            title={t(opt.labelKey as MessageKey)}
            description={t(opt.descKey as MessageKey)}
            onclick={() => onSaveGeneralPatch({ icon_rail_enabled: opt.value })}
          >
            {#snippet preview()}
              <SettingsWireframePreview variant={opt.preview} />
            {/snippet}
          </SettingsOptionCard>
        {/each}
      </div>
    </div>

    <div class="space-y-2 pt-2">
      <div>
        <p class="text-sm font-medium">{t("settings_workspaceFolderSort")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">{t("settings_workspaceFolderSortDesc")}</p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each WORKSPACE_FOLDER_SORT_OPTIONS as opt (opt.value)}
          {@const active = (settings?.workspace_folder_sort_order ?? "last_active") === opt.value}
          <SettingsOptionCard
            {active}
            title={t(opt.labelKey as MessageKey)}
            description={t(opt.descKey as MessageKey)}
            onclick={() => onSaveGeneralPatch({ workspace_folder_sort_order: opt.value })}
          />
        {/each}
      </div>
    </div>

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
          <SettingsOptionCard
            {active}
            title={t(opt.labelKey as MessageKey)}
            description={t(opt.descKey as MessageKey)}
            onclick={() => pickSessionIslandAlignment(opt.value)}
          >
            {#snippet preview()}
              <SettingsWireframePreview variant={opt.preview} />
            {/snippet}
          </SettingsOptionCard>
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
          <SettingsOptionCard
            {active}
            title={t(mode.labelKey as MessageKey)}
            description={t(mode.descKey as MessageKey)}
            onclick={() => pickVisualPerfMode(mode.value)}
          >
            {#snippet preview()}
              <SettingsWireframePreview variant={mode.preview} />
            {/snippet}
          </SettingsOptionCard>
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

  <!--
    P1 决策 #5: 旧 icon-rail 上的 "warm/neutral" 配色按钮作为主 UI 入口
    在 v1.0.9 调整时被移除，但 themeStore.setColorScheme 仍然在跑 (sidebar
    tokens 取决于 colorScheme)。这里把它收回 Settings → Appearance → Advanced
    作为 2nd-class toggle，会话内即时生效。
  -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_general_advanced")}
    </h2>
    <SettingsToggle
      checked={themeStore.colorScheme === "warm"}
      label={t("layout_schemeTitle_warm")}
      description={t("layout_schemeTitle_neutral")}
      onchange={(value) => themeStore.setColorScheme(value ? "warm" : "neutral")}
    />
  </Card>
</div>
