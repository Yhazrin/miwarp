<script lang="ts">
  /**
   * MobileConnectionDiagnosticsDialog — Connection status and diagnostics.
   * Shows server health, connected clients, latency, and troubleshooting tips.
   * Uses MiDialog for narrow-screen safe display.
   */
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import { t as _t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  type DiagnosticEntry = {
    label: string;
    value: string;
    status: "ok" | "warning" | "error" | "info";
  };

  let {
    open = $bindable(false),
    diagnostics = [],
    connectedClients = 0,
    serverUptime = "",
    onClose,
  }: {
    open?: boolean;
    diagnostics?: DiagnosticEntry[];
    connectedClients?: number;
    serverUptime?: string;
    onClose?: () => void;
  } = $props();

  const statusColors: Record<string, string> = {
    ok: "text-miwarp-status-success",
    warning: "text-miwarp-status-warning",
    error: "text-miwarp-status-error",
    info: "text-muted-foreground",
  };

  const statusIcons: Record<string, import("$lib/lucide-icon").LucideIconName> = {
    ok: "check",
    warning: "triangle-alert",
    error: "x",
    info: "circle",
  };
</script>

<MiDialog bind:open size="sm" title="Connection Diagnostics" {onClose}>
  <div class="space-y-4">
    <!-- Summary -->
    <div class="flex items-center justify-between rounded-lg border border-border/30 p-3">
      <div class="flex items-center gap-2">
        <Icon name="monitor" size="sm" class="text-muted-foreground" />
        <span class="text-sm">Connected Clients</span>
      </div>
      <span class="font-mono text-sm font-medium">{connectedClients}</span>
    </div>

    {#if serverUptime}
      <div class="flex items-center justify-between rounded-lg border border-border/30 p-3">
        <div class="flex items-center gap-2">
          <Icon name="clock" size="sm" class="text-muted-foreground" />
          <span class="text-sm">Uptime</span>
        </div>
        <span class="font-mono text-xs text-muted-foreground">{serverUptime}</span>
      </div>
    {/if}

    <!-- Diagnostics list -->
    {#if diagnostics.length > 0}
      <div class="space-y-2">
        {#each diagnostics as entry (entry.label)}
          <div class="flex items-start gap-2 rounded-lg border border-border/20 p-2.5">
            <Icon
              name={statusIcons[entry.status] || "info"}
              size="xs"
              class="mt-0.5 shrink-0 {statusColors[entry.status]}"
            />
            <div class="min-w-0 flex-1">
              <span class="block text-xs font-medium">{entry.label}</span>
              <span class="mt-0.5 block text-[10px] text-muted-foreground">{entry.value}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-center text-sm text-muted-foreground">No diagnostics available</p>
    {/if}
  </div>
</MiDialog>
