<!--
  TaskExecutionMonitor.svelte
  
  Real-time monitoring component for scheduled task execution.
  Based on Claude Cowork design patterns.
-->
<script lang="ts">
  import type { ExecutionLog } from "$lib/types/task-execution-monitor";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";

  interface Props {
    taskId?: string;
    taskName?: string;
    status?: "queued" | "running" | "paused" | "completed" | "failed";
    progress?: number;
    currentStep?: number;
    totalSteps?: number;
    logs?: ExecutionLog[];
    onCancel?: () => void;
    onRetry?: () => void;
    onClose?: () => void;
  }

  let {
    taskId = "",
    taskName = "Task",
    status = "queued",
    progress = 0,
    currentStep = 0,
    totalSteps = 0,
    logs = [],
    onCancel,
    onRetry,
    onClose,
  }: Props = $props();

  // Auto-scroll logs
  let logContainer: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (logContainer && logs.length > 0) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });

  // Status configuration
  const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    queued: { label: t("taskExec_queued"), color: "text-muted-foreground", bgColor: "bg-muted" },
    running: {
      label: t("taskExec_running"),
      color: "text-miwarp-status-info",
      bgColor: "bg-[hsl(var(--miwarp-status-info)/0.1)]",
    },
    paused: {
      label: t("taskExec_paused"),
      color: "text-miwarp-status-warning",
      bgColor: "bg-[hsl(var(--miwarp-status-warning)/0.1)]",
    },
    completed: {
      label: t("taskExec_completed"),
      color: "text-miwarp-status-success",
      bgColor: "bg-[hsl(var(--miwarp-status-success)/0.1)]",
    },
    failed: { label: t("taskExec_failed"), color: "text-miwarp-status-error", bgColor: "bg-[hsl(var(--miwarp-status-error)/0.1)]" },
  };

  let config = $derived(statusConfig[status] || statusConfig.queued);

  // Format timestamp
  function formatTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return timestamp;
    }
  }

  // Get log level icon
  function getLogIcon(level: string): string {
    switch (level) {
      case "error":
        return "❌";
      case "warn":
        return "⚠️";
      case "info":
      default:
        return "ℹ️";
    }
  }

  // Get log level color
  function getLogColor(level: string): string {
    switch (level) {
      case "error":
        return "text-miwarp-status-error";
      case "warn":
        return "text-miwarp-status-warning";
      default:
        return "text-foreground";
    }
  }
</script>

<div class="flex h-full flex-col rounded-lg border bg-background">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-full {config.bgColor}">
        {#if status === "running"}
          <Icon name="loader-2" size="lg" class="animate-spin {config.color}" />
        {:else if status === "completed"}
          <svg
            class="h-5 w-5 {config.color}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else if status === "failed"}
          <svg
            class="h-5 w-5 {config.color}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        {:else}
          <Icon name="clock" class="h-5 w-5 {config.color}" />
        {/if}
      </div>
      <div>
        <h3 class="font-medium">{taskName}</h3>
        <p class="text-xs text-muted-foreground">
          {#if taskId}
            ID: {taskId.slice(0, 8)}...
          {/if}
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="rounded-md px-2 py-1 text-xs font-medium {config.bgColor} {config.color}">
        {config.label}
      </span>
      <button
        class="rounded-md p-1.5 hover:bg-accent transition-colors"
        aria-label="Close"
        onclick={() => onClose?.()}
      >
        <Icon name="x" size="md" />
      </button>
    </div>
  </div>

  <!-- Progress -->
  <div class="border-b px-4 py-3">
    <div class="flex items-center justify-between text-sm mb-2">
      <span class="text-muted-foreground">
        {t("taskExec_stepProgress", { currentStep: String(currentStep), totalSteps: String(totalSteps) })}
      </span>
      <span class="font-medium">{progress.toFixed(0)}%</span>
    </div>
    <div class="h-2 rounded-full bg-muted overflow-hidden">
      <div
        class="h-full rounded-full transition-all duration-300
          {status === 'failed'
          ? 'bg-miwarp-status-error'
          : status === 'completed'
            ? 'bg-miwarp-status-success'
            : 'bg-primary'}"
        style="width: {progress}%"
      ></div>
    </div>
  </div>

  <!-- Logs -->
  <div bind:this={logContainer} class="flex-1 overflow-y-auto p-4 font-mono text-xs">
    {#if logs.length === 0}
      <EmptyState
        title={t("taskExecution_waiting")}
        class="h-full text-muted-foreground"
      >
        {#snippet iconComponent()}
          <Icon name="clock" size="lg" class="opacity-50 mb-2" />
        {/snippet}
      </EmptyState>
    {:else}
      <div class="space-y-1">
        {#each logs as log}
          <div class="flex items-start gap-2 py-1 {getLogColor(log.level)}">
            <span class="shrink-0 opacity-50">{formatTime(log.timestamp)}</span>
            <span>{getLogIcon(log.level)}</span>
            <span class="flex-1 break-all">{log.message}</span>
            {#if log.stepId}
              <span class="shrink-0 text-muted-foreground">[{log.stepId}]</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Actions -->
  <div class="flex items-center justify-between border-t px-4 py-3">
    <div class="text-xs text-muted-foreground">
      {#if status === "running"}
        <span class="flex items-center gap-1">
          <span class="h-2 w-2 rounded-full bg-miwarp-status-info animate-pulse"></span>
          {t("taskExec_processing")}
        </span>
      {:else if status === "completed"}
        <span class="flex items-center gap-1 text-miwarp-status-success">
          ✓ {t("taskExec_completedSuccess")}
        </span>
      {:else if status === "failed"}
        <span class="flex items-center gap-1 text-miwarp-status-error">
          ✗ {t("taskExec_execFailed")}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if status === "running"}
        <button
          class="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
          onclick={() => onCancel?.()}
        >
          {t("taskExec_cancel")}
        </button>
      {/if}
      {#if status === "failed"}
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onclick={() => onRetry?.()}
        >
          {t("taskExec_retry")}
        </button>
      {/if}
    </div>
  </div>
</div>
