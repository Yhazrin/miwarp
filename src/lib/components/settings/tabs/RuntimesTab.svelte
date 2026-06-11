<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Card from "$lib/components/Card.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import SettingsFieldRow from "../_shared/SettingsFieldRow.svelte";
  import SettingsFieldEnum from "../_shared/SettingsFieldEnum.svelte";
  import * as api from "$lib/api";

  interface RuntimeInfo {
    name: string;
    agent: string;
    binary: string;
    version: string | null;
    available: boolean;
    icon: string;
  }

  let runtimes = $state<RuntimeInfo[]>([]);
  let loading = $state(true);
  let mimoBinaryPath = $state("");
  let mimoProtocolMode = $state("auto");

  onMount(async () => {
    try {
      const [mimoDetect, mimoAgentSettings] = await Promise.all([
        api.detectMimoRuntime().catch(() => ({ available: false, binary: "mimo", version: null })),
        api.getAgentSettings("mimo").catch(() => null),
      ]);

      runtimes = [
        {
          name: "Claude Code",
          agent: "claude",
          binary: "claude",
          version: null,
          available: true,
          icon: "anthropic",
        },
        {
          name: "MiMo Code",
          agent: "mimo",
          binary: mimoDetect.binary,
          version: mimoDetect.version,
          available: mimoDetect.available,
          icon: "mimo",
        },
        {
          name: "Codex",
          agent: "codex",
          binary: "codex",
          version: null,
          available: false,
          icon: "openai",
        },
      ];

      if (mimoAgentSettings) {
        mimoBinaryPath = mimoAgentSettings.mimo_binary_path ?? "";
        mimoProtocolMode = mimoAgentSettings.mimo_protocol_mode ?? "auto";
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
      if (result.binary) mimoBinaryPath = result.binary;
    } finally {
      loading = false;
    }
  }

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const protocolOptions = [
    { value: "auto", label: "Auto (StreamJson)" },
    { value: "stream-json", label: "StreamJson (NDJSON)" },
    { value: "pty", label: "PTY (TUI embedded)" },
    { value: "pipe", label: "Pipe (single-shot)" },
  ];

  const agentIcons: Record<string, string> = {
    anthropic:
      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    mimo: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    openai:
      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  };
</script>

{#if loading && runtimes.length === 0}
  <div class="flex items-center justify-center py-12">
    <Spinner size="md" class="border-primary border-t-transparent" />
    <span class="ml-3 text-sm text-muted-foreground">{lk("settings_runtimes_detecting")}</span>
  </div>
{:else}
  <div class="space-y-6">
    <!-- Runtime Overview -->
    <Card class="p-6">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        {lk("settings_runtimes_overview")}
      </h2>

      <div class="space-y-3">
        {#each runtimes as runtime (runtime.agent)}
          <div
            class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-accent/40 transition-colors"
          >
            <div class="flex items-center gap-3 min-w-0">
              <!-- Status dot -->
              <div
                class="w-2 h-2 rounded-full shrink-0 {runtime.available
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/40'}"
              ></div>

              <!-- Name + binary -->
              <div class="min-w-0">
                <span class="text-sm font-medium text-foreground">{runtime.name}</span>
                {#if runtime.binary !== runtime.agent}
                  <span class="text-xs text-muted-foreground ml-2 font-mono">{runtime.binary}</span>
                {/if}
              </div>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              {#if runtime.version}
                <span class="text-xs text-muted-foreground font-mono">{runtime.version}</span>
              {/if}
              <span
                class="text-xs px-2 py-0.5 rounded-full {runtime.available
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'}"
              >
                {runtime.available
                  ? lk("settings_runtimes_available")
                  : lk("settings_runtimes_not_found")}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </Card>

    <!-- MiMo Code Configuration -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        MiMo Code
      </h2>

      <SettingsFieldRow
        label={lk("settings_runtimes_mimo_binary_path")}
        description="Leave empty for auto-detection"
      >
        {#snippet children()}
          <div class="flex items-center gap-2">
            <input
              type="text"
              class="w-48 shrink-0 rounded-md border bg-transparent px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              placeholder="auto-detect"
              value={mimoBinaryPath}
              onblur={(e) => {
                mimoBinaryPath = (e.target as HTMLInputElement).value;
                api.updateAgentSettings("mimo", {
                  mimo_binary_path: (mimoBinaryPath || undefined) as string | undefined,
                });
              }}
            />
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              onclick={detectMimo}
              disabled={loading}
            >
              {lk("settings_runtimes_detect")}
            </button>
          </div>
        {/snippet}
      </SettingsFieldRow>

      <SettingsFieldEnum
        label={lk("settings_runtimes_mimo_protocol")}
        description="Communication protocol with MiMo-Code runtime"
        value={mimoProtocolMode}
        options={protocolOptions}
        onchange={(v) => {
          mimoProtocolMode = v;
          api.updateAgentSettings("mimo", {
            mimo_protocol_mode: (v || undefined) as string | undefined,
          });
        }}
      />
    </Card>
  </div>
{/if}
