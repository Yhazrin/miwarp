<script lang="ts">
  interface Props {
    value: string;
    onchange: (expr: string) => void;
    disabled?: boolean;
  }

  let { value, onchange, disabled = false }: Props = $props();

  // Parse cron expression: minute hour day month weekday
  let minute = $state("0");
  let _hour = $state("9");
  let _dayOfMonth = $state("*");
  let _month = $state("*");
  let _dayOfWeek = $state("*");

  // UI state
  let activeTab = $state<"simple" | "advanced">("simple");

  // Simple schedule options
  type SimpleInterval = "minute" | "hourly" | "daily" | "weekly" | "monthly" | "custom";
  let simpleInterval = $state<SimpleInterval>("daily");

  // Daily time picker
  let dailyHour = $state(9);
  let dailyMinute = $state(0);

  // Weekly day picker
  let weeklyDays = $state<number[]>([1, 2, 3, 4, 5]);

  // Monthly day picker
  let monthlyDay = $state(1);

  // Interval picker
  let intervalValue = $state(30);
  let intervalUnit = $state<"minutes" | "hours">("minutes");

  const WEEKDAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAY_FULL = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  // Common presets
  const PRESETS = [
    { label: "Every minute", expr: "* * * * *" },
    { label: "Every 5 minutes", expr: "*/5 * * * *" },
    { label: "Every 15 minutes", expr: "*/15 * * * *" },
    { label: "Every 30 minutes", expr: "*/30 * * * *" },
    { label: "Every hour", expr: "0 * * * *" },
    { label: "Every day at 9am", expr: "0 9 * * *" },
    { label: "Every day at 6pm", expr: "0 18 * * *" },
    { label: "Weekdays 9am", expr: "0 9 * * 1-5" },
    { label: "Every Monday", expr: "0 9 * * 1" },
    { label: "First of month", expr: "0 0 1 * *" },
  ];

  /**
   * Parse incoming value to sync UI state
   */
  $effect(() => {
    if (!value) return;

    const parts = value.trim().split(/\s+/);
    if (parts.length !== 5) return;

    [minute, _hour, _dayOfMonth, _month, _dayOfWeek] = parts;

    // Determine which simple mode matches
    if (value === "* * * * *") {
      simpleInterval = "minute";
    } else if (value === "*/5 * * * *") {
      simpleInterval = "custom";
      intervalValue = 5;
      intervalUnit = "minutes";
    } else if (value === "*/15 * * * *") {
      simpleInterval = "custom";
      intervalValue = 15;
      intervalUnit = "minutes";
    } else if (value === "*/30 * * * *") {
      simpleInterval = "custom";
      intervalValue = 30;
      intervalUnit = "minutes";
    } else if (value === "0 * * * *") {
      simpleInterval = "hourly";
    } else if (value === "0 9 * * *" || value === "0 18 * * *") {
      simpleInterval = "daily";
      if (parts[1] === "9") {
        dailyHour = 9;
        dailyMinute = parseInt(parts[0]) || 0;
      } else if (parts[1] === "18") {
        dailyHour = 18;
        dailyMinute = parseInt(parts[0]) || 0;
      }
    } else if (parts[4] !== "*" && parts[2] === "*") {
      simpleInterval = "weekly";
      weeklyDays = parts[4]
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n));
    } else if (parts[3] === "*" && parts[2] !== "*") {
      simpleInterval = "monthly";
      monthlyDay = parseInt(parts[2]) || 1;
    } else {
      simpleInterval = "custom";
    }
  });

  /**
   * Build cron expression from UI state
   */
  function buildExpression(): string {
    switch (simpleInterval) {
      case "minute":
        return "* * * * *";
      case "hourly":
        return `${minute} * * * *`;
      case "daily":
        return `${dailyMinute.toString().padStart(2, "0")} ${dailyHour} * * *`;
      case "weekly":
        return `${dailyMinute.toString().padStart(2, "0")} ${dailyHour} * * ${weeklyDays.join(",") || "1"}`;
      case "monthly":
        return `${dailyMinute.toString().padStart(2, "0")} ${dailyHour} ${monthlyDay} * *`;
      case "custom":
        if (intervalUnit === "minutes") {
          return `*/${intervalValue} * * * *`;
        } else {
          return `${minute} */${intervalValue} * * *`;
        }
      default:
        return value;
    }
  }

  /**
   * Emit expression change
   */
  function emitChange(expr: string) {
    onchange(expr);
  }

  /**
   * Handle direct input change
   */
  function handleDirectInput(newValue: string) {
    emitChange(newValue);
  }

  /**
   * Toggle weekday for weekly mode
   */
  function toggleWeekday(day: number) {
    if (weeklyDays.includes(day)) {
      weeklyDays = weeklyDays.filter((d) => d !== day);
    } else {
      weeklyDays = [...weeklyDays, day].sort();
    }
    emitChange(buildExpression());
  }

  /**
   * Generate natural language description
   */
  const description = $derived.by(() => {
    if (value === "* * * * *") return "Every minute";

    if (value.startsWith("*/")) {
      const interval = value.split(" ")[0].slice(2);
      return `Every ${interval} minutes`;
    }

    const parts = value.split(/\s+/);
    const [min, hr, dom, mon, dow] = parts;

    // Daily at specific time
    if (dom === "*" && mon === "*" && dow === "*") {
      return `Every day at ${formatTime(hr, min)}`;
    }

    // Weekly
    if (dom === "*" && mon === "*" && dow !== "*") {
      const days = dow
        .split(",")
        .map((d) => WEEKDAY_FULL[parseInt(d) || 0])
        .join(", ");
      return `Every ${days} at ${formatTime(hr, min)}`;
    }

    // Monthly
    if (dom !== "*" && mon === "*") {
      return `Monthly on day ${dom} at ${formatTime(hr, min)}`;
    }

    return `At ${formatTime(hr, min)} on day ${dom} of month ${mon}`;
  });

  function formatTime(hr: string, min: string): string {
    const h = parseInt(hr) || 0;
    const m = parseInt(min) || 0;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  }

  /**
   * Apply preset
   */
  function applyPreset(expr: string) {
    emitChange(expr);
  }

  /**
   * Update from simple mode
   */
  function updateSimple() {
    emitChange(buildExpression());
  }
