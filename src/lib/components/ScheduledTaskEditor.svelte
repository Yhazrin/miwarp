<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import {
    INTERVAL_PRESETS,
    DEFAULT_TASK_TEMPLATES,
    type Agent,
    type ScheduleType,
    type ScheduleConfig,
    type WorkspaceInfo,
    type ScheduledTaskInput,
    type ScheduledTaskPatch,
  } from "$lib/types/scheduled-task";
  import { getUserSettings } from "$lib/api";
  import type { UserSettings } from "$lib/types";

  // Friendly schedule builder state
  type FrequencyType =
    | "minutely"
    | "interval_min"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "custom_cron";
  let frequency = $state<FrequencyType>("daily");
  let schedHour = $state(9);
  let schedMinute = $state(0);
  let schedIntervalMin = $state(30); // for interval_min mode
  let schedWeekdays = $state<number[]>([1, 2, 3, 4, 5]); // 0=Sun … 6=Sat
  let schedMonthDay = $state(1);
  let customCronExpr = $state(""); // only used when frequency === "custom_cron"

  // Derived cron expression from friendly inputs
  const cronExpression = $derived.by(() => {
    const h = schedHour.toString();
    const m = schedMinute.toString();
    switch (frequency) {
      case "minutely":
        return "* * * * *";
      case "interval_min":
        return `*/${schedIntervalMin} * * * *`;
      case "hourly":
        return `${m} * * * *`;
      case "daily":
        return `${m} ${h} * * *`;
      case "weekly": {
        const days = schedWeekdays.length > 0 ? schedWeekdays.join(",") : "*";
        return `${m} ${h} * * ${days}`;
      }
      case "monthly":
        return `${m} ${h} ${schedMonthDay} * *`;
      case "custom_cron":
        return customCronExpr.trim();
      default:
        return "0 9 * * *";
    }
  });

  // Form state
  let name = $state("");
  let description = $state("");
  let prompt = $state("");
  let agent = $state<Agent>("claude");
  let scheduleType = $state<ScheduleType>("cron");
  let intervalMinutes = $state(60);
  let fireAtDate = $state("");
  let fireAtTime = $state("09:00");
  let permissionMode = $state<string>("");
  let model = $state("");
  let workspaceCwd = $state("");
  let remoteHostName = $state<string>("");

  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  const FREQUENCY_OPTIONS: { value: FrequencyType; label: string }[] = [
    { value: "minutely", label: "每分钟" },
    { value: "interval_min", label: "每隔N分钟" },
    { value: "hourly", label: "每小时" },
    { value: "daily", label: "每天" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
    { value: "custom_cron", label: "自定义" },
  ];

  function toggleWeekday(day: number) {
    if (schedWeekdays.includes(day)) {
      schedWeekdays = schedWeekdays.filter((d) => d !== day);
    } else {
      schedWeekdays = [...schedWeekdays, day].sort();
    }
  }

  /** Parse an existing cron expression back into friendly fields (best-effort). */
  function parseCronToFriendly(expr: string) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
      frequency = "custom_cron";
      customCronExpr = expr;
      return;
    }
    const [min, hour, day, _month, weekday] = parts;
    if (expr === "* * * * *") {
      frequency = "minutely";
      return;
    }
    if (min.startsWith("*/")) {
      frequency = "interval_min";
      schedIntervalMin = parseInt(min.slice(2)) || 30;
      return;
    }
    if (min !== "*" && hour === "*") {
      frequency = "hourly";
      schedMinute = parseInt(min) || 0;
      return;
    }
    if (min !== "*" && hour !== "*") {
      schedHour = parseInt(hour) || 9;
      schedMinute = parseInt(min) || 0;
      if (weekday !== "*") {
        frequency = "weekly";
        schedWeekdays = weekday
          .split(",")
          .map(Number)
          .filter((n) => !isNaN(n));
      } else if (day !== "*") {
        frequency = "monthly";
        schedMonthDay = parseInt(day) || 1;
      } else {
        frequency = "daily";
      }
      return;
    }
    frequency = "custom_cron";
    customCronExpr = expr;
  }

  // Settings for remote hosts
  let settings = $state<UserSettings | null>(null);
  let folderPickerOpen = $state(false);

  // Validation
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  onMount(async () => {
    try {
      settings = await getUserSettings();
    } catch {
      // ignore
    }
  });

  // Initialize from editing task
  $effect(() => {
    const task = scheduledTasksStore.editingTask;
    if (task) {
      name = task.name;
      description = task.description ?? "";
      prompt = task.prompt;
      agent = task.agent;
      scheduleType = task.schedule.type;
      if (task.schedule.cronExpression) {
        parseCronToFriendly(task.schedule.cronExpression);
      }
      intervalMinutes = task.schedule.intervalMinutes ?? 60;
      permissionMode = task.permissionMode ?? "";
      model = task.model ?? "";
      workspaceCwd = task.workspace.cwd;
      remoteHostName = task.workspace.remoteHostName ?? "";

      if (task.schedule.fireAt) {
        const date = new Date(task.schedule.fireAt);
        fireAtDate = date.toISOString().split("T")[0];
        fireAtTime = date.toTimeString().slice(0, 5);
      } else {
        fireAtDate = "";
        fireAtTime = "09:00";
      }
    } else {
      // Reset for new task
      name = "";
      description = "";
      prompt = "";
      agent = "claude";
      scheduleType = "cron";
      frequency = "daily";
      schedHour = 9;
      schedMinute = 0;
      schedWeekdays = [1, 2, 3, 4, 5];
      schedMonthDay = 1;
      schedIntervalMin = 30;
      customCronExpr = "";
      intervalMinutes = 60;
      fireAtDate = "";
      fireAtTime = "09:00";
      permissionMode = "";
      model = "";
      workspaceCwd = "";
      remoteHostName = "";
    }
    errors = {};
  });

  // Detect context-dependent phrases in prompt
  const CONTEXT_PATTERNS = [
    /\b(上面|刚才|当前对话|如前所述|之前提到)\b/i,
    /\b(the above|current conversation|as mentioned|earlier|previous (?:chat|message|context))\b/i,
    /\b(this (?:code|file|project|component))(?!\s+(?:has|is|needs|uses|in))/i,
  ];
  const promptContextWarning = $derived(() => {
    if (!prompt.trim()) return null;
    for (const pattern of CONTEXT_PATTERNS) {
      if (pattern.test(prompt)) return t("schedEditor_contextWarning");
    }
    return null;
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t("schedEditor_errorName");
    if (!prompt.trim()) e.prompt = t("schedEditor_errorPrompt");
    if (!workspaceCwd.trim()) e.workspace = t("schedEditor_errorWorkspace");

    if (scheduleType === "cron") {
      if (!ScheduledTasksService.validateCronExpression(cronExpression)) {
        e.cronExpression = t("schedEditor_errorCron");
      }
    } else if (scheduleType === "one-time") {
      if (!fireAtDate) e.fireAtDate = t("schedEditor_errorDate");
      if (!fireAtTime) e.fireAtTime = t("schedEditor_errorTime");
    } else if (scheduleType === "interval") {
      if (!intervalMinutes || intervalMinutes < 1) {
        e.intervalMinutes = t("schedEditor_errorInterval");
      }
    }

    errors = e;
    return Object.keys(e).length === 0;
  }

  function buildSchedule(): ScheduleConfig {
    switch (scheduleType) {
      case "cron":
        return { type: "cron", cronExpression: cronExpression.trim() };
      case "one-time":
        return { type: "one-time", fireAt: new Date(`${fireAtDate}T${fireAtTime}`).toISOString() };
      case "interval":
        return { type: "interval", intervalMinutes };
    }
  }

  function buildWorkspace(): WorkspaceInfo {
    return {
      cwd: workspaceCwd.trim(),
      remoteHostName: remoteHostName || undefined,
    };
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
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          workspace,
          agent,
          schedule,
          enabled: true,
          permissionMode: permissionMode || undefined,
          model: model || undefined,
        };
        await scheduledTasksStore.createTask(input);
      } else {
        const task = scheduledTasksStore.editingTask!;
        const patch: ScheduledTaskPatch = {
          name: name.trim(),
          description: description.trim() || null,
          prompt: prompt.trim(),
          workspace,
          agent,
          schedule,
          permissionMode: permissionMode || null,
          model: model || null,
        };
        await scheduledTasksStore.updateTask(task.id, patch);
      }
    } finally {
      saving = false;
    }
  }

  function applyTemplate(template: (typeof DEFAULT_TASK_TEMPLATES)[number]) {
    name = template.name;
    description = template.description;
    prompt = template.prompt;
    scheduleType = template.schedule.type;
    if (template.schedule.cronExpression) {
      parseCronToFriendly(template.schedule.cronExpression);
    }
    if (template.schedule.intervalMinutes) intervalMinutes = template.schedule.intervalMinutes;
  }

  function handleCancel() {
    scheduledTasksStore.closeEditor();
  }

  const remoteHosts = $derived(settings?.remote_hosts ?? []);
