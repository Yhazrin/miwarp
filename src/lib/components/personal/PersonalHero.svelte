<script lang="ts">
  /**
   * Hero banner — big avatar, display name, handle, role+timezone line,
   * and four quick stats. The stats are computed by the parent and passed
   * in; this component never fetches.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";

  let {
    settings,
    stats,
  }: {
    settings: UserSettings;
    stats: {
      runs7d: number | null;
      skills: number;
      providers: number;
      sinceDays: number | null;
    };
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const displayName = $derived((settings.user_display_name ?? "").trim() || "MiWarp user");
  const handle = $derived((settings.user_handle ?? "").trim());
  const role = $derived((settings.user_role ?? "").trim());
  const timezone = $derived((settings.user_timezone ?? "").trim());
  const initials = $derived(
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "M",
  );

  const subtitleParts = $derived([role, timezone].filter((s) => s.length > 0));
</script>

<div
  class="rounded-xl border border-sidebar-border/60 bg-gradient-to-br from-sidebar/60 via-sidebar/40 to-sidebar/30 p-6 sm:p-8"
>
  <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
    <div
      class="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-2xl font-semibold text-primary shadow-sm ring-1 ring-primary/20"
      aria-hidden="true"
    >
      {initials}
    </div>

    <div class="min-w-0 flex-1 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
          {displayName}
        </h1>
        {#if handle}
          <span class="text-sm text-muted-foreground">@{handle}</span>
        {/if}
      </div>
      {#if subtitleParts.length > 0}
        <p class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {#each subtitleParts as part, idx (idx)}
            {#if idx > 0}
              <span aria-hidden="true">·</span>
            {/if}
            <span>{part}</span>
          {/each}
        </p>
      {/if}
      <p class="text-xs text-muted-foreground/80">
        {lk("personal_hero_subtitle")}
      </p>
    </div>
  </div>

  <dl class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div class="rounded-lg border border-sidebar-border/40 bg-background/40 p-3">
      <dt class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {lk("personal_hero_stat_runs")}
      </dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {stats.runs7d ?? "—"}
      </dd>
    </div>
    <div class="rounded-lg border border-sidebar-border/40 bg-background/40 p-3">
      <dt class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {lk("personal_hero_stat_skills")}
      </dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {stats.skills}
        <Icon name="sparkles" size="xs" class="ml-1 text-muted-foreground/60" />
      </dd>
    </div>
    <div class="rounded-lg border border-sidebar-border/40 bg-background/40 p-3">
      <dt class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {lk("personal_hero_stat_providers")}
      </dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {stats.providers}
      </dd>
    </div>
    <div class="rounded-lg border border-sidebar-border/40 bg-background/40 p-3">
      <dt class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {lk("personal_hero_stat_since")}
      </dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {stats.sinceDays === null ? "—" : stats.sinceDays}
      </dd>
    </div>
  </dl>
</div>
