/**
 * files_persisted reducer.
 *
 * Appends new persisted file paths to the store's `persistedFiles` list,
 * capped at 500 entries (drop oldest first). Store-only — no ctx
 * involvement because persistedFiles has no batch/replay semantics.
 */
import type { BusEvent } from "$lib/types";
import type { Reducer } from "./types";

export const reduceFilesPersisted: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "files_persisted" }>;
  const newFiles = Array.isArray(e.files) ? e.files : [];
  const merged = [...store.persistedFiles, ...newFiles];
  store.persistedFiles = merged.length > 500 ? merged.slice(-500) : merged;
};
