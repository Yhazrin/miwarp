<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Card from "$lib/components/Card.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import SettingsFieldRow from "../_shared/SettingsFieldRow.svelte";
  import SettingsFieldEnum from "../_shared/SettingsFieldEnum.svelte";
  import RuntimeControlCenter from "$lib/components/runtime/RuntimeControlCenter.svelte";
  import { runtimeHubStore } from "$lib/stores/runtime-hub-store.svelte";
  import { isStartableRuntime } from "$lib/runtime/registry";
  import type { ResolvedRuntime } from "$lib/runtime/types";
  import type { AgentSettings, UserSettings } from "$lib/types";
  import * as api from "$lib/api";

  let {
    settings = null as UserSettings | null,
    mimoAgentSettings = null as AgentSettings | null,
  }: {
    settings?: UserSettings | null;
    mimoAgentSettings?: AgentSettings | null;
  } = $props();

  let mimoBinaryPath = $state("");
  let mimoProtocolMode = $state("auto");

  const installedCount = $derived(runtimeHubStore.installedCount);
  const startableCount = $derived(runtimeHubStore.startableCount);
  const defaultRuntime = $derived(runtimeHubStore.runtime(runtimeHubStore.defaultRuntime));

  $effect(() => {
    if (!mimoAgentSettings) return;
    mimoBinaryPath = mimoAgentSettings.mimo_binary_path ?? "";
    mimoProtocolMode = mimoAgentSettings.mimo_protocol_mode ?? "auto";
  });

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function runtimeInitial(runtime: ResolvedRuntime): string {
    return runtime.id === "qwen-code" ? "Q" : runtime.id.slice(0, 1).toUpperCase();
  }

  function statusClass(runtime: ResolvedRuntime): string {
    if (runtime.status === "available")
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    if (runtime.status === "desktop")
      return "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    if (runtime.status === "coming-soon")
      return "border-violet-500/20 bg-violet-500/8 text-violet-600 dark:text-violet-400";
    return "border-border bg-muted/60 text-muted-foreground";
  }

  const protocolOptions = [
    { value: "auto", label: "Auto (StreamJson)" },
    { value: "stream-json", label: "StreamJson (NDJSON)" },
    { value: "pty", label: "PTY" },
    { value: "pipe", label: "Pipe" },
  ];
</script>

