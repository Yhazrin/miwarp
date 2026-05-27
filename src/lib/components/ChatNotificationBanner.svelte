<script lang="ts">
  interface Props {
    taskId: string;
    status: string;
  }

  let { taskId, status }: Props = $props();
</script>

<div class="chat-content-width py-1" data-export-exclude>
  <div
    class="flex items-center gap-2 text-xs text-muted-foreground bg-[hsl(var(--miwarp-status-info)/0.05)] border border-[hsl(var(--miwarp-status-info)/0.2)] rounded px-3 py-1.5 animate-fade-in"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-info))] animate-pulse"></span>
    Task #{taskId}: {status}
  </div>
</div>
