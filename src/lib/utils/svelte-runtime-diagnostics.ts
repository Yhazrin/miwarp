/**
 * Dev-only hooks for diagnosing Svelte runtime issues (e.g. effect_update_depth_exceeded).
 * Enable verbose console output without requiring ocv:debug tags.
 */
import { dev } from "$app/environment";
import { getChatSessionStore } from "$lib/stores/chat-page-singletons";

let installed = false;

function snapshotChatStore(): Record<string, unknown> {
  try {
    const store = getChatSessionStore();
    return {
      storeRunId: store.run?.id ?? null,
      storePhase: store.phase,
      timelineLen: store.timeline.length,
      resumeInFlight: store.resumeInFlight,
    };
  } catch {
    return { storeSnapshot: "unavailable" };
  }
}

function logRuntimeFailure(kind: string, err: unknown): void {
  const href = typeof window !== "undefined" ? window.location.href : "";
  let runQuery: string | null = null;
  try {
    runQuery = href ? new URL(href).searchParams.get("run") : null;
  } catch {
    runQuery = null;
  }

  const stack = err instanceof Error ? err.stack : undefined;
  const reason =
    typeof err === "string"
      ? err
      : err != null && typeof (err as { message?: unknown }).message === "string"
        ? String((err as { message: string }).message)
        : String(err);

  console.error(`[miwarp:${kind}]`, reason, {
    stack,
    locationHref: href,
    runQuery,
    ...snapshotChatStore(),
  });
}

/** Install window error listeners once (development builds only). */
export function installSvelteRuntimeDiagnostics(): void {
  if (!dev || typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("error", (ev) => {
    logRuntimeFailure("window-error", ev.error ?? ev.message);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    logRuntimeFailure("unhandledrejection", ev.reason);
  });
}