<div class="space-y-5 pb-8">
  <RuntimeControlCenter defaultAgent={settings?.default_agent ?? "claude"} />

  <section
    class="overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-accent/20"
  >
    <div class="flex flex-col gap-5 p-6 lg:flex-row lg:items-end lg:justify-between">
      <div class="max-w-2xl">
        <div
          class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
          {lk("runtime_hub_eyebrow")}
        </div>
        <h2 class="text-xl font-semibold tracking-tight text-foreground">
          {lk("runtime_hub_title")}
        </h2>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {lk("runtime_hub_description")}
        </p>
      </div>
      <button
        type="button"
        class="inline-flex h-9 items-center justify-center gap-2 rounded-lg border bg-background/70 px-3 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        onclick={() => runtimeHubStore.refresh(true)}
        disabled={runtimeHubStore.loading}
      >
        {#if runtimeHubStore.loading}
          <Spinner size="sm" />
        {/if}
        {lk("runtime_hub_refresh")}
      </button>
    </div>

    <div class="grid border-t bg-background/45 sm:grid-cols-3">
      <div class="border-b p-4 sm:border-b-0 sm:border-r">
        <div class="text-2xl font-semibold tabular-nums">{installedCount}</div>
        <div class="mt-1 text-xs text-muted-foreground">{lk("runtime_hub_installed")}</div>
      </div>
      <div class="border-b p-4 sm:border-b-0 sm:border-r">
        <div class="text-2xl font-semibold tabular-nums">{startableCount}</div>
        <div class="mt-1 text-xs text-muted-foreground">{lk("runtime_hub_startable")}</div>
      </div>
      <div class="p-4">
        <div class="truncate text-sm font-semibold">
          {defaultRuntime ? lk(defaultRuntime.nameKey) : "—"}
        </div>
        <div class="mt-1 text-xs text-muted-foreground">{lk("runtime_hub_default")}</div>
      </div>
    </div>
  </section>

  {#if runtimeHubStore.error}
    <div
      class="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      {runtimeHubStore.error}
    </div>
  {/if}

  <section class="grid gap-3 xl:grid-cols-2">
    {#each runtimeHubStore.runtimes as runtime (runtime.id)}
      <Card
        class="group overflow-hidden border bg-card/75 p-0 transition-colors hover:border-primary/25"
      >
        <div class="flex gap-4 p-5">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background text-sm font-bold text-foreground shadow-sm"
          >
            {runtimeInitial(runtime)}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-foreground">{lk(runtime.nameKey)}</h3>
              <span
                class="rounded-full border px-2 py-0.5 text-[11px] font-medium {statusClass(
                  runtime,
                )}"
              >
                {lk(runtime.statusKey)}
              </span>
              {#if runtime.id === runtimeHubStore.defaultRuntime}
                <span
                  class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  {lk("runtime_hub_default_badge")}
                </span>
              {/if}
            </div>

            <p class="mt-1.5 text-xs leading-5 text-muted-foreground">
              {lk(runtime.capabilitiesKey)}
            </p>

            <dl class="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <div class="min-w-0 rounded-lg border bg-background/60 px-3 py-2">
                <dt class="text-muted-foreground">{lk("runtime_hub_version")}</dt>
                <dd class="mt-1 truncate font-mono text-foreground">{runtime.version ?? "—"}</dd>
              </div>
              <div class="min-w-0 rounded-lg border bg-background/60 px-3 py-2">
                <dt class="text-muted-foreground">{lk("runtime_hub_binary")}</dt>
                <dd class="mt-1 truncate font-mono text-foreground" title={runtime.binary ?? ""}>
                  {runtime.binary ?? runtime.agent}
                </dd>
              </div>
            </dl>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              {#if runtime.available && isStartableRuntime(runtime.id)}
                <button
                  type="button"
                  class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  disabled={runtime.id === runtimeHubStore.defaultRuntime}
                  onclick={() => {
                    if (runtimeHubStore.setDefault(runtime.id)) {
                      void api.updateUserSettings({ default_agent: runtime.agent });
                    }
                  }}
                >
                  {runtime.id === runtimeHubStore.defaultRuntime
                    ? lk("runtime_hub_current_default")
                    : lk("runtime_hub_make_default")}
                </button>
              {:else if runtime.launchSupport === "desktop"}
                <span class="text-xs text-muted-foreground">{lk("runtime_hub_desktop_note")}</span>
              {:else if runtime.launchSupport === "coming-soon"}
                <span class="text-xs text-muted-foreground"
                  >{lk("runtime_hub_adapter_pending")}</span
                >
              {:else}
                <span class="text-xs text-muted-foreground">{lk("runtime_hub_install_hint")}</span>
              {/if}
            </div>
          </div>
        </div>
      </Card>
    {/each}
  </section>

  <Card class="space-y-4 p-5">
    <div>
      <h3 class="text-sm font-semibold text-foreground">{lk("runtime_hub_mimo_advanced")}</h3>
      <p class="mt-1 text-xs text-muted-foreground">{lk("runtime_hub_mimo_description")}</p>
    </div>

    {#if !mimoAgentSettings && runtimeHubStore.loading}
      <div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {lk("settings_runtimes_detecting")}
      </div>
    {:else}
      <SettingsFieldRow
        label={lk("settings_runtimes_mimo_binary_path")}
        description={lk("runtime_hub_binary_description")}
      >
        {#snippet children()}
          <input
            type="text"
            class="w-64 max-w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-mono outline-none transition-colors focus:border-ring"
            placeholder="auto-detect"
            bind:value={mimoBinaryPath}
            onblur={() =>
              api.updateAgentSettings("mimo", {
                mimo_binary_path: (mimoBinaryPath || undefined) as string | undefined,
              })}
          />
        {/snippet}
      </SettingsFieldRow>

      <SettingsFieldEnum
        label={lk("settings_runtimes_mimo_protocol")}
        description={lk("runtime_hub_protocol_description")}
        value={mimoProtocolMode}
        options={protocolOptions}
        onchange={(value) => {
          mimoProtocolMode = value;
          void api.updateAgentSettings("mimo", {
            mimo_protocol_mode: (value || undefined) as string | undefined,
          });
        }}
      />
    {/if}
  </Card>
</div>
