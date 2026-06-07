<script lang="ts">
  /**
   * v1.0.6 follow-up: extracted from settings +page.svelte's
   * `activeTab === "general"` branch. Renders language + UI zoom +
   * theme editor (the latter delegates to ThemeCard).
   *
   * State is lifted to the orchestrator (+page.svelte).
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { LOCALE_REGISTRY, getEntry, currentLocale, switchLocale } from "$lib/i18n/index.svelte";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import SettingsDoctorPanel from "../SettingsDoctorPanel.svelte";
  import ThemeCard from "./ThemeCard.svelte";

  let {
    settings,
    onSaveGeneralPatch = async (_patch: Record<string, unknown>) => {},
    onZoom = (_factor: number) => {},
  }: {
    settings: UserSettings | null;
    onSaveGeneralPatch?: (patch: Record<string, unknown>) => Promise<void>;
    onZoom?: (factor: number) => void;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function pickLocale(code: string) {
    switchLocale(code);
    void onSaveGeneralPatch({ ui_locale: code });
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
          value={settings?.ui_zoom ?? 1}
          oninput={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            onZoom(v);
          }}
          onchange={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            void onSaveGeneralPatch({ ui_zoom: v });
          }}
          class="w-40 accent-primary"
        />
        <span class="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {Math.round((settings?.ui_zoom ?? 1) * 100)}%
        </span>
      </div>
    </div>
  </Card>

  <!-- Doctor Panel (status at a glance) -->
  <SettingsDoctorPanel {settings} />

  <!-- Theme editor + background picker (moved from old "theme" tab) -->
  <ThemeCard />
</div>
