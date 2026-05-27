<script lang="ts">
  import type { McpServerInfo } from "$lib/types";
  import * as api from "$lib/api";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";
  import { statusDotClass, statusLabel, parseServersFromResponse } from "$lib/utils/mcp";
  import { relativeTime } from "$lib/utils/format";

  let {
    runId,
    mcpServers,
    sessionAlive = false,
    onClose,
    onServersUpdate,
  }: {
    runId: string;
    mcpServers: McpServerInfo[];
    sessionAlive?: boolean;
    onClose: () => void;
    onServersUpdate?: (servers: McpServerInfo[]) => void;
  } = $props();

  // Health monitoring state
  interface ServerHealth {
    name: string;
    latency: number | null;
    latencyHistory: number[];
    errorCount: number;
    lastError: string | null;
    lastSuccess: string | null;
    isHealthy: boolean;
  }

  let loading = $state(false);
  let togglingServer = $state<string | null>(null);
  let servers = $state<McpServerInfo[]>([]);
  let error = $state("");
  let successMsg = $state("");
  let expandedServer = $state<string | null>(null);

  // Health metrics per server
  let healthMetrics = $state<Record<string, ServerHealth>>({});

  // Sync from prop when it changes
  $effect(() => {
    servers = [...mcpServers];

    // Initialize health metrics for new servers
    for (const server of mcpServers) {
      if (!healthMetrics[server.name]) {
        healthMetrics[server.name] = {
          name: server.name,
          latency: null,
          latencyHistory: [],
          errorCount: 0,
          lastError: server.error || null,
          lastSuccess: server.status === "running" ? new Date().toISOString() : null,
          isHealthy: server.status === "running",
        };
      }
    }
  });

  /**
   * Update health metrics when server status changes
   */
  function updateHealthMetrics(serverName: string, status: string, errorMsg?: string) {
    const current = healthMetrics[serverName] || {
      name: serverName,
      latency: null,
      latencyHistory: [],
      errorCount: 0,
      lastError: null,
      lastSuccess: null,
      isHealthy: false,
    };

    if (status === "running") {
      healthMetrics[serverName] = {
        ...current,
        isHealthy: true,
        lastSuccess: new Date().toISOString(),
        lastError: errorMsg || null,
      };
    } else if (status === "failed" || status === "error") {
      healthMetrics[serverName] = {
        ...current,
        isHealthy: false,
        errorCount: current.errorCount + 1,
        lastError: errorMsg || "Unknown error",
      };
    }

    healthMetrics = { ...healthMetrics };
  }

  /**
   * Get connection quality based on latency
   */
  function getConnectionQuality(latency: number | null): {
    label: string;
    color: string;
    icon: string;
  } {
    if (latency === null) return { label: "Unknown", color: "text-muted-foreground", icon: "⚪" };
    if (latency < 50) return { label: "Excellent", color: "text-green-600", icon: "🟢" };
    if (latency < 100) return { label: "Good", color: "text-emerald-600", icon: "🟢" };
    if (latency < 200) return { label: "Fair", color: "text-yellow-600", icon: "🟡" };
    if (latency < 500) return { label: "Poor", color: "text-orange-600", icon: "🟠" };
    return { label: "Critical", color: "text-red-600", icon: "🔴" };
  }

  async function refresh() {
    if (!sessionAlive) return;
    loading = true;
    error = "";
    try {
      dbg("mcp", "refresh", { runId });
      const response = await api.getMcpStatus(runId);
      const updated = parseServersFromResponse(response);
      if (updated.length > 0) {
        servers = updated;
        onServersUpdate?.(updated);

        // Update health metrics
        for (const server of updated) {
          updateHealthMetrics(server.name, server.status, server.error);
        }
      }
    } catch (e) {
      dbgWarn("mcp", "refresh failed", e);
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function reconnect(serverName: string) {
    if (!sessionAlive) return;
    loading = true;
    error = "";
    try {
      dbg("mcp", "reconnect", { runId, serverName });
      const startTime = Date.now();
      await api.reconnectMcpServer(runId, serverName);
      const latency = Date.now() - startTime;

      // Update health with latency
      healthMetrics[serverName] = {
        ...(healthMetrics[serverName] || { name: serverName }),
        latency,
        latencyHistory: [...(healthMetrics[serverName]?.latencyHistory || []), latency].slice(-10),
        lastSuccess: new Date().toISOString(),
        isHealthy: true,
      };
      healthMetrics = { ...healthMetrics };

      await refresh();
    } catch (e) {
      dbgWarn("mcp", "reconnect failed", e);
      updateHealthMetrics(serverName, "failed", String(e));
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function toggle(serverName: string, currentlyEnabled: boolean) {
    togglingServer = serverName;
    error = "";
    successMsg = "";
    const newEnabled = !currentlyEnabled;

    const server = servers.find((s) => s.name === serverName);
    const scope = server?.scope ?? "user";

    try {
      dbg("mcp", "toggle broadcast", { serverName, enabled: newEnabled });
      const sent = await api.broadcastMcpToggle(serverName, newEnabled);
      dbg("mcp", "toggle broadcast sent to sessions", { count: sent });

      dbg("mcp", "toggle config", { serverName, enabled: newEnabled, scope });
      const result = await api.toggleMcpServerConfig(serverName, newEnabled, scope);
      if (result.success) {
        successMsg = result.message;
        setTimeout(() => (successMsg = ""), 3000);
      } else {
        error = result.message;
      }

      servers = servers.map((s) =>
        s.name === serverName ? { ...s, status: newEnabled ? "pending" : "disabled" } : s,
      );
      onServersUpdate?.(servers);

      updateHealthMetrics(serverName, newEnabled ? "pending" : "disabled");
    } catch (e) {
      dbgWarn("mcp", "toggle failed", e);
      updateHealthMetrics(serverName, "failed", String(e));
      error = String(e);
    } finally {
      togglingServer = null;
    }
  }

  /**
   * Toggle expanded view for server details
   */
  function toggleExpand(serverName: string) {
    expandedServer = expandedServer === serverName ? null : serverName;
  }

  /**
   * Get average latency from history
   */
  function getAverageLatency(history: number[]): number | null {
    if (history.length === 0) return null;
    return Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  }
</script>

/** * McpStatusPanel - Enhanced MCP server status panel with health monitoring * * Features: * -
Real-time health monitoring with latency display * - Connection quality indicators * - Error
diagnostics and history * - Quick reconnect with health check */
<div class="rounded-lg border border-border bg-background shadow-lg w-96 animate-fade-in">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border">
    <div class="flex items-center gap-2">
      <span class="text-xs font-semibold text-foreground">{t("mcp_serversTitle")}</span>
      {#if servers.length > 0}
        {@const healthyCount = servers.filter((s) => s.status === "running").length}
        <span class="text-[10px] text-muted-foreground">
          ({healthyCount}/{servers.length})
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        disabled={loading || !sessionAlive}
        onclick={refresh}
        title={t("mcp_refreshStatus")}
      >
        <svg
          class="h-3.5 w-3.5 {loading ? 'animate-spin' : ''}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      </button>
      <button
        class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        onclick={onClose}
        title={t("common_close")}
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Server list -->
  <div class="max-h-80 overflow-y-auto">
    {#if servers.length === 0}
      <div class="px-3 py-4 text-center text-xs text-muted-foreground">
        {t("mcp_noConfiguredStatus")}
      </div>
    {:else}
      {#each servers as server}
        {@const health = healthMetrics[server.name]}
        {@const quality = getConnectionQuality(health?.latency || null)}
        <div class="border-b border-border/50 last:border-b-0">
          <!-- Main row -->
          <div class="flex items-center gap-2 px-3 py-2">
            <!-- Expand toggle -->
            <button
              onclick={() => toggleExpand(server.name)}
              aria-label="Toggle server details"
              class="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg
                class="h-3 w-3 transition-transform {expandedServer === server.name
                  ? 'rotate-90'
                  : ''}"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>

            <!-- Status dot with quality indicator -->
            <div class="relative">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full {statusDotClass(server.status)}"
              ></span>
              {#if server.status === "running" && health?.latency}
                <span class="absolute -top-0.5 -right-0.5 text-[8px]">{quality.icon}</span>
              {/if}
            </div>

            <!-- Name + status -->
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-foreground truncate">{server.name}</div>
              <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{statusLabel(server.status)}</span>
                {#if health?.latency}
                  <span class="text-muted-foreground/70">·</span>
                  <span class={quality.color}>{health.latency}ms</span>
                {/if}
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0">
              {#if sessionAlive && (server.status === "failed" || server.status === "needs-auth")}
                <button
                  class="rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 hover:text-foreground hover:bg-accent border border-border/50 transition-colors disabled:opacity-50"
                  disabled={loading}
                  onclick={() => reconnect(server.name)}
                >
                  {t("mcp_reconnect")}
                </button>
              {/if}
              <button
                class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 {server.status ===
                'disabled'
                  ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30'
                  : 'text-foreground/70 hover:text-foreground hover:bg-accent border border-border/50'}"
                disabled={togglingServer === server.name}
                onclick={() => toggle(server.name, server.status !== "disabled")}
              >
                {#if togglingServer === server.name}
                  <span class="flex items-center gap-1">
                    <span
                      class="h-2.5 w-2.5 border border-current/30 border-t-current rounded-full animate-spin"
                    ></span>
                  </span>
                {:else}
                  {server.status === "disabled" ? t("mcp_enable") : t("mcp_disable")}
                {/if}
              </button>
            </div>
          </div>

          <!-- Expanded details -->
          {#if expandedServer === server.name}
            <div class="px-3 pb-3 pl-8 space-y-2 text-[10px]">
              {#if server.error}
                <div class="p-2 rounded bg-destructive/10 border border-destructive/20">
                  <div class="font-medium text-destructive mb-0.5">{t('mcpStatus_error')}</div>
                  <div class="text-destructive/80 font-mono">{server.error}</div>
                </div>
              {/if}

              {#if health}
                <!-- Latency chart -->
                {#if health.latencyHistory.length > 1}
                  <div class="space-y-1">
                    <div class="text-muted-foreground uppercase tracking-wider">
                      {t('mcpStatus_latencyHistory')}
                    </div>
                    <div class="flex items-end gap-0.5 h-6">
                      {#each health.latencyHistory as latency, _i}
                        {@const maxLatency = Math.max(...health.latencyHistory)}
                        {@const height = maxLatency > 0 ? (latency / maxLatency) * 24 : 0}
                        <div
                          class="w-2 rounded-t transition-all {latency < 100
                            ? 'bg-green-500'
                            : latency < 300
                              ? 'bg-yellow-500'
                              : 'bg-red-500'}"
                          style="height: {Math.max(2, height)}px"
                          title="{latency}ms"
                        ></div>
                      {/each}
                    </div>
                    <div class="flex justify-between text-muted-foreground/70">
                      <span>Avg: {getAverageLatency(health.latencyHistory) || "N/A"}ms</span>
                      <span>Current: {health.latency || "N/A"}ms</span>
                    </div>
                  </div>
                {/if}

                <!-- Connection stats -->
                <div class="grid grid-cols-2 gap-2">
                  <div class="p-1.5 rounded bg-muted/30">
                    <div class="text-muted-foreground">Last Success</div>
                    <div class="font-medium">
                      {health.lastSuccess ? relativeTime(health.lastSuccess) : "Never"}
                    </div>
                  </div>
                  <div class="p-1.5 rounded bg-muted/30">
                    <div class="text-muted-foreground">Errors</div>
                    <div class="font-medium {health.errorCount > 0 ? 'text-destructive' : ''}">
                      {health.errorCount}
                    </div>
                  </div>
                </div>

                <!-- Quality indicator -->
                {#if health.latency !== null}
                  <div class="flex items-center justify-between p-1.5 rounded bg-muted/30">
                    <span class="text-muted-foreground">Connection Quality</span>
                    <span class="{quality.color} font-medium">
                      {quality.icon}
                      {quality.label}
                    </span>
                  </div>
                {/if}
              {/if}

              <!-- Server info -->
              {#if server.scope}
                <div class="text-muted-foreground">
                  Scope: <span class="font-medium text-foreground">{server.scope}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Success message -->
  {#if successMsg}
    <div
      class="px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400"
    >
      {successMsg}
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <div class="px-3 py-2 border-t border-destructive/20 bg-destructive/5 text-xs text-destructive">
      {error}
    </div>
  {/if}

  <!-- Footer note -->
  {#if !sessionAlive && servers.length > 0}
    <div class="px-3 py-2 border-t border-border/50 text-[10px] text-muted-foreground">
      {t("mcp_sessionInactive")}
    </div>
  {/if}
</div>
