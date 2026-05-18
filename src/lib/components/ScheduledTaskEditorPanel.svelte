<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type {
    Agent,
    ScheduleConfig,
    WorkspaceInfo,
    ScheduledTaskInput,
    ScheduledTaskPatch,
  } from "$lib/types/scheduled-task";

  // Simplified schedule state
  type SimpleScheduleType = "daily" | "weekly" | "interval" | "one-time";
  let scheduleType = $state<SimpleScheduleType>("daily");
  let schedHour = $state(9);
  let schedMinute = $state(0);
  let schedIntervalMin = $state(30);
  let schedWeekdays = $state<number[]>([1, 2, 3, 4, 5]);
  let fireAtDate = $state("");
  let fireAtTime = $state("09:00");

  // Form state
  let name = $state("");
  let prompt = $state("");
  let agent = $state<Agent>("claude");
  let workspaceCwd = $state("");

  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

  // Initialize from editing task or reset for new
  $effect(() => {
    const task = scheduledTasksStore.editingTask;
    if (task) {
      name = task.name;
      prompt = task.prompt;
      agent = task.agent;
      workspaceCwd = task.workspace.cwd;

      // Parse schedule
      if (task.schedule.type === "cron" && task.schedule.cronExpression) {
        const expr = task.schedule.cronExpression;
        if (expr === "* * * * *") {
          scheduleType = "interval";
          schedIntervalMin = 1;
        } else if (expr.startsWith("*/")) {
          scheduleType = "interval";
          schedIntervalMin = parseInt(expr.slice(2)) || 30;
        } else {
          const parts = expr.trim().split(/\s+/);
          if (parts.length === 5) {
            const [, hour, day, , weekday] = parts;
            schedHour = parseInt(hour) || 9;
            schedMinute = parseInt(parts[0]) || 0;
            if (weekday !== "*") {
              scheduleType = "weekly";
              schedWeekdays = weekday
                .split(",")
                .map(Number)
                .filter((n) => !isNaN(n));
            } else if (day !== "*") {
              // monthly - fall back to daily
              scheduleType = "daily";
            } else {
              scheduleType = "daily";
            }
          }
        }
      } else if (task.schedule.type === "interval") {
        scheduleType = "interval";
        schedIntervalMin = task.schedule.intervalMinutes ?? 30;
      } else if (task.schedule.type === "one-time") {
        scheduleType = "one-time";
        if (task.schedule.fireAt) {
          const date = new Date(task.schedule.fireAt);
          fireAtDate = date.toISOString().split("T")[0];
          fireAtTime = date.toTimeString().slice(0, 5);
        }
      } else {
        scheduleType = "daily";
      }
    } else {
      // Reset for new task
      name = "";
      prompt = "";
      agent = "claude";
      workspaceCwd = "";
      scheduleType = "daily";
      schedHour = 9;
      schedMinute = 0;
      schedIntervalMin = 30;
      schedWeekdays = [1, 2, 3, 4, 5];
      fireAtDate = "";
      fireAtTime = "09:00";
    }
    errors = {};
  });

  function toggleWeekday(day: number) {
    if (schedWeekdays.includes(day)) {
      schedWeekdays = schedWeekdays.filter((d) => d !== day);
    } else {
      schedWeekdays = [...schedWeekdays, day].sort();
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t("schedEditor_errorName");
    if (!prompt.trim()) e.prompt = t("schedEditor_errorPrompt");
    if (!workspaceCwd.trim()) e.workspace = t("schedEditor_errorWorkspace");
    errors = e;
    return Object.keys(e).length === 0;
  }

  function buildSchedule(): ScheduleConfig {
    switch (scheduleType) {
      case "daily":
        return { type: "cron", cronExpression: `${schedMinute} ${schedHour} * * *` };
      case "weekly": {
        const days = schedWeekdays.length > 0 ? schedWeekdays.join(",") : "1";
        return { type: "cron", cronExpression: `${schedMinute} ${schedHour} * * ${days}` };
      }
      case "interval":
        return { type: "interval", intervalMinutes: schedIntervalMin };
      case "one-time":
        return { type: "one-time", fireAt: new Date(`${fireAtDate}T${fireAtTime}`).toISOString() };
    }
  }

  function buildWorkspace(): WorkspaceInfo {
    return { cwd: workspaceCwd.trim() };
  }

  async function handleSubmit() {
    if (!validate()) return;
    saving = true;
    try {
      const schedule = buildSchedule();
      const workspace = buildWorkspace();

      if (scheduledTasksStore.editorMode === "create") {
        const input: ScheduledTaskInput = {
          name: name.trim(),
          prompt: prompt.trim(),
          workspace,
          agent,
          schedule,
          enabled: true,
        };
        await scheduledTasksStore.createTask(input);
      } else {
        const task = scheduledTasksStore.editingTask!;
        const patch: ScheduledTaskPatch = {
          name: name.trim(),
          prompt: prompt.trim(),
          workspace,
          agent,
          schedule,
        };
        await scheduledTasksStore.updateTask(task.id, patch);
      }
    } finally {
      saving = false;
    }
  }

  function handleCancel() {
    scheduledTasksStore.closeEditor();
  }

  const schedulePreview = $derived.by(() => {
    switch (scheduleType) {
      case "daily":
        return `${schedHour.toString().padStart(2, "0")}:${schedMinute.toString().padStart(2, "0")} ${t("sched_daily")}`;
      case "weekly":
        const days = schedWeekdays.map((d) => WEEKDAY_LABELS[d]).join("");
        return `${schedHour.toString().padStart(2, "0")}:${schedMinute.toString().padStart(2, "0")} ${t("sched_weekly")} ${days}`;
      case "interval":
        return `${t("sched_every")} ${schedIntervalMin} ${t("sched_minutes")}`;
      case "one-time":
        if (fireAtDate && fireAtTime) {
          return new Date(`${fireAtDate}T${fireAtTime}`).toLocaleString();
        }
        return t("schedCard_noTimeSet");
    }
  });
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
    <h3 class="text-xs font-semibold text-foreground">
      {scheduledTasksStore.editorMode === "create"
        ? t("scheduledTasks_create")
        : t("schedEditor_editTitle")}
    </h3>
    <Button variant="ghost" size="icon" onclick={handleCancel} class="h-6 w-6">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </Button>
  </div>

  <!-- Form -->
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
    class="flex-1 overflow-y-auto p-3 space-y-3"
  >
    <!-- Name -->
    <div class="space-y-1">
      <label
        for="panelTaskName"
        class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
      >
        {t("schedEditor_name")}
      </label>
      <input
        id="panelTaskName"
        type="text"
        bind:value={name}
        placeholder={t("schedEditor_namePlaceholder")}
        class="w-full px-2 py-1.5 rounded-lg border bg-background text-xs
          {errors.name ? 'border-destructive' : 'border-input'}"
      />
      {#if errors.name}
        <p class="text-[10px] text-destructive">{errors.name}</p>
      {/if}
    </div>

    <!-- Workspace -->
    <div class="space-y-1">
      <label
        for="panelWorkspace"
        class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
      >
        {t("schedEditor_workspace")}
      </label>
      <input
        id="panelWorkspace"
        type="text"
        bind:value={workspaceCwd}
        placeholder={t("schedEditor_workspacePlaceholder")}
        class="w-full px-2 py-1.5 rounded-lg border bg-background text-xs font-mono
          {errors.workspace ? 'border-destructive' : 'border-input'}"
      />
      {#if errors.workspace}
        <p class="text-[10px] text-destructive">{errors.workspace}</p>
      {/if}
    </div>

    <!-- Agent -->
    <div class="space-y-1">
      <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {t("schedEditor_agent")}
      </label>
      <div class="flex gap-3">
        <label class="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="panelAgent"
            value="claude"
            bind:group={agent}
            class="text-primary"
          />
          <span class="text-xs">{t("schedEditor_claude")}</span>
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="panelAgent"
            value="codex"
            bind:group={agent}
            class="text-primary"
          />
          <span class="text-xs">{t("schedEditor_codex")}</span>
        </label>
      </div>
    </div>

    <!-- Schedule Type -->
    <div class="space-y-1">
      <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {t("schedEditor_schedule")}
      </label>
      <div class="grid grid-cols-4 gap-1">
        {#each [{ value: "daily", label: t("sched_daily") }, { value: "weekly", label: t("sched_weekly") }, { value: "interval", label: t("sched_interval") }, { value: "one-time", label: t("sched_oneTime") }] as opt}
          <button
            type="button"
            onclick={() => (scheduleType = opt.value as SimpleScheduleType)}
            class="px-2 py-1 text-[10px] rounded-lg border transition-colors {scheduleType ===
            opt.value
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border text-muted-foreground hover:border-primary/50'}"
          >
            {opt.label}
          </button>
        {/each}
      </div>

      <!-- Daily time picker -->
      {#if scheduleType === "daily" || scheduleType === "weekly"}
        <div class="flex items-center gap-1 mt-1">
          <select
            bind:value={schedHour}
            class="px-1.5 py-1 rounded-lg border border-input bg-background text-[10px]"
          >
            {#each Array.from({ length: 24 }, (_, i) => i) as h}
              <option value={h}>{h.toString().padStart(2, "0")}</option>
            {/each}
          </select>
          <span class="text-[10px]">:</span>
          <select
            bind:value={schedMinute}
            class="px-1.5 py-1 rounded-lg border border-input bg-background text-[10px]"
          >
            {#each [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as m}
              <option value={m}>{m.toString().padStart(2, "0")}</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Weekday picker -->
      {#if scheduleType === "weekly"}
        <div class="flex gap-1 mt-1">
          {#each [0, 1, 2, 3, 4, 5, 6] as day}
            <button
              type="button"
              onclick={() => toggleWeekday(day)}
              class="h-6 w-6 rounded-lg text-[10px] font-medium border transition-colors {schedWeekdays.includes(
                day,
              )
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'}"
            >
              {WEEKDAY_LABELS[day]}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Interval picker -->
      {#if scheduleType === "interval"}
        <div class="flex items-center gap-1 mt-1">
          <span class="text-[10px] text-muted-foreground">{t("sched_every")}</span>
          <select
            bind:value={schedIntervalMin}
            class="px-1.5 py-1 rounded-lg border border-input bg-background text-[10px]"
          >
            {#each [5, 10, 15, 20, 30, 45, 60] as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
          <span class="text-[10px] text-muted-foreground">{t("sched_minutes")}</span>
        </div>
      {/if}

      <!-- One-time picker -->
      {#if scheduleType === "one-time"}
        <div class="flex gap-1 mt-1">
          <input
            type="date"
            bind:value={fireAtDate}
            class="flex-1 px-1.5 py-1 rounded-lg border border-input bg-background text-[10px]"
          />
          <input
            type="time"
            bind:value={fireAtTime}
            class="w-20 px-1.5 py-1 rounded-lg border border-input bg-background text-[10px]"
          />
        </div>
      {/if}
    </div>

    <!-- Prompt -->
    <div class="space-y-1">
      <label
        for="panelPrompt"
        class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
      >
        {t("schedEditor_prompt")}
      </label>
      <textarea
        id="panelPrompt"
        bind:value={prompt}
        placeholder={t("schedEditor_promptPlaceholder")}
        rows="4"
        class="w-full px-2 py-1.5 rounded-lg border bg-background text-xs resize-y
          {errors.prompt ? 'border-destructive' : 'border-input'}"
      ></textarea>
      {#if errors.prompt}
        <p class="text-[10px] text-destructive">{errors.prompt}</p>
      {/if}
    </div>

    <!-- Preview -->
    <p class="text-[10px] text-muted-foreground/60">
      {schedulePreview}
    </p>
  </form>

  <!-- Actions -->
  <div class="flex gap-2 p-3 border-t border-border/30 shrink-0">
    <Button variant="outline" size="sm" onclick={handleCancel} class="flex-1 text-[10px] h-7">
      {t("schedEditor_cancel")}
    </Button>
    <Button
      variant="default"
      size="sm"
      loading={saving}
      onclick={handleSubmit}
      class="flex-1 text-[10px] h-7"
    >
      {scheduledTasksStore.editorMode === "create"
        ? t("schedEditor_create")
        : t("schedEditor_save")}
    </Button>
  </div>
</div>
