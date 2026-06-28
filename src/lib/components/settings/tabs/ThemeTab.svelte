<script lang="ts">
  /**
   * Theme settings — pick a theme + light/dark/system mode.
   *
   *   Each theme is one design; light and dark are the two renderings of the
   *   same theme. The mode toggle decides which CSS variant is applied, and
   *   "system" follows the OS preference at runtime.
   *
   *   The ThemeTab only orchestrates UI: theme + mode changes go through
   *   `themeStore.setTheme()` / `themeStore.setMode()`. The store owns the
   *   OS-listener effect so system mode keeps working when this tab is
   *   not mounted.
   */
  import { themeName, themeStore, type ThemeId } from "$lib/stores/theme-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import Card from "$lib/components/Card.svelte";
  import SettingsOptionCard from "$lib/components/settings/SettingsOptionCard.svelte";
  import SettingsWireframePreview from "$lib/components/settings/SettingsWireframePreview.svelte";

  type Mode = "light" | "dark" | "system";

  const MODE_OPTIONS: {
    id: Mode;
    labelKey: string;
    descKey: string;
    preview: "theme-mode-light" | "theme-mode-dark" | "theme-mode-system";
  }[] = [
    {
      id: "light",
      labelKey: "settings_cliConfig_optLight",
      descKey: "settings_theme_modeLightDesc",
      preview: "theme-mode-light",
    },
    {
      id: "dark",
      labelKey: "settings_cliConfig_optDark",
      descKey: "settings_theme_modeDarkDesc",
      preview: "theme-mode-dark",
    },
    {
      id: "system",
      labelKey: "settings_theme_system",
      descKey: "settings_theme_modeSystemDesc",
      preview: "theme-mode-system",
    },
  ];
</script>

<!-- ═══ Core: theme picker + mode toggle. Tight max-width so the picker
     feels centered and intentional instead of stretching across a wide
     settings pane. ═══ -->
<div class="mx-auto max-w-2xl space-y-6">
  <!-- ═══ Section 1: 主题色 (12 themes — each is one design with light + dark) ═══ -->
  <section>
    <h3 class="mb-2 text-sm font-semibold text-foreground">
      {t("settings_theme_color")}
    </h3>
    <p class="mb-3 text-xs text-muted-foreground/80">
      {t("settings_theme_colorDesc")}
    </p>
    <Card>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each themeStore.themes as theme (theme.id)}
          {@const active = themeStore.currentTheme === theme.id}
          <SettingsOptionCard
            {active}
            title={themeName(theme)}
            onclick={() => themeStore.setTheme(theme.id as ThemeId)}
          >
            {#snippet preview()}
              <SettingsWireframePreview variant="theme-accent" accentColor={theme.accent} />
            {/snippet}
          </SettingsOptionCard>
        {/each}
      </div>
    </Card>
  </section>

  <!-- ═══ Section 2: 亮 / 暗 / 系统 ═══ -->
  <section>
    <h3 class="mb-2 text-sm font-semibold text-foreground">
      {t("settings_theme_mode")}
    </h3>
    <p class="mb-3 text-xs text-muted-foreground/80">
      {t("settings_theme_modeDesc")}
    </p>
    <Card>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {#each MODE_OPTIONS as opt (opt.id)}
          {@const active = themeStore.mode === opt.id}
          <SettingsOptionCard
            {active}
            title={t(opt.labelKey as Parameters<typeof t>[0])}
            description={t(opt.descKey as Parameters<typeof t>[0])}
            onclick={() => themeStore.setMode(opt.id)}
          >
            {#snippet preview()}
              <SettingsWireframePreview variant={opt.preview} />
            {/snippet}
          </SettingsOptionCard>
        {/each}
      </div>
    </Card>
  </section>
</div>

<!-- ═══ Advanced (collapsed by default) — sits outside the centered
     core so the per-token editor can use the full pane width. ═══ -->
<details class="mt-6 group">
  <summary
    class="flex cursor-pointer items-center justify-between rounded-lg border border-border/40 bg-card/40 px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden"
  >
    <span class="flex items-center gap-2">
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {t("settings_theme_advanced")}
    </span>
    <svg
      class="h-3.5 w-3.5 transition-transform group-open:rotate-90"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  </summary>
  <div class="mt-3 space-y-3">
    <ThemeEditor />
    <BackgroundPicker />
  </div>
</details>
