<script lang="ts">
  /**
   * Data card — export the full profile as JSON and reset to defaults.
   * Both actions confirm with the user before running. Export uses the
   * in-memory settings payload (no secrets — UserSettings is already
   * pre-scrubbed by the Tauri command on read).
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import PersonalSection from "./PersonalSection.svelte";
  import { dbgWarn } from "$lib/utils/debug";

  let {
    settings,
    onReset,
  }: {
    settings: UserSettings;
    onReset: () => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  let confirmReset = $state(false);

  function exportJson() {
    try {
      const payload = JSON.stringify(settings, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `miwarp-personal-profile-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      dbgWarn("personal", "export profile failed", e);
    }
  }

  async function confirmAndReset() {
    if (!confirmReset) {
      confirmReset = true;
      return;
    }
    confirmReset = false;
    await onReset();
  }
</script>

<PersonalSection
  icon="package"
  eyebrow={lk("personal_section_data_eyebrow")}
  title={lk("personal_section_data_title")}
  description={lk("personal_section_data_desc")}
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-foreground">
        {lk("personal_data_export")}
      </p>
      <p class="text-xs text-muted-foreground mt-0.5">
        {lk("personal_data_exportDesc")}
      </p>
    </div>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
      onclick={exportJson}
    >
      <Icon name="download" size="xs" />
      {lk("personal_data_exportButton")}
    </button>
  </div>

  <div
    class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-foreground">
        {lk("personal_data_reset")}
      </p>
      <p class="text-xs text-muted-foreground mt-0.5">
        {confirmReset ? lk("personal_data_resetConfirm") : lk("personal_data_resetDesc")}
      </p>
    </div>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors
        {confirmReset
        ? 'border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30'
        : 'border-border bg-background hover:bg-accent'}"
      onclick={confirmAndReset}
    >
      <Icon name="refresh-ccw" size="xs" />
      {confirmReset ? lk("personal_data_resetAgain") : lk("personal_data_resetButton")}
    </button>
  </div>
</PersonalSection>
