<script lang="ts">
  import { projectProfileStore } from "$lib/workbench/project-profile-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";

  type Props = { cwd: string };
  let { cwd }: Props = $props();

  $effect(() => {
    if (cwd) {
      void projectProfileStore.load(cwd);
    }
  });

  const isDirty = $derived(projectProfileStore.notesIsDirty);
  const modifiedAt = $derived(projectProfileStore.notesModifiedAt);
  const modifiedLabel = $derived(modifiedAt ? relativeTime(new Date(modifiedAt)) : null);
  const saving = $state({ value: false });

  async function onSave(): Promise<void> {
    if (!isDirty || saving.value) return;
    saving.value = true;
    try {
      await projectProfileStore.saveNotes(cwd);
    } finally {
      saving.value = false;
    }
  }
</script>

<section class="rounded-lg border border-border/40 bg-card/40 p-4">
  <header class="mb-3 flex items-start justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold text-foreground">
        {t("workbench_notes_title")}
      </h3>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {t("workbench_notes_subtitle")}
      </p>
    </div>
    {#if modifiedLabel}
      <span class="shrink-0 text-xs text-muted-foreground">
        {t("workbench_notes_lastEdited", { time: modifiedLabel })}
      </span>
    {/if}
  </header>

  <textarea
    class="w-full min-h-[160px] resize-y rounded-md border border-border/40 bg-background/60 p-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
    rows="6"
    placeholder={t("workbench_notes_placeholder")}
    bind:value={projectProfileStore.notesDirty}
  ></textarea>

  <div class="mt-3 flex items-center justify-end gap-2">
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!isDirty || saving.value}
      onclick={onSave}
    >
      {saving.value ? t("workbench_notes_saving") : t("workbench_notes_save")}
    </button>
  </div>
</section>
