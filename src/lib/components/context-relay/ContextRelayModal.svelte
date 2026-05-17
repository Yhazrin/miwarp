<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { contextRelayStore } from "$lib/context-relay/context-relay-store.svelte";
  import ContextClipCard from "./ContextClipCard.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let instructions = $state("");

  // Sync instructions with store
  $effect(() => {
    instructions = contextRelayStore.additionalInstructions;
  });

  function handleInstructionsChange(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    contextRelayStore.setInstructions(target.value);
  }

  function handleSearchChange(e: Event) {
    const target = e.target as HTMLInputElement;
    contextRelayStore.setSearchQuery(target.value);
  }

  async function handleSendToCurrent() {
    const result = await contextRelayStore.relayToCurrent();
    if (result.success) {
      setTimeout(() => contextRelayStore.closeModal(), 800);
    }
  }

  async function handleSendToNew() {
    const result = await contextRelayStore.relayToNewSession();
    if (result.success) {
      setTimeout(() => contextRelayStore.closeModal(), 800);
    }
  }

  async function handleSendToSession(runId: string) {
    const result = await contextRelayStore.relayToSession(runId);
    if (result.success) {
      setTimeout(() => contextRelayStore.closeModal(), 800);
    }
  }

  function handleClose() {
    contextRelayStore.closeModal();
  }

  const filteredTargets = $derived(contextRelayStore.getFilteredTargets());
</script>

{#if contextRelayStore.open}
  <Modal
    open={true}
    size="lg"
    noPadding
    title={t("contextRelay_title") || "Send to Session"}
    onclose={handleClose}
  >
    <!-- Content -->
    <div class="max-h-[85vh] overflow-y-auto space-y-4 px-5 py-4">
      {#if contextRelayStore.clip}
        <!-- Clip preview -->
        <div>
          <h3 class="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("contextRelay_preview") || "Content"}
          </h3>
          <ContextClipCard clip={contextRelayStore.clip} compact />
        </div>

        <!-- Search sessions -->
        <div>
          <h3 class="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("contextRelay_sendTo") || "Send To"}
          </h3>

          <!-- Search input -->
          <div class="relative mb-2">
            <svg
              class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              class="w-full rounded-lg border border-border/50 bg-background/50 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={t("contextRelay_searchPlaceholder") || "Search sessions..."}
              value={contextRelayStore.searchQuery}
              oninput={handleSearchChange}
            />
          </div>

          <div class="space-y-1.5 max-h-64 overflow-y-auto">
            <!-- Current session -->
            {#if contextRelayStore.currentRunId}
              <button
                class="w-full flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
                onclick={() => handleSendToCurrent()}
                disabled={contextRelayStore.sending}
              >
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15"
                >
                  <svg
                    class="h-3.5 w-3.5 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-foreground">
                    {t("contextRelay_currentSession") || "Current Session"}
                  </div>
                  <div class="text-[10px] text-muted-foreground truncate">
                    {contextRelayStore.currentCwd}
                  </div>
                </div>
                <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  Active
                </span>
              </button>
            {/if}

            <!-- New session -->
            <button
              class="w-full flex items-center gap-3 rounded-lg border border-border/50 bg-background/30 px-3 py-2.5 text-left transition-colors hover:bg-accent/20"
              onclick={() => handleSendToNew()}
              disabled={contextRelayStore.sending}
            >
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500/15"
              >
                <svg
                  class="h-3.5 w-3.5 text-green-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-foreground">
                  {t("contextRelay_newSession") || "New Session"}
                </div>
                <div class="text-[10px] text-muted-foreground truncate">
                  {contextRelayStore.currentCwd}
                </div>
              </div>
            </button>

            <!-- Session list -->
            {#if contextRelayStore.loading}
              <div class="py-4 text-center text-xs text-muted-foreground">
                {t("common_loading") || "Loading..."}
              </div>
            {:else if filteredTargets.length === 0}
              <div class="py-4 text-center text-xs text-muted-foreground">
                {contextRelayStore.searchQuery
                  ? t("contextRelay_noResults") || "No matching sessions"
                  : t("contextRelay_noRecentSessions") || "No recent sessions"}
              </div>
            {:else}
              {#each filteredTargets as target (target.id)}
                <button
                  class="w-full flex items-center gap-3 rounded-lg border border-border/30 bg-background/20 px-3 py-2 text-left transition-colors hover:bg-accent/15"
                  onclick={() => handleSendToSession(target.id)}
                  disabled={contextRelayStore.sending}
                >
                  <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    <svg
                      class="h-3.5 w-3.5 text-muted-foreground"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-foreground truncate">
                      {target.name || target.prompt?.slice(0, 50) || "Untitled"}
                    </div>
                    <div class="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span>{target.agent}</span>
                      <span>&middot;</span>
                      <span>{target.status}</span>
                      {#if target.cwd}
                        <span>&middot;</span>
                        <span class="truncate">{target.cwd}</span>
                      {/if}
                    </div>
                  </div>
                </button>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Additional instructions -->
        <div>
          <h3 class="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("contextRelay_addInstructions") || "Instructions"}
            <span class="font-normal normal-case tracking-normal text-muted-foreground/60">
              ({t("common_optional")})
            </span>
          </h3>
          <textarea
            class="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            rows="2"
            placeholder={t("contextRelay_instructionsPlaceholder") ||
              "Add context or instructions..."}
            value={instructions}
            oninput={handleInstructionsChange}
          ></textarea>
        </div>
      {/if}
    </div>

    <!-- Footer with result -->
    {#if contextRelayStore.lastResult}
      <div
        class="px-5 py-3 border-t border-border/30 {contextRelayStore.lastResult.success
          ? 'bg-green-500/10'
          : 'bg-red-500/10'}"
      >
        {#if contextRelayStore.lastResult.success}
          <div class="flex items-center gap-2 text-sm text-green-500">
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{t("contextRelay_success") || "Sent successfully!"}</span>
          </div>
        {:else}
          <div class="flex items-center gap-2 text-sm text-red-500">
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              {contextRelayStore.lastResult.error || t("contextRelay_error") || "Failed to send"}
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}
