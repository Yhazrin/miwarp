<script lang="ts">
  interface Props {
    taskId: string;
    status: string;
  }

  let { taskId, status }: Props = $props();
</script>

<div class="chat-content-width py-1" data-export-exclude>
  <div
    class="flex items-center gap-2 text-xs text-muted-foreground bg-teal-500/5 border border-teal-500/20 rounded px-3 py-1.5 animate-fade-in"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse"></span>
    Task #{taskId}: {status}
  </div>
</div>
