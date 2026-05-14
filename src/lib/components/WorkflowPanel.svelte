<script lang="ts">
  /**
   * WorkflowPanel - Guided Workflows UI Component
   *
   * Provides step indicator, current step details, and navigation controls.
   */
  import { workflowStore } from "$lib/stores/workflow-store.svelte";
  import type { WorkflowTemplate, WorkflowStep } from "$lib/types/workflow";

  interface Props {
    onExecute?: (step: WorkflowStep) => Promise<void>;
    onNotify?: (message: string) => void;
  }

  let { onExecute, onNotify }: Props = $props();

  // Local UI state
  let showTemplateSelector = $state(false);
  let showContextPanel = $state(false);
  let customPrompt = $state("");

  // Derived state
  let templates = $derived(workflowStore.templates);
  let activeTemplate = $derived(workflowStore.activeTemplate);
  let currentStep = $derived(workflowStore.currentStep);
  let activeInstance = $derived(workflowStore.state.activeInstance);
  let isRunning = $derived(workflowStore.isRunning);
  let isWaiting = $derived(workflowStore.isWaiting);
  let progress = $derived(workflowStore.progress);
  let error = $derived(workflowStore.state.error);
  let isExecuting = $derived(workflowStore.state.isExecuting);

  // Category colors
  const categoryColors: Record<string, string> = {
    development: "#6366f1",
    review: "#f59e0b",
    testing: "#10b981",
    documentation: "#3b82f6",
    deployment: "#ef4444",
    custom: "#8b5cf6",
  };

  function handleSelectTemplate(template: WorkflowTemplate) {
    workflowStore.startWorkflow(template.id);
    showTemplateSelector = false;
    customPrompt = "";
  }

  function handleStart() {
    if (!activeInstance) return;
    if (currentStep?.interventionLevel && currentStep.interventionLevel >= 2) {
      workflowStore.waitForIntervention();
    } else {
      workflowStore.resumeWorkflow();
    }
  }

  async function handleNext() {
    if (!currentStep) return;

    if (currentStep.interventionLevel >= 1 && !customPrompt.trim()) {
      workflowStore.waitForIntervention();
      onNotify?.("请先填写 Prompt 或确认操作");
      return;
    }

    workflowStore.state.isExecuting = true;
    try {
      if (onExecute) {
        await onExecute(currentStep);
      }
      await workflowStore.nextStep({
        prompt: customPrompt,
        executedAt: new Date().toISOString(),
      });
      customPrompt = "";
    } catch (e) {
      workflowStore.failStep(String(e));
    } finally {
      workflowStore.state.isExecuting = false;
    }
  }

  function handlePrev() {
    workflowStore.prevStep();
  }

  function handleSkip() {
    workflowStore.skipStep();
    customPrompt = "";
  }

  function handlePause() {
    workflowStore.pauseWorkflow();
  }

  function handleCancel() {
    workflowStore.cancelWorkflow();
    customPrompt = "";
  }

  function handleReset() {
    workflowStore.resetWorkflow();
    customPrompt = "";
  }

  function handleJumpToStep(index: number) {
    workflowStore.jumpToStep(index);
  }

  function handleRestoreCheckpoint(index: number) {
    workflowStore.restoreFromCheckpoint(index);
  }

  // SVG path data for icons (consistent with phase-detection.ts pattern)
  const stepIconPaths: Record<string, string> = {
    completed: "M20 6 9 17l-5-5",
    active: "M5 3l14 9-14 9V3z",
    skipped: "M5 4l10 8-10 8V4zM19 5v14",
    failed: "M18 6 6 18M6 6l12 12",
    pending: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0",
  };

  function getStepIcon(step: WorkflowStep): string {
    return stepIconPaths[step.status] ?? stepIconPaths.pending;
  }

  function getInterventionLabel(level: number): string {
    switch (level) {
      case 0:
        return "自主执行";
      case 1:
        return "执行前确认";
      case 2:
        return "方案审批";
      case 3:
        return "人工介入";
      default:
        return "未知";
    }
  }
</script>

