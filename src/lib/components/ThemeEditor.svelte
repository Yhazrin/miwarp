<script lang="ts">
  import { themeStore, type ThemeId } from "../stores/theme-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { slide } from "svelte/transition";

  interface Props {
    /** Callback when theme changes */
    onChange?: () => void;
  }

  let { onChange }: Props = $props();

  let showImportExport = $state(false);
  let importJson = $state("");
  let exportJson = $derived(themeStore.exportConfig());

  // Read computed CSS vars directly — theme is already applied before this component mounts
  function getColor(varName: string): string {
    return getComputedHsl(varName);
  }

  const colorGroups = [
    {
      label: t("themeEditor_backgrounds"),
      vars: [
        { key: "--miwarp-bg-deepest", label: t("themeEditor_deepest") },
        { key: "--miwarp-bg-deep", label: t("themeEditor_deep") },
        { key: "--miwarp-bg-base", label: t("themeEditor_base") },
        { key: "--miwarp-bg-elevated", label: t("themeEditor_elevated") },
        { key: "--miwarp-bg-surface", label: t("themeEditor_surface") },
        { key: "--miwarp-bg-hover", label: t("themeEditor_hover") },
      ],
    },
    {
      label: t("themeEditor_accentColors"),
      vars: [
        { key: "--miwarp-accent-primary", label: t("themeEditor_primary") },
        { key: "--miwarp-accent-violet", label: t("themeEditor_violet") },
        { key: "--miwarp-accent-blue", label: t("themeEditor_blue") },
      ],
    },
    {
      label: t("themeEditor_text"),
      vars: [
        { key: "--miwarp-text-primary", label: t("themeEditor_primary") },
        { key: "--miwarp-text-secondary", label: t("themeEditor_secondary") },
        { key: "--miwarp-text-tertiary", label: t("themeEditor_tertiary") },
      ],
    },
    {
      label: t("themeEditor_status"),
      vars: [
        { key: "--miwarp-status-running", label: t("themeEditor_running") },
        { key: "--miwarp-status-done", label: t("themeEditor_completed") },
        { key: "--miwarp-status-failed", label: t("themeEditor_failed") },
        { key: "--miwarp-status-pending", label: t("themeEditor_pending") },
        { key: "--miwarp-status-paused", label: t("themeEditor_paused") },
        { key: "--miwarp-status-blocked", label: t("themeEditor_blocked") },
        { key: "--miwarp-status-idle", label: t("themeEditor_idle") },
      ],
    },
  ];

  function getComputedHsl(varName: string): string {
    if (typeof document === "undefined") return "0 0% 50%";
    return (
      getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "0 0% 50%"
    );
  }

  function hslToHex(hsl: string): string {
    const parts = hsl.match(/(\d+)\s+(\d+)%\s+(\d+)%/);
    if (!parts) return "#888888";
    const h = parseInt(parts[1]) / 360;
    const s = parseInt(parts[2]) / 100;
    const l = parseInt(parts[3]) / 100;

    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function hexToHsl(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return "0 0% 50%";

    let r = parseInt(result[1], 16) / 255;
    let g = parseInt(result[2], 16) / 255;
    let b = parseInt(result[3], 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  }

  function setVariable(varName: string, hex: string) {
    const hsl = hexToHsl(hex);
    themeStore.setThemeOverride(themeStore.currentTheme, varName, hsl);
  }

  function handleThemeSelect(themeId: ThemeId) {
    themeStore.setTheme(themeId);
    onChange?.();
  }

  function handleExport() {
    navigator.clipboard.writeText(exportJson);
  }

  function handleImport() {
    themeStore.importConfig(importJson);
    showImportExport = false;
    onChange?.();
  }

  function isVariableOverridden(varName: string): boolean {
    const overrides = themeStore.getThemeOverrides(themeStore.currentTheme);
    return varName in overrides;
  }

  function handleResetVariable(varName: string) {
    const overrides = themeStore.getThemeOverrides(themeStore.currentTheme);
    delete overrides[varName];
    // Trigger by re-applying the theme
    themeStore.setTheme(themeStore.currentTheme);
  }

  let showSaveDialog = $state(false);
  let customThemeName = $state("");

  function handleResetCurrentTheme() {
    if (confirm(t("theme_resetConfirm"))) {
      themeStore.resetThemeOverrides(themeStore.currentTheme);
    }
  }

  function handleSaveAsCustomTheme() {
    showSaveDialog = true;
  }

  function handleCreateCustomTheme() {
    if (!customThemeName.trim()) return;
    themeStore.createCustomThemeFromOverrides(themeStore.currentTheme, customThemeName.trim());
    showSaveDialog = false;
    customThemeName = "";
  }
</script>

<div class="theme-editor space-y-4 p-4">
  <!-- Theme selector -->
  <div class="space-y-2">
    <h3 class="text-sm font-semibold text-miwarp-text-primary">{t("theme_title")}</h3>
    <div class="grid grid-cols-3 gap-2">
      {#each themeStore.themes as theme}
        {@const hasOverrides = themeStore.hasThemeOverrides(theme.id)}
        <button
          class="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all"
          class:border-primary={themeStore.currentTheme === theme.id}
          class:border-border={themeStore.currentTheme !== theme.id}
          class:bg-miwarp-bg-elevated={themeStore.currentTheme === theme.id}
          class:bg-miwarp-bg-base={themeStore.currentTheme !== theme.id}
          onclick={() => handleThemeSelect(theme.id)}
        >
          <span
            class="h-4 w-4 rounded-full border border-border"
            style="background: {theme.accent};"
          ></span>
          <span class="text-miwarp-text-primary">{theme.name}</span>
          {#if hasOverrides}
            <span
              class="h-1.5 w-1.5 rounded-full bg-miwarp-accent-primary shrink-0"
              title={t("theme_hasOverrides")}
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Color editors -->
  {#each colorGroups as group}
    <div class="space-y-2">
      <h4 class="text-xs font-medium text-miwarp-text-secondary">{group.label}</h4>
      <div class="grid grid-cols-2 gap-2">
        {#each group.vars as colorVar}
          {@const currentValue = getColor(colorVar.key)}
          {@const isOverridden = isVariableOverridden(colorVar.key)}
          <div
            class="flex items-center gap-2 rounded-md border border-border bg-miwarp-bg-elevated px-2 py-1.5"
          >
            <input
              type="color"
              class="h-5 w-5 cursor-pointer rounded border border-border bg-transparent"
              value={hslToHex(currentValue)}
              oninput={(e) => setVariable(colorVar.key, (e.target as HTMLInputElement).value)}
            />
            <span class="text-xs text-miwarp-text-tertiary">{colorVar.label}</span>
            {#if isOverridden}
              <button
                class="ml-auto text-miwarp-text-tertiary hover:text-miwarp-text-primary shrink-0"
                onclick={() => handleResetVariable(colorVar.key)}
                title={t("theme_resetVariable")}
                aria-label={t("theme_resetVariable")}
              >
                ↺
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <!-- Theme action buttons -->
  {#if themeStore.hasThemeOverrides(themeStore.currentTheme)}
    <div class="flex gap-2">
      <button
        class="rounded-md border border-border bg-miwarp-bg-surface px-3 py-1.5 text-xs text-miwarp-text-secondary hover:bg-miwarp-bg-hover"
        onclick={handleResetCurrentTheme}
      >
        {t("theme_resetToDefaults")}
      </button>
      <button
        class="rounded-md accent-gradient px-3 py-1.5 text-xs text-[hsl(var(--primary-foreground))]"
        onclick={handleSaveAsCustomTheme}
      >
        {t("theme_saveAsCustom")}
      </button>
    </div>

    <!-- Save as Custom Theme Dialog -->
    {#if showSaveDialog}
      <div class="space-y-2 border-t border-border pt-3" transition:slide={{ duration: 200 }}>
        <input
          type="text"
          class="w-full rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("theme_customThemeNamePlaceholder")}
          bind:value={customThemeName}
        />
        <div class="flex gap-2">
          <button
            class="rounded-md border border-border bg-miwarp-bg-surface px-3 py-1.5 text-xs text-miwarp-text-secondary hover:bg-miwarp-bg-hover"
            onclick={() => {
              showSaveDialog = false;
              customThemeName = "";
            }}
          >
            {t("theme_cancel")}
          </button>
          <button
            class="rounded-md accent-gradient px-3 py-1.5 text-xs text-[hsl(var(--primary-foreground))] disabled:opacity-40"
            onclick={handleCreateCustomTheme}
            disabled={!customThemeName.trim()}
          >
            {t("theme_create")}
          </button>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Import/Export -->
  <div class="border-t border-border pt-3 space-y-2">
    <button
      class="text-xs text-miwarp-accent-primary hover:underline"
      onclick={() => (showImportExport = !showImportExport)}
    >
      {showImportExport ? t("theme_hide") : t("theme_importExport")}
    </button>

    {#if showImportExport}
      <div class="space-y-2" transition:slide={{ duration: 200 }}>
        <div class="flex gap-2">
          <button
            class="rounded-md border border-border bg-miwarp-bg-surface px-3 py-1.5
                   text-xs text-miwarp-text-secondary hover:bg-miwarp-bg-hover"
            onclick={handleExport}
          >
            {t("theme_copyExport")}
          </button>
        </div>
        <textarea
          class="h-24 w-full rounded-md border border-border bg-miwarp-bg-elevated
                 p-2 font-mono text-xs text-foreground
                 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("theme_importPlaceholder")}
          bind:value={importJson}
        ></textarea>
        <button
          class="rounded-md accent-gradient px-3 py-1.5 text-xs text-[hsl(var(--primary-foreground))]"
          onclick={handleImport}
        >
          {t("theme_importTheme")}
        </button>
      </div>
    {/if}
  </div>
</div>
