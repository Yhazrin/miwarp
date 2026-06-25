<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { ArtifactGroupBy, ArtifactKind, ArtifactRecord } from "$lib/types/artifact";
  import type { ArtifactGroup } from "$lib/stores/artifact-store.svelte";

  let {
    groups,
    groupBy,
    selectedArtifactId,
    onSelect,
    onGroupByChange,
    onTogglePin,
    onRemove,
  }: {
    groups: ArtifactGroup[];
    groupBy: ArtifactGroupBy;
    selectedArtifactId: string | null;
    onSelect: (id: string) => void;
    onGroupByChange: (mode: ArtifactGroupBy) => void;
    onTogglePin: (id: string) => void;
    onRemove: (id: string) => void;
  } = $props();

  const groupByOptions: { id: ArtifactGroupBy; key: MessageKey }[] = [
    { id: "run", key: "artifacts_group_by_run" },
    { id: "kind", key: "artifacts_group_by_kind" },
    { id: "task", key: "artifacts_group_by_task" },
  ];

  const kindKey: Record<ArtifactKind, MessageKey> = {
    diff: "artifacts_kind_diff",
    file: "artifacts_kind_file",
    plan: "artifacts_kind_plan",
    test_report: "artifacts_kind_test_report",
    screenshot: "artifacts_kind_screenshot",
    mermaid: "artifacts_kind_mermaid",
    vega: "artifacts_kind_vega",
    mind_map: "artifacts_kind_mind_map",
    terminal_log: "artifacts_kind_terminal_log",
    build: "artifacts_kind_build",
    pr: "artifacts_kind_pr",
    diagnostic_bundle: "artifacts_kind_diagnostic_bundle",
    context_pack: "artifacts_kind_context_pack",
  };

  function kindLabel(kind: ArtifactKind): string {
    return t(kindKey[kind]);
  }

  function pinLabel(artifact: ArtifactRecord): string {
    return artifact.pinned ? t("artifacts_unpin") : t("artifacts_pin");
  }
</script>

<div
  class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2"
  role="group"
  aria-label={t("artifacts_group_by")}
>
  <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
    {t("artifacts_group_by")}
  </span>
  {#each groupByOptions as option (option.id)}
    <button
      type="button"
      class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors
        {groupBy === option.id
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:bg-muted'}"
      aria-pressed={groupBy === option.id}
      aria-label={t(option.key)}
      onclick={() => onGroupByChange(option.id)}
    >
      {t(option.key)}
    </button>
  {/each}
</div>

<div class="flex-1 overflow-y-auto" role="listbox" aria-label={t("artifacts_title")} tabindex="0">
  {#if groups.length === 0}
    <p class="px-4 py-6 text-xs text-muted-foreground">{t("artifacts_empty")}</p>
  {:else}
    {#each groups as group (group.id)}
      <section class="border-b border-border">
        <header class="flex items-center justify-between bg-muted/30 px-4 py-2 text-[11px]">
          <span class="font-mono text-foreground">{group.label}</span>
          <span class="text-muted-foreground">
            {t("artifacts_count", { count: String(group.artifacts.length) })}
          </span>
        </header>
        <ul class="divide-y divide-border">
          {#each group.artifacts as artifact (artifact.id)}
            <li
              class="flex items-start justify-between gap-2 px-4 py-2 text-xs
                {selectedArtifactId === artifact.id ? 'bg-primary/5' : 'hover:bg-muted/40'}"
            >
              <button
                type="button"
                class="min-w-0 flex-1 text-left transition-colors"
                aria-current={selectedArtifactId === artifact.id ? "true" : undefined}
                aria-label={t("artifacts_select_aria", { title: artifact.title })}
                onclick={() => onSelect(artifact.id)}
              >
                <span class="block truncate font-medium text-foreground">{artifact.title}</span>
                <span class="mt-0.5 block text-[10px] text-muted-foreground">
                  {kindLabel(artifact.kind)} · {artifact.run_id ?? t("artifacts_unassigned")}
                </span>
              </button>
              <span class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="rounded-md border border-border px-2 py-0.5 text-[10px] text-foreground hover:bg-muted"
                  aria-label={pinLabel(artifact)}
                  onclick={() => onTogglePin(artifact.id)}
                >
                  {pinLabel(artifact)}
                </button>
                <button
                  type="button"
                  class="rounded-md border border-rose-500/40 px-2 py-0.5 text-[10px] text-rose-600 hover:bg-rose-500/10"
                  aria-label={t("artifacts_remove")}
                  onclick={() => onRemove(artifact.id)}
                >
                  {t("artifacts_remove")}
                </button>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>
