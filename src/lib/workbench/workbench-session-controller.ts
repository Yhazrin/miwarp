/**
 * WorkbenchSessionController — atomic project switch for /workbench.
 *
 * Extracted from `WorkbenchStore.selectProject()` to make the transactional
 * shape of a project switch explicit and testable:
 *
 *   1. Bump a per-controller `generation` token so async effects racing the
 *      switch can abort.
 *   2. Decide the next `activeRunId` for the target project BEFORE touching
 *      the EventMiddleware subscription.
 *   3. If the target project has no active run → release the previous
 *      project's EventMiddleware subscription and the SessionStore owner.
 *   4. If there IS a target run → unsubscribe the previous session from
 *      EventMiddleware, then subscribe the new run (single-session mode
 *      keeps the middleware in a known state).
 *   5. Persist `selectedProjectId` last so a failed step above cannot leave
 *      the store pointing at a project whose session was never rehydrated.
 *
 * The controller deliberately exposes only `selectProject` and the
 * generation guard — every other surface (release, restore, abort) is
 * invoked by the store so the test surface stays small.
 */
import * as api from "$lib/api";
import { getEventMiddleware, sessionStore, type EventMiddleware } from "$lib/stores";
import type { TaskRun } from "$lib/types";
import { dbg } from "$lib/utils/debug";

import { runProjectCwd } from "./workbench-store.svelte";
import type { WorkbenchProjectSummary } from "./workbench-store.svelte";

const isProjectDeskRun = (run: TaskRun): boolean => run.run_surface === "project_desk";

const isActiveStatus = (run: TaskRun): boolean =>
  run.status === "running" ||
  run.status === "pending" ||
  run.status === "waiting_input" ||
  run.status === "waiting_approval";

const compareIsoDesc = (a: string | null, b: string | null): number =>
  new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();

const runActivityAt = (run: TaskRun): string =>
  run.last_activity_at ?? run.ended_at ?? run.started_at;

export interface SelectProjectOptions {
  /** All runs known to the workbench, used to look up the next active run. */
  runs: TaskRun[];
  /** Persisted per-project activeRunId map (mutable copy owned by the store). */
  activeRunByProject: Record<string, string>;
  /** Current selected project id, used to skip redundant work and to release. */
  currentProjectId: string;
}

export interface SelectProjectResult {
  /** Next selected project id (may equal current if called with same id). */
  projectId: string;
  /** Resolved active run id for the project, "" if none. */
  activeRunId: string;
  /** Generation token captured for this switch — async effects compare to abort. */
  generation: number;
  /** True if the EventMiddleware subscription was actually swapped. */
  switchedSubscription: boolean;
  /** True if the SessionStore owner was released (no active run for target). */
  releasedOwner: boolean;
}

export class WorkbenchSessionController {
  /**
   * Monotonic generation token. Bumped on every selectProject call.
   * Async effects in the store compare this against the value they
   * captured at trigger time and abort if it has moved on.
   */
  generation = 0;

  /**
   * Record the result of the last selectProject call so other surfaces
   * (the chat page effect, the sidebar click handler) can verify their
   * captured generation against the controller's current generation.
   */
  lastResult: SelectProjectResult | null = null;

  /**
   * Atomic project switch. Returns a {@link SelectProjectResult} describing
   * what changed so the caller can apply the post-conditions (persist
   * `selectedProjectId`, swap `activeRunByProject`, reconcile timeline).
   *
   * This method is the only entry point that mutates `lastResult`; everything
   * else reads it.
   */
  async selectProject(
    project: WorkbenchProjectSummary | null,
    options: SelectProjectOptions,
  ): Promise<SelectProjectResult> {
    this.generation += 1;
    const gen = this.generation;

    // No project → release ownership and clear active run.
    if (!project) {
      const released = await this.releaseSessionOwnership(
        options.activeRunByProject[options.currentProjectId],
      );
      const result: SelectProjectResult = {
        projectId: "",
        activeRunId: "",
        generation: gen,
        switchedSubscription: released,
        releasedOwner: released,
      };
      this.lastResult = result;
      return result;
    }

    // Same project → just refresh the activeRunId derivation, no IO.
    if (project.id === options.currentProjectId) {
      const activeRunId = options.activeRunByProject[project.id] ?? "";
      const result: SelectProjectResult = {
        projectId: project.id,
        activeRunId,
        generation: gen,
        switchedSubscription: false,
        releasedOwner: false,
      };
      this.lastResult = result;
      return result;
    }

    // Resolve the next active run for the target project BEFORE swapping
    // the EventMiddleware subscription — if the lookup fails we leave the
    // middleware pointing at the previous run.
    const nextActiveRunId = this.resolveNextActiveRunId(project, options);
    const previousActiveRunId = options.activeRunByProject[options.currentProjectId] ?? "";

    let switched = false;
    let released = false;

    if (nextActiveRunId) {
      switched = await this.swapSessionOwnership(previousActiveRunId, nextActiveRunId);
    } else {
      released = await this.releaseSessionOwnership(previousActiveRunId);
    }

    const result: SelectProjectResult = {
      projectId: project.id,
      activeRunId: nextActiveRunId,
      generation: gen,
      switchedSubscription: switched,
      releasedOwner: released,
    };
    dbg("workbench", "selectProject", {
      from: options.currentProjectId,
      to: project.id,
      nextActiveRunId,
      switched,
      released,
      gen,
    });
    this.lastResult = result;
    return result;
  }

