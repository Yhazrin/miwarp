/**
 * Demand-driven team subscription: the layout used to register the team +
 * task event listeners and a polling fallback in onMount at app start, even
 * when the user is sitting on the chats tab and never visits /teams. That
 * was wasted IPC + listener setup.
 *
 * `createTeamSubscription` is a single-flight factory: first call wires up
 * the listeners + poll; `dispose()` reverses both. Re-invocation after
 * `dispose()` is fine — the subscription is fully torn down and the next
 * call rebuilds it from scratch. There is no shared global state, so two
 * concurrent calls return two independent subscriptions (the caller is
 * expected to gate on its own state, as the layout does).
 */
import { getTransport } from "$lib/transport";
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  LISTEN_RETRY_BASE_DELAY_MS,
  LISTEN_RETRY_MAX_ATTEMPTS,
  TEAM_RESYNC_DEBOUNCE_MS,
  TEAMS_POLL_INTERVAL_MS,
} from "$lib/utils/layout-timings";
import type { TeamStore } from "$lib/stores/team-store.svelte";

type TeamUpdatePayload { team_name: string; change: string };
type TaskUpdatePayload { team_name: string; task_id: string; change: string };

export type TeamSubscription = {
  dispose: () => void;
};

export function createTeamSubscription(
  teamStore: Pick<
    TeamStore,
    "loadTeams" | "forceRefresh" | "handleTeamUpdate" | "handleTaskUpdate"
  >,
  shouldPoll: () => boolean,
): TeamSubscription {
  let destroyed = false;
  let unlistenTeam: (() => void) | undefined;
  let unlistenTask: (() => void) | undefined;
  const retryTimers: ReturnType<typeof setTimeout>[] = [];
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleResync() {
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      if (!destroyed) teamStore.forceRefresh();
    }, TEAM_RESYNC_DEBOUNCE_MS);
  }

  function registerListener<T>(
    name: string,
    handler: (payload: T) => void,
    assign: (fn: () => void) => void,
  ) {
    const transport = getTransport();
    function tryListen(attempt: number) {
      transport
        .listen<T>(name, handler)
        .then((fn) => {
          if (destroyed) {
            fn();
            return;
          }
          assign(fn);
          scheduleResync();
        })
        .catch((e) => {
          if (destroyed) return;
          if (attempt < LISTEN_RETRY_MAX_ATTEMPTS - 1) {
            const delay = (attempt + 1) * LISTEN_RETRY_BASE_DELAY_MS; // 2s, 4s
            dbgWarn(
              "layout",
              `${name} listen failed (attempt ${attempt + 1}/${LISTEN_RETRY_MAX_ATTEMPTS}), retry in ${delay}ms`,
              e,
            );
            const t = setTimeout(() => tryListen(attempt + 1), delay);
            retryTimers.push(t);
          } else {
            dbgWarn(
              "layout",
              `${name} listen failed after ${LISTEN_RETRY_MAX_ATTEMPTS} attempts, falling back to poll`,
              e,
            );
          }
        });
    }
    tryListen(0);
  }

  // Fire-and-forget the initial load. The hook returns synchronously; the
  // IPC round-trip is owned by teamStore.loadTeams.
  void teamStore.loadTeams();
  const pollTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (!shouldPoll()) return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void teamStore.loadTeams();
    }
  }, TEAMS_POLL_INTERVAL_MS);
  // Defensive: poll interval that respects the page-visibility signal lives
  // inside `shouldPoll`; the timer itself is always active until dispose.

  registerListener<TeamUpdatePayload>(
    "team-update",
    (payload) => {
      dbg("layout", "team-update", payload);
      teamStore.handleTeamUpdate(payload);
    },
    (fn) => (unlistenTeam = fn),
  );

  registerListener<TaskUpdatePayload>(
    "task-update",
    (payload) => {
      dbg("layout", "task-update", payload);
      teamStore.handleTaskUpdate(payload);
    },
    (fn) => (unlistenTask = fn),
  );

  return {
    dispose: () => {
      if (destroyed) return;
      destroyed = true;
      unlistenTeam?.();
      unlistenTask?.();
      if (pollTimer) clearInterval(pollTimer);
      retryTimers.forEach(clearTimeout);
      if (resyncTimer) clearTimeout(resyncTimer);
    },
  };
}
