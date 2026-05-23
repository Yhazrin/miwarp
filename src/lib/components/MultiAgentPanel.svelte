<script lang="ts">
  import {
    multiAgentService,
    type MultiAgentResult,
    type MultiAgentConfig,
  } from "$lib/services/multi-agent-service";
  import { t } from "$lib/i18n/index.svelte";
  import { pipelineOrchestrator } from "$lib/services/pipeline-orchestrator";
  import Button from "./Button.svelte";
  import Modal from "./Modal.svelte";
  import type { SkillPipeline } from "$lib/types/skill-pipeline";

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
  let executionLevels = $state<string[][]>([]);
  let validationErrors = $state<string[]>([]);

  const presets = multiAgentService.getPresets();

  // 获取当前选择的预设配置
  const currentConfig = $derived(
    selectedPreset ? multiAgentService.getPreset(selectedPreset) : null,
  );

  // 转换 MultiAgentConfig 为 SkillPipeline 用于 DAG 分析
  const currentPipeline = $derived.by<SkillPipeline | null>(() => {
    if (!currentConfig) return null;
    return {
      id: `pipeline-${currentConfig.name}`,
      name: currentConfig.name,
      description: currentConfig.description,
      steps: currentConfig.agents.map((agent) => ({
        skillName: agent.id,
        dependsOn: agent.dependsOn,
      })),
    };
  });
