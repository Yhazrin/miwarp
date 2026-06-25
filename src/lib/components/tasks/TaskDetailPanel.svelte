<script lang="ts">
  import { goto } from "$app/navigation";
  import { t, tRaw } from "$lib/i18n/index.svelte";
  import type {
    ReviewOutcome,
    TaskEvent,
    TaskMergeDecisionKind,
    TaskRecord,
  } from "$lib/types/task";
  import {
    MERGE_DECISION_KEYS,
    REVIEW_KEYS,
    STATUS_KEYS,
    VERDICT_KEYS,
  } from "$lib/chat/task-status-helpers";
  import { relativeTime } from "$lib/utils/format";

  let {
    task,
    events,
    loadingEvents = false,
    onLinkRun,
    onUnlinkRun,
    onApplyReview,
    onApplyMerge,
    onRefresh,
    onLoadEvents,
  }: {
    task: TaskRecord | null;
    events: TaskEvent[];
    loadingEvents?: boolean;
    onLinkRun: (runId: string, role: string) => Promise<void>;
    onUnlinkRun: (runId: string) => Promise<void>;
    onApplyReview: (decision: { outcome: ReviewOutcome; notes?: string }) => Promise<void>;
    onApplyMerge: (decision: { decision: TaskMergeDecisionKind; notes?: string }) => Promise<void>;
    onRefresh: () => Promise<void>;
    onLoadEvents: () => Promise<void>;
  } = $props();

  let newRunId = $state("");
  let newRunRole = $state("primary");
  let reviewNotes = $state("");
  let mergeNotes = $state("");
  let working = $state(false);
  let lastError = $state<string | null>(null);

  function describeEvent(event: TaskEvent): string {
    switch (event.event.type) {
      case "created":
        return t("tasks_events_type_created");
      case "status_transition":
        return tRaw("tasks_events_type_status", {
          from: t(STATUS_KEYS[event.event.from]),
          to: t(STATUS_KEYS[event.event.to]),
        });
      case "run_linked":
        return tRaw("tasks_events_type_run_linked", { role: event.event.role });
      case "run_unlinked":
        return t("tasks_events_type_run_unlinked");
      case "artifact_linked":
        return tRaw("tasks_events_type_artifact", { kind: event.event.kind });
      case "artifact_unlinked":
        return tRaw("tasks_events_type_artifact", { kind: event.event.artifact_id });
      case "quality_gate_updated":
        return tRaw("tasks_events_type_quality_gate", { verdict: event.event.verdict });
      case "review_updated":
        return tRaw("tasks_events_type_review", {
          outcome: t(REVIEW_KEYS[event.event.outcome]),
        });
      case "merge_decision_updated":
        return tRaw("tasks_events_type_merge", {
          decision: t(MERGE_DECISION_KEYS[event.event.decision]),
        });
      case "worktree_updated":
        return tRaw("tasks_events_type_worktree", { branch: event.event.branch });
      case "changed_file_tracked":
        return tRaw("tasks_events_type_changed_file", { path: event.event.path });
      case "restart_reconciled":
        return t("tasks_events_type_restart");
      default:
        return (event.event as { type: string }).type;
    }
  }

  async function runLink(): Promise<void> {
    if (!newRunId.trim()) return;
    working = true;
    lastError = null;
    try {
      await onLinkRun(newRunId.trim(), newRunRole);
      newRunId = "";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  async function applyReview(outcome: ReviewOutcome): Promise<void> {
    working = true;
    lastError = null;
    try {
      await onApplyReview({ outcome, notes: reviewNotes.trim() || undefined });
      reviewNotes = "";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  async function applyMerge(decision: TaskMergeDecisionKind): Promise<void> {
    working = true;
    lastError = null;
    try {
      await onApplyMerge({ decision, notes: mergeNotes.trim() || undefined });
      mergeNotes = "";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }
</script>

{#if !task}
  <div class="flex h-full items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    {t("tasks_empty")}
  </div>
{:else}
  <div class="flex h-full flex-col overflow-y-auto">
    <header class="border-b border-border px-6 py-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold text-foreground">{task.title}</h2>
          {#if task.objective}
            <p class="mt-1 text-sm text-muted-foreground">{task.objective}</p>
          {/if}
          <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span class="rounded-full bg-muted px-2 py-0.5">
              {t(STATUS_KEYS[task.status])}
            </span>
            <span class="rounded-full bg-muted px-2 py-0.5 font-mono">
              {task.id}
            </span>
            <span class="rounded-full bg-muted px-2 py-0.5">
              rev {task.revision}
            </span>
            <span class="rounded-full bg-muted px-2 py-0.5">
              last seq {task.last_event_seq}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 gap-2">
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            onclick={onRefresh}
          >
            {t("tasks_refresh")}
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onclick={() => goto(`/chat?cwd=${encodeURIComponent(task?.workspace_cwd ?? "")}`)}
          >
            {t("tasks_open_chat")}
          </button>
        </div>
      </div>
      {#if task.description}
        <p class="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{task.description}</p>
      {/if}
      <dl
        class="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2"
      >
        {#if task.workspace_cwd}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">
              {t("tasks_field_workspace")}
            </dt>
            <dd class="truncate font-mono text-foreground">{task.workspace_cwd}</dd>
          </div>
        {/if}
        {#if task.agent}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">
              {t("tasks_field_agent")}
            </dt>
            <dd class="text-foreground">{task.agent}</dd>
          </div>
        {/if}
        {#if task.model}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">
              {t("tasks_field_model")}
            </dt>
            <dd class="text-foreground">{task.model}</dd>
          </div>
        {/if}
        {#if task.owner}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">
              {t("tasks_field_owner")}
            </dt>
            <dd class="text-foreground">{task.owner}</dd>
          </div>
        {/if}
        {#if task.worktree_branch}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">Worktree</dt>
            <dd class="truncate font-mono text-foreground">{task.worktree_branch}</dd>
          </div>
        {/if}
        {#if task.tags.length > 0}
          <div>
            <dt class="font-medium uppercase tracking-wide text-[10px]">{t("tasks_field_tags")}</dt>
            <dd class="flex flex-wrap gap-1">
              {#each task.tags as tag (tag)}
                <span class="rounded-full bg-muted px-2 py-0.5">{tag}</span>
              {/each}
            </dd>
          </div>
        {/if}
      </dl>
    </header>

    {#if lastError}
      <p
        class="border-b border-rose-500/40 bg-rose-500/10 px-6 py-2 text-xs text-rose-600 dark:text-rose-300"
      >
        {t("tasks_decision_failed", { message: lastError })}
      </p>
    {/if}

    <div class="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2">
      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tasks_detail_runs")}
        </h3>
        {#if task.run_links.length === 0}
          <p class="text-xs text-muted-foreground">{t("tasks_no_runs")}</p>
        {:else}
          <ul class="space-y-2">
            {#each task.run_links as link (link.run_id)}
              <li
                class="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs"
              >
                <div class="min-w-0">
                  <p class="truncate font-mono text-foreground">{link.run_id}</p>
                  <p class="text-[10px] text-muted-foreground">
                    {link.role} · {relativeTime(link.linked_at)}
                  </p>
                </div>
                <button
                  type="button"
                  class="text-[11px] text-muted-foreground hover:text-rose-500"
                  disabled={working}
                  onclick={() => onUnlinkRun(link.run_id)}
                >
                  {t("tasks_unlink_run")}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="rounded-md border border-dashed border-border bg-background/60 p-3">
          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              bind:value={newRunId}
              placeholder="run-id"
              class="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground"
            />
            <select
              bind:value={newRunRole}
              class="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            >
              <option value="primary">primary</option>
              <option value="worktree">worktree</option>
              <option value="verification">verification</option>
              <option value="review">review</option>
              <option value="followup">followup</option>
            </select>
            <button
              type="button"
              class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={working || !newRunId.trim()}
              onclick={runLink}
            >
              {t("tasks_link_run")}
            </button>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tasks_detail_artifacts")}
        </h3>
        {#if task.artifact_links.length === 0}
          <p class="text-xs text-muted-foreground">{t("tasks_no_artifacts")}</p>
        {:else}
          <ul class="space-y-2">
            {#each task.artifact_links as artifact (artifact.artifact_id)}
              <li class="rounded-md border border-border bg-background px-3 py-2 text-xs">
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate font-mono text-foreground">{artifact.artifact_id}</p>
                  <span class="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                    {artifact.kind}
                  </span>
                </div>
                {#if artifact.content_hash}
                  <p class="mt-1 truncate text-[10px] text-muted-foreground">
                    sha:{artifact.content_hash}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tasks_detail_verification")}
        </h3>
        {#if task.verification_commands.length === 0}
          <p class="text-xs text-muted-foreground">—</p>
        {:else}
          <ul class="space-y-1 text-xs text-foreground">
            {#each task.verification_commands as command, index (index)}
              <li class="rounded-md border border-border bg-background px-2 py-1 font-mono">
                {command.command}
              </li>
            {/each}
          </ul>
        {/if}
        <p class="text-xs text-muted-foreground">
          verdict: {t(VERDICT_KEYS[task.quality_gate.verdict])}
        </p>
      </section>

      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tasks_detail_review")}
        </h3>
        <p class="text-xs text-foreground">
          {t(REVIEW_KEYS[task.review.outcome])}
        </p>
        <input
          type="text"
          bind:value={reviewNotes}
          placeholder="review notes"
          class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={working}
            onclick={() => applyReview("approved")}
          >
            {t("tasks_review_approve")}
          </button>
          <button
            type="button"
            class="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            disabled={working}
            onclick={() => applyReview("changes_requested")}
          >
            {t("tasks_review_changes")}
          </button>
          <button
            type="button"
            class="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            disabled={working}
            onclick={() => applyReview("rejected")}
          >
            {t("tasks_review_reject")}
          </button>
        </div>
      </section>

      <section class="space-y-3 lg:col-span-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tasks_detail_merge")}
        </h3>
        <p class="text-xs text-foreground">
          {t(MERGE_DECISION_KEYS[task.merge_decision.decision])}
        </p>
        <input
          type="text"
          bind:value={mergeNotes}
          placeholder="merge notes"
          class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={working}
            onclick={() => applyMerge("merge")}
          >
            {t("tasks_merge_merge")}
          </button>
          <button
            type="button"
            class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            disabled={working}
            onclick={() => applyMerge("keep_branch")}
          >
            {t("tasks_merge_keep_branch")}
          </button>
          <button
            type="button"
            class="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
            disabled={working}
            onclick={() => applyMerge("discard")}
          >
            {t("tasks_merge_discard")}
          </button>
        </div>
      </section>

      <section class="space-y-3 lg:col-span-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("tasks_detail_events")}
          </h3>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={onLoadEvents}
          >
            {t("tasks_refresh")}
          </button>
        </div>
        {#if loadingEvents && events.length === 0}
          <p class="text-xs text-muted-foreground">{t("common_loading")}</p>
        {:else if events.length === 0}
          <p class="text-xs text-muted-foreground">{t("tasks_no_events")}</p>
        {:else}
          <ol class="space-y-1 text-xs text-foreground">
            {#each events as event (event.id)}
              <li class="rounded-md border border-border bg-background px-2 py-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span>{describeEvent(event)}</span>
                  <span class="text-[10px] text-muted-foreground">
                    #{event.seq} · {relativeTime(event.timestamp)}
                  </span>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </div>
  </div>
{/if}
