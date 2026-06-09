<script lang="ts">
  /**
   * Forward selected text to another session. Lists all runs grouped by
   * workspace (cwd) with a name / preview / cwd search box. Confirms by
   * returning the target runId; the parent (chat stage) then calls
   * `send_chat_message` and navigates to the target run.
   */
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Icon from "$lib/components/Icon.svelte";
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
      runs = await api.listRuns();
    } catch (e) {
      dbgWarn("forward-dialog", "listRuns failed", e);
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
    open = false;
    onSelect(id);
  }

  function relativeTimeLabel(iso?: string) {
    if (!iso) return "";
    return relativeTime(iso);
  }

  onMount(() => {
    // scroll active item into view when navigating
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
  <div class="flex h-[28rem] flex-col gap-3">
    <div class="relative">
      <Icon
        name="search"
        size="sm"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
      />
      <input
        type="text"
        bind:value={query}
        placeholder={t("chat_forwardSearchPlaceholder")}
        class="w-full rounded-md border border-border/60 bg-background/60 pl-8 pr-3 py-1.5 text-sm outline-none transition-colors focus:border-primary/50"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-background/40">
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
          <div class="border-b border-border/30 last:border-b-0">
            <div
              class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground/80 bg-muted/30"
            >
              <Icon name={group.cwd ? "folder" : "folder-open"} size="xs" />
              <span class="truncate">{group.label}</span>
              <span class="text-muted-foreground/50">· {group.runs.length}</span>
            </div>
            {#each group.runs as run (run.id)}
              {@const isActive = flatIds[activeIndex] === run.id}
              <button
                type="button"
                data-forward-run={run.id}
                onclick={() => pick(run.id)}
                class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors
                  ${isActive ? "bg-primary/12 text-foreground" : "hover:bg-muted/40 text-foreground/85"}`}
              >
                <span
                  class={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full
                    ${
                      run.status === "running"
                        ? "bg-miwarp-status-success animate-pulse"
                        : run.status === "waiting_input" || run.status === "waiting_approval"
                          ? "bg-miwarp-status-warning"
                          : "bg-muted-foreground/30"
                    }`}
                ></span>
                <span class="flex-1 min-w-0 truncate">
                  {run.name ||
                    run.last_message_preview ||
                    run.prompt.slice(0, 80) ||
                    run.id.slice(0, 8)}
                </span>
                <span class="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                  {relativeTimeLabel(run.last_activity_at || run.started_at)}
                </span>
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <p class="text-[10px] text-muted-foreground/60 text-center">
      {t("chat_forwardHint")}
    </p>
  </div>
</Modal>
