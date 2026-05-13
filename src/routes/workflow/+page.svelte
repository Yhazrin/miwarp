<script lang="ts">
  /**
   * Workflow Page - Standalone guided workflows experience
   */
  import WorkflowPanel from "$lib/components/WorkflowPanel.svelte";
  import type { WorkflowStep } from "$lib/types/workflow";

  let notification = $state<string | null>(null);

  async function handleExecute(step: WorkflowStep) {
    // This would connect to the actual execution engine
    // For now, simulate execution
    console.log("Executing step:", step.title);
    console.log("Prompt:", step.prompt);
    console.log("Tools:", step.tools);

    // Simulate some work
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
  <title>Guided Workflows - MiWarp</title>
</svelte:head>

<div class="workflow-page">
  <div class="workflow-container">
    <WorkflowPanel onExecute={handleExecute} onNotify={handleNotify} />
  </div>

  {#if notification}
    <div class="notification">
      <span>{notification}</span>
    </div>
  {/if}
</div>

<style>
  .workflow-page {
    min-height: 100vh;
    padding: 1rem;
    background: var(--color-background, #0a0a0a);
  }

  .workflow-container {
    max-width: 900px;
    margin: 0 auto;
  }

  .notification {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.75rem 1.5rem;
    background: var(--color-primary, #6366f1);
    color: white;
    border-radius: 8px;
    font-size: 0.875rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(1rem);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