>>>>>>> b3dda378 (@)

  // 验证并计算执行层级
  $effect(() => {
    if (currentPipeline) {
      const pipeline = currentPipeline;
      if (pipeline) {
        const validation = pipelineOrchestrator.validate(pipeline);
        validationErrors = validation.errors;
        if (validation.valid) {
          executionLevels = pipelineOrchestrator.topologicalSort(pipeline.steps);
        }
      }
    } else {
      executionLevels = [];
      validationErrors = [];
    }
  });

  async function executeSelected() {
    if (!selectedPreset || !currentConfig) return;

    isRunning = true;
    results = [];
    progress = new Map();

    const execResults = await multiAgentService.execute(
      currentConfig,
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
    results = [];
    progress = new Map();
  }

  // 获取 Agent 的执行状态
  function getAgentStatus(agentId: string): MultiAgentResult["status"] | "pending" {
    if (isRunning) {
      return progress.has(agentId) ? "running" : "pending";
    }
    const result = results.find((r) => r.agentId === agentId);
    return result?.status || "pending";
  }

  // 渲染依赖边
  function getDependencyEdges(config: MultiAgentConfig): Array<{ from: string; to: string }> {
    const edges: Array<{ from: string; to: string }> = [];
    for (const agent of config.agents) {
      if (agent.dependsOn) {
        for (const dep of agent.dependsOn) {
          edges.push({ from: dep, to: agent.id });
        }
      }
    }
    return edges;
  }
</script>

<Modal bind:open title={t("multiAgent_title", { default: "多 Agent 并行执行" })} size="xl">
  <div class="space-y-6">
    <!-- 预设列表 -->
    <div class="grid grid-cols-3 gap-3">
      {#each presets as preset}
        <button
          class="p-3 rounded-lg border text-left transition-all hover:border-[hsl(var(--primary))] {selectedPreset ===
          preset.id
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
            : 'border-border bg-muted/30'}"
          onclick={() => openPreset(preset.id)}
        >
          <div class="font-medium text-foreground text-sm">{preset.name}</div>
          <div class="text-xs text-muted-foreground mt-1 line-clamp-2">{preset.description}</div>
        </button>
      {/each}
    </div>

    <!-- DAG 执行计划可视化 -->
    {#if selectedPreset && currentConfig}
      <div class="p-4 rounded-lg bg-muted/20 border border-border">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="font-medium">{currentConfig.name}</div>
            <div class="text-xs text-muted-foreground">{currentConfig.description}</div>
          </div>
          {#if validationErrors.length > 0}
            <div class="flex items-center gap-1 text-xs text-destructive">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>配置错误</span>
            </div>
          {/if}
        </div>

        <!-- DAG 可视化 -->
        <div class="execution-dag">
          {#if executionLevels.length > 0}
            <div class="flex flex-col gap-4">
              {#each executionLevels as level, levelIndex}
                <div class="flex items-center gap-4">
                  <div class="text-xs text-muted-foreground w-16 shrink-0">
                    {levelIndex === 0
                      ? "Stage 1"
                      : levelIndex === executionLevels.length - 1
                        ? "Final"
                        : `Stage ${levelIndex + 1}`}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    {#each level as agentId}
                      {@const agent = currentConfig.agents.find((a) => a.id === agentId)}
                      {@const status = getAgentStatus(agentId)}
                      {#if agent}
                        <div
                          class="relative px-3 py-2 rounded-lg border transition-all {status ===
                          'completed'
                            ? 'bg-green-500/20 border-green-500/50'
                            : status === 'failed'
                              ? 'bg-red-500/20 border-red-500/50'
                              : status === 'running'
                                ? 'bg-[hsl(var(--primary))]/20 border-[hsl(var(--primary))]/50 animate-pulse'
                                : 'bg-muted border-border'}"
                        >
                          <div class="text-sm font-medium">{agent.name}</div>
                          {#if status === "completed"}
                            <span class="absolute -top-1 -right-1 text-green-500 text-xs">✓</span>
                          {:else if status === "failed"}
                            <span class="absolute -top-1 -right-1 text-red-500 text-xs">✗</span>
                          {:else if status === "running"}
                            <span
                              class="absolute -top-1 -right-1 w-2 h-2 bg-[hsl(var(--primary))] rounded-full animate-bounce"
                            ></span>
                          {/if}
                          {#if agent.dependsOn?.length}
                            <div class="text-xs text-muted-foreground mt-1">
                              ← {agent.dependsOn.join(", ")}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {:else if validationErrors.length > 0}
            <div class="text-sm text-destructive">
              <div class="font-medium mb-2">发现以下问题：</div>
              <ul class="list-disc list-inside space-y-1">
                {#each validationErrors as error}
                  <li>{error}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>

        <!-- 进度时间线 -->
        {#if isRunning && progress.size > 0}
          <div class="mt-4 pt-4 border-t border-border">
            <div class="text-xs text-muted-foreground mb-2">执行进度</div>
            <div class="space-y-2">
              {#each [...progress.entries()] as [agentId, status]}
                {@const agent = currentConfig.agents.find((a) => a.id === agentId)}
                {#if agent}
                  <div class="flex items-center gap-3">
                    <div
                      class="w-2 h-2 rounded-full bg-[hsl(var(--primary))] animate-pulse shrink-0"
                    ></div>
                    <span class="text-sm font-medium w-20 shrink-0">{agent.name}</span>
                    <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        class="h-full bg-[hsl(var(--primary))] animate-pulse"
                        style="width: 50%"
                      ></div>
                    </div>
                    <span class="text-xs text-muted-foreground shrink-0">{status}</span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- 执行按钮 -->
      <Button
        onclick={executeSelected}
        disabled={isRunning || validationErrors.length > 0}
        class="w-full"
        variant={validationErrors.length > 0 ? "secondary" : "default"}
      >
        {#if isRunning}
          {t("multiAgent_running", { default: "执行中..." })}
        {:else if validationErrors.length > 0}
          {t("multiAgent_fixErrors", { default: "请修复配置错误" })}
        {:else}
          {t("multiAgent_execute", { default: "开始执行" })}
        {/if}
      </Button>
    {/if}

    <!-- 结果汇总 -->
    {#if results.length > 0 && !isRunning}
      <div class="p-4 rounded-lg bg-muted/20 border border-border">
        <div class="flex items-center justify-between mb-3">
          <div class="font-medium">{t("multiAgent_results", { default: "执行结果" })}</div>
          <div class="text-xs text-muted-foreground">
            {results.filter((r) => r.status === "completed").length}/{results.length} 成功
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          {#each results as result}
            {@const agent = currentConfig?.agents.find((a) => a.id === result.agentId)}
            {#if agent}
              <div
                class="flex items-center gap-2 p-2 rounded {result.status === 'completed'
                  ? 'bg-green-500/10'
                  : result.status === 'failed'
                    ? 'bg-red-500/10'
                    : 'bg-yellow-500/10'}"
              >
                {#if result.status === "completed"}
                  <svg
                    class="w-4 h-4 text-green-500 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                {:else if result.status === "failed"}
                  <svg
                    class="w-4 h-4 text-red-500 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                {:else}
                  <div class="w-4 h-4 rounded-full border-2 border-yellow-500 shrink-0"></div>
                {/if}
                <div class="min-w-0">
                  <div class="text-sm font-medium truncate">{agent.name}</div>
                  {#if result.duration}
                    <div class="text-xs text-muted-foreground">
                      {(result.duration / 1000).toFixed(1)}s
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .execution-dag {
    min-height: 100px;
  }
</style>
