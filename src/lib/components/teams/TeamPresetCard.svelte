<script lang="ts">
  /**
   * One preset card on the Teams page Quick Launch row.
   * Clicking dispatches the prompt with this preset via team-dispatcher.
   */
  import type { TeamPreset } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";

  let {
    preset,
    onLaunch,
    busy,
  }: {
    preset: TeamPreset;
    onLaunch: (presetId: string) => void;
    busy: boolean;
  } = $props();
</script>

<button
  type="button"
  disabled={busy}
  class="group flex h-full w-full flex-col gap-2 rounded-xl border border-border/60 bg-card p-3.5 text-left
    transition-all hover:border-primary/40 hover:bg-accent/30 hover:shadow-sm
    disabled:cursor-not-allowed disabled:opacity-60"
  onclick={() => onLaunch(preset.id)}
>
  <div class="flex items-start justify-between gap-2">
    <div
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </div>
    <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {t("teamsPage_presetMembers", { count: String(preset.members.length) })}
    </span>
  </div>
  <div class="min-h-0 flex-1">
    <p class="text-xs font-semibold text-foreground leading-snug">
      {preset.name === "Fullstack Team"
        ? t("teamsPage_fullstackName")
        : preset.name === "Review Team"
          ? t("teamsPage_reviewName")
          : preset.name === "Research Team"
            ? t("teamsPage_researchName")
            : preset.name}
    </p>
    <p class="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">
      {preset.description}
    </p>
  </div>
  <div
    class="flex items-center gap-1 text-[10px] font-medium text-primary group-hover:gap-1.5 transition-all"
  >
    <svg
      class="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
    <span>{t("teamsPage_startWithPreset")}</span>
  </div>
</button>
