<script lang="ts">
  import {
    multiAgentService,
    type MultiAgentConfig,
    type MultiAgentResult,
  } from "$lib/services/multi-agent-service";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import Modal from "./Modal.svelte";

  let {
    open = $bindable(false),
    cwd = "",
    onExecute,
  }: {
    open: boolean;
    cwd?: string;
    onExecute?: (results: MultiAgentResult[]) => void;
  } = $props();

  let selectedPreset = $state<string | null>(null);
  let results = $state<MultiAgentResult[]>([]);
  let isRunning = $state(false);
  let progress = $state<Map<string, string>>(new Map());

  const presets = multiAgentService.getPresets();

  async function executeSelected() {
    if (!selectedPreset) return;

    const config = multiAgentService.getPreset(selectedPreset);
    if (!config) return;

    isRunning = true;
    results = [];
    progress = new Map();

    const execResults = await multiAgentService.execute(
      config,
      { cwd, projectPath: cwd },
      (agentId, status) => {
        progress = new Map(progress).set(agentId, status);
      },
    );

    results = execResults;
    isRunning = false;
    onExecute?.(execResults);
  }

  function openPreset(id: string) {
    selectedPreset = id;
  }
</script>

<Modal bind:open title={t("multiAgent_title", { default: "多 Agent 并行执行" })} size="lg">
  <div class="space-y-4">
    <!-- 预设列表 -->
    <div class="grid grid-cols-2 gap-3">
      {#each presets as preset}
        <button
          class="p-4 rounded-lg border text-left transition-all hover:border-[hsl(var(--primary))] {selectedPreset ===
          preset.id
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
            : 'border-border bg-muted/30'}"
          onclick={() => openPreset(preset.id)}
        >
          <div class="font-medium text-foreground">{preset.name}</div>
          <div class="text-xs text-muted-foreground mt-1">{preset.description}</div>
          <div class="text-xs text-muted-foreground mt-2">
            {preset.agentCount} 个 Agent 并行
          </div>
        </button>
      {/each}
    </div>

    <!-- 已选择的预设详情 -->
    {#if selectedPreset}
      {@const config = multiAgentService.getPreset(selectedPreset)}
      {#if config}
        <div class="p-4 rounded-lg bg-muted/30 border border-border">
          <div class="font-medium mb-2">{config.name}</div>
          <div class="text-sm text-muted-foreground mb-3">{config.description}</div>
          <div class="text-sm">
            <div class="font-medium mb-2">执行计划：</div>
            <ul class="space-y-1">
              {#each config.agents as agent, i}
                <li class="flex items-center gap-2">
                  <span
                    class="w-6 h-6 rounded-full bg-[hsl(var(--primary))] text-primary-foreground text-xs flex items-center justify-center"
                  >
                    {i + 1}
                  </span>
                  <span>{agent.name}</span>
                  {#if agent.dependsOn?.length}
                    <span class="text-xs text-muted-foreground">
                      (依赖: {agent.dependsOn.join(", ")})
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        </div>

        <!-- 执行按钮 -->
        <Button onclick={executeSelected} disabled={isRunning} class="w-full">
          {isRunning
            ? t("multiAgent_running", { default: "执行中..." })
            : t("multiAgent_execute", { default: "开始执行" })}
        </Button>
      {/if}
    {/if}

    <!-- 进度显示 -->
    {#if isRunning && progress.size > 0}
      <div class="p-4 rounded-lg bg-muted/30 border border-border">
        <div class="font-medium mb-3">执行进度</div>
        <div class="space-y-2">
          {#each [...progress.entries()] as [agentId, status]}
            <div class="flex items-center gap-3">
              <div
                class="animate-spin w-4 h-4 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full"
              ></div>
              <span class="text-sm">{agentId}</span>
              <span class="text-xs text-muted-foreground">{status}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 结果显示 -->
    {#if results.length > 0 && !isRunning}
      <div class="p-4 rounded-lg bg-muted/30 border border-border">
        <div class="font-medium mb-3">执行结果</div>
        <div class="space-y-2">
          {#each results as result}
            <div
              class="flex items-center gap-3 p-2 rounded {result.status === 'completed'
                ? 'bg-green-500/10'
                : result.status === 'failed'
                  ? 'bg-red-500/10'
                  : 'bg-yellow-500/10'}"
            >
              {#if result.status === "completed"}
                <span class="text-green-500">✅</span>
              {:else if result.status === "failed"}
                <span class="text-red-500">❌</span>
              {:else}
                <span class="text-yellow-500">⏳</span>
              {/if}
              <span class="font-medium">{result.agentId}</span>
              {#if result.duration}
                <span class="text-xs text-muted-foreground"
                  >({(result.duration / 1000).toFixed(1)}s)</span
                >
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</Modal>
