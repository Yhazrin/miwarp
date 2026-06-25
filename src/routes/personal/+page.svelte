<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { getUserSettings, updateUserSettings } from "$lib/api";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import type { UserSettings } from "$lib/types";

  let loading = $state(true);
  let saving = $state(false);

  let displayName = $state("");
  let role = $state("");
  let timezone = $state("");

  let original = $state<{ displayName: string; role: string; timezone: string } | null>(null);

  onMount(async () => {
    try {
      const settings = await getUserSettings();
      const detectedTz = detectBrowserTimezone();
      displayName = settings.user_display_name ?? "";
      role = settings.user_role ?? "";
      timezone = settings.user_timezone ?? detectedTz;
      original = {
        displayName: settings.user_display_name ?? "",
        role: settings.user_role ?? "",
        timezone: settings.user_timezone ?? detectedTz,
      };
    } catch (e) {
      dbgWarn("personal", "load settings failed", e);
    } finally {
      loading = false;
    }
  });

  function detectBrowserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }

  function normalize(value: string): string {
    return value.trim();
  }

  let previewText = $derived.by(() => {
    const lines: string[] = [];
    const name = normalize(displayName);
    const r = normalize(role);
    const tz = normalize(timezone);
    if (name) lines.push(`- Display name: ${name}`);
    if (r) lines.push(`- Role: ${r}`);
    if (tz) lines.push(`- Timezone: ${tz}`);
    if (lines.length === 0) return "";
    return `User identity (MiWarp personal profile):\n${lines.join("\n")}`;
  });

  let hasAnyValue = $derived(previewText !== "");

  let isDirty = $derived.by(() => {
    if (!original) return false;
    return (
      normalize(displayName) !== original.displayName ||
      normalize(role) !== original.role ||
      normalize(timezone) !== original.timezone
    );
  });

  async function save() {
    if (saving) return;
    saving = true;
    try {
      const patch: Partial<UserSettings> = {
        user_display_name: normalize(displayName) || undefined,
        user_role: normalize(role) || undefined,
        user_timezone: normalize(timezone) || undefined,
      };
      const next = await updateUserSettings(patch);
      const detectedTz = detectBrowserTimezone();
      original = {
        displayName: next.user_display_name ?? "",
        role: next.user_role ?? "",
        timezone: next.user_timezone ?? detectedTz,
      };
      showToast(t("personal_saved"), "success");
    } catch (e) {
      dbgWarn("personal", "save failed", e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{t("personal_title")} · MiWarp</title>
</svelte:head>

<div class="min-h-full px-6 py-10 sm:px-10 sm:py-14">
  <div class="mx-auto w-full max-w-2xl space-y-8">
    <header class="space-y-3">
      <h1 class="text-2xl font-semibold tracking-tight text-sidebar-foreground">
        {t("personal_title")}
      </h1>
      <p class="text-sm text-sidebar-foreground/70">{t("personal_subtitle")}</p>
      <p class="text-xs leading-relaxed text-sidebar-foreground/80">
        {t("personal_consent")}
      </p>
    </header>

    {#if loading}
      <div class="rounded-xl border border-sidebar-border/60 bg-sidebar/40 p-8">
        <div class="space-y-4">
          <div class="h-4 w-1/3 animate-pulse rounded bg-sidebar-accent/40"></div>
          <div class="h-10 w-full animate-pulse rounded-md bg-sidebar-accent/30"></div>
          <div class="h-4 w-1/3 animate-pulse rounded bg-sidebar-accent/40"></div>
          <div class="h-10 w-full animate-pulse rounded-md bg-sidebar-accent/30"></div>
        </div>
      </div>
    {:else}
      <section class="rounded-xl border border-sidebar-border/60 bg-sidebar/40 p-6 space-y-5">
        <div class="space-y-1.5">
          <label
            for="personal-display-name"
            class="block text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70"
          >
            {t("personal_displayName")}
          </label>
          <input
            id="personal-display-name"
            type="text"
            bind:value={displayName}
            placeholder={t("personal_displayNamePlaceholder")}
            autocomplete="off"
            class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
          />
        </div>

        <div class="space-y-1.5">
          <label
            for="personal-role"
            class="block text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70"
          >
            {t("personal_role")}
          </label>
          <input
            id="personal-role"
            type="text"
            bind:value={role}
            placeholder={t("personal_rolePlaceholder")}
            autocomplete="off"
            class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
          />
        </div>

        <div class="space-y-1.5">
          <label
            for="personal-timezone"
            class="block text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70"
          >
            {t("personal_timezone")}
          </label>
          <input
            id="personal-timezone"
            type="text"
            bind:value={timezone}
            placeholder={t("personal_timezonePlaceholder")}
            autocomplete="off"
            class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
          />
        </div>
      </section>

      <section class="rounded-xl border border-sidebar-border/60 bg-sidebar/40 p-6 space-y-3">
        <h2 class="text-sm font-semibold text-sidebar-foreground">{t("personal_previewTitle")}</h2>
        <pre
          class="overflow-x-auto rounded-md border border-sidebar-border/40 bg-sidebar-accent/30 p-4 text-xs leading-relaxed text-sidebar-foreground/90">{hasAnyValue
            ? previewText
            : t("personal_previewEmpty")}</pre>
      </section>

      <div class="flex items-center justify-end gap-3">
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          onclick={save}
          disabled={!isDirty || saving}
        >
          {saving ? `${t("personal_save")}…` : t("personal_save")}
        </button>
      </div>
    {/if}
  </div>
</div>
