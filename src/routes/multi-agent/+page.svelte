<script lang="ts">
  import {
    multiAgentService,
    type MultiAgentConfig,
    type MultiAgentResult,
  } from "$lib/services/multi-agent-service";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import { dbgWarn } from "$lib/utils/debug";

  const presets = multiAgentService.getPresets();
  let _selectedConfig = $state<MultiAgentConfig | null>(null);
  let results = $state<MultiAgentResult[]>([]);
  let isRunning = $state(false);
  let customPrompt = $state("");

  async function executePreset(config: MultiAgentConfig) {
    _selectedConfig = config;
    isRunning = true;
    results = [];

    try {
      const execResults = await multiAgentService.execute(
        config,
        { cwd: "", projectPath: "" },
        (_agentId, _status) => {},
      );
      results = execResults;
    } catch (e) {
      dbgWarn("multi-agent", "executePreset failed", e);
    } finally {
      isRunning = false;
    }
  }

  function executeCustom() {
    const config = multiAgentService.parseNaturalLanguage(customPrompt);
    if (config) {
      executePreset(config);
    }
  }
</script>

<div class="mx-auto max-w-4xl p-6">
  <h1 class="text-2xl font-bold mb-6">{t("multiAgent_title", { default: "多 Agent 并行执行" })}</h1>

  <!-- 预设任务 -->
  <div class="mb-8">
    <h2 class="text-lg font-medium mb-4">{t("multiAgent_presetSelect")}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each presets as preset (preset.id)}
        {@const config = multiAgentService.getPreset(preset.id)}
        {#if config}
          <Card>
            <div class="p-4">
              <h3 class="font-medium mb-2">{preset.name}</h3>
              <p class="text-sm text-muted-foreground mb-4">{preset.description}</p>
              <div class="text-xs text-muted-foreground mb-4">
                {t("multiAgent_agentsParallel", { count: String(config.agents.length) })}
              </div>
              <Button onclick={() => executePreset(config)} disabled={isRunning} class="w-full">
                {isRunning ? t("multiAgent_running") : t("multiAgent_execute")}
              </Button>
            </div>
          </Card>
        {/if}
      {/each}
    </div>
  </div>

  <!-- 自定义任务 -->
  <div class="mb-8">
    <h2 class="text-lg font-medium mb-4">{t("multiAgent_customTaskTitle")}</h2>
    <div class="p-4 rounded-lg border border-border bg-muted/30">
      <textarea
        bind:value={customPrompt}
        placeholder={t("multiAgent_customPlaceholder")}
        class="w-full h-24 p-3 rounded border border-border bg-background text-foreground"
      ></textarea>
      <Button onclick={executeCustom} disabled={isRunning || !customPrompt} class="mt-3">
        {t("multiAgent_executeCustom")}
      </Button>
    </div>
  </div>

  <!-- 执行结果 -->
  {#if results.length > 0}
    <div>
      <h2 class="text-lg font-medium mb-4">{t("multiAgent_execResults")}</h2>
      <div class="space-y-3">
        {#each results as result}
          <div
            class="p-4 rounded-lg border {result.status === 'completed'
              ? 'border-[hsl(var(--miwarp-status-success)/0.3)] bg-[hsl(var(--miwarp-status-success)/0.1)]'
              : result.status === 'failed'
                ? 'border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)]'
                : 'border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)]'}"
          >
            <div class="flex items-center gap-3">
              {#if result.status === "completed"}
                <span class="text-2xl">✅</span>
              {:else if result.status === "failed"}
                <span class="text-2xl">❌</span>
              {:else}
                <span class="text-2xl">⏳</span>
              {/if}
              <div>
                <div class="font-medium">{result.agentId}</div>
                {#if result.duration}
                  <div class="text-xs text-muted-foreground">
                    {t("multiAgent_duration", { time: (result.duration / 1000).toFixed(1) })}
                  </div>
                {/if}
                {#if result.error}
                  <div class="text-sm text-[hsl(var(--miwarp-status-error))] mt-1">{result.error}</div>
                {/if}
                {#if result.result}
                  <div class="text-sm mt-1">{result.result}</div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
