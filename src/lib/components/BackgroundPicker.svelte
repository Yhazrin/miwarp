<script lang="ts">
  import { backgroundStore } from "../stores/background-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { SizingMode, BackgroundConfig } from "../types/background";

  interface Props {
    /** Session ID for per-session override, or empty for global */
    sessionId?: string;
    /** Callback when settings change */
    onChange?: () => void;
  }

  let { sessionId = "", onChange }: Props = $props();

  let config = $derived(
    sessionId ? backgroundStore.getForSession(sessionId) : backgroundStore.global,
  );

  let previewStyle = $derived(backgroundStore.getStyle(sessionId || undefined));
  let overlayStyle = $derived(backgroundStore.getOverlayStyle(sessionId || undefined));

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

  function handleImagePick() {
    // Trigger native file dialog via Tauri if available
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // Revoke previous blob URL to avoid memory leak
        const prev = config?.imageUrl;
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        const url = URL.createObjectURL(file);
        update({ imageUrl: url });
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
    {#if config.imageUrl}
      <div class="absolute inset-0 z-0" style={previewStyle}></div>
      {#if config.colorOverlay}
        <div class="absolute inset-0 z-[1]" style={overlayStyle}></div>
      {/if}
    {/if}
    <div class="absolute inset-0 z-[2] flex items-center justify-center">
      <span class="text-xs text-miwarp-text-secondary">
        {config.imageUrl ? "Preview" : "No background set"}
      </span>
    </div>
  </div>

  <!-- Image URL -->
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-url">
      Image URL or Path
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
        class="rounded-md border border-border bg-miwarp-bg-surface px-3 py-1.5
               text-xs text-miwarp-text-secondary transition-colors hover:bg-miwarp-bg-hover"
        onclick={handleImagePick}
      >
        Browse
      </button>
    </div>
  </div>

  <!-- Opacity -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-opacity">
        Opacity
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
          Position X
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
          Position Y
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
      Sizing Mode
    </label>
    <select
      id="bg-sizing"
      class="w-full rounded-md border border-border bg-miwarp-bg-elevated px-3 py-1.5
             text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      value={config.sizingMode}
      onchange={(e) => update({ sizingMode: (e.target as HTMLSelectElement).value as SizingMode })}
    >
      {#each sizingModes as mode}
        <option value={mode.value}>{mode.label}</option>
      {/each}
    </select>
  </div>

  <!-- Color Overlay -->
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-miwarp-text-secondary" for="bg-overlay">
      Color Overlay
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
  </div>

  <!-- Scope info + Reset -->
  <div class="flex items-center justify-between border-t border-border pt-3">
    <span class="text-xs text-miwarp-text-tertiary">
      {sessionId ? "Session override" : "Global default"}
    </span>
    <button
      class="rounded-md px-3 py-1 text-xs text-miwarp-status-error
             transition-colors hover:bg-miwarp-status-error/10"
      onclick={handleReset}
    >
      {sessionId ? "Remove Override" : "Reset to Default"}
    </button>
  </div>
</div>
