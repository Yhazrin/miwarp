<script lang="ts">
  import WorkflowPanel from "$lib/components/WorkflowPanel.svelte";
  import type { WorkflowStep } from "$lib/types/workflow";
  import { t } from "$lib/i18n/index.svelte";

  let notification = $state<string | null>(null);

  async function handleExecute(step: WorkflowStep) {
    console.log("Executing step:", step.title);
    console.log("Prompt:", step.prompt);
    console.log("Tools:", step.tools);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  function handleNotify(message: string) {
    notification = message;
    setTimeout(() => {
      notification = null;
    }, 3000);
  }
</script>

<svelte:head>
  <title>{t("workflow_pageTitle")}</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Page header -->
  <div class="shrink-0 border-b border-border px-6 py-4">
    <h1 class="text-xl font-semibold text-foreground">{t("workflow_pageTitle")}</h1>
    <p class="mt-1 text-sm text-muted-foreground">{t("workflow_startFromTemplate")}</p>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-3xl px-6 py-5">
      <WorkflowPanel onExecute={handleExecute} onNotify={handleNotify} />
    </div>
  </div>

  <!-- Toast notification -->
  {#if notification}
    <div
      class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-primary/20 bg-background/95 px-4 py-2 text-sm text-foreground shadow-lg backdrop-blur-sm duration-200"
    >
      {notification}
    </div>
  {/if}
</div>
