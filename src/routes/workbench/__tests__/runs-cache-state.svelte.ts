/**
 * Test-only factory: wraps a `$state` proxy so the harness's reactive
 * read of `cache.runs` re-fires whenever the test mutates the array.
 *
 * `runsSidebarStore.runs` is itself a `$state` rune, so this just
 * models that contract for tests that exercise the workbench mount
 * effect without booting the full layout.
 */
export interface RunsCacheStateHandle {
  runs: import("$lib/types").TaskRun[];
  setRuns(next: import("$lib/types").TaskRun[]): void;
}

export function createRunsCacheState(
  initial: import("$lib/types").TaskRun[],
): RunsCacheStateHandle {
  const state = $state<{ runs: import("$lib/types").TaskRun[] }>({ runs: initial });
  return {
    get runs() {
      return state.runs;
    },
    setRuns(next) {
      state.runs = next;
    },
  };
}