  /**
   * Release the EventMiddleware subscription and the SessionStore owner
   * when a project has no active run. Idempotent: clearing an empty
   * subscription is a no-op.
   */
  async releaseSessionOwnership(currentRunId: string): Promise<boolean> {
    if (!currentRunId) return false;
    const middleware = getEventMiddleware();
    middleware.subscribeCurrent("", sessionStore);
    try {
      sessionStore.releaseConnection();
    } catch (e) {
      dbg("workbench", "releaseSessionOwnership: releaseConnection failed", {
        runId: currentRunId,
        error: String(e),
      });
    }
    return true;
  }

  /**
   * Swap the EventMiddleware subscription from one run to another.
   * Idempotent when from === to (treated as a re-subscribe, harmless).
   */
  async swapSessionOwnership(fromRunId: string, toRunId: string): Promise<boolean> {
    if (!toRunId) return false;
    const middleware: EventMiddleware = getEventMiddleware();
    if (fromRunId === toRunId) {
      // Re-assert ownership; idempotent on the middleware side.
      middleware.subscribeCurrent(toRunId, sessionStore);
      return false;
    }
    middleware.subscribeCurrent(toRunId, sessionStore);
    dbg("workbench", "swapSessionOwnership", { from: fromRunId, to: toRunId });
    return true;
  }

  /**
   * Decide the next active run id for a project. Caller passes the full
   * runs list because the store owns it; this method is pure given those
   * inputs (no IO, no async).
   */
  private resolveNextActiveRunId(
    project: WorkbenchProjectSummary,
    options: SelectProjectOptions,
  ): string {
    const persisted = options.activeRunByProject[project.id];
    if (persisted) {
      const persistedRun = options.runs.find((run) => run.id === persisted);
      if (persistedRun && isProjectDeskRun(persistedRun)) {
        return persistedRun.id;
      }
    }
    const projectRuns = options.runs
      .filter((run) => runProjectCwd(run) === project.cwd)
      .sort((a, b) => compareIsoDesc(runActivityAt(a), runActivityAt(b)));
    const deskRun =
      projectRuns.find((run) => isProjectDeskRun(run) && isActiveStatus(run)) ??
      projectRuns.find(isProjectDeskRun);
    return deskRun?.id ?? "";
  }
}

/**
 * Module-level singleton — the workbench is a single-instance surface,
 * so a shared controller keeps generation monotonic across consumers.
 */
export const workbenchSessionController = new WorkbenchSessionController();

/**
 * Look up the project-desk token estimation metadata for the active run.
 * Kept here so P2-16 (Rust-generated snapshot stats) has a single source of
 * truth — the controller can fill `context_char_count` /
 * `estimated_tokens` / `snapshot_generated_at` from the run meta later.
 */
export interface ProjectDeskContextStats {
  /** char count of the system prompt that would be injected for this run. */
  contextCharCount: number | null;
  /** Estimated token count, derived if backend didn't supply one. */
  estimatedTokens: number | null;
  /** When the snapshot was generated (ISO string) — null if unknown. */
  snapshotGeneratedAt: string | null;
}

export function emptyContextStats(): ProjectDeskContextStats {
  return {
    contextCharCount: null,
    estimatedTokens: null,
    snapshotGeneratedAt: null,
  };
}

/** Estimate chars/tokens when the backend hasn't reported them. */
export function estimateContextStats(cwd: string, projectLabel: string): ProjectDeskContextStats {
  // Same heuristic the control panel already used to keep the UI
  // populated when Rust hasn't reported the stats yet (P2-16 fallback).
  const chars = 480 + (cwd?.length ?? 0) + (projectLabel?.length ?? 0);
  return {
    contextCharCount: chars,
    estimatedTokens: Math.max(120, Math.round(chars / 3)),
    snapshotGeneratedAt: new Date().toISOString(),
  };
}

// Re-export so consumers don't have to reach into the store just for the
// pure helper.
export { api };
