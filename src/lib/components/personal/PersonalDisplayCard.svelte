<script lang="ts">
  /**
   * Display & Locale — language switcher + UI zoom. Local-only preferences
   * that the user is most likely to want to flip while looking at their own
   * profile page. Zoom is purely visual; it does not write to UserSettings
   * from this card — the parent applies a CSS transform via the `onZoom`
   * callback so the slider feels instant, matching the settings page.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { LOCALE_REGISTRY, getEntry, currentLocale, switchLocale } from "$lib/i18n/index.svelte";
  import type { UserSettings } from "$lib/types";
  import type { DisplaySettings } from "./settings-slice";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    displaySettings,
    onCommit,
    onZoom,
  }: {
    displaySettings: DisplaySettings;
    onCommit: (patch: Partial<UserSettings>) => Promise<void>;
    onZoom?: (factor: number) => void;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function pickLocale(code: string) {
    switchLocale(code);
    void onCommit({ ui_locale: code } as Partial<UserSettings>);
  }

  let zoomDraft = $state<number | null>(null);
  const zoomValue = $derived(zoomDraft ?? displaySettings.ui_zoom ?? 1);

  function commitZoom(v: number) {
    zoomDraft = null;
    onZoom?.(v);
    void onCommit({ ui_zoom: v });
  }
</script>

<PersonalSection
  icon="monitor"
  eyebrow={lk("personal_section_display_eyebrow")}
  title={lk("personal_section_display_title")}
  description={lk("personal_section_display_desc")}
>
  <div class="space-y-4">
    <div class="space-y-2">
      <div>
        <p class="text-sm font-medium text-foreground">
          {lk("personal_display_language")}
        </p>
        <p class="text-xs text-muted-foreground">
          {lk("personal_display_languageDesc")}
        </p>
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

    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-foreground">
          {lk("personal_display_zoom")}
        </p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {lk("personal_display_zoomDesc")}
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
            zoomDraft = parseFloat((e.target as HTMLInputElement).value);
          }}
          onchange={(e) => {
            commitZoom(parseFloat((e.target as HTMLInputElement).value));
          }}
          class="w-40 accent-primary"
          aria-label={lk("personal_display_zoom")}
        />
        <span class="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {Math.round(zoomValue * 100)}%
        </span>
      </div>
    </div>
  </div>
</PersonalSection>
