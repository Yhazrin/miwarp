<script lang="ts">
  import { CheckCircle, Circle, Loader2 } from "lucide-svelte";

  interface Phase {
    name: string;
    description?: string;
    status: "pending" | "active" | "completed";
  }

  interface ProgressData {
    phases?: Phase[];
    steps?: Array<{ id: string; title: string; status: string }>;
    current?: number;
    total?: number;
    message?: string;
  }

  let { data }: { data: ProgressData } = $props();

  const phases = $derived(data.phases || data.steps || []);
  const current = $derived(data.current ?? 0);
  const total = $derived(data.total ?? phases.length);
  const message = $derived(data.message || "");

  function getStatusIcon(status: string) {
    switch (status) {
      case "completed":
        return CheckCircle;
      case "active":
        return Loader2;
      default:
        return Circle;
    }
  }

  function getStatusClass(status: string) {
    switch (status) {
      case "completed":
        return "text-green-500";
      case "active":
        return "text-blue-500 animate-pulse";
      default:
        return "text-muted-foreground";
    }
  }
</script>

<div class="progress-widget rounded-lg border border-border bg-muted/20 p-4">
  {#if total > 0}
    <div class="mb-3 flex items-center justify-between text-sm">
      <span class="font-medium">Progress</span>
      <span class="text-muted-foreground">{current} / {total}</span>
    </div>
    <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        class="h-full bg-blue-500 transition-all duration-300 ease-out"
        style="width: {(current / total) * 100}%"
      ></div>
    </div>
  {/if}

  {#if phases.length > 0}
    <div class="mt-4 space-y-2">
      {#each phases as phase, i}
        {@const Icon = getStatusIcon(phase.status)}
        <div class="flex items-start gap-3 text-sm">
          <div class={getStatusClass(phase.status)}>
            {#if phase.status === "active"}
              <Icon class="h-4 w-4 animate-spin" />
            {:else}
              <Icon class="h-4 w-4" />
            {/if}
          </div>
          <div class="flex-1">
            <span class="font-medium">{phase.name}</span>
            {#if phase.description}
              <p class="mt-0.5 text-xs text-muted-foreground">{phase.description}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if message}
    <p class="mt-3 text-xs text-muted-foreground">{message}</p>
  {/if}
</div>