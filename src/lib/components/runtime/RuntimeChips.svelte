<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { runtimeControlPlaneStore } from "$lib/runtime-control-plane";
  import { runtimeHubStore } from "$lib/stores/runtime-hub-store.svelte";
  import type { SessionStore } from "$lib/stores/session-store.svelte";

  let {
    store,
    disabled = false,
    onRuntimeChange,
    onModelChange,
  }: {
    store: SessionStore;
    disabled?: boolean;
    onRuntimeChange?: (runtimeId: string) => void;
    onModelChange?: (model: string) => void;
  } = $props();

  const controlPlane = runtimeControlPlaneStore;

  const isRunning = $derived(store.isRunning);

  const effectiveRuntimeId = $derived(
    controlPlane.effectiveRuntimeId(runtimeHubStore.defaultRuntime),
  );

  const effectiveModel = $derived(controlPlane.effectiveModel(store.run?.model ?? null));

  const effectiveProvider = $derived(
    controlPlane.effectiveProvider(controlPlane.selected?.provider ?? null),
  );

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function setRuntime(id: string): void {
    if (isRunning) return;
    controlPlane.setSessionOverride({
      runtimeId: id,
      model: controlPlane.sessionOverride?.model,
      provider: controlPlane.sessionOverride?.provider,
    });
    onRuntimeChange?.(id);
  }

  function setModel(model: string): void {
    if (isRunning) return;
    controlPlane.setSessionOverride({
      runtimeId: controlPlane.sessionOverride?.runtimeId ?? effectiveRuntimeId,
      model,
      provider: controlPlane.sessionOverride?.provider,
    });
    onModelChange?.(model);
  }
</script>

<div class="flex flex-wrap items-center gap-1.5 px-1 pb-1" data-runtime-chips>
  <button
    type="button"
    class="rounded-full border bg-background/70 px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    title={isRunning ? lk("runtime_chip_locked_running") : lk("runtime_chip_runtime")}
    disabled={disabled || isRunning}
    onclick={() => setRuntime(effectiveRuntimeId)}
  >
    <span class="text-muted-foreground">{lk("runtime_chip_runtime")}:</span>
    <span class="ml-1 text-foreground">{effectiveRuntimeId}</span>
  </button>

  {#if effectiveProvider}
    <span
      class="rounded-full border bg-background/50 px-2.5 py-1 text-[10px] text-muted-foreground"
      title={lk("runtime_chip_provider")}
    >
      {effectiveProvider}
    </span>
  {/if}

  {#if effectiveModel}
    <button
      type="button"
      class="rounded-full border bg-background/70 px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      title={isRunning ? lk("runtime_chip_locked_running") : lk("runtime_chip_model")}
      disabled={disabled || isRunning}
      onclick={() => setModel(effectiveModel)}
    >
      <span class="text-muted-foreground">{lk("runtime_chip_model")}:</span>
      <span class="ml-1 font-mono text-foreground">{effectiveModel}</span>
    </button>
  {/if}

  {#if isRunning}
    <span class="text-[10px] text-amber-600 dark:text-amber-400"
      >{lk("runtime_chip_locked_running")}</span
    >
  {/if}
</div>
