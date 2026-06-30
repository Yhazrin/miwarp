<script lang="ts">
  /**
   * Test-only wrapper that installs the layout runs cache context and
   * mounts the workbench effect harness as a child. The cache's `runs`
   * getter reads from `cache.runs` (a `$state` proxy), so the harness's
   * reactive read of `cache.runs` re-fires whenever the test mutates
   * `cache.runs`.
   */
  import { setContext } from "svelte";
  import Harness from "./Harness.svelte";
  import { RUNS_CACHE_CONTEXT_KEY, type RunsCacheContext } from "$lib/layout-chrome-context";
  import type { TaskRun } from "$lib/types";
  import type { RunsCacheStateHandle } from "./runs-cache-state.svelte";

  let {
    cache,
    whenReady,
  }: {
    cache: RunsCacheStateHandle;
    whenReady: () => Promise<TaskRun[]>;
  } = $props();

  setContext<RunsCacheContext>(RUNS_CACHE_CONTEXT_KEY, {
    get runs() {
      return cache.runs;
    },
    whenReady,
  });
</script>

<Harness />
