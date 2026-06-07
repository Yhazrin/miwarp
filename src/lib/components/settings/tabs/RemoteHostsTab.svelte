<script lang="ts">
  /**
   * v1.0.6 follow-up: remote hosts tab shell. Receives state via
   * props. The full SSH host CRUD + key wizard form is delegated to
   * the orchestrator's callbacks; this component is the layout
   * skeleton. SSH key wizard extraction is tracked in follow-up.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { RemoteHost } from "$lib/types";
  import Card from "$lib/components/Card.svelte";

  let {
    remoteHosts = [] as RemoteHost[],
    editingRemote = null as RemoteHost | null,
    onStartEdit = (_host: RemoteHost | null) => {},
    onDeleteHost = async (_name: string) => {},
  }: {
    remoteHosts?: RemoteHost[];
    editingRemote?: RemoteHost | null;
    onStartEdit?: (host: RemoteHost | null) => void;
    onDeleteHost?: (name: string) => Promise<void>;
  } = $props();
  function lk(key: string): string { return t(key as MessageKey); }

</script>

<Card class="p-6 space-y-5">
  <div class="flex items-start justify-between">
    <div>
      <p class="text-sm font-medium">{lk("settings_remote_title")}</p>
      <p class="text-xs text-muted-foreground mt-0.5">{lk("settings_remote_desc")}</p>
    </div>
    <button
      type="button"
      class="rounded-md border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
      onclick={() => onStartEdit(null)}
    >
      {lk("settings_remote_add")}
    </button>
  </div>

  {#if remoteHosts.length === 0}
    <p class="text-sm text-muted-foreground italic">{lk("settings_remote_empty")}</p>
  {:else}
    <div class="divide-y divide-border/50 -mx-3 px-3">
      {#each remoteHosts as host (host.name)}
        <div class="flex items-center gap-3 py-2 group">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{host.name}</p>
            <p class="text-xs text-muted-foreground truncate">
              {host.user}@{host.host}:{host.port}
            </p>
          </div>
          <button
            type="button"
            class="rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
            onclick={() => onStartEdit(host)}
          >
            {lk("settings_remote_edit")}
          </button>
          <button
            type="button"
            class="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
            onclick={() => onDeleteHost(host.name)}
          >
            {lk("settings_remote_delete")}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</Card>
