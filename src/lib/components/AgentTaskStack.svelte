<script lang="ts">
  /**
   * v1.0.6 / 4.8: Compact task stack visualization for multi-agent workflows.
   * Shows a vertical stack of active/pending tasks with status indicators.
   * Gated by `shouldShowAgentTaskStack(processVisibility)`.
   */
  import { progressStore } from "$lib/stores/progress-store.svelte";
  import type { ProgressTodo } from "$lib/chat/progress-parser";
  import { t } from "$lib/i18n/index.svelte";

  let {
    runId = "",
    onJumpToEntry,
  }: {
    runId: string;
    onJumpToEntry?: (entryId: string) => void;
  } = $props();

  const todos = $derived<ProgressTodo[]>(runId ? progressStore.todosFor(runId) : []);

  // Only show active tasks (in_progress + pending) in the compact stack
  const activeTodos = $derived(
    todos.filter((t) => t.status === "in_progress" || t.status === "pending"),
  );

  function statusIcon(status: ProgressTodo["status"]): string {
    switch (status) {
      case "in_progress":
        return "●";
      case "completed":
        return "✓";
      case "failed":
        return "✕";
      default:
        return "○";
    }
  }

  function statusColor(status: ProgressTodo["status"]): string {
    switch (status) {
      case "in_progress":
        return "text-miwarp-status-info";
      case "completed":
        return "text-miwarp-status-success";
      case "failed":
        return "text-miwarp-status-error";
      default:
        return "text-muted-foreground/60";
    }
  }
</script>

{#if activeTodos.length > 0}
  <div
    class="flex flex-col gap-0.5 rounded-md border border-border/30 bg-card/30 px-2 py-1.5 text-[11px]"
    role="list"
    aria-label={t("progress_title")}
  >
    {#each activeTodos as todo (todo.id)}
      <div role="listitem">
        <button
          type="button"
          class="group flex items-center gap-1.5 truncate text-left transition-colors hover:text-foreground"
          onclick={() => todo.sourceEntryId && onJumpToEntry?.(todo.sourceEntryId)}
          disabled={!todo.sourceEntryId}
        >
          <span
            class="shrink-0 {statusColor(todo.status)} {todo.status === 'in_progress'
              ? 'animate-pulse'
              : ''}"
          >
            {statusIcon(todo.status)}
          </span>
          <span class="truncate text-muted-foreground group-hover:text-foreground">
            {todo.content}
          </span>
        </button>
      </div>
    {/each}
  </div>
{/if}
