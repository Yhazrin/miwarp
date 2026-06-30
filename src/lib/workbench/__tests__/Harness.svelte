<script lang="ts">
  /**
   * Test-only harness for the workbench `/+page.svelte` mount effect.
   *
   * Mirrors the production mount block from
   * `src/routes/workbench/+page.svelte` — `onMount` plus a one-shot
   * async IIFE that resolves the layout runs cache and calls
   * `workbenchStore.refresh(...)`. The heavy child components
   * (Hero / Chat / ControlPanel) are omitted because the regression is
   * about the mount behaviour, not the rendered DOM.
   *
   * If the production block changes (e.g. swaps back to `$effect` +
   * `untrack`), update this harness in lockstep.
   */
  import { getContext, onMount } from "svelte";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import {
    RUNS_CACHE_CONTEXT_KEY,
    type RunsCacheContext,
    resolveLayoutCachedRuns,
  } from "$lib/layout-chrome-context";

  const runsCache = getContext<RunsCacheContext | undefined>(RUNS_CACHE_CONTEXT_KEY);

  onMount(() => {
    void (async () => {
      const workspaces = workspacesStore.list;
      const cached = await resolveLayoutCachedRuns(runsCache);
      void workbenchStore.refresh(workspaces, cached ?? undefined);
    })();
  });
</script>
