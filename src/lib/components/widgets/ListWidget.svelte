<script lang="ts">
  import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-svelte";

  interface ListItem {
    text: string;
    severity?: "info" | "warning" | "error" | "success";
    icon?: string;
    href?: string;
    action?: string;
  }

  interface ListData {
    title?: string;
    description?: string;
    items?: ListItem[];
  }

  let { data }: { data: ListData } = $props();

  const items = $derived(data.items || []);

  function getSeverityIcon(severity: string = "info") {
    switch (severity) {
      case "success":
        return CheckCircle2;
      case "warning":
        return AlertTriangle;
      case "error":
        return AlertCircle;
      default:
        return Info;
    }
  }

  function getSeverityClass(severity: string = "info") {
    switch (severity) {
      case "success":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
      case "error":
        return "text-red-500";
      default:
        return "text-blue-500";
    }
  }
</script>

<div class="list-widget rounded-lg border border-border bg-muted/20 p-4">
  {#if data.title}
    <h3 class="mb-2 text-sm font-semibold">{data.title}</h3>
  {/if}

  {#if data.description}
    <p class="mb-3 text-xs text-muted-foreground">{data.description}</p>
  {/if}

  {#if items.length > 0}
    <ul class="space-y-2">
      {#each items as item, i}
        {@const Icon = getSeverityIcon(item.severity)}
        <li class="flex items-start gap-2 rounded-md bg-background/50 p-2 text-sm">
          {#if item.severity}
            <span class={getSeverityClass(item.severity)}>
              <Icon class="h-4 w-4 shrink-0" />
            </span>
          {/if}
          <span class="flex-1">{item.text}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-xs text-muted-foreground">No items to display</p>
  {/if}
</div>