<script lang="ts">
  /**
   * v1.0.6 / 5.2 Codex Progress panel — right-side Progress tab.
   * Reads the progress store for the active run and renders a compact
   * checkbox list with status pills and click-to-jump behavior.
   */
  import { progressStore } from "$lib/stores/progress-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { ProgressTodo } from "$lib/chat/progress-parser";

  let {
    runId = "",
    onJumpToEntry,
  }: {
    runId: string;
    onJumpToEntry?: (entryId: string) => void;
  } = $props();

  const todos = $derived<ProgressTodo[]>(runId ? progressStore.todosFor(runId) : []);

  function statusLabel(status: ProgressTodo["status"]): string {
    switch (status) {
      case "completed":
        return t("progress_status_completed");
      case "in_progress":
        return t("progress_status_inProgress");
      case "failed":
        return t("progress_status_failed");
      default:
        return t("progress_status_pending");
    }
  }

  function statusClass(status: ProgressTodo["status"]): string {
    switch (status) {
      case "completed":
        return "bg-miwarp-status-success/20 text-miwarp-status-success";
      case "in_progress":
        return "bg-miwarp-status-info/20 text-miwarp-status-info";
      case "failed":
        return "bg-miwarp-status-error/20 text-miwarp-status-error";
      default:
        return "bg-muted text-muted-foreground";
    }
  }

  function handleClick(todo: ProgressTodo): void {
    if (todo.sourceEntryId && onJumpToEntry) onJumpToEntry(todo.sourceEntryId);
  }
</script>

<div class="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t("progress_title")}
    </h3>
    <span class="text-[10px] text-muted-foreground/70">{todos.length}</span>
  </div>
  {#if todos.length === 0}
    <div class="mt-6 text-center text-xs italic text-muted-foreground/60">
      {t("progress_empty")}
    </div>
  {:else}
    <ul class="flex flex-col gap-1.5">
      {#each todos as todo (todo.id)}
        <li>
          <button
            type="button"
            class="group flex w-full items-start gap-2 rounded-md border border-border/40
              bg-card/50 p-2 text-left transition-colors hover:bg-card/80"
            onclick={() => handleClick(todo)}
            disabled={!todo.sourceEntryId}
          >
            <span class="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs">
              {#if todo.status === "completed"}
                <span aria-hidden="true">✓</span>
              {:else if todo.status === "in_progress"}
                <span aria-hidden="true">●</span>
              {:else if todo.status === "failed"}
                <span aria-hidden="true">✕</span>
              {:else}
                <span aria-hidden="true">○</span>
              {/if}
            </span>
            <span class="min-w-0 flex-1 break-words text-xs leading-relaxed text-foreground/90">
              {todo.content}
            </span>
            <span
              class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium {statusClass(
                todo.status,
              )}"
            >
              {statusLabel(todo.status)}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
