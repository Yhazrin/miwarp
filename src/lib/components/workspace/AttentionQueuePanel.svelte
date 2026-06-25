<script lang="ts">
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
  import type { AttentionAction, AttentionItem } from "$lib/types/attention-queue";

  let {
    compact = false,
  }: {
    compact?: boolean;
  } = $props();

  let actingId = $state<string | null>(null);
  let refreshing = $state(false);

  const pendingItems = $derived([
    ...attentionQueueStore.openItems,
    ...attentionQueueStore.acknowledgedItems,
  ]);

  function kindLabel(kind: AttentionItem["kind"]): string {
    return t(`attention_kind_${kind}`);
  }

  function actionLabel(action: AttentionAction): string {
    return t(`attention_action_${action}`);
  }

  function severityClass(item: AttentionItem): string {
    return item.severity === "blocking"
      ? "border-miwarp-status-warning/40 bg-miwarp-status-warning/10"
      : "border-border/60 bg-muted/30";
  }

  async function refreshQueue(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await attentionQueueStore.reconcile();
      await attentionQueueStore.loadSnapshot();
      await attentionQueueStore.loadEvents();
    } finally {
      refreshing = false;
    }
  }

  async function handleAck(item: AttentionItem): Promise<void> {
    actingId = item.id;
    try {
      await attentionQueueStore.acknowledge(item.id);
    } finally {
      actingId = null;
    }
  }

  async function handleResolve(item: AttentionItem, action: AttentionAction): Promise<void> {
    actingId = item.id;
    try {
      await attentionQueueStore.resolve(item.id, action);
    } finally {
      actingId = null;
    }
  }

  function openRun(item: AttentionItem): void {
    if (!item.run_id) return;
    void goto(`/chat?run=${encodeURIComponent(item.run_id)}`);
  }
</script>

<section
  class="border-b border-border {compact ? 'mx-0' : 'mx-6 mt-4'} rounded-xl border bg-card/40"
  aria-label={t("attention_queue_title")}
>
  <div class="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
    <div>
      <h2 class="text-sm font-semibold text-foreground">{t("attention_queue_title")}</h2>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("attention_queue_subtitle")}</p>
    </div>
    <div class="flex items-center gap-2">
      {#if pendingItems.length > 0}
        <span
          class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-miwarp-status-warning/20 px-1.5 py-0.5 text-[11px] font-semibold text-miwarp-status-warning"
        >
          {pendingItems.length}
        </span>
      {/if}
      <button
        type="button"
        class="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
        disabled={refreshing}
        onclick={() => void refreshQueue()}
      >
        {refreshing ? t("common_loading") : t("attention_queue_refresh")}
      </button>
    </div>
  </div>

  {#if pendingItems.length === 0}
    <p class="px-4 py-4 text-xs text-muted-foreground">{t("attention_queue_empty")}</p>
  {:else}
    <ul class="divide-y divide-border/50">
      {#each pendingItems as item (item.id)}
        <li class="px-4 py-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide {severityClass(
                    item,
                  )}"
                >
                  {kindLabel(item.kind)}
                </span>
                {#if item.status === "acknowledged"}
                  <span class="text-[10px] text-muted-foreground"
                    >{t("attention_status_acknowledged")}</span
                  >
                {/if}
              </div>
              <p class="mt-1 text-sm font-medium text-foreground">{item.title}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-1.5">
              {#if item.run_id}
                <button
                  type="button"
                  class="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted/50"
                  onclick={() => openRun(item)}
                >
                  {t("attention_queue_open_session")}
                </button>
              {/if}
              {#if item.status === "open" && item.allowed_actions.includes("acknowledge")}
                <button
                  type="button"
                  class="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted/50 disabled:opacity-50"
                  disabled={actingId === item.id}
                  onclick={() => void handleAck(item)}
                >
                  {actionLabel("acknowledge")}
                </button>
              {/if}
              {#each item.allowed_actions.filter((action) => action !== "acknowledge" && action !== "source_cleared") as action (action)}
                <button
                  type="button"
                  class="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  disabled={actingId === item.id}
                  onclick={() => void handleResolve(item, action)}
                >
                  {actionLabel(action)}
                </button>
              {/each}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
