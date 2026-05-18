<script lang="ts">
  import { backgroundStore } from "../stores/background-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { SizingMode, WallpaperMode, BackgroundConfig } from "../types/background";

  interface Props {
    /** Session ID for per-session override, or empty for global */
    sessionId?: string;
    /** Callback when settings change */
    onChange?: () => void;
  }

  let { sessionId = "", onChange }: Props = $props();

  let config = $derived.by(() =>
    sessionId ? backgroundStore.getForSession(sessionId) : backgroundStore.global,
  );

  let sid = $derived(sessionId || undefined);

  let imagePreviewStyle = $derived(backgroundStore.getImagePreviewInnerStyle(sid));
  let solidPreviewStyle = $derived(backgroundStore.getSolidPreviewStyle(sid));
  let overlayStyle = $derived(backgroundStore.getOverlayStyle(sid));

  const sizingModes: { value: SizingMode; label: string }[] = [
    { value: "cover", label: t("background_cover") },
    { value: "fill", label: t("background_fill") },
    { value: "fit", label: t("background_fit") },
    { value: "stretch", label: t("background_stretch") },
    { value: "tile", label: t("background_tile") },
  ];

  function update(partial: Partial<BackgroundConfig>) {
    if (sessionId) {
      backgroundStore.setSession(sessionId, partial);
    } else {
      backgroundStore.setGlobal(partial);
    }
    onChange?.();
  }

  function setMode(mode: WallpaperMode) {
    update({ mode });
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function handleImagePick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          update({ mode: "image", imageUrl: dataUrl });
        } catch (err) {
          console.warn("Background image read failed", err);
        }
      }
    };
    input.click();
  }

  function handleReset() {
    if (sessionId) {
      backgroundStore.clearSession(sessionId);
    } else {
      backgroundStore.resetGlobal();
    }
    onChange?.();
  }
</script>