<div class="workflow-panel">
  <!-- Header -->
  <div class="panel-header">
    <h3>Guided Workflows</h3>
    <button
      class="btn btn-icon"
      onclick={() => (showTemplateSelector = !showTemplateSelector)}
      title="Templates"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    </button>
  </div>

  <!-- Template Selector Dropdown -->
  {#if showTemplateSelector}
    <div class="template-selector">
      <div class="selector-header">
        <h4>选择工作流模板</h4>
        <button class="btn btn-icon" onclick={() => (showTemplateSelector = false)}> × </button>
      </div>
      <div class="template-grid">
        {#each templates as template}
          <button class="template-card" onclick={() => handleSelectTemplate(template)}>
            <span class="template-icon">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={template.icon} />
              </svg>
            </span>
            <span class="template-name">{template.name}</span>
            <span class="template-desc">{template.description}</span>
            <span class="template-meta">
              <span
                class="category-badge"
                style="background: {categoryColors[template.category] ?? '#666'}"
              >
                {template.category}
              </span>
              <span class="template-time">{template.estimatedTime}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- No Active Workflow -->
  {#if !activeTemplate}
    <div class="empty-state">
      <span class="empty-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3M22 2l-7.5 7.5"
          />
          <path d="M11.5 12.5 9.5 10.5 14 2l8 8-8.5 4.5zM14 8l-2 2" />
        </svg>
      </span>
      <p>选择一个模板开始工作流</p>
      <button class="btn btn-primary" onclick={() => (showTemplateSelector = true)}>
        浏览模板
      </button>
    </div>
  {:else}
    <!-- Workflow Active -->

    <!-- Progress Bar -->
    <div class="progress-section">
      <div class="progress-info">
        <span class="workflow-name">{activeTemplate.name}</span>
        <span class="progress-percent">{progress}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progress}%"></div>
      </div>
    </div>

    <!-- Step Indicator -->
    <div class="step-indicator">
      {#each activeTemplate.steps as step, index}
        <button
          class="step-dot"
          class:completed={step.status === "completed"}
          class:active={step.status === "active"}
          class:skipped={step.status === "skipped"}
          class:failed={step.status === "failed"}
          onclick={() => handleJumpToStep(index)}
          title={step.title}
        >
          <span class="step-icon">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d={getStepIcon(step)} />
            </svg>
          </span>
          <span class="step-number">{index + 1}</span>
        </button>
        {#if index < activeTemplate.steps.length - 1}
          <div class="step-connector" class:completed={step.status === "completed"}></div>
        {/if}
      {/each}
    </div>

    <!-- Current Step Details -->
    {#if currentStep}
      <div class="step-details">
        <div class="step-header">
          <div class="step-title-area">
            <h4 class="step-title">
              Step {(activeInstance?.currentStepIndex ?? 0) + 1}: {currentStep.title}
            </h4>
            <span
              class="intervention-badge"
              class:level-0={currentStep.interventionLevel === 0}
              class:level-1={currentStep.interventionLevel === 1}
              class:level-2={currentStep.interventionLevel === 2}
              class:level-3={currentStep.interventionLevel === 3}
            >
              {getInterventionLabel(currentStep.interventionLevel)}
            </span>
          </div>
          {#if currentStep.estimatedTime}
            <span class="step-time">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
              </svg>
              {currentStep.estimatedTime}
            </span>
          {/if}
        </div>

        <p class="step-instruction">{currentStep.instruction}</p>

        <!-- Auto-generated Prompt -->
        {#if currentStep.prompt}
          <div class="prompt-section">
            <h5>自动 Prompt</h5>
            <pre class="prompt-preview">{currentStep.prompt}</pre>
          </div>
        {/if}

        <!-- Custom Prompt Input -->
        <div class="custom-prompt">
          <h5>自定义 Prompt</h5>
          <textarea
            bind:value={customPrompt}
            placeholder="在此输入或修改 Prompt..."
            rows="4"
            class="prompt-input"
          ></textarea>
        </div>

        <!-- Tools -->
        <div class="tools-section">
          <h5>所需工具</h5>
          <div class="tools-list">
            {#each currentStep.tools as tool}
              <span class="tool-badge">{tool}</span>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Status Messages -->
    {#if isWaiting}
      <div class="status-message waiting">
        <span class="status-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
          </svg>
        </span>
        <span>等待确认...</span>
      </div>
    {/if}

    {#if error}
      <div class="status-message error">
        <span class="status-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <span>{error}</span>
        <button class="btn btn-icon" onclick={() => workflowStore.clearError()}>×</button>
      </div>
    {/if}

    <!-- Control Buttons -->
    <div class="control-buttons">
      {#if !isRunning && !isWaiting}
        <button
          class="btn btn-secondary"
          onclick={handlePrev}
          disabled={!activeInstance || (activeInstance?.currentStepIndex ?? 0) === 0}
        >
          ← 上一步
        </button>
        <button class="btn btn-secondary" onclick={handleSkip}>跳过</button>
        <button class="btn btn-primary" onclick={handleStart} disabled={isExecuting}>
          {currentStep?.interventionLevel === 0 ? "开始执行" : "确认执行"}
        </button>
      {:else if isRunning}
        <button class="btn btn-secondary" onclick={handlePause}>暂停</button>
        <button class="btn btn-primary" onclick={handleNext} disabled={isExecuting}>
          {isExecuting ? "执行中..." : "下一步 →"}
        </button>
      {:else if isWaiting}
        <button class="btn btn-secondary" onclick={handlePrev}>← 上一步</button>
        <button class="btn btn-secondary" onclick={handleSkip}>跳过</button>
        <button class="btn btn-primary" onclick={handleNext} disabled={isExecuting}>
          确认执行
        </button>
      {/if}
    </div>

    <!-- Workflow Actions -->
    <div class="workflow-actions">
      {#if (activeInstance?.status ?? "") === "completed"}
        <button class="btn btn-secondary" onclick={handleReset}>重新开始</button>
        <button class="btn btn-primary" onclick={() => (showTemplateSelector = true)}>
          新工作流
        </button>
      {:else if activeInstance && activeInstance.status !== "completed" && activeInstance.status !== "cancelled"}
        <button class="btn btn-danger" onclick={handleCancel}>取消</button>
      {/if}
    </div>

    <!-- Context Panel Toggle -->
    <button class="context-toggle" onclick={() => (showContextPanel = !showContextPanel)}>
      {showContextPanel ? "隐藏" : "显示"}上下文
    </button>

    <!-- Context Panel -->
    {#if showContextPanel}
      <div class="context-panel">
        <h5>上下文信息</h5>
        <div class="context-field">
          <label>项目路径</label>
          <input
            type="text"
            value={workflowStore.state.currentContext.projectPath ?? ""}
            onchange={(e) => workflowStore.updateContext({ projectPath: e.currentTarget.value })}
            placeholder="/path/to/project"
          />
        </div>
        <div class="context-field">
          <label>相关文件</label>
          <textarea
            value={workflowStore.state.currentContext.relevantFiles.join("\n")}
            onchange={(e) =>
              workflowStore.updateContext({
                relevantFiles: e.currentTarget.value.split("\n").filter(Boolean),
              })}
            placeholder="每行一个文件路径"
            rows="3"
          ></textarea>
        </div>
      </div>
    {/if}

    <!-- Checkpoint History -->
    {#if (activeInstance?.checkpoints.length ?? 0) > 0}
      <div class="checkpoint-section">
        <h5>执行历史</h5>
        <div class="checkpoint-list">
          {#each activeInstance?.checkpoints ?? [] as cp, index}
            <div class="checkpoint-item">
              <span class="checkpoint-time">
                {new Date(cp.timestamp).toLocaleTimeString()}
              </span>
              <span class="checkpoint-step">Step {cp.stepIndex + 1}</span>
              <span class="checkpoint-status" class:completed={cp.completed}>
                {cp.completed ? "完成" : "跳过"}
              </span>
              <button
                class="btn btn-icon"
                onclick={() => handleRestoreCheckpoint(index)}
                title="恢复到此点"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="1,4 1,10 7,10" /><path d="M3.51 15a9 9 0 105.64-11.36L1 10" />
                </svg>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .workflow-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    background: transparent;
    max-height: 100%;
    overflow-y: auto;
    color: hsl(var(--foreground));
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0.85rem;
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1rem;
    background: hsl(var(--background) / 0.42);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* Template Selector */
  .template-selector {
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1.1rem;
    padding: 0.75rem;
    background: hsl(var(--background) / 0.38);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .selector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.65rem;
  }

  .selector-header h4 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 0.55rem;
  }

  .template-card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.75rem;
    background: hsl(var(--muted) / 0.28);
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1rem;
    cursor: pointer;
    text-align: left;
    color: hsl(var(--foreground));
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      transform 0.18s ease;
  }

  .template-card:hover {
    border-color: hsl(var(--primary) / 0.42);
    background: hsl(var(--accent) / 0.14);
    transform: translateY(-1px);
  }

  .template-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: hsl(var(--primary));
  }

  .template-name {
    font-weight: 600;
    font-size: 0.82rem;
  }

  .template-desc {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.4;
  }

  .template-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.25rem;
  }

  .category-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.625rem;
    color: white;
    text-transform: uppercase;
  }

  .template-time {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    padding: 2.5rem 1rem;
    text-align: center;
    border: 1px solid hsl(var(--border) / 0.36);
    border-radius: 1.35rem;
    background: hsl(var(--background) / 0.32);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
    color: hsl(var(--muted-foreground));
  }

  .empty-state p {
    color: hsl(var(--muted-foreground));
    margin: 0;
    font-size: 0.8rem;
  }

  /* Progress */
  .progress-section {
    padding: 0.75rem;
    background: hsl(var(--background) / 0.38);
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1rem;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .workflow-name {
    font-weight: 500;
    font-size: 0.78rem;
  }

  .progress-percent {
    color: hsl(var(--primary));
    font-weight: 600;
    font-size: 0.75rem;
  }

  .progress-bar {
    height: 4px;
    background: hsl(var(--muted) / 0.65);
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--miwarp-accent-violet)));
    transition: width 0.3s ease;
  }

  /* Step Indicator */
  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0.75rem;
    overflow-x: auto;
    border: 1px solid hsl(var(--border) / 0.32);
    border-radius: 1rem;
    background: hsl(var(--background) / 0.28);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .step-dot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .step-icon {
    font-size: 0.78rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: hsl(var(--muted) / 0.62);
    color: hsl(var(--muted-foreground));
  }

  .step-number {
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground));
  }

  .step-dot.completed .step-icon {
    background: hsl(var(--miwarp-status-success));
    color: white;
  }

  .step-dot.active .step-icon {
    background: hsl(var(--primary));
    color: white;
  }

  .step-dot.skipped .step-icon {
    background: hsl(var(--muted-foreground));
    color: white;
  }

  .step-dot.failed .step-icon {
    background: hsl(var(--destructive));
    color: white;
  }

  .step-connector {
    flex: 1;
    height: 2px;
    min-width: 20px;
    background: hsl(var(--border) / 0.55);
    margin: 0 0.25rem;
    margin-bottom: 1.25rem;
  }

  .step-connector.completed {
    background: hsl(var(--miwarp-status-success));
  }

  /* Step Details */
  .step-details {
    padding: 0.85rem;
    background: hsl(var(--background) / 0.38);
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1.15rem;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .step-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.75rem;
  }

  .step-title-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .step-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .intervention-badge {
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    font-size: 0.625rem;
    border: 1px solid hsl(var(--border) / 0.28);
  }

  .intervention-badge.level-0 {
    background: hsl(var(--miwarp-status-success) / 0.14);
    color: hsl(var(--miwarp-status-success));
  }

  .intervention-badge.level-1 {
    background: hsl(var(--miwarp-status-info) / 0.14);
    color: hsl(var(--miwarp-status-info));
  }

  .intervention-badge.level-2 {
    background: hsl(var(--miwarp-status-warning) / 0.14);
    color: hsl(var(--miwarp-status-warning));
  }

  .intervention-badge.level-3 {
    background: hsl(var(--destructive) / 0.14);
    color: hsl(var(--destructive));
  }

  .step-time {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .step-instruction {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: hsl(var(--foreground) / 0.82);
  }

  /* Prompt Sections */
  .prompt-section,
  .custom-prompt,
  .tools-section {
    margin-bottom: 1rem;
  }

  .prompt-section h5,
  .custom-prompt h5,
  .tools-section h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .prompt-preview {
    margin: 0;
    padding: 0.75rem;
    background: hsl(var(--muted) / 0.34);
    border-radius: 0.9rem;
    font-size: 0.75rem;
    white-space: pre-wrap;
    color: hsl(var(--foreground) / 0.86);
    border: 1px solid hsl(var(--border) / 0.42);
  }

  .prompt-input {
    width: 100%;
    padding: 0.75rem;
    background: hsl(var(--background) / 0.42);
    border: 1px solid hsl(var(--border) / 0.48);
    border-radius: 0.95rem;
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    font-family: inherit;
    resize: vertical;
  }

  .prompt-input:focus {
    outline: none;
    border-color: hsl(var(--primary) / 0.55);
  }

  /* Tools */
  .tools-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tool-badge {
    padding: 0.25rem 0.75rem;
    background: hsl(var(--muted) / 0.36);
    border: 1px solid hsl(var(--border) / 0.4);
    border-radius: 999px;
    font-size: 0.75rem;
    color: hsl(var(--primary));
  }

  /* Status Messages */
  .status-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 1rem;
    font-size: 0.875rem;
  }

  .status-message.waiting {
    background: hsl(var(--miwarp-status-warning) / 0.1);
    border: 1px solid hsl(var(--miwarp-status-warning) / 0.28);
    color: hsl(var(--miwarp-status-warning));
  }

  .status-message.error {
    background: hsl(var(--destructive) / 0.1);
    border: 1px solid hsl(var(--destructive) / 0.28);
    color: hsl(var(--destructive));
  }

  .status-icon {
    font-size: 1rem;
  }

  /* Control Buttons */
  .control-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .workflow-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
    padding-top: 0.5rem;
  }

  /* Context Panel */
  .context-toggle {
    background: hsl(var(--background) / 0.28);
    border: 1px solid hsl(var(--border) / 0.36);
    border-radius: 999px;
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.5rem;
    text-align: center;
  }

  .context-toggle:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent) / 0.12);
  }

  .context-panel {
    padding: 0.85rem;
    background: hsl(var(--background) / 0.38);
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1.15rem;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .context-panel h5 {
    margin: 0 0 0.75rem 0;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    text-transform: uppercase;
  }

  .context-field {
    margin-bottom: 0.75rem;
  }

  .context-field label {
    display: block;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    margin-bottom: 0.25rem;
  }

  .context-field input,
  .context-field textarea {
    width: 100%;
    padding: 0.5rem;
    background: hsl(var(--background) / 0.42);
    border: 1px solid hsl(var(--border) / 0.48);
    border-radius: 0.85rem;
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    font-family: inherit;
  }

  .context-field input:focus,
  .context-field textarea:focus {
    outline: none;
    border-color: hsl(var(--primary) / 0.55);
  }

  /* Checkpoints */
  .checkpoint-section {
    padding: 0.75rem;
    background: hsl(var(--background) / 0.38);
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 1.15rem;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .checkpoint-section h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    text-transform: uppercase;
  }

  .checkpoint-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .checkpoint-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.25rem;
    font-size: 0.75rem;
    border-bottom: 1px solid hsl(var(--border) / 0.28);
  }

  .checkpoint-item:last-child {
    border-bottom: none;
  }

  .checkpoint-time {
    color: hsl(var(--muted-foreground));
  }

  .checkpoint-step {
    color: hsl(var(--foreground));
  }

  .checkpoint-status {
    color: hsl(var(--muted-foreground));
  }

  .checkpoint-status.completed {
    color: hsl(var(--miwarp-status-success));
  }

  /* Buttons */
  .btn {
    padding: 0.48rem 0.82rem;
    border: 1px solid hsl(var(--border) / 0.42);
    border-radius: 999px;
    cursor: pointer;
    font-size: 0.78rem;
    background: hsl(var(--background) / 0.36);
    color: hsl(var(--foreground));
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--miwarp-accent-violet)));
    border-color: hsl(var(--primary) / 0.42);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    border-color: hsl(var(--primary) / 0.7);
  }

  .btn-secondary {
    background: hsl(var(--muted) / 0.34);
    color: hsl(var(--foreground) / 0.86);
  }

  .btn-secondary:hover:not(:disabled) {
    background: hsl(var(--accent) / 0.12);
  }

  .btn-danger {
    background: hsl(var(--destructive) / 0.13);
    border-color: hsl(var(--destructive) / 0.32);
    color: hsl(var(--destructive));
  }

  .btn-danger:hover:not(:disabled) {
    background: hsl(var(--destructive) / 0.18);
  }

  .btn-icon {
    padding: 0.45rem;
    background: transparent;
    border: 1px solid hsl(var(--border) / 0.42);
    color: hsl(var(--muted-foreground));
  }

  .btn-icon:hover:not(:disabled) {
    background: hsl(var(--accent) / 0.12);
    color: hsl(var(--foreground));
  }
</style>
