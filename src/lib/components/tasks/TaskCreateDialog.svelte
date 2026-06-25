<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { TaskCreateInput, TaskPriority } from "$lib/types/task";

  let {
    open,
    onSubmit,
    onCancel,
  }: {
    open: boolean;
    onSubmit: (input: TaskCreateInput) => Promise<void>;
    onCancel: () => void;
  } = $props();

  let title = $state("");
  let objective = $state("");
  let description = $state("");
  let priority = $state<TaskPriority>("medium");
  let workspace = $state("");
  let agent = $state("");
  let model = $state("");
  let verification = $state("");
  let allowedDirs = $state("");
  let maxChangedFiles = $state<number | null>(null);
  let owner = $state("");
  let tags = $state("");
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    submitting = true;
    errorMessage = null;
    try {
      const trimmedDirs = allowedDirs
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const trimmedTags = tags
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const input: TaskCreateInput = {
        title: title.trim(),
        objective: objective.trim() || undefined,
        description: description.trim(),
        priority,
        workspace_cwd: workspace.trim() || null,
        agent: agent.trim() || null,
        model: model.trim() || null,
        verification_commands: verification.trim()
          ? [{ command: verification.trim(), cwd: workspace.trim() || null }]
          : [],
        allowed_dirs: trimmedDirs,
        max_changed_files: maxChangedFiles,
        owner: owner.trim() || null,
        tags: trimmedTags,
      };
      await onSubmit(input);
      reset();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function reset(): void {
    title = "";
    objective = "";
    description = "";
    priority = "medium";
    workspace = "";
    agent = "";
    model = "";
    verification = "";
    allowedDirs = "";
    maxChangedFiles = null;
    owner = "";
    tags = "";
    errorMessage = null;
  }

  function handleClose(): void {
    reset();
    onCancel();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
  >
    <form
      class="w-full max-w-xl space-y-3 rounded-xl border border-border bg-card p-5 shadow-2xl"
      onsubmit={handleSubmit}
    >
      <header class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-foreground">{t("tasks_create_dialog_title")}</h3>
        <button
          type="button"
          class="text-xs text-muted-foreground hover:text-foreground"
          onclick={handleClose}
        >
          {t("tasks_cancel")}
        </button>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_title")}</span>
          <input
            type="text"
            required
            bind:value={title}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_priority")}</span>
          <select
            bind:value={priority}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <option value="low">{t("tasks_priority_low")}</option>
            <option value="medium">{t("tasks_priority_medium")}</option>
            <option value="high">{t("tasks_priority_high")}</option>
            <option value="critical">{t("tasks_priority_critical")}</option>
          </select>
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_objective")}</span>
          <input
            type="text"
            bind:value={objective}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_description")}</span>
          <textarea
            bind:value={description}
            rows="3"
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          ></textarea>
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_workspace")}</span>
          <input
            type="text"
            bind:value={workspace}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_agent")}</span>
          <input
            type="text"
            bind:value={agent}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_model")}</span>
          <input
            type="text"
            bind:value={model}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_verification")}</span>
          <input
            type="text"
            bind:value={verification}
            placeholder="pnpm check"
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_max_changed_files")}</span>
          <input
            type="number"
            min="1"
            bind:value={maxChangedFiles}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground">
          <span>{t("tasks_field_owner")}</span>
          <input
            type="text"
            bind:value={owner}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_allowed_dirs")}</span>
          <input
            type="text"
            bind:value={allowedDirs}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono text-foreground"
          />
        </label>
        <label class="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>{t("tasks_field_tags")}</span>
          <input
            type="text"
            bind:value={tags}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      {#if errorMessage}
        <p
          class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300"
        >
          {t("tasks_create_failed", { message: errorMessage })}
        </p>
      {/if}

      <footer class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          onclick={handleClose}
        >
          {t("tasks_cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {t("tasks_submit")}
        </button>
      </footer>
    </form>
  </div>
{/if}
