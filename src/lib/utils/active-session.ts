/**
 * getActiveSessionIdentity — read the active session's run id + cwd without
 * pulling the heavy SessionStore into callers that only need an identity
 * hint (e.g. root layout, split-lifecycle deps, sidebar pre-flight).
 *
 * Source priority:
 *   1. `?run=` query param on the current page URL (authoritative for the
 *      chat route — reflects the latest navigate/redirect).
 *   2. Persisted `ocv:active-session-id` (last active run on cold start).
 *   3. `null` when neither is set.
 *
 * For cwd we read the layout's persisted project-cwd key directly so we
 * don't need to spin up projectSelectionStore. Callers that need a fully
 * reactive view should subscribe to the page store + projectSelectionStore
 * directly; this helper is for one-shot reads.
 */
import { page } from "$app/stores";
import { get } from "svelte/store";
import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

export interface ActiveSessionIdentity {
  runId: string | null;
  cwd: string | null;
}

export function getActiveSessionIdentity(): ActiveSessionIdentity {
  let runId: string | null = null;
  let cwd: string | null = null;

  try {
    const url = get(page).url;
    const fromQuery = url.searchParams.get("run");
    if (fromQuery) runId = fromQuery;
  } catch {
    /* SSR or store not initialised */
  }

  if (!runId) {
    try {
      const stored =
        typeof localStorage !== "undefined" ? localStorage.getItem("ocv:active-session-id") : null;
      if (stored) runId = stored;
    } catch {
      /* ignore */
    }
  }

  try {
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem(LS_PROJECT_CWD) : null;
    if (stored) cwd = normalizeCwd(stored) || null;
  } catch {
    /* ignore */
  }

  return { runId, cwd };
}
