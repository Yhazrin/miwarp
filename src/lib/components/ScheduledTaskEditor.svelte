<script lang="ts">
  import Button from "./Button.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import { CRON_PRESETS, type TaskScheduleType } from "$lib/types/scheduled-task";

  // Form state
  let taskId = $state("");
  let description = $state("");
  let prompt = $state("");
  let scheduleType = $state<TaskScheduleType>("cron");
  let cronExpression = $state("0 9 * * *");
  let fireAtDate = $state("");
  let fireAtTime = $state("09:00");

  // Validation
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  // Initialize from editing task
  $effect(() => {
    const task = scheduledTasksStore.editingTask;
    if (task) {
      taskId = task.taskId;
      description = task.description;
      prompt = task.prompt;

      if (task.cronExpression) {
        scheduleType = "cron";
        cronExpression = task.cronExpression;
      } else if (task.fireAt) {
        scheduleType = "one-time";
        const date = new Date(task.fireAt);
        fireAtDate = date.toISOString().split("T")[0];
        fireAtTime = date.toTimeString().slice(0, 5);
      }
    } else {
      // Reset for new task
      taskId = "";
      description = "";
      prompt = "";
      scheduleType = "cron";
      cronExpression = "0 9 * * *";
      fireAtDate = "";
      fireAtTime = "09:00";
    }
    errors = {};
  });

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!taskId.trim()) {
      newErrors.taskId = "Task ID is required";
    } else if (!/^[a-z0-9-]+$/.test(taskId)) {
      newErrors.taskId = "Task ID must be lowercase letters, numbers, and hyphens only";
    }

    if (!prompt.trim()) {
      newErrors.prompt = "Prompt is required";
    }

    if (scheduleType === "cron") {
      if (!ScheduledTasksService.validateCronExpression(cronExpression)) {
        newErrors.cronExpression = "Invalid cron expression";
      }
    } else {
      if (!fireAtDate) {
        newErrors.fireAtDate = "Date is required";
      }
      if (!fireAtTime) {
        newErrors.fireAtTime = "Time is required";
      } else {
        const dateTime = new Date(`${fireAtDate}T${fireAtTime}`);
        if (isNaN(dateTime.getTime())) {
          newErrors.fireAtTime = "Invalid date/time";
        } else if (dateTime <= new Date()) {
          newErrors.fireAtTime = "Time must be in the future";
        }
      }
    }

    errors = newErrors;
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    saving = true;
    try {
      const params: any = {
        taskId: taskId.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
      };

      if (scheduleType === "cron") {
        params.cronExpression = cronExpression.trim();
      } else {
        params.fireAt = new Date(`${fireAtDate}T${fireAtTime}`).toISOString();
      }

      let success: boolean;
      if (scheduledTasksStore.editorMode === "create") {
        success = await scheduledTasksStore.createTask(params);
      } else {
        success = await scheduledTasksStore.updateTask({ taskId: taskId.trim(), ...params });
      }

      if (success) {
        scheduledTasksStore.closeEditor();
      }
    } finally {
      saving = false;
    }
  }

  function handleCancel() {
    scheduledTasksStore.closeEditor();
  }

  function applyPreset(preset: (typeof CRON_PRESETS)[number]) {
    cronExpression = preset.expression;
  }
</script>

<!-- Modal backdrop -->
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

      <!-- Form -->
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        class="p-4 space-y-4"
      >
        <!-- Task ID -->
        <div class="space-y-1">
          <label for="taskId" class="text-sm font-medium">Task ID</label>
          <input
            id="taskId"
            type="text"
            bind:value={taskId}
            placeholder="my-daily-task"
            disabled={scheduledTasksStore.editorMode === "edit"}
            class="w-full px-3 py-2 rounded-md border bg-background text-sm
              disabled:opacity-50 disabled:cursor-not-allowed
              {errors.taskId ? 'border-destructive' : 'border-input'}"
          />
          {#if errors.taskId}
            <p class="text-xs text-destructive">{errors.taskId}</p>
          {/if}
          {#if scheduledTasksStore.editorMode === "edit"}
            <p class="text-xs text-muted-foreground">Task ID cannot be changed after creation</p>
          {/if}
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label for="description" class="text-sm font-medium">Description</label>
          <input
            id="description"
            type="text"
            bind:value={description}
            placeholder="What does this task do?"
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <!-- Prompt -->
        <div class="space-y-1">
          <label for="prompt" class="text-sm font-medium">Prompt</label>
          <textarea
            id="prompt"
            bind:value={prompt}
            placeholder="Describe what Claude should do when this task runs..."
            rows="5"
            class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
          ></textarea>
          {#if errors.prompt}
            <p class="text-xs text-destructive">{errors.prompt}</p>
          {/if}
        </div>

        <!-- Schedule Type -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Schedule Type</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                value="cron"
                bind:group={scheduleType}
                class="text-primary"
              />
              <span class="text-sm">Recurring (Cron)</span>
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

        <!-- Cron Expression -->
        {#if scheduleType === "cron"}
          <div class="space-y-2">
            <label for="cronExpression" class="text-sm font-medium">Cron Expression</label>
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

            <!-- Presets -->
            <div class="flex flex-wrap gap-2 mt-2">
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
              Current: {ScheduledTasksService.describeCronExpression(cronExpression)}
            </p>
          </div>
        {:else}
          <!-- One-time: Date and Time -->
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
