/**
 * Build a stable view-model object whose properties always read the latest
 * value from their selector. This is important for Svelte rune values: copying
 * them into a plain object captures the value from the first render and leaves
 * child components with stale arrays and flags after async session loading.
 */
export type LiveViewModelSelectors<T extends object> = {
  [K in keyof T]-?: () => T[K];
};

export function createLiveViewModel<T extends object>(selectors: LiveViewModelSelectors<T>): T {
  const viewModel = {} as T;

  for (const key of Object.keys(selectors) as Array<keyof T>) {
    Object.defineProperty(viewModel, key, {
      enumerable: true,
      configurable: false,
      get: selectors[key],
    });
  }

  return viewModel;
}
