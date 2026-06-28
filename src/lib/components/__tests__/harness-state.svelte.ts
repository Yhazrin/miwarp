/**
 * Test-only utility for creating a reactive props container that the
 * `Harness.svelte` wrapper can read from. Mutating fields on the returned
 * record triggers Svelte 5 reactivity inside the mounted component.
 *
 * Svelte 5's reactivity is built on `$state` proxies declared via runes.
 * Plain TypeScript cannot call `$state(...)` directly — it must live inside
 * a `.svelte` or `.svelte.ts/js` file. This module declares a single
 * factory that owns a `$state` record and exposes a `setProps` mutator;
 * tests receive the record and pass it to `mount(Harness, { props: ... })`.
 *
 * Not part of the production bundle.
 */
export interface HarnessHandle {
  state: Record<string, unknown>;
  setProps(next: Record<string, unknown>): void;
}

export function createHarnessState(initial: Record<string, unknown>): HarnessHandle {
  // `$state` is a rune available in .svelte.ts modules — this file is
  // compiled by the Svelte plugin and the rune becomes a proxy that
  // tracks reads/writes.
  const state = $state<Record<string, unknown>>({ ...initial });
  return {
    state,
    setProps(next) {
      Object.assign(state, next);
    },
  };
}
