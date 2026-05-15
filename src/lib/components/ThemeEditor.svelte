<script lang="ts">
  import { themeStore, type ThemeId } from "../stores/theme-store.svelte";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    /** Callback when theme changes */
    onChange?: () => void;
  }

  let { onChange }: Props = $props();

  let showImportExport = $state(false);
  let importJson = $state("");
  let exportJson = $derived(themeStore.exportConfig());

  const colorGroups = [
    {
      label: "Backgrounds",
      vars: [
        { key: "--miwarp-bg-deepest", label: "Deepest" },
        { key: "--miwarp-bg-deep", label: "Deep" },
        { key: "--miwarp-bg-base", label: "Base" },
        { key: "--miwarp-bg-elevated", label: "Elevated" },
        { key: "--miwarp-bg-surface", label: "Surface" },
        { key: "--miwarp-bg-hover", label: "Hover" },
      ],
    },
    {
      label: "Accent Colors",
      vars: [
        { key: "--miwarp-accent-primary", label: "Primary" },
        { key: "--miwarp-accent-violet", label: "Violet" },
        { key: "--miwarp-accent-blue", label: "Blue" },
      ],
    },
    {
      label: "Text",
      vars: [
        { key: "--miwarp-text-primary", label: "Primary" },
        { key: "--miwarp-text-secondary", label: "Secondary" },
        { key: "--miwarp-text-tertiary", label: "Tertiary" },
      ],
    },
    {
      label: "Status",
      vars: [
        { key: "--miwarp-status-success", label: "Success" },
        { key: "--miwarp-status-warning", label: "Warning" },
        { key: "--miwarp-status-error", label: "Error" },
        { key: "--miwarp-status-info", label: "Info" },
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
    document.documentElement.style.setProperty(varName, hsl);
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
</script>

<div class="theme-editor space-y-4 p-4">
  <!-- Theme selector -->
  <div class="space-y-2">
    <h3 class="text-sm font-semibold text-miwarp-text-primary">{t("theme_title")}</h3>
    <div class="grid grid-cols-3 gap-2">
      {#each themeStore.themes as theme}
        <button
          class="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all"
          class:border-primary={themeStore.currentTheme === theme.id}
          class:border-border={themeStore.currentTheme !== theme.id}
          class:bg-miwarp-bg-elevated={themeStore.currentTheme === theme.id}
          class:bg-miwarp-bg-base={themeStore.currentTheme !== theme.id}
          onclick={() => handleThemeSelect(theme.id)}
        >
          <span
            class="h-4 w-4 rounded-full border border-white/20"
            style="background: {theme.accent};"
          ></span>
          <span class="text-miwarp-text-primary">{theme.name}</span>
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
          {@const currentValue = getComputedHsl(colorVar.key)}
          <div
            class="flex items-center gap-2 rounded-md border border-border bg-miwarp-bg-elevated px-2 py-1.5"
          >
            <input
              type="color"
              class="h-5 w-5 cursor-pointer rounded border border-white/10 bg-transparent"
              value={hslToHex(currentValue)}
              oninput={(e) => setVariable(colorVar.key, (e.target as HTMLInputElement).value)}
            />
            <span class="text-xs text-miwarp-text-tertiary">{colorVar.label}</span>
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <!-- Import/Export -->
  <div class="border-t border-border pt-3 space-y-2">
    <button
      class="text-xs text-miwarp-accent-primary hover:underline"
      onclick={() => (showImportExport = !showImportExport)}
    >
      {showImportExport ? t("theme_hide") : t("theme_importExport")}
    </button>

    {#if showImportExport}
      <div class="space-y-2">
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
          class="rounded-md accent-gradient px-3 py-1.5 text-xs text-white"
          onclick={handleImport}
        >
          Import Theme
        </button>
      </div>
    {/if}
  </div>
</div>
