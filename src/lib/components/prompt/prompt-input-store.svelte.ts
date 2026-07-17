/**
 * Local facade for the prompt input store.
 *
 * The actual state lives in `src/lib/stores/prompt-input-store.svelte.ts`
 * (that module is the canonical, single state owner for PromptInput).
 *
 * This file is a re-export so the controllers and view components under
 * `./prompt/` can depend on a co-located store path without introducing a
 * second copy of the state. Importing from here must remain a pure
 * re-export — never duplicate the state.
 */
export {
  PromptInputStore,
  type PendingAttachment,
  type PastedBlock,
  type PathRef,
} from "$lib/stores/prompt-input-store.svelte";
