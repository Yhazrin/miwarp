<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Spinner from "$lib/components/Spinner.svelte";
  import RuntimeConfigDiffModal from "./RuntimeConfigDiffModal.svelte";
  import { runtimeControlPlaneStore, RuntimeConfigWatcher } from "$lib/runtime-control-plane";
  import type { RuntimeSnapshot } from "$lib/runtime-control-plane/types";
  import { agentToRuntimeId } from "$lib/runtime/registry";

  let {
    defaultAgent: _defaultAgent = "claude",
  }: {
    defaultAgent?: string;
  } = $props();

  let modelDraft = $state("");
  let providerDraft = $state("");
  let applying = $state(false);
  let watcher: RuntimeConfigWatcher | null = null;

  const store = runtimeControlPlaneStore;

  $effect(() => {
    store.init();
    return () => {
      void watcher?.dispose();
    };
  });

  $effect(() => {
    const selected = store.selected;
    if (!selected?.runtimeId) return;
    void (async () => {
      watcher?.dispose();
      watcher = new RuntimeConfigWatcher();
      await watcher.start(selected.runtimeId, () => {
        void store.refresh(true);
      });
    })();
    return () => {
      void watcher?.stop(selected.runtimeId);
      watcher?.dispose();
      watcher = null;
    };
  });

  $effect(() => {
    const selected = store.selected;
    if (!selected) return;
    modelDraft = selected.currentModel ?? "";
    providerDraft = selected.provider ?? "";
  });

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function authLabel(auth: RuntimeSnapshot["auth"]): string {
    return lk(`runtime_auth_${auth}`);
  }

  function freshnessLabel(snapshot: RuntimeSnapshot): string {
    const ageSec = Math.max(0, Math.floor((Date.now() - snapshot.fetchedAtMs) / 1000));
    return lk("runtime_freshness_seconds").replace("{seconds}", String(ageSec));
  }

  function _mapRuntimeId(snapshot: RuntimeSnapshot): string {
    return (
      agentToRuntimeId(snapshot.runtimeId.replace("-code", "").replace("-agent", "")) ??
      snapshot.runtimeId
    );
  }

  async function previewModelChange(): Promise<void> {
    const selected = store.selected;
    if (!selected) return;
    await store.previewConfig(selected.runtimeId, { model: modelDraft });
  }

  async function confirmModelChange(): Promise<void> {
    const selected = store.selected;
    if (!selected || !store.pendingPreview) return;
    applying = true;
    try {
      await store.applyConfig(selected.runtimeId, { model: modelDraft });
    } finally {
      applying = false;
    }
  }
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold">{lk("runtime_control_center_title")}</h3>
      <p class="text-xs text-muted-foreground">{lk("runtime_control_center_description")}</p>
    </div>
    <button
      type="button"
      class="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium hover:bg-accent disabled:opacity-60"
      onclick={() => store.refresh(true)}
      disabled={store.loading}
    >
      {#if store.loading}<Spinner size="sm" />{/if}
      {lk("runtime_hub_refresh")}
    </button>
  </div>

  {#if store.error}
    <div
      class="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      {store.error}
    </div>
  {/if}

  {#if store.lastTransaction && !store.lastTransaction.success}
    <div
      class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
    >
      {lk("runtime_config_rollback_notice")}
      {#if store.lastTransaction.error}
        <span class="mt-1 block text-xs opacity-80">{store.lastTransaction.error}</span>
      {/if}
    </div>
  {/if}

  <div class="grid gap-3 lg:grid-cols-2">
    {#each store.list?.runtimes ?? [] as runtime (runtime.runtimeId)}
      <button
        type="button"
        class="rounded-2xl border p-4 text-left transition-colors hover:border-primary/30 {store.selectedRuntimeId ===
        runtime.runtimeId
          ? 'border-primary/40 bg-primary/5'
          : 'bg-card/70'}"
        onclick={() => {
          store.selectedRuntimeId = runtime.runtimeId;
        }}
      >
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-semibold">{runtime.displayName}</h4>
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-medium {runtime.installed
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground'}"
          >
            {runtime.installed ? lk("runtime_status_available") : lk("runtime_status_unavailable")}
          </span>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <dt class="text-muted-foreground">{lk("runtime_hub_version")}</dt>
            <dd class="font-mono">{runtime.version ?? "—"}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{lk("runtime_control_auth")}</dt>
            <dd>{authLabel(runtime.auth)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{lk("runtime_control_provider")}</dt>
            <dd>{runtime.provider ?? "—"}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{lk("runtime_control_model")}</dt>
            <dd class="truncate">{runtime.currentModel ?? "—"}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-muted-foreground">{lk("runtime_control_freshness")}</dt>
            <dd>
              {freshnessLabel(runtime)}{runtime.stale ? ` · ${lk("runtime_control_stale")}` : ""}
            </dd>
          </div>
        </dl>
        {#if runtime.runtimeId === store.list?.defaultRuntimeId}
          <span
            class="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
          >
            {lk("runtime_hub_default_badge")}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  {#if store.selected}
    {@const runtime = store.selected}
    <section class="rounded-2xl border bg-card/60 p-4">
      <h4 class="text-sm font-semibold">{lk("runtime_control_details")}</h4>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label class="text-xs">
          <span class="text-muted-foreground">{lk("runtime_control_model")}</span>
          <input
            class="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
            bind:value={modelDraft}
          />
        </label>
        <label class="text-xs">
          <span class="text-muted-foreground">{lk("runtime_control_provider")}</span>
          <input
            class="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
            bind:value={providerDraft}
            disabled
          />
        </label>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          onclick={previewModelChange}
        >
          {lk("runtime_config_preview")}
        </button>
        {#if runtime.installed}
          <button
            type="button"
            class="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            onclick={() => store.setDefault(runtime.runtimeId)}
          >
            {lk("runtime_hub_make_default")}
          </button>
        {/if}
      </div>

      <div class="mt-4 grid gap-2 text-xs">
        <div>
          <span class="font-medium">{lk("runtime_control_commands")}:</span>
          {#if runtime.commands.kind === "unsupported"}
            <span class="text-muted-foreground">
              {lk("runtime_capability_unsupported")} ({runtime.commands.capability})</span
            >
          {:else if runtime.commands.value.length === 0}
            <span class="text-muted-foreground"> —</span>
          {:else}
            <span class="text-muted-foreground">
              {runtime.commands.value.map((c) => c.name).join(", ")}</span
            >
          {/if}
        </div>
        <div>
          <span class="font-medium">MCP:</span>
          {#if runtime.mcp.kind === "unsupported"}
            <span class="text-muted-foreground"> {lk("runtime_capability_unsupported")}</span>
          {:else}
            <span class="text-muted-foreground"> {runtime.mcp.value.length}</span>
          {/if}
        </div>
        <div>
          <span class="font-medium">{lk("runtime_control_diagnostics")}:</span>
          <button
            type="button"
            class="ml-2 rounded border px-2 py-0.5 text-[10px] hover:bg-accent"
            onclick={() => store.diagnose(runtime.runtimeId)}
          >
            {lk("runtime_control_run_diagnostics")}
          </button>
        </div>
      </div>
    </section>
  {/if}
</div>

{#if store.pendingPreview}
  <RuntimeConfigDiffModal
    preview={store.pendingPreview}
    {applying}
    onconfirm={confirmModelChange}
    oncancel={() => {
      store.pendingPreview = null;
    }}
  />
{/if}