<div class="background-picker space-y-4 p-4">
  <!-- Preview -->
  <div
    class="relative h-32 w-full overflow-hidden rounded-lg border border-border"
    style="background: hsl(var(--miwarp-bg-deepest));"
  >
    {#if config.mode === "image" && config.imageUrl}
      <div class="absolute inset-0 z-0 overflow-hidden">
        <div class="absolute inset-0" style={imagePreviewStyle}></div>
      </div>
    {:else if config.mode === "solid"}
      <div class="absolute inset-0 z-0" style={solidPreviewStyle}></div>
    {/if}
    {#if config.colorOverlay}
      <div class="absolute inset-0 z-[1]" style={overlayStyle}></div>
    {/if}
    <div class="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
      <span class="text-xs text-miwarp-text-secondary">
        {#if config.mode === "none"}
          {t("background_previewOff")}
        {:else if config.mode === "solid"}
          {t("background_previewSolid")}
        {:else if config.imageUrl}
          {t("background_previewImage")}
        {:else}
          {t("background_previewNoImage")}
        {/if}
      </span>
    </div>
  </div>

  <!-- Mode -->
  <div class="space-y-1.5">
    <span class="text-xs font-medium text-miwarp-text-secondary">{t("background_mode")}</span>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs transition-colors {config.mode === 'none'
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-miwarp-bg-surface text-miwarp-text-secondary hover:bg-miwarp-bg-hover'}"
        onclick={() => setMode("none")}
      >
        {t("background_modeOff")}
      </button>
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs transition-colors {config.mode === 'solid'
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-miwarp-bg-surface text-miwarp-text-secondary hover:bg-miwarp-bg-hover'}"
        onclick={() => setMode("solid")}
      >
        {t("background_modeSolid")}
      </button>
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs transition-colors {config.mode === 'image'
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-miwarp-bg-surface text-miwarp-text-secondary hover:bg-miwarp-bg-hover'}"
        onclick={() => setMode("image")}
      >
        {t("background_modeImage")}
      </button>
    </div>
  </div>

  {#if config.mode === "solid"}
    <div class="space-y-1.5">
      <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-solid"
        >{t("background_solidColor")}</label
      >
      <div class="flex gap-2">
        <input
          id="bg-solid"
          type="color"
          class="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
          value={config.solidColor || "#0f172a"}
          oninput={(e) => update({ solidColor: (e.target as HTMLInputElement).value })}
        />
        <input
          type="text"
          class="flex-1 rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5
                 text-sm text-foreground placeholder:text-muted-foreground
                 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          value={config.solidColor}
          oninput={(e) => update({ solidColor: (e.target as HTMLInputElement).value })}
        />
      </div>
    </div>
  {/if}

  {#if config.mode === "image"}
    <!-- Image URL -->
    <div class="space-y-1.5">
      <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-url">
        {t("background_imageUrl")}
      </label>
      <div class="flex gap-2">
        <input
          id="bg-url"
          type="text"
          class="flex-1 rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5
                 text-sm text-foreground placeholder:text-muted-foreground
                 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("background_urlPlaceholder")}
          value={config.imageUrl}
          oninput={(e) => update({ imageUrl: (e.target as HTMLInputElement).value })}
        />
        <button
          type="button"
          class="shrink-0 rounded-md border border-border bg-miwarp-bg-surface px-3 py-1.5
                 text-xs text-miwarp-text-secondary transition-colors hover:bg-miwarp-bg-hover"
          onclick={handleImagePick}
        >
          {t("background_browse")}
        </button>
      </div>
    </div>
  {/if}

  {#if config.mode === "solid" || config.mode === "image"}
    <!-- Opacity -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-opacity">
          {t("background_opacity")}
        </label>
        <span class="text-xs text-miwarp-text-tertiary">{config.opacity}%</span>
      </div>
      <input
        id="bg-opacity"
        type="range"
        min="0"
        max="100"
        class="w-full accent-primary"
        value={config.opacity}
        oninput={(e) => update({ opacity: Number((e.target as HTMLInputElement).value) })}
      />
    </div>
  {/if}

  {#if config.mode === "image"}
    <!-- Blur -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-blur">
          {t("background_blur")}
        </label>
        <span class="text-xs text-miwarp-text-tertiary">{config.blur}px</span>
      </div>
      <input
        id="bg-blur"
        type="range"
        min="0"
        max="50"
        class="w-full accent-primary"
        value={config.blur}
        oninput={(e) => update({ blur: Number((e.target as HTMLInputElement).value) })}
      />
    </div>

    <!-- Position X / Y -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-pos-x">
            {t("background_positionX")}
          </label>
          <span class="text-xs text-miwarp-text-tertiary">{config.positionX}%</span>
        </div>
        <input
          id="bg-pos-x"
          type="range"
          min="0"
          max="100"
          class="w-full accent-primary"
          value={config.positionX}
          oninput={(e) => update({ positionX: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-pos-y">
            {t("background_positionY")}
          </label>
          <span class="text-xs text-miwarp-text-tertiary">{config.positionY}%</span>
        </div>
        <input
          id="bg-pos-y"
          type="range"
          min="0"
          max="100"
          class="w-full accent-primary"
          value={config.positionY}
          oninput={(e) => update({ positionY: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
    </div>

    <!-- Sizing Mode -->
    <div class="space-y-1.5">
      <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-sizing">
        {t("background_sizingMode")}
      </label>
      <select
        id="bg-sizing"
        class="w-full rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5
               text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        value={config.sizingMode}
        onchange={(e) =>
          update({ sizingMode: (e.target as HTMLSelectElement).value as SizingMode })}
      >
        {#each sizingModes as mode}
          <option value={mode.value}>{mode.label}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if config.mode !== "none"}
    <!-- Window chrome (frosted shell over wallpaper / transparent window) -->
    <div class="space-y-3 rounded-lg border border-border/60 bg-miwarp-bg-surface/50 p-3">
      <p class="text-[11px] leading-snug text-miwarp-text-tertiary">
        {t("background_chromeHint")}
      </p>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-chrome-op">
            {t("background_chromeOpacity")}
          </label>
          <span class="text-xs text-miwarp-text-tertiary">{config.chromeOpacity}%</span>
        </div>
        <input
          id="bg-chrome-op"
          type="range"
          min="0"
          max="100"
          class="w-full accent-primary"
          value={config.chromeOpacity}
          oninput={(e) => update({ chromeOpacity: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-chrome-blur">
            {t("background_chromeBlur")}
          </label>
          <span class="text-xs text-miwarp-text-tertiary">{config.chromeBlur}px</span>
        </div>
        <input
          id="bg-chrome-blur"
          type="range"
          min="0"
          max="48"
          class="w-full accent-primary"
          value={config.chromeBlur}
          oninput={(e) => update({ chromeBlur: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
    </div>
  {/if}

  <!-- Color Overlay -->
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-overlay">
      {t("background_colorOverlay")}
    </label>
    <div class="flex gap-2">
      <input
        id="bg-overlay"
        type="color"
        class="h-8 w-8 cursor-pointer rounded border border-border bg-transparent"
        value={config.colorOverlay || "#000000"}
        oninput={(e) => update({ colorOverlay: (e.target as HTMLInputElement).value })}
      />
      <input
        type="text"
        class="flex-1 rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5
               text-sm text-foreground placeholder:text-muted-foreground
               focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="#000000"
        value={config.colorOverlay}
        oninput={(e) => update({ colorOverlay: (e.target as HTMLInputElement).value })}
      />
    </div>
    {#if config.colorOverlay}
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <label class="text-xs text-miwarp-text-secondary" for="bg-overlay-op"
            >{t("background_overlayStrength")}</label
          >
          <span class="text-xs text-miwarp-text-tertiary">{config.overlayOpacity}%</span>
        </div>
        <input
          id="bg-overlay-op"
          type="range"
          min="0"
          max="100"
          class="w-full accent-primary"
          value={config.overlayOpacity}
          oninput={(e) => update({ overlayOpacity: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
    {/if}
  </div>

  <!-- Scope info + Reset -->
  <div class="flex items-center justify-between border-t border-border pt-3">
    <span class="text-xs text-miwarp-text-tertiary">
      {sessionId ? t("background_scopeSession") : t("background_scopeGlobal")}
    </span>
    <button
      type="button"
      class="rounded-md px-3 py-1 text-xs text-miwarp-status-error
             transition-colors hover:bg-miwarp-status-error/10"
      onclick={handleReset}
    >
      {sessionId ? t("background_removeOverride") : t("background_resetDefault")}
    </button>
  </div>
</div>
