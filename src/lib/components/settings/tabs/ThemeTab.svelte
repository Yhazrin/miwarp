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
  import { themeStore, type ThemeId } from "$lib/stores/theme-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import Card from "$lib/components/Card.svelte";

  type Mode = "light" | "dark" | "system";

  const MODE_OPTIONS: { id: Mode; labelKey: string }[] = [
    { id: "light", labelKey: "settings_cliConfig_optLight" },
    { id: "dark", labelKey: "settings_cliConfig_optDark" },
    { id: "system", labelKey: "settings_theme_system" },
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
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {#each themeStore.themes as theme (theme.id)}
          {@const active = themeStore.currentTheme === theme.id}
          <button
            type="button"
            class="group flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all
              {active
              ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
              : 'border-border/40 hover:border-border/70 hover:bg-muted/40'}"
            onclick={() => themeStore.setTheme(theme.id as ThemeId)}
            aria-pressed={active}
          >
            <span
              class="h-5 w-5 shrink-0 rounded-full border border-border/40 shadow-inner"
              style:background-color={theme.accent}
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {theme.name}
            </span>
            {#if active}
              <svg
                class="h-3.5 w-3.5 shrink-0 text-primary"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                  clip-rule="evenodd"
                />
              </svg>
            {/if}
          </button>
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
      <div class="grid grid-cols-3 gap-2">
        {#each MODE_OPTIONS as opt (opt.id)}
          {@const active = themeStore.mode === opt.id}
          <button
            type="button"
            class="flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 transition-all
              {active
              ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
              : 'border-border/40 hover:border-border/70 hover:bg-muted/40'}"
            onclick={() => themeStore.setMode(opt.id)}
            aria-pressed={active}
          >
            <svg
              class="h-4 w-4 {active ? 'text-primary' : 'text-muted-foreground'}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              {#if opt.id === "light"}
                <circle cx="12" cy="12" r="4" />
                <path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                />
              {:else if opt.id === "dark"}
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              {:else}
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              {/if}
            </svg>
            <span
              class="text-xs font-medium {active ? 'text-foreground' : 'text-muted-foreground'}"
            >
              {t(opt.labelKey as Parameters<typeof t>[0])}
            </span>
          </button>
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
