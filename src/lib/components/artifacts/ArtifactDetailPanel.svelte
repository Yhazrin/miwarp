<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { ArtifactKind, ArtifactRecord } from "$lib/types/artifact";
  import { relativeTime } from "$lib/utils/format";

  let {
    artifact,
    onOpen,
    onCopyPath,
  }: {
    artifact: ArtifactRecord | null;
    onOpen: (artifact: ArtifactRecord) => void;
    onCopyPath: (artifact: ArtifactRecord) => void;
  } = $props();

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

  function formatSize(bytes: number | null | undefined): string {
    if (bytes == null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

{#if !artifact}
  <div class="flex h-full items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    {t("artifacts_empty")}
  </div>
{:else}
  <div class="flex h-full flex-col overflow-y-auto">
    <header class="border-b border-border px-6 py-4">
      <h2 class="truncate text-base font-semibold text-foreground">{artifact.title}</h2>
      {#if artifact.description}
        <p class="mt-1 text-sm text-muted-foreground">{artifact.description}</p>
      {/if}
      <p class="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(kindKey[artifact.kind])} · {relativeTime(artifact.updated_at)}
      </p>
    </header>

    <dl class="grid grid-cols-1 gap-3 px-6 py-4 text-xs text-muted-foreground sm:grid-cols-2">
      <div>
        <dt class="font-medium uppercase tracking-wide text-[10px]">
          {t("artifacts_run_label")}
        </dt>
        <dd class="font-mono text-foreground">
          {artifact.run_id ?? t("artifacts_unassigned")}
        </dd>
      </div>
      <div>
        <dt class="font-medium uppercase tracking-wide text-[10px]">
          {t("artifacts_task_label")}
        </dt>
        <dd class="font-mono text-foreground">
          {artifact.task_id ?? t("artifacts_unassigned")}
        </dd>
      </div>
      <div>
        <dt class="font-medium uppercase tracking-wide text-[10px]">
          {t("artifacts_hash_label")}
        </dt>
        <dd class="truncate font-mono text-foreground">
          {artifact.content_hash ?? "—"}
        </dd>
      </div>
      <div>
        <dt class="font-medium uppercase tracking-wide text-[10px]">Size</dt>
        <dd class="text-foreground">{formatSize(artifact.size_bytes)}</dd>
      </div>
      {#if artifact.mime_type}
        <div>
          <dt class="font-medium uppercase tracking-wide text-[10px]">MIME</dt>
          <dd class="text-foreground">{artifact.mime_type}</dd>
        </div>
      {/if}
      {#if artifact.source_uri}
        <div class="sm:col-span-2">
          <dt class="font-medium uppercase tracking-wide text-[10px]">URI</dt>
          <dd class="truncate font-mono text-foreground">{artifact.source_uri}</dd>
        </div>
      {/if}
      {#if artifact.tags.length > 0}
        <div class="sm:col-span-2">
          <dt class="font-medium uppercase tracking-wide text-[10px]">Tags</dt>
          <dd class="mt-1 flex flex-wrap gap-1">
            {#each artifact.tags as tag (tag)}
              <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground"
                >{tag}</span
              >
            {/each}
          </dd>
        </div>
      {/if}
    </dl>

    <div class="flex shrink-0 gap-2 border-t border-border px-6 py-3">
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        aria-label={t("artifacts_open_external")}
        onclick={() => onOpen(artifact)}
      >
        {t("artifacts_open_external")}
      </button>
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        aria-label={t("artifacts_copy_path")}
        onclick={() => onCopyPath(artifact)}
      >
        {t("artifacts_copy_path")}
      </button>
    </div>
  </div>
{/if}
