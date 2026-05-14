<script lang="ts">
  import { onMount } from "svelte";
  import Button from "./Button.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import {
    CRON_PRESETS,
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

  // Form state
  let name = $state("");
  let description = $state("");
  let prompt = $state("");
  let agent = $state<Agent>("claude");
  let scheduleType = $state<ScheduleType>("cron");
  let cronExpression = $state("0 9 * * *");
  let intervalMinutes = $state(60);
  let fireAtDate = $state("");
  let fireAtTime = $state("09:00");
  let permissionMode = $state<string>("");
  let model = $state("");
  let workspaceCwd = $state("");
  let remoteHostName = $state<string>("");

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
      cronExpression = task.schedule.cronExpression ?? "0 9 * * *";
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
      cronExpression = "0 9 * * *";
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

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!prompt.trim()) e.prompt = "Prompt is required";
    if (!workspaceCwd.trim()) e.workspace = "Workspace path is required";

    if (scheduleType === "cron") {
      if (!ScheduledTasksService.validateCronExpression(cronExpression)) {
        e.cronExpression = "Invalid cron expression";
      }
    } else if (scheduleType === "one-time") {
      if (!fireAtDate) e.fireAtDate = "Date is required";
      if (!fireAtTime) e.fireAtTime = "Time is required";
    } else if (scheduleType === "interval") {
      if (!intervalMinutes || intervalMinutes < 1) {
        e.intervalMinutes = "Interval must be at least 1 minute";
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

  function applyPreset(preset: (typeof CRON_PRESETS)[number]) {
    cronExpression = preset.expression;
  }

  function applyTemplate(template: (typeof DEFAULT_TASK_TEMPLATES)[number]) {
    name = template.name;
    description = template.description;
    prompt = template.prompt;
    scheduleType = template.schedule.type;
    if (template.schedule.cronExpression) cronExpression = template.schedule.cronExpression;
    if (template.schedule.intervalMinutes) intervalMinutes = template.schedule.intervalMinutes;
  }

  function handleCancel() {
    scheduledTasksStore.closeEditor();
  }

  const remoteHosts = $derived(settings?.remote_hosts ?? []);
</script>

{#if scheduledTasksStore.showEditor}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div
      class="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background rounded-xl shadow-2xl border"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-lg font-semibold">
          {scheduledTasksStore.editorMode === "create"
            ? "Create Scheduled Task"
            : "Edit Scheduled Task"}
        </h2>
        <Button variant="ghost" size="icon" onclick={handleCancel}>
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
          <p class="text-xs text-muted-foreground mb-2">Quick start templates:</p>
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
          <label for="taskName" class="text-sm font-medium">Name</label>
          <input
            id="taskName"
            type="text"
            bind:value={name}
            placeholder="Daily Project Check"
            class="w-full px-3 py-2 rounded-md border bg-background text-sm
              {errors.name ? 'border-destructive' : 'border-input'}"
          />
          {#if errors.name}
            <p class="text-xs text-destructive">{errors.name}</p>
          {/if}
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label for="taskDesc" class="text-sm font-medium">Description</label>
          <input
            id="taskDesc"
            type="text"
            bind:value={description}
            placeholder="What does this task do?"
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <!-- Workspace -->
        <div class="space-y-1">
          <label class="text-sm font-medium">Workspace</label>
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={workspaceCwd}
              placeholder="/path/to/project"
              class="flex-1 px-3 py-2 rounded-md border bg-background text-sm font-mono
                {errors.workspace ? 'border-destructive' : 'border-input'}"
            />
            <Button variant="outline" size="sm" onclick={() => (folderPickerOpen = true)}>
              Browse
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
              Remote Host <span class="text-muted-foreground">(optional)</span>
            </label>
            <select
              id="remoteHost"
              bind:value={remoteHostName}
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              <option value="">Local</option>
              {#each remoteHosts as host}
                <option value={host.name}>{host.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Agent -->
        <div class="space-y-1">
          <label class="text-sm font-medium">Agent</label>
          <div class="flex gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="agent"
                value="claude"
                bind:group={agent}
                class="text-primary"
              />
              <span class="text-sm">Claude</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="agent"
                value="codex"
                bind:group={agent}
                class="text-primary"
              />
              <span class="text-sm">Codex</span>
            </label>
          </div>
        </div>

        <!-- Prompt -->
        <div class="space-y-1">
          <label for="taskPrompt" class="text-sm font-medium">Prompt</label>
          <textarea
            id="taskPrompt"
            bind:value={prompt}
            placeholder="Describe what the agent should do when this task runs..."
            rows="4"
            class="w-full px-3 py-2 rounded-md border bg-background text-sm resize-y
              {errors.prompt ? 'border-destructive' : 'border-input'}"
          ></textarea>
          {#if errors.prompt}
            <p class="text-xs text-destructive">{errors.prompt}</p>
          {/if}
        </div>

        <!-- Schedule Type -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Schedule</label>
          <div class="flex gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="cron"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">Cron</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="interval"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">Interval</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="one-time"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">One-time</span>
            </label>
          </div>
        </div>

        <!-- Cron -->
        {#if scheduleType === "cron"}
          <div class="space-y-2">
            <input
              id="cronExpression"
              type="text"
              bind:value={cronExpression}
              placeholder="0 9 * * *"
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
            />
            {#if errors.cronExpression}
              <p class="text-xs text-destructive">{errors.cronExpression}</p>
            {/if}
            <div class="flex flex-wrap gap-1.5">
              {#each CRON_PRESETS as preset}
                <button
                  type="button"
                  onclick={() => applyPreset(preset)}
                  class="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                >
                  {preset.label}
                </button>
              {/each}
            </div>
            <p class="text-xs text-muted-foreground">
              {ScheduledTasksService.describeCronExpression(cronExpression)}
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
              <span class="text-sm text-muted-foreground">minutes</span>
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
              <label for="fireAtDate" class="text-sm font-medium">Date</label>
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
              <label for="fireAtTime" class="text-sm font-medium">Time</label>
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
            Model <span class="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="taskModel"
            type="text"
            bind:value={model}
            placeholder="Leave empty for default"
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <!-- Permission Mode -->
        <div class="space-y-1">
          <label for="permissionMode" class="text-sm font-medium">
            Permission Mode <span class="text-muted-foreground">(optional)</span>
          </label>
          <select
            id="permissionMode"
            bind:value={permissionMode}
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          >
            <option value="">Default</option>
            <option value="auto-accept-all">Auto-accept all</option>
            <option value="plan">Plan mode</option>
          </select>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onclick={handleCancel}>Cancel</Button>
          <Button variant="default" loading={saving} type="submit">
            {scheduledTasksStore.editorMode === "create" ? "Create Task" : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}
