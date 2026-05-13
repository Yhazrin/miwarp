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

  function getStepIcon(step: WorkflowStep): string {
    switch (step.status) {
      case "completed":
        return "✓";
      case "active":
        return "▶";
      case "skipped":
        return "⏭";
      case "failed":
        return "✗";
      default:
        return "○";
    }
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
      📋
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
            <span class="template-icon">{template.icon}</span>
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
      <span class="empty-icon">🚀</span>
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
          <span class="step-icon">{getStepIcon(step)}</span>
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
              Step {activeInstance?.currentStepIndex ?? 0 + 1}: {currentStep.title}
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
            <span class="step-time">⏱ {currentStep.estimatedTime}</span>
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
        <span class="status-icon">⏸</span>
        <span>等待确认...</span>
      </div>
    {/if}

    {#if error}
      <div class="status-message error">
        <span class="status-icon">⚠</span>
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
                ↩
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
    gap: 1rem;
    padding: 1rem;
    background: var(--color-surface, #1a1a1a);
    border-radius: 8px;
    max-height: 100%;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  /* Template Selector */
  .template-selector {
    background: var(--color-background, #0a0a0a);
    border-radius: 8px;
    padding: 1rem;
  }

  .selector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .selector-header h4 {
    margin: 0;
    font-size: 1rem;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .template-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid var(--color-border, #333);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .template-card:hover {
    border-color: var(--color-primary, #6366f1);
    background: var(--color-hover, #222);
  }

  .template-icon {
    font-size: 2rem;
  }

  .template-name {
    font-weight: 600;
    font-size: 1rem;
  }

  .template-desc {
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
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
    border-radius: 4px;
    font-size: 0.625rem;
    color: white;
    text-transform: uppercase;
  }

  .template-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .empty-icon {
    font-size: 3rem;
    opacity: 0.5;
  }

  .empty-state p {
    color: var(--color-text-secondary, #888);
    margin: 0;
  }

  /* Progress */
  .progress-section {
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 6px;
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .workflow-name {
    font-weight: 500;
  }

  .progress-percent {
    color: var(--color-primary, #6366f1);
    font-weight: 600;
  }

  .progress-bar {
    height: 4px;
    background: var(--color-border, #333);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-primary, #6366f1);
    transition: width 0.3s ease;
  }

  /* Step Indicator */
  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 0.5rem;
    overflow-x: auto;
  }

  .step-dot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .step-icon {
    font-size: 1rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-border, #333);
    color: var(--color-text-secondary, #888);
  }

  .step-number {
    font-size: 0.625rem;
    color: var(--color-text-secondary, #888);
  }

  .step-dot.completed .step-icon {
    background: var(--color-success, #22c55e);
    color: white;
  }

  .step-dot.active .step-icon {
    background: var(--color-primary, #6366f1);
    color: white;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.3);
  }

  .step-dot.skipped .step-icon {
    background: var(--color-text-secondary, #888);
    color: white;
  }

  .step-dot.failed .step-icon {
    background: var(--color-error, #ef4444);
    color: white;
  }

  .step-connector {
    flex: 1;
    height: 2px;
    min-width: 20px;
    background: var(--color-border, #333);
    margin: 0 0.25rem;
    margin-bottom: 1.25rem;
  }

  .step-connector.completed {
    background: var(--color-success, #22c55e);
  }

  /* Step Details */
  .step-details {
    padding: 1rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 6px;
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
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .step-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .intervention-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.625rem;
    text-transform: uppercase;
  }

  .intervention-badge.level-0 {
    background: #22c55e;
    color: white;
  }

  .intervention-badge.level-1 {
    background: #3b82f6;
    color: white;
  }

  .intervention-badge.level-2 {
    background: #f59e0b;
    color: black;
  }

  .intervention-badge.level-3 {
    background: #ef4444;
    color: white;
  }

  .step-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
  }

  .step-instruction {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text, #e5e5e5);
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
    color: var(--color-text-secondary, #888);
    text-transform: uppercase;
  }

  .prompt-preview {
    margin: 0;
    padding: 0.75rem;
    background: var(--color-surface, #1a1a1a);
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: pre-wrap;
    color: var(--color-text, #e5e5e5);
    border: 1px solid var(--color-border, #333);
  }

  .prompt-input {
    width: 100%;
    padding: 0.75rem;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, #e5e5e5);
    font-size: 0.875rem;
    font-family: inherit;
    resize: vertical;
  }

  .prompt-input:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  /* Tools */
  .tools-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tool-badge {
    padding: 0.25rem 0.75rem;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--color-primary, #6366f1);
  }

  /* Status Messages */
  .status-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .status-message.waiting {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #f59e0b;
  }

  .status-message.error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .status-icon {
    font-size: 1rem;
  }

  /* Control Buttons */
  .control-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .workflow-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border, #333);
  }

  /* Context Panel */
  .context-toggle {
    background: transparent;
    border: none;
    color: var(--color-text-secondary, #888);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.5rem;
    text-align: center;
  }

  .context-toggle:hover {
    color: var(--color-text, #e5e5e5);
  }

  .context-panel {
    padding: 1rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 6px;
  }

  .context-panel h5 {
    margin: 0 0 0.75rem 0;
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
    text-transform: uppercase;
  }

  .context-field {
    margin-bottom: 0.75rem;
  }

  .context-field label {
    display: block;
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
    margin-bottom: 0.25rem;
  }

  .context-field input,
  .context-field textarea {
    width: 100%;
    padding: 0.5rem;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, #e5e5e5);
    font-size: 0.875rem;
    font-family: inherit;
  }

  .context-field input:focus,
  .context-field textarea:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  /* Checkpoints */
  .checkpoint-section {
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 6px;
  }

  .checkpoint-section h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
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
    padding: 0.25rem 0;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .checkpoint-item:last-child {
    border-bottom: none;
  }

  .checkpoint-time {
    color: var(--color-text-secondary, #888);
  }

  .checkpoint-step {
    color: var(--color-text, #e5e5e5);
  }

  .checkpoint-status {
    color: var(--color-text-secondary, #888);
  }

  .checkpoint-status.completed {
    color: var(--color-success, #22c55e);
  }

  /* Buttons */
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--color-primary, #6366f1);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-hover, #4f46e5);
  }

  .btn-secondary {
    background: var(--color-secondary, #333);
    color: white;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-secondary-hover, #444);
  }

  .btn-danger {
    background: var(--color-error, #ef4444);
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }

  .btn-icon {
    padding: 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border, #333);
    color: var(--color-text-secondary, #888);
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--color-hover, #222);
    color: var(--color-text, #e5e5e5);
  }
</style>
