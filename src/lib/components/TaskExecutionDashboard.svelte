<script lang="ts">
  import type { SkillExecutionEnhanced } from "$lib/types/skill-execution";
  import { createTaskDashboard } from "$lib/services/task-execution-dashboard";

  interface Props {
    executions?: SkillExecutionEnhanced[];
    title?: string;
  }

  let { executions = [], title }: Props = $props();

  let dashboard = $derived(createTaskDashboard(executions));
  let stats = $derived(dashboard.getStats());
  let health = $derived(dashboard.getHealthStatus());
  let trends = $derived(dashboard.getTrends(7));
  let skillStats = $derived(dashboard.getSkillStats());

  let healthColor = $derived.by(() => {
    switch (health.status) {
      case "healthy":
        return "text-miwarp-status-success";
      case "warning":
        return "text-miwarp-status-warning";

      case "critical":
        return "text-miwarp-status-error";
    }
  });

  let healthBg = $derived.by(() => {
    switch (health.status) {
      case "healthy":
        return "bg-miwarp-status-success";
      case "warning":
        return "bg-miwarp-status-warning";

      case "critical":
        return "bg-miwarp-status-error";
    }
  });

  function formatDuration(ms: number): string {
    if (ms === 0) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }

  function formatTrendDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
</script>

<div class="flex flex-col gap-4 p-4">
  {#if title}
    <h2 class="text-lg font-semibold">{title}</h2>
  {/if}

  <!-- 健康度概览 -->
  <div class="rounded-lg border border-border/40 bg-card p-4">
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-medium text-muted-foreground">任务健康度</span>
      <span class={`text-lg font-bold ${healthColor}`}>
        {health.score}
      </span>
    </div>
    <div class="h-2 rounded-full bg-border/30 overflow-hidden">
      <div
        class={`h-full transition-all duration-500 ${healthBg}`}
        style:width={`${health.score}%`}
      ></div>
    </div>
    <div class="mt-2 flex flex-wrap gap-2">
      {#each health.factors as factor}
        <span
          class={`text-xs px-2 py-0.5 rounded ${
            factor.status === "good"
              ? "bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success"
              : factor.status === "warning"
                ? "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning"
                : "bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error"
          }`}
        >
          {factor.name}: {Math.round(factor.value)}%
        </span>
      {/each}
    </div>
  </div>

  <!-- 统计卡片 -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="rounded-lg border border-border/40 bg-card p-3">
      <div class="text-xs text-muted-foreground">总任务</div>
      <div class="text-xl font-bold">{stats.totalTasks}</div>
    </div>
    <div class="rounded-lg border border-border/40 bg-card p-3">
      <div class="text-xs text-muted-foreground">进行中</div>
      <div class="text-xl font-bold text-miwarp-status-info">{stats.activeTasks}</div>
    </div>
    <div class="rounded-lg border border-border/40 bg-card p-3">
      <div class="text-xs text-muted-foreground">成功率</div>
      <div class="text-xl font-bold text-miwarp-status-success">{Math.round(stats.avgSuccessRate)}%</div>
    </div>
    <div class="rounded-lg border border-border/40 bg-card p-3">
      <div class="text-xs text-muted-foreground">平均时长</div>
      <div class="text-xl font-bold">{formatDuration(stats.avgDuration)}</div>
    </div>
  </div>

  <!-- 详细统计 -->
  <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full bg-miwarp-status-success"></span>
      <span class="text-muted-foreground">已完成</span>
      <span class="ml-auto font-medium">{stats.completedTasks}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full bg-miwarp-status-error"></span>
      <span class="text-muted-foreground">失败</span>
      <span class="ml-auto font-medium">{stats.failedTasks}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full bg-miwarp-status-warning"></span>
      <span class="text-muted-foreground">待处理</span>
      <span class="ml-auto font-medium">{stats.pendingTasks}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full bg-muted-foreground"></span>
      <span class="text-muted-foreground">24h内</span>
      <span class="ml-auto font-medium">{stats.tasksLast24h}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full bg-muted-foreground"></span>
      <span class="text-muted-foreground">7天内</span>
      <span class="ml-auto font-medium">{stats.tasksLast7d}</span>
    </div>
  </div>

  <!-- 趋势图表 -->
  {#if trends.length > 0}
    <div class="rounded-lg border border-border/40 bg-card p-4">
      <h3 class="text-sm font-medium text-muted-foreground mb-3">7天趋势</h3>
      <div class="flex items-end gap-1 h-20">
        {#each trends as trend}
          {@const maxVal = Math.max(...trends.map((t) => t.completed + t.failed + t.cancelled), 1)}
          {@const height = ((trend.completed + trend.failed + trend.cancelled) / maxVal) * 100}
          <div
            class="flex-1 flex flex-col items-center gap-0.5"
            title={formatTrendDate(trend.date)}
          >
            <div class="w-full flex flex-col-reverse rounded-t" style:height={`${height}%`}>
              {#if trend.completed > 0}
                <div
                  class="bg-miwarp-status-success flex-1"
                  style:height={`${(trend.completed / (trend.completed + trend.failed + trend.cancelled)) * 100}%`}
                ></div>
              {/if}
              {#if trend.failed > 0}
                <div
                  class="bg-miwarp-status-error"
                  style:height={`${(trend.failed / (trend.completed + trend.failed + trend.cancelled)) * 100}%`}
                ></div>
              {/if}
              {#if trend.cancelled > 0}
                <div
                  class="bg-muted-foreground"
                  style:height={`${(trend.cancelled / (trend.completed + trend.failed + trend.cancelled)) * 100}%`}
                ></div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <div class="mt-2 flex justify-between text-xs text-muted-foreground">
        {#each trends as trend}
          <span>{formatTrendDate(trend.date)}</span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 技能统计 -->
  {#if skillStats.length > 0}
    <div class="rounded-lg border border-border/40 bg-card p-4">
      <h3 class="text-sm font-medium text-muted-foreground mb-3">技能执行统计</h3>
      <div class="space-y-2 max-h-48 overflow-y-auto">
        {#each skillStats.slice(0, 10) as skill}
          <div class="flex items-center gap-3 text-sm">
            <span class="flex-1 truncate">{skill.skillName}</span>
            <span class="text-muted-foreground">{skill.totalExecutions}次</span>
            <span class="w-16 text-right">
              <span
                class={skill.successRate >= 80
                  ? "text-miwarp-status-success"
                  : skill.successRate >= 50
                    ? "text-miwarp-status-warning"
                    : "text-miwarp-status-error"}
              >
                {Math.round(skill.successRate)}%
              </span>
            </span>
            <span class="text-muted-foreground w-16 text-right"
              >{formatDuration(skill.avgDuration)}</span
            >
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