</script>

/** * CronVisualEditor - Visual cron expression editor * * Provides intuitive UI for creating and
editing cron expressions * with real-time preview and natural language descriptions. */
<div class="space-y-3">
  <!-- Simple/Advanced Tabs -->
  <div class="flex gap-1 bg-muted/50 rounded-lg p-1">
    <button
      type="button"
      onclick={() => (activeTab = "simple")}
      class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
        {activeTab === 'simple'
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'}"
      {disabled}
    >
      Simple
    </button>
    <button
      type="button"
      onclick={() => (activeTab = "advanced")}
      class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
        {activeTab === 'advanced'
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'}"
      {disabled}
    >
      Advanced
    </button>
  </div>

  {#if activeTab === "simple"}
    <!-- Simple Interval Selector -->
    <div class="space-y-1">
      <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Schedule Type
      </label>
      <select
        bind:value={simpleInterval}
        onchange={() => updateSimple()}
        {disabled}
        class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
      >
        <option value="minute">Every minute</option>
        <option value="hourly">Every hour</option>
        <option value="daily">Daily at specific time</option>
        <option value="weekly">Weekly on selected days</option>
        <option value="monthly">Monthly on specific day</option>
        <option value="custom">Custom interval</option>
      </select>
    </div>

    <!-- Time Pickers based on type -->
    {#if simpleInterval === "daily" || simpleInterval === "weekly" || simpleInterval === "monthly"}
      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Hour
          </label>
          <select
            bind:value={dailyHour}
            onchange={() => updateSimple()}
            {disabled}
            class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
          >
            {#each Array(24) as _, h}
              <option value={h}>{h.toString().padStart(2, "0")}:00</option>
            {/each}
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Minute
          </label>
          <select
            bind:value={dailyMinute}
            onchange={() => updateSimple()}
            {disabled}
            class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
          >
            {#each [0, 15, 30, 45] as m}
              <option value={m}>{m.toString().padStart(2, "0")}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}

    <!-- Weekly day picker -->
    {#if simpleInterval === "weekly"}
      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Days of Week
        </label>
        <div class="flex gap-1">
          {#each WEEKDAY_ABBREV as day, i}
            <button
              type="button"
              onclick={() => toggleWeekday(i)}
              {disabled}
              class="flex-1 px-1 py-1.5 text-[10px] font-medium rounded transition-colors
                {weeklyDays.includes(i)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'}"
            >
              {day}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Monthly day picker -->
    {#if simpleInterval === "monthly"}
      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Day of Month
        </label>
        <select
          bind:value={monthlyDay}
          onchange={() => updateSimple()}
          {disabled}
          class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
        >
          {#each Array(31) as _, i}
            <option value={i + 1}>{i + 1}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Custom interval -->
    {#if simpleInterval === "custom"}
      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Interval
          </label>
          <input
            type="number"
            min="1"
            max="59"
            bind:value={intervalValue}
            onchange={() => updateSimple()}
            {disabled}
            class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
          />
        </div>
        <div class="space-y-1">
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Unit
          </label>
          <select
            bind:value={intervalUnit}
            onchange={() => updateSimple()}
            {disabled}
            class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs"
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
          </select>
        </div>
      </div>
    {/if}

    <!-- Quick Presets -->
    <div class="space-y-1">
      <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Quick Presets
      </label>
      <div class="flex flex-wrap gap-1">
        {#each PRESETS.slice(0, 5) as preset}
          <button
            type="button"
            onclick={() => applyPreset(preset.expr)}
            {disabled}
            class="px-2 py-1 text-[10px] rounded-md bg-muted/50 hover:bg-muted transition-colors"
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <!-- Advanced: Direct cron expression input -->
    <div class="space-y-2">
      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Cron Expression
        </label>
        <input
          type="text"
          {value}
          oninput={(e) => handleDirectInput(e.currentTarget.value)}
          placeholder="* * * * *"
          {disabled}
          class="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs font-mono"
        />
      </div>

      <!-- Cron field reference -->
      <div class="p-2 rounded-lg bg-muted/30 text-[10px] space-y-1">
        <div class="font-medium text-muted-foreground">Format: minute hour day month weekday</div>
        <div class="grid grid-cols-5 gap-1 text-muted-foreground">
          <div class="text-center">0-59</div>
          <div class="text-center">0-23</div>
          <div class="text-center">1-31</div>
          <div class="text-center">1-12</div>
          <div class="text-center">0-6</div>
        </div>
      </div>

      <!-- More presets in advanced mode -->
      <div class="space-y-1">
        <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          More Presets
        </label>
        <div class="flex flex-wrap gap-1">
          {#each PRESETS.slice(5) as preset}
            <button
              type="button"
              onclick={() => applyPreset(preset.expr)}
              {disabled}
              class="px-2 py-1 text-[10px] rounded-md bg-muted/50 hover:bg-muted transition-colors"
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Preview -->
  <div class="p-2 rounded-lg bg-primary/10 border border-primary/20">
    <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Preview</div>
    <div class="text-xs font-medium text-primary">{description}</div>
    <div class="text-[10px] font-mono text-muted-foreground mt-1">{value}</div>
  </div>
</div>
