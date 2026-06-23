<script lang="ts">
  /**
   * Fleet View — digital employee dashboard (v1.2.0).
   *
   * Renders a responsive grid of fleet member cards with:
   * - Top header: status counts + metrics
   * - Filters bar: status / agent / search
   * - Live updates via the fleet-store's WS subscription
   *
   * Per CLAUDE.md "高内聚低耦合": this page owns the layout, defers all
   * data + state to `fleetStore`. No direct API calls.
   */
  import { onMount, onDestroy } from "svelte";
  import { fleetStore } from "$lib/stores/fleet-store.svelte";
  import { t, tRaw } from "$lib/i18n/index.svelte";
  import * as api from "$lib/api";

  onMount(async () => {
    await fleetStore.refresh();
    try {
      const status = await api.getWebServerStatus();
      if (status.running && status.port) {
        const token = await api.getWebServerToken();
        if (token) {
          fleetStore.connectLiveUpdates(token, status.port);
        }
      }
    } catch {
      // Web server not running — live updates disabled, REST still works.
    }
  });

  onDestroy(() => {
    fleetStore.disconnect();
  });
</script>

<div class="fleet-view">
  <header class="fleet-header">
    <h1>{t("fleet_title")}</h1>
    {#if fleetStore.metrics}
      <div class="metrics">
        <span class="metric-total">{fleetStore.metrics.total} {t("fleet_total")}</span>
        {#each Object.entries(fleetStore.statusCounts) as [status, count]}
          <span class="metric-chip metric-{status}">
            {tRaw("fleet_status_" + status)}: {count}
          </span>
        {/each}
      </div>
    {/if}
    <button class="refresh-btn" onclick={() => fleetStore.refresh()} disabled={fleetStore.loading}>
      {fleetStore.loading ? t("fleet_refreshing") : t("fleet_refresh")}
    </button>
  </header>

  <div class="filters">
    <label>
      {t("fleet_filter_status")}
      <select bind:value={fleetStore.filters.status}>
        <option value="all">{t("fleet_filter_all")}</option>
        <option value="running">{t("fleet_status_running")}</option>
        <option value="idle">{t("fleet_status_idle")}</option>
        <option value="awaiting_permission">{t("fleet_status_awaiting_permission")}</option>
        <option value="error">{t("fleet_status_error")}</option>
        <option value="stopped">{t("fleet_status_stopped")}</option>
        <option value="detached">{t("fleet_status_detached")}</option>
      </select>
    </label>
    <label>
      {t("fleet_filter_agent")}
      <select bind:value={fleetStore.filters.agent}>
        <option value="all">{t("fleet_filter_all")}</option>
        {#each fleetStore.availableAgents as agent}
          <option value={agent}>{agent}</option>
        {/each}
      </select>
    </label>
    <input
      type="search"
      placeholder={t("fleet_filter_search")}
      bind:value={fleetStore.filters.search}
    />
    <button onclick={() => fleetStore.resetFilters()}>
      {t("fleet_filter_reset")}
    </button>
  </div>

  {#if fleetStore.error}
    <div class="error">{fleetStore.error}</div>
  {/if}

  <div class="member-grid">
    {#each fleetStore.filteredMembers as member (member.id)}
      <button
        class="member-card member-{member.status}"
        onclick={() => (fleetStore.selectedMemberId = member.id)}
      >
        <div class="card-header">
          <span class="agent-badge">{member.agent}</span>
          <span class="status-dot status-{member.status}"></span>
        </div>
        <div class="card-cwd" title={member.cwd}>{member.cwd}</div>
        {#if member.currentTaskPreview}
          <div class="card-task">"{member.currentTaskPreview}"</div>
        {/if}
        <div class="card-meta">
          <span>{member.metrics.uptimeSecs}s</span>
          <span>{member.metrics.messageCount} {t("fleet_messages")}</span>
        </div>
      </button>
    {:else}
      <div class="empty">{t("fleet_empty")}</div>
    {/each}
  </div>

  {#if fleetStore.selectedMemberId}
    {@const selected = fleetStore.members.find((m) => m.id === fleetStore.selectedMemberId)}
    {#if selected}
      <aside class="detail-drawer">
        <header>
          <h2>{selected.id}</h2>
          <button onclick={() => (fleetStore.selectedMemberId = null)}>×</button>
        </header>
        <dl>
          <dt>{t("fleet_field_agent")}</dt>
          <dd>{selected.agent}</dd>
          <dt>{t("fleet_field_status")}</dt>
          <dd>{tRaw("fleet_status_" + selected.status)}</dd>
          <dt>{t("fleet_field_cwd")}</dt>
          <dd>{selected.cwd}</dd>
          <dt>{t("fleet_field_model")}</dt>
          <dd>{selected.model ?? "—"}</dd>
          <dt>{t("fleet_field_uptime")}</dt>
          <dd>{selected.metrics.uptimeSecs}s</dd>
        </dl>
        <div class="actions">
          <button onclick={() => fleetStore.stopMember(selected.id)}>
            {t("fleet_action_stop")}
          </button>
        </div>
      </aside>
    {/if}
  {/if}
</div>

<style>
  .fleet-view {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .fleet-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .fleet-header h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  .metrics {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .metric-total,
  .metric-chip {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: var(--surface-2, #1a1a1a);
    font-size: 0.85rem;
  }
  .metric-running {
    color: #4ade80;
  }
  .metric-idle {
    color: #94a3b8;
  }
  .metric-error {
    color: #f87171;
  }
  .metric-stopped {
    color: #475569;
  }
  .refresh-btn {
    margin-left: auto;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border, #333);
    background: var(--surface-2, #1a1a1a);
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
  }
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .filters {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    align-items: center;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    color: var(--text-2, #aaa);
  }
  .filters select,
  .filters input {
    padding: 0.4rem;
    border: 1px solid var(--border, #333);
    background: var(--surface-2, #1a1a1a);
    color: inherit;
    border-radius: 4px;
  }
  .member-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
  }
  .member-card {
    text-align: left;
    padding: 0.75rem;
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    background: var(--surface-1, #141414);
    color: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .member-card:hover {
    border-color: var(--accent, #3b82f6);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .agent-badge {
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    background: var(--surface-3, #222);
    border-radius: 3px;
    text-transform: uppercase;
  }
  .status-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }
  .status-running {
    background: #4ade80;
  }
  .status-idle {
    background: #94a3b8;
  }
  .status-awaiting_permission {
    background: #fbbf24;
  }
  .status-error {
    background: #f87171;
  }
  .status-stopped {
    background: #475569;
  }
  .status-detached {
    background: #1e293b;
  }
  .card-cwd {
    font-size: 0.75rem;
    color: var(--text-2, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-task {
    font-size: 0.85rem;
    color: var(--text-1, #ddd);
    font-style: italic;
  }
  .card-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: var(--text-3, #666);
  }
  .empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2rem;
    color: var(--text-2, #888);
  }
  .error {
    padding: 0.75rem;
    background: #7f1d1d33;
    border: 1px solid #f87171;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  .detail-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    max-width: 90vw;
    height: 100vh;
    background: var(--surface-1, #141414);
    border-left: 1px solid var(--border, #333);
    padding: 1.5rem;
    overflow-y: auto;
  }
  .detail-drawer header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .detail-drawer header button {
    background: none;
    border: none;
    color: inherit;
    font-size: 1.5rem;
    cursor: pointer;
  }
  .detail-drawer dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .detail-drawer dt {
    color: var(--text-2, #888);
  }
  .detail-drawer .actions {
    margin-top: 1.5rem;
    display: flex;
    gap: 0.5rem;
  }
  .detail-drawer .actions button {
    padding: 0.5rem 1rem;
    background: #7f1d1d;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
