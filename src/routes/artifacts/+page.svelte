<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { artifactStore, type ArtifactGroup } from "$lib/stores/artifact-store.svelte";
  import type { ArtifactGroupBy, ArtifactKind, ArtifactRecord } from "$lib/types/artifact";
  import ArtifactGroupList from "$lib/components/artifacts/ArtifactGroupList.svelte";
  import ArtifactDetailPanel from "$lib/components/artifacts/ArtifactDetailPanel.svelte";

  let groupBy = $state<ArtifactGroupBy>("run");
  let search = $state("");
  let kindFilter = $state<ArtifactKind | "all">("all");
  let pinnedOnly = $state(false);
  let toast = $state<string | null>(null);

  const groups = $derived.by((): ArtifactGroup[] => {
    artifactStore.filter = { ...artifactStore.filter, kind: kindFilter, search, pinnedOnly };
    if (groupBy === "run") return artifactStore.groupByRun();
    if (groupBy === "kind") return artifactStore.groupByKind();
    return artifactStore.groupByTask();
  });
  const totalCount = $derived(artifactStore.filtered().length);
  const pinnedCount = $derived(artifactStore.pinned.length);
  const selected = $derived(artifactStore.selected);

  onMount(() => {
    void artifactStore.refresh().catch((e: unknown) => {
      console.error("artifacts: failed to load", e);
    });
  });

  function onSelect(id: string): void {
    artifactStore.select(id);
  }

  function onGroupByChange(mode: ArtifactGroupBy): void {
    groupBy = mode;
  }

  function onTogglePin(id: string): void {
    artifactStore.togglePin(id);
  }

  function onRemove(id: string): void {
    if (typeof window !== "undefined") {
      const ok = window.confirm(t("artifacts_remove_confirm"));
      if (!ok) return;
    }
    artifactStore.remove(id);
  }

  function onOpen(artifact: ArtifactRecord): void {
    // Frontend stub: surface the URI so users can copy / open via system handler.
    if (typeof navigator !== "undefined" && artifact.source_uri) {
      console.info("artifact: open", artifact.source_uri);
    }
    toast = t("artifacts_open_external");
    setTimeout(() => (toast = null), 2000);
  }

  async function onCopyPath(artifact: ArtifactRecord): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.clipboard && artifact.source_uri) {
      try {
        await navigator.clipboard.writeText(artifact.source_uri);
      } catch (e) {
        console.warn("clipboard write failed", e);
      }
    }
    toast = t("artifacts_copied");
    setTimeout(() => (toast = null), 2000);
  }

  const kindOptions: { id: ArtifactKind | "all"; key: MessageKey }[] = [
    { id: "all", key: "artifacts_kind_label" },
    { id: "diff", key: "artifacts_kind_diff" },
    { id: "file", key: "artifacts_kind_file" },
    { id: "plan", key: "artifacts_kind_plan" },
    { id: "test_report", key: "artifacts_kind_test_report" },
    { id: "screenshot", key: "artifacts_kind_screenshot" },
    { id: "mermaid", key: "artifacts_kind_mermaid" },
    { id: "vega", key: "artifacts_kind_vega" },
    { id: "mind_map", key: "artifacts_kind_mind_map" },
    { id: "terminal_log", key: "artifacts_kind_terminal_log" },
    { id: "build", key: "artifacts_kind_build" },
    { id: "pr", key: "artifacts_kind_pr" },
    { id: "diagnostic_bundle", key: "artifacts_kind_diagnostic_bundle" },
    { id: "context_pack", key: "artifacts_kind_context_pack" },
  ];
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
    <div>
      <h1 class="text-base font-semibold text-foreground">{t("artifacts_title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("artifacts_subtitle")}</p>
      <p class="mt-1 text-[10px] text-muted-foreground">
        {t("artifacts_count", { count: String(totalCount) })} · {t("artifacts_pinned_count", {
          count: String(pinnedCount),
        })}
      </p>
    </div>
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
      aria-label={t("artifacts_refresh")}
      onclick={() => artifactStore.refresh()}
    >
      {t("artifacts_refresh")}
    </button>
  </div>

  <div
    class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-2"
    role="group"
    aria-label={t("artifacts_filter_group_label")}
  >
    <input
      type="search"
      value={search}
      oninput={(event) => (search = (event.currentTarget as HTMLInputElement).value)}
      placeholder={t("artifacts_filter_search")}
      aria-label={t("artifacts_filter_search")}
      class="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
    />
    <select
      value={kindFilter}
      onchange={(event) =>
        (kindFilter = (event.currentTarget as HTMLSelectElement).value as ArtifactKind | "all")}
      class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
      aria-label={t("artifacts_kind_label")}
    >
      {#each kindOptions as option (option.id)}
        <option value={option.id}>{t(option.key)}</option>
      {/each}
    </select>
    <label class="flex items-center gap-1 text-[11px] text-muted-foreground">
      <input
        type="checkbox"
        checked={pinnedOnly}
        onchange={(event) => (pinnedOnly = (event.currentTarget as HTMLInputElement).checked)}
        class="h-3 w-3"
      />
      {t("artifacts_filter_pinned")}
    </label>
  </div>

  {#if toast}
    <div
      class="border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground"
      role="status"
    >
      {toast}
    </div>
  {/if}

  <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
    <ArtifactGroupList
      {groups}
      {groupBy}
      selectedArtifactId={selected?.id ?? null}
      {onSelect}
      {onGroupByChange}
      {onTogglePin}
      {onRemove}
    />
    <ArtifactDetailPanel artifact={selected} {onOpen} {onCopyPath} />
  </div>
</div>