</script>

{#if scheduledTasksStore.showEditor}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-miwarp-overlay backdrop-blur-sm">
    <div
      class="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background rounded-xl shadow-2xl border"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-lg font-semibold">
          {scheduledTasksStore.editorMode === "create"
            ? t("schedEditor_createTitle")
            : t("schedEditor_editTitle")}
        </h2>
        <Button variant="ghost" size="icon" onclick={handleCancel} title={t("common_close")}>
          <svg
            class="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      </div>

      <!-- Templates (create mode only) -->
      {#if scheduledTasksStore.editorMode === "create"}
        <div class="px-4 pt-3 pb-1">
          <p class="text-xs text-muted-foreground mb-2">{t("schedEditor_quickStart")}</p>
          <div class="flex flex-wrap gap-1.5">
            {#each DEFAULT_TASK_TEMPLATES as tpl}
              <button
                type="button"
                onclick={() => applyTemplate(tpl)}
                class="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors"
              >
                {tpl.name}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Form -->
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        class="p-4 space-y-4"
      >
        <!-- Name -->
        <div class="space-y-1">
          <label for="taskName" class="text-sm font-medium">{t("schedEditor_name")}</label>
          <input
            id="taskName"
            type="text"
            bind:value={name}
            placeholder={t("schedEditor_namePlaceholder")}
            class="w-full px-3 py-2 rounded-md border bg-background text-sm
              {errors.name ? 'border-destructive' : 'border-input'}"
          />
          {#if errors.name}
            <p class="text-xs text-destructive">{errors.name}</p>
          {/if}
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label for="taskDesc" class="text-sm font-medium">{t("schedEditor_description")}</label>
          <input
            id="taskDesc"
            type="text"
            bind:value={description}
            placeholder={t("schedEditor_descPlaceholder")}
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <!-- Workspace -->
        <div class="space-y-1">
          <label for="sched-workspace" class="text-sm font-medium"
            >{t("schedEditor_workspace")}</label
          >
          <div class="flex gap-2">
            <input
              id="sched-workspace"
              type="text"
              bind:value={workspaceCwd}
              placeholder={t("schedEditor_workspacePlaceholder")}
              class="flex-1 px-3 py-2 rounded-md border bg-background text-sm font-mono
                {errors.workspace ? 'border-destructive' : 'border-input'}"
            />
            <Button variant="outline" size="sm" onclick={() => (folderPickerOpen = true)}>
              {t("schedEditor_browse")}
            </Button>
          </div>
          {#if errors.workspace}
            <p class="text-xs text-destructive">{errors.workspace}</p>
          {/if}
          <FolderPicker
            bind:open={folderPickerOpen}
            initialPath={workspaceCwd}
            onConfirm={(result) => {
              workspaceCwd = result.path;
            }}
          />
        </div>

        <!-- Remote Host (optional) -->
        {#if remoteHosts.length > 0}
          <div class="space-y-1">
            <label for="remoteHost" class="text-sm font-medium">
              {t("schedEditor_remoteHost")}
              <span class="text-muted-foreground">{t("schedEditor_remoteHostOptional")}</span>
            </label>
            <select
              id="remoteHost"
              bind:value={remoteHostName}
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              <option value="">{t("schedEditor_local")}</option>
              {#each remoteHosts as host}
                <option value={host.name}>{host.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Agent -->
        <div class="space-y-1">
          <span class="text-sm font-medium">{t("schedEditor_agent")}</span>
          <div class="flex gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="agent"
                value="claude"
                bind:group={agent}
                class="text-primary"
              />
              <span class="text-sm">{t("schedEditor_claude")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="agent"
                value="codex"
                bind:group={agent}
                class="text-primary"
              />
              <span class="text-sm">{t("schedEditor_codex")}</span>
            </label>
          </div>
        </div>

        <!-- Prompt -->
        <div class="space-y-1">
          <label for="taskPrompt" class="text-sm font-medium">{t("schedEditor_prompt")}</label>
          <textarea
            id="taskPrompt"
            bind:value={prompt}
            placeholder={t("schedEditor_promptPlaceholder")}
            rows="4"
            class="w-full px-3 py-2 rounded-md border bg-background text-sm resize-y
              {errors.prompt ? 'border-destructive' : 'border-input'}"
          ></textarea>
          {#if errors.prompt}
            <p class="text-xs text-destructive">{errors.prompt}</p>
          {:else if promptContextWarning()}
            <p class="text-xs text-[hsl(var(--miwarp-status-warning))] flex items-center gap-1">
              <svg
                class="h-3 w-3 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M12 9v4" /><path d="M12 17h.01" /><path
                  d="M3.6 15.4 10.2 4a2 2 0 0 1 3.6 0l6.6 11.4a2 2 0 0 1-1.8 3H5.4a2 2 0 0 1-1.8-3Z"
                /></svg
              >
              {promptContextWarning()}
            </p>
          {:else}
            <p class="text-xs text-muted-foreground/60">{t("schedEditor_promptHint")}</p>
          {/if}
        </div>

        <!-- Schedule Type -->
        <div class="space-y-2">
          <span class="text-sm font-medium">{t("schedEditor_schedule")}</span>
          <div class="flex gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="cron"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">{t("schedEditor_cron")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="interval"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">{t("schedEditor_interval")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="one-time"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">{t("schedEditor_oneTime")}</span>
            </label>
          </div>
        </div>

        <!-- Cron — friendly builder -->
        {#if scheduleType === "cron"}
          <div class="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <!-- Frequency selector -->
            <div class="space-y-1.5">
              <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >执行频率</span
              >
              <div class="flex flex-wrap gap-1.5">
                {#each FREQUENCY_OPTIONS as opt}
                  <button
                    type="button"
                    onclick={() => (frequency = opt.value)}
                    class="px-3 py-1 text-xs rounded-full border transition-colors {frequency ===
                    opt.value
                      ? 'bg-background text-foreground shadow-sm border-border'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}"
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Interval minutes -->
            {#if frequency === "interval_min"}
              <div class="flex items-center gap-2">
                <span class="text-sm text-muted-foreground">每隔</span>
                <select
                  bind:value={schedIntervalMin}
                  class="px-2 py-1 rounded-md border border-input bg-background text-sm"
                >
                  {#each [5, 10, 15, 20, 30, 45] as m}
                    <option value={m}>{m} 分钟</option>
                  {/each}
                </select>
                <span class="text-sm text-muted-foreground">执行一次</span>
              </div>
            {/if}

            <!-- Weekday picker -->
            {#if frequency === "weekly"}
              <div class="space-y-1.5">
                <span class="text-xs font-medium text-muted-foreground">执行日</span>
                <div class="flex gap-1.5">
                  {#each [0, 1, 2, 3, 4, 5, 6] as day}
                    <button
                      type="button"
                      onclick={() => toggleWeekday(day)}
                      class="h-8 w-8 rounded-full text-xs font-medium border transition-colors {schedWeekdays.includes(
                        day,
                      )
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-foreground'}"
                    >
                      {WEEKDAY_LABELS[day]}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Month day picker -->
            {#if frequency === "monthly"}
              <div class="flex items-center gap-2">
                <span class="text-sm text-muted-foreground">每月第</span>
                <select
                  bind:value={schedMonthDay}
                  class="px-2 py-1 rounded-md border border-input bg-background text-sm"
                >
                  {#each Array.from({ length: 28 }, (_, i) => i + 1) as d}
                    <option value={d}>{d}</option>
                  {/each}
                </select>
                <span class="text-sm text-muted-foreground">日</span>
              </div>
            {/if}

            <!-- Time picker (for modes that need it) -->
            {#if frequency === "daily" || frequency === "weekly" || frequency === "monthly" || frequency === "hourly"}
              <div class="flex items-center gap-2">
                <span class="text-sm text-muted-foreground"
                  >{frequency === "hourly" ? "整点后" : "时间"}</span
                >
                {#if frequency !== "hourly"}
                  <select
                    bind:value={schedHour}
                    class="px-2 py-1 rounded-md border border-input bg-background text-sm"
                  >
                    {#each Array.from({ length: 24 }, (_, i) => i) as h}
                      <option value={h}>{h.toString().padStart(2, "0")} 时</option>
                    {/each}
                  </select>
                {/if}
                <select
                  bind:value={schedMinute}
                  class="px-2 py-1 rounded-md border border-input bg-background text-sm"
                >
                  {#each [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as m}
                    <option value={m}>{m.toString().padStart(2, "0")} 分</option>
                  {/each}
                </select>
              </div>
            {/if}

            <!-- Custom cron input -->
            {#if frequency === "custom_cron"}
              <div class="space-y-1">
                <input
                  type="text"
                  bind:value={customCronExpr}
                  placeholder="0 9 * * *（分 时 日 月 周）"
                  class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
                />
                {#if errors.cronExpression}
                  <p class="text-xs text-destructive">{errors.cronExpression}</p>
                {/if}
              </div>
            {/if}

            <!-- Preview -->
            <p class="text-xs text-muted-foreground/70 border-t border-border/50 pt-2">
              {ScheduledTasksService.describeCronExpression(cronExpression)} ·
              <span class="font-mono opacity-60">{cronExpression}</span>
            </p>
          </div>
        {/if}

        <!-- Interval -->
        {#if scheduleType === "interval"}
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <input
                type="number"
                bind:value={intervalMinutes}
                min="1"
                max="10080"
                class="w-24 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
              <span class="text-sm text-muted-foreground">{t("schedEditor_minutes")}</span>
            </div>
            {#if errors.intervalMinutes}
              <p class="text-xs text-destructive">{errors.intervalMinutes}</p>
            {/if}
            <div class="flex flex-wrap gap-1.5">
              {#each INTERVAL_PRESETS as preset}
                <button
                  type="button"
                  onclick={() => (intervalMinutes = preset.minutes)}
                  class="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                >
                  {preset.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- One-time -->
        {#if scheduleType === "one-time"}
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="fireAtDate" class="text-sm font-medium">{t("schedEditor_date")}</label>
              <input
                id="fireAtDate"
                type="date"
                bind:value={fireAtDate}
                min={new Date().toISOString().split("T")[0]}
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
              {#if errors.fireAtDate}
                <p class="text-xs text-destructive">{errors.fireAtDate}</p>
              {/if}
            </div>
            <div class="space-y-1">
              <label for="fireAtTime" class="text-sm font-medium">{t("schedEditor_time")}</label>
              <input
                id="fireAtTime"
                type="time"
                bind:value={fireAtTime}
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
              {#if errors.fireAtTime}
                <p class="text-xs text-destructive">{errors.fireAtTime}</p>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Model (optional) -->
        <div class="space-y-1">
          <label for="taskModel" class="text-sm font-medium">
            {t("schedEditor_model")}
          </label>
          <input
            id="taskModel"
            type="text"
            bind:value={model}
            placeholder={t("schedEditor_modelPlaceholder")}
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <!-- Permission Mode -->
        <div class="space-y-1">
          <label for="permissionMode" class="text-sm font-medium">
            {t("schedEditor_permissionMode")}
          </label>
          <select
            id="permissionMode"
            bind:value={permissionMode}
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          >
            <option value="">{t("schedEditor_default")}</option>
            <option value="auto-accept-all">{t("schedEditor_autoAccept")}</option>
            <option value="plan">{t("schedEditor_planMode")}</option>
          </select>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onclick={handleCancel}>{t("schedEditor_cancel")}</Button>
          <Button variant="default" loading={saving} type="submit">
            {scheduledTasksStore.editorMode === "create"
              ? t("schedEditor_create")
              : t("schedEditor_save")}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}
