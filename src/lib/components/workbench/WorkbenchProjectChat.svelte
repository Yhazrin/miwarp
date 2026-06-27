<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  function onInput(event: Event): void {
    const projectId = workbenchStore.selectedProjectId;
    if (!projectId) return;
    const target = event.currentTarget as HTMLTextAreaElement;
    workbenchStore.setDraft(projectId, target.value);
  }

  function onSubmit(event: Event): void {
    event.preventDefault();
    const projectId = workbenchStore.selectedProjectId;
    if (!projectId) return;
    void workbenchStore.sendMessage(projectId, workbenchStore.selectedDraft);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const projectId = workbenchStore.selectedProjectId;
      if (!projectId) return;
      void workbenchStore.sendMessage(projectId, workbenchStore.selectedDraft);
    }
  }
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
  <!-- Message stream -->
  <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-40">
    {#if workbenchStore.selectedMessages.length === 0}
      <div
        class="flex h-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border/40 bg-card/40 px-6 py-10 text-center backdrop-blur-xl"
      >
        <Icon name="message-square" size="lg" class="text-muted-foreground/60" />
        <p class="text-sm font-medium text-foreground">{t("workbench_projectChat")}</p>
        <p class="max-w-md text-xs text-muted-foreground">
          {t("workbench_projectChatComingSoon")}
        </p>
      </div>
    {:else}
      <ul class="mx-auto flex max-w-3xl flex-col gap-3">
        {#each workbenchStore.selectedMessages as message (message.id)}
          <li
            class="rounded-2xl border border-border/40 px-4 py-3 text-sm shadow-sm backdrop-blur-xl
              {message.role === 'user'
              ? 'ml-12 bg-primary/90 text-primary-foreground border-primary/40'
              : 'mr-12 bg-card/70 text-foreground'}"
          >
            <div class="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
              {message.role === "user"
                ? t("workbench_messageYou")
                : t("workbench_messageAssistant")}
            </div>
            <p class="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </li>
        {/each}
        {#if workbenchStore.dispatching}
          <li
            class="mr-12 flex items-center gap-2 rounded-2xl border border-border/40 bg-card/70 px-4 py-3 text-sm shadow-sm backdrop-blur-xl"
          >
            <Icon name="loader-2" size="sm" class="animate-spin text-muted-foreground" />
            <span class="text-xs text-muted-foreground">{t("workbench_dispatching")}</span>
          </li>
        {/if}
      </ul>
    {/if}
  </div>

  <!-- Floating input dock -->
  <form
    class="pointer-events-none sticky bottom-4 z-10 mx-auto w-full max-w-3xl px-4"
    onsubmit={onSubmit}
  >
    <div
      class="pointer-events-auto rounded-3xl border border-border/40 bg-card/80 px-4 py-3 shadow-lg backdrop-blur-2xl transition-shadow focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
    >
      <textarea
        rows="1"
        placeholder={t("workbench_projectChatPlaceholder")}
        class="min-h-[40px] max-h-32 w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        value={workbenchStore.selectedDraft}
        oninput={onInput}
        onkeydown={onKeyDown}
        disabled={workbenchStore.dispatching}
      ></textarea>
      <div class="mt-2 flex items-center justify-between gap-3">
        <p class="truncate text-[10px] text-muted-foreground/70">
          {t("workbench_projectChatComingSoon")}
        </p>
        <button
          type="submit"
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity disabled:opacity-40 hover:bg-primary/90"
          disabled={workbenchStore.dispatching || !workbenchStore.selectedDraft.trim()}
          aria-label={t("workbench_sendMessage")}
        >
          <Icon name="arrow-right" size="sm" />
        </button>
      </div>
    </div>
  </form>
</div>
