<script lang="ts">
  /**
   * Forward selected text to another session. Lists all runs grouped by
   * workspace (cwd) with a name / preview / cwd search box. Confirms by
   * returning the target runId; the parent (chat stage) then calls
   * `send_chat_message` and navigates to the target run.
   *
   * Uses `listRunsLite` — skips the events.jsonl summary scan so the
   * picker opens instantly even with hundreds of runs.
   */
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Input from "$lib/components/Input.svelte";
  import Button from "$lib/components/Button.svelte";
  import * as api from "$lib/api";
  import type { TaskRun } from "$lib/types";
  import { cwdDisplayLabel, relativeTime } from "$lib/utils/format";
  import { dbgWarn } from "$lib/utils/debug";

  let {
    open = $bindable(false),
    onSelect,
  }: {
    open?: boolean;
    onSelect: (targetRunId: string) => void;
  } = $props();

  let loading = $state(false);
  let runs = $state<TaskRun[]>([]);
  let query = $state("");
  let activeIndex = $state(0);

  /** Always load the latest list when the dialog opens — runs change quickly
   *  (new sessions, completed, failed) and a stale cache would confuse the user. */
  $effect(() => {
    if (!open) return;
    void load();
    query = "";
    activeIndex = 0;
  });

  async function load() {
    loading = true;
    try {
      runs = await api.listRunsLite();
    } catch (e) {
      dbgWarn("forward-dialog", "listRunsLite failed", e);
      runs = [];
    } finally {
      loading = false;
    }
  }

  interface RunGroup {
    cwd: string;
    label: string;
    runs: TaskRun[];
  }

  const filtered = $derived.by<RunGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? runs.filter((r) => {
          if (r.name?.toLowerCase().includes(q)) return true;
          if (r.last_message_preview?.toLowerCase().includes(q)) return true;
          if (r.cwd.toLowerCase().includes(q)) return true;
          return false;
        })
      : runs;
    const byCwd = new Map<string, TaskRun[]>();
    for (const r of matched) {
      const key = r.cwd || "__uncategorized__";
      if (!byCwd.has(key)) byCwd.set(key, []);
      byCwd.get(key)!.push(r);
    }
    const groups: RunGroup[] = [];
    for (const [cwd, rs] of byCwd) {
      rs.sort((a, b) =>
        (b.last_activity_at || b.started_at).localeCompare(a.last_activity_at || a.started_at),
      );
      groups.push({
        cwd: cwd === "__uncategorized__" ? "" : cwd,
        label: cwd === "__uncategorized__" ? t("sidebar_uncategorized") : cwdDisplayLabel(cwd),
        runs: rs,
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  });

  /** Flat list of runIds in render order — used for keyboard nav. */
  const flatIds = $derived(filtered.flatMap((g) => g.runs.map((r) => r.id)));

  /** The run currently targeted for forwarding. Driven by activeIndex. */
  const pickedRun = $derived.by<TaskRun | null>(() => {
    const id = flatIds[activeIndex];
    if (!id) return null;
    return runs.find((r) => r.id === id) ?? null;
  });

  function handleKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(flatIds.length - 1, activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = flatIds[activeIndex];
      if (id) pick(id);
    }
  }

  function pick(id: string) {
    onSelect(id);
    open = false;
  }

  function pickFromFooter() {
    if (pickedRun) pick(pickedRun.id);
  }

  function cancel() {
    open = false;
  }

  /** Session title: user-set name > first line of prompt > short id.
   *  Never falls back to the full UUID — the UUID is only used as last
   *  resort, truncated. */
  function runTitle(run: TaskRun): string {
    if (run.name?.trim()) return run.name.trim();
    const firstLine = (run.prompt || "").split("\n", 1)[0]?.trim() ?? "";
    if (firstLine) return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    return run.id.slice(0, 8);
  }

  /** Last message preview — separate from title, layered below it. */
  function runPreview(run: TaskRun): string {
    return run.last_message_preview?.trim() ?? "";
  }

  /** Status dot class — maps the runtime status to a token color. */
  function statusDotClass(status: TaskRun["status"]): string {
    switch (status) {
      case "running":
        return "bg-miwarp-status-success animate-pulse";
      case "waiting_input":
      case "waiting_approval":
        return "bg-miwarp-status-warning";
      case "failed":
        return "bg-miwarp-status-error";
      default:
        return "bg-muted-foreground/50";
    }
  }

  function relativeTimeLabel(iso?: string): string {
    if (!iso) return "";
    return relativeTime(iso);
  }

  onMount(() => {
    $effect(() => {
      const id = flatIds[activeIndex];
      if (!id) return;
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-forward-run="${id}"]`);
        el?.scrollIntoView({ block: "nearest" });
      });
    });
  });
</script>

<svelte:window onkeydown={handleKey} />

<Modal bind:open title={t("chat_forwardToSession")} size="lg">
  <div class="flex max-h-[70vh] flex-col gap-3 px-6 py-4">
    <!-- Search -->
    <div class="relative">
      <Icon
        name="search"
        size="sm"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 z-10"
      />
      <Input
        bind:value={query}
        placeholder={t("chat_forwardSearchPlaceholder")}
        class="pl-8"
        aria-label={t("chat_forwardSearchPlaceholder")}
      />
    </div>

    <!-- Run list — grouped by workspace (cwd) -->
    <div
      class="scrollbar-hide min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/40 bg-background/30"
    >
      {#if loading && runs.length === 0}
        <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("common_loading")}
        </div>
      {:else if filtered.length === 0}
        <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("chat_forwardNoMatches")}
        </div>
      {:else}
        {#each filtered as group (group.cwd || "__uncategorized__")}
          <div>
            <!-- Group header: short project name (primary) + full path
                 (auxiliary). The path appears ONCE here, not in every item. -->
            <div
              class="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border/40 bg-background/85 px-4 py-2 text-xs backdrop-blur"
            >
              <Icon
                name={group.cwd ? "folder" : "folder-open"}
                size="xs"
                class="shrink-0 self-center text-muted-foreground/70"
              />
              <span class="truncate text-sm font-semibold text-foreground">
                {group.label}
              </span>
              <span class="truncate text-xs text-muted-foreground/60">
                {group.cwd}
              </span>
              <span class="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground/60">
                {group.runs.length}
              </span>
            </div>

            {#each group.runs as run (run.id)}
              {@const isActive = flatIds[activeIndex] === run.id}
              {@const title = runTitle(run)}
              {@const preview = runPreview(run)}
              {@const updatedAt = run.last_activity_at || run.started_at}
              <button
                type="button"
                data-forward-run={run.id}
                onclick={() => (activeIndex = flatIds.indexOf(run.id))}
                class={`flex w-full items-start gap-3 border-b border-border/20 px-4 py-2.5 text-left text-sm transition-colors last:border-b-0
                  ${isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
              >
                <!-- Selection indicator (radio-style) -->
                <span
                  class={`mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border
                    ${
                      isActive
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40 bg-transparent"
                    }`}
                  aria-hidden="true"
                >
                  {#if isActive}
                    <span class="h-1.5 w-1.5 rounded-full bg-primary-foreground"></span>
                  {/if}
                </span>

                <!-- Status dot (overlaid separately to preserve the radio look) -->
                <span
                  class={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(run.status)}`}
                  aria-hidden="true"
                ></span>

                <!-- Title + preview + meta — three layered lines, no truncation
                     hiding information. The title is the primary visual
                     anchor; preview and meta are clearly secondary. -->
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="truncate text-sm font-medium leading-tight">
                    {title}
                  </span>
                  {#if preview}
                    <span
                      class={`truncate text-xs leading-snug ${isActive ? "text-accent-foreground/80" : "text-muted-foreground"}`}
                    >
                      {preview}
                    </span>
                  {/if}
                  <span
                    class={`flex items-center gap-1.5 text-xs tabular-nums ${isActive ? "text-accent-foreground/70" : "text-muted-foreground/70"}`}
                  >
                    {#if updatedAt}
                      <span>{relativeTimeLabel(updatedAt)}</span>
                    {/if}
                    {#if run.message_count && run.message_count > 0}
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("chat_forwardMessagesMeta", { count: String(run.message_count) })}
                      </span>
                    {/if}
                    {#if run.model}
                      <span aria-hidden="true">·</span>
                      <span class="truncate">{run.model}</span>
                    {/if}
                  </span>
                </div>
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer: single-line action bar. Left: subtle "Forwarding to: Title"
         hint. Right: Cancel + Forward. Enter still works as a shortcut. -->
    <div class="flex shrink-0 items-center gap-3 border-t border-border/40 bg-muted/20 px-4 py-3">
      <Icon name="arrow-right" size="sm" class="shrink-0 text-muted-foreground" />
      <span class="shrink-0 text-sm text-muted-foreground">
        {t("chat_forwardSelectedLabel")}
      </span>
      <span
        class={`min-w-0 flex-1 truncate text-sm font-medium ${pickedRun ? "text-foreground" : "italic text-muted-foreground/70"}`}
      >
        {pickedRun ? runTitle(pickedRun) : t("chat_forwardNoSelection")}
      </span>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onclick={cancel}>
          {t("chat_forwardCancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!pickedRun}
          onclick={pickFromFooter}
          title={t("chat_forwardHint")}
        >
          {t("chat_forwardConfirm")}
        </Button>
      </div>
    </div>
  </div>
</Modal>
