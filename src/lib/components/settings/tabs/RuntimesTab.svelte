<script lang="ts">
  /**
   * Runtimes settings tab — shows detected agent runtimes and their status.
   * Displays Claude Code, MiMo-Code, and Codex with binary paths, versions,
   * and configuration options.
   */
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Card from "$lib/components/Card.svelte";
  import * as api from "$lib/api";

  interface RuntimeInfo {
    name: string;
    binary: string;
    version: string | null;
    available: boolean;
    agent: string;
  }

  let runtimes = $state<RuntimeInfo[]>([]);
  let loading = $state(true);
  let mimoSettings = $state<{ binary_path?: string; protocol_mode?: string }>({});

  onMount(async () => {
    try {
      // Detect all runtimes in parallel
      const [mimoDetect, claudeSettings, mimoAgentSettings] = await Promise.all([
        api
          .detectMimoRuntime()
          .catch(() => ({ available: false, binary: "claude", version: null })),
        api.getAgentSettings("claude").catch(() => null),
        api.getAgentSettings("mimo").catch(() => null),
      ]);

      // Claude Code — always assumed available if MiWarp is running
      const claudeBinary = "claude";
      const claudeVersion = null; // TODO: detect claude version

      runtimes = [
        {
          name: "Claude Code",
          binary: claudeBinary,
          version: claudeVersion,
          available: true, // Claude is the primary runtime
          agent: "claude",
        },
        {
          name: "MiMo Code",
          binary: mimoDetect.binary,
          version: mimoDetect.version,
          available: mimoDetect.available,
          agent: "mimo",
        },
        {
          name: "Codex",
          binary: "codex",
          version: null,
          available: false, // Detection not implemented yet
          agent: "codex",
        },
      ];

      if (mimoAgentSettings) {
        mimoSettings = {
          binary_path: mimoAgentSettings.mimo_binary_path,
          protocol_mode: mimoAgentSettings.mimo_protocol_mode,
        };
      }
    } finally {
      loading = false;
    }
  });

  async function detectMimo() {
    loading = true;
    try {
      const result = await api.detectMimoRuntime();
      runtimes = runtimes.map((r) =>
        r.agent === "mimo"
          ? { ...r, available: result.available, binary: result.binary, version: result.version }
          : r,
      );
    } finally {
      loading = false;
    }
  }

  async function saveMimoBinaryPath(path: string) {
    mimoSettings.binary_path = path || undefined;
    await api.updateAgentSettings("mimo", {
      mimo_binary_path: (path || undefined) as string | undefined,
    });
  }

  async function saveMimoProtocolMode(mode: string) {
    mimoSettings.protocol_mode = mode || undefined;
    await api.updateAgentSettings("mimo", {
      mimo_protocol_mode: (mode || undefined) as string | undefined,
    });
  }

  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div class="runtimes-tab">
  {#if loading}
    <div class="loading-row">
      <span class="spinner"></span>
      <span>{lk("settings_runtimes_detecting")}</span>
    </div>
  {/if}

  <!-- Runtime Cards -->
  <div class="runtime-grid">
    {#each runtimes as runtime (runtime.agent)}
      <Card>
        <div class="runtime-card">
          <div class="runtime-header">
            <div
              class="runtime-icon"
              class:available={runtime.available}
              class:unavailable={!runtime.available}
            >
              {#if runtime.available}
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M5.5 8l2 2 3.5-3.5" />
                </svg>
              {:else}
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M6 6l4 4M10 6l-4 4" />
                </svg>
              {/if}
            </div>
            <div class="runtime-info">
              <h3 class="runtime-name">{runtime.name}</h3>
              <span
                class="runtime-status"
                class:available={runtime.available}
                class:unavailable={!runtime.available}
              >
                {runtime.available
                  ? lk("settings_runtimes_available")
                  : lk("settings_runtimes_not_found")}
              </span>
            </div>
          </div>

          <div class="runtime-details">
            <div class="detail-row">
              <span class="detail-label">{lk("settings_runtimes_binary")}</span>
              <code class="detail-value">{runtime.binary}</code>
            </div>
            {#if runtime.version}
              <div class="detail-row">
                <span class="detail-label">{lk("settings_runtimes_version")}</span>
                <code class="detail-value">{runtime.version}</code>
              </div>
            {/if}
          </div>
        </div>
      </Card>
    {/each}
  </div>

  <!-- MiMo Configuration -->
  {#if runtimes.find((r) => r.agent === "mimo")}
    <Card>
      <div class="config-section">
        <h3 class="section-title">{lk("settings_runtimes_mimo_config")}</h3>

        <div class="config-row">
          <label class="config-label" for="mimo-binary"
            >{lk("settings_runtimes_mimo_binary_path")}</label
          >
          <div class="config-input-row">
            <input
              id="mimo-binary"
              type="text"
              class="config-input"
              placeholder="auto-detect"
              value={mimoSettings.binary_path ?? ""}
              onblur={(e) => saveMimoBinaryPath((e.target as HTMLInputElement).value)}
            />
            <button class="btn-secondary" onclick={detectMimo} disabled={loading}>
              {lk("settings_runtimes_detect")}
            </button>
          </div>
        </div>

        <div class="config-row">
          <label class="config-label" for="mimo-protocol"
            >{lk("settings_runtimes_mimo_protocol")}</label
          >
          <select
            id="mimo-protocol"
            class="config-select"
            value={mimoSettings.protocol_mode ?? "auto"}
            onchange={(e) => saveMimoProtocolMode((e.target as HTMLSelectElement).value)}
          >
            <option value="auto">{lk("settings_runtimes_protocol_auto")}</option>
            <option value="stream-json">{lk("settings_runtimes_protocol_streamjson")}</option>
            <option value="pty">{lk("settings_runtimes_protocol_pty")}</option>
            <option value="pipe">{lk("settings_runtimes_protocol_pipe")}</option>
          </select>
        </div>
      </div>
    </Card>
  {/if}
</div>

<style>
  .runtimes-tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .loading-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .runtime-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .runtime-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .runtime-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .runtime-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .runtime-icon.available {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .runtime-icon.unavailable {
    background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
    color: var(--text-tertiary);
  }

  .runtime-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .runtime-name {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
  }

  .runtime-status {
    font-size: 0.75rem;
    font-weight: 500;
  }

  .runtime-status.available {
    color: var(--accent);
  }

  .runtime-status.unavailable {
    color: var(--text-tertiary);
  }

  .runtime-details {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8125rem;
  }

  .detail-label {
    color: var(--text-secondary);
  }

  .detail-value {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    background: var(--bg-secondary);
    border-radius: 4px;
    color: var(--text-primary);
  }

  .config-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
  }

  .config-row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .config-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .config-input-row {
    display: flex;
    gap: 0.5rem;
  }

  .config-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    font-family: var(--font-mono);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  .config-input:focus {
    border-color: var(--accent);
  }

  .config-select {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
  }

  .btn-secondary {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-weight: 500;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-tertiary);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
