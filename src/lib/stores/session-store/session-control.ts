/**
 * Session lifecycle control functions extracted from SessionStore.
 *
 * Contains loadRun, startSession, sendMessage, sendSilentCommand,
 * interrupt, stop, resumeSession, _handleFork, connectSession.
 *
 * @module session-control
 */
import * as api from "$lib/api";
import type {
  TaskRun,
  BusEvent,
  Attachment,
  SessionMode,
  RunSurface,
} from "$lib/types";
import { isKeyOptionalPlatform } from "$lib/utils/platform-presets";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import * as snapshotCache from "$lib/utils/snapshot-cache";
import { getTransport } from "$lib/transport";
import { getEventMiddleware } from "../event-middleware";
import { mapAttachments } from "../session/timeline-projection";
import {
  type SessionPhase,
  type UsageState,
  type TurnUsage,
  ACTIVE_PHASES,
  TERMINAL_PHASES,
} from "../types";
import type { ReduceCtx } from "../reducers/types";
import type {
  TimelineEntry,
  HookEvent,
} from "$lib/types";

// ── Store interface for session-control functions ──

export interface SessionControlAPI {
  // $state fields (read/write)
  run: TaskRun | null;
  timeline: TimelineEntry[];
  agent: string;
  remoteHostName: string | null;
  platformId: string | null;
  model: string;
  error: string;
  phase: SessionPhase;
  permissionMode: string;
  permissionModeSetByUser: boolean;
  streamingText: string;
  thinkingText: string;
  thinkingStartMs: number;
  thinkingEndMs: number;
  tools: HookEvent[];
  usage: UsageState;
  turnUsages: TurnUsage[];
  previousPermissionMode: string;
  pendingPermissionModeOverride: string | null;
  pendingClearContextPlan: string | null;
  sessionInitReceived: boolean;
  permissionModePersistFailed: boolean;

  // Private-like fields
  _isLoadingReplay: boolean;
  _stopping: boolean;
  _lastProcessedSeq: number;
  _lastSnapshotSeq: number;
  _needsIdleHealthCheck: boolean;
  _seenMessageIds: Set<string>;
  _seenToolIds: Set<string>;
  _toolTlIndex: Map<string, number>;
  _toolHeIndex: Map<string, number>;

  // Getters
  readonly useStreamSession: boolean;
  readonly sessionAlive: boolean;
  readonly isRunning: boolean;
  readonly isIdle: boolean;
  readonly canSend: boolean;

  // Methods
  isKnownSlashCommand(text: string): boolean;
  _setPhase(to: SessionPhase): void;
  _clearContentState(): void;
  _clearStreamingState(ctx: ReduceCtx | null): void;
  _startSpawnTimeout(runId: string): void;
  _startResponseTimeout(runId: string): void;
  _clearResponseTimeout(): void;
  _clearTimeoutError(): void;
  _pushOptimisticUser(content: string, attachments?: Attachment[]): string;
  _removeOptimisticUser(entryId: string): void;
  _tryApplySnapshot(bodyOrObj: string | Record<string, unknown>): boolean;
  _parseSnapshotBody(body: string): Record<string, unknown> | null;
  _saveSnapshotToIdb(runId: string): void;
  applyEventBatchAsync(
    events: BusEvent[],
    opts?: { replayOnly?: boolean; isStale?: () => boolean },
  ): Promise<number | null>;
  reset(): void;
  recoverFromEventLog(notice?: string): Promise<void>;

  // Async lifecycle coordinator
  _asyncLifecycle: {
    beginLoad(): number | null;
    beginResume(): number | null;
    isStale(gen: number): boolean;
    stalePredicate(gen: number): () => boolean;
    currentGeneration: number;
    endResume(): void;
  };

  // Connection controller
  _connection: {
    beginReplay(runId: string): void;
    subscribeFromSeq(runId: string, seq: number): void;
    subscribeFromReplay(runId: string, events: BusEvent[]): void;
    subscribeFresh(runId: string): void;
    release(): void;
  };
}

// ── loadRun ──

export async function loadRunImpl(
  store: SessionControlAPI,
  id: string,
  xtermRef?: { clear(): void; writeText(s: string): void },
): Promise<void> {
  const gen = store._asyncLifecycle.beginLoad();
  if (gen === null) return;
  const loadStart = performance.now();
  dbg("store", "loadRun id=", id, "gen=", gen);

  if (!id) {
    store.reset();
    return;
  }

  // Select the logical run before any asynchronous load. This releases the
  // previous run owner immediately and establishes an explicit replay phase.
  store._connection.beginReplay(id);

  // Reset state for new load
  store._setPhase("loading");
  store._clearContentState();

  if (xtermRef) {
    xtermRef.clear();
    xtermRef.writeText("\x1b[0m\x1b[2J\x1b[H");
  }

  try {
    const fetchedRun = await api.getRun(id);
    if (store._asyncLifecycle.isStale(gen)) {
      dbg("store", "stale after getRun, gen=", gen);
      return;
    }
    store.run = fetchedRun;
    // Cache for notification title lookup
    import("$lib/services/notification-listener")
      .then((m) => m.cacheRun(fetchedRun))
      .catch((e) => dbgWarn("store", "cacheRun failed:", e));

    // Auto-sync CLI imports to pick up events written after the initial import
    if (store.run.source === "cli_import") {
      try {
        const syncResult = await api.syncCliSession(id);
        if (syncResult.newEvents > 0) {
          dbg("store", "loadRun: auto-synced CLI import", {
            newEvents: syncResult.newEvents,
          });
          // Refresh run meta after sync (watermark/status may have updated)
          const refreshed = await api.getRun(id);
          if (store._asyncLifecycle.isStale(gen)) {
            dbg("store", "stale after auto-sync refresh, gen=", gen);
            return;
          }
          store.run = refreshed;
          // Sync appended events → IDB snapshot is stale
          snapshotCache.deleteSnapshot(id).catch((e) => dbgWarn("snapshot", "delete failed", e));
        }
      } catch (e) {
        dbg("store", "loadRun: auto-sync failed (non-fatal)", String(e));
      }
      if (store._asyncLifecycle.isStale(gen)) {
        dbg("store", "stale after auto-sync, gen=", gen);
        return;
      }
    }

    store.agent = store.run.agent;
    store.remoteHostName = store.run.remote_host_name ?? null;
    store.platformId = store.run.platform_id ?? null;
    // Suppress isThinking during event replay (prevents "thinking" flash on session switch)
    store._isLoadingReplay = true;

    // Determine phase from run status
    const st = store.run.status;
    if (st === "running") {
      // Health check: verify actor is actually alive for "running" runs.
      try {
        const status = await api.getSessionRuntimeStatus(id);
        if (store._asyncLifecycle.isStale(gen)) return;
        if (!status.actor_alive) {
          dbg("store", "loadRun: actor dead for running run, downgrading to ready", { id });
          store._setPhase("ready");
        } else {
          store._setPhase("running");
        }
      } catch {
        // Health check failed — assume actor is alive (optimistic)
        if (store._asyncLifecycle.isStale(gen)) return;
        store._setPhase("running");
      }
    } else if (st === "completed" || st === "failed" || st === "stopped") {
      store._setPhase(st as SessionPhase);
    } else if (st === "idle") {
      // Keep "loading" until the snapshot path chooses cached / idle
    } else {
      store._setPhase("ready");
    }

    // Terminal runs use replayOnly — historical run_state events must not
    // overwrite the phase we just set from run.status.
    const isTerminal = TERMINAL_PHASES.includes(store.phase);

    if (store.useStreamSession) {
      let reducerMs = 0;
      let snapshotHit = false;

      // Try IDB snapshot (terminal + idle sessions)
      const snapshotEligible = isTerminal || store.run!.status === "idle";
      let snapshotBody: string | null = null;
      if (snapshotEligible) {
        try {
          snapshotBody = await snapshotCache.readSnapshot(id, store.run!.status);
        } catch {
          /* IDB unavailable → miss */
        }
        if (store._asyncLifecycle.isStale(gen)) return;
      }

      if (snapshotBody) {
        const isIdleSnap = !isTerminal;
        // Parse once, used for both seq check and apply
        const parsed = store._parseSnapshotBody(snapshotBody);
        if (!parsed) {
          snapshotBody = null; // corrupted JSON
        } else {
          const snapSeq = isIdleSnap ? ((parsed._lastProcessedSeq as number) ?? 0) : 1;

          if (snapSeq === 0 && isIdleSnap) {
            // seq=0: skip snapshot, delete stale entry to prevent repeated hit-then-skip
            dbg("store", "idle snapshot seq=0, skipping for full replay");
            snapshotCache
              .deleteSnapshot(id)
              .catch((e) => dbgWarn("snapshot", "delete failed", e));
            snapshotBody = null; // fall through to miss path
          } else if (store._tryApplySnapshot(parsed)) {
            snapshotHit = true;
            // Align _lastSnapshotSeq to prevent unnecessary rewrite on first idle
            store._lastSnapshotSeq = store._lastProcessedSeq;

            if (isIdleSnap) {
              if (getTransport().isDesktop()) {
                store._setPhase("cached");
                dbg("store", "loadRun: idle snapshot hit → cached (lazy resume)", { id });
              } else {
                store._setPhase("idle");
              }
            }

            // Desktop idle: incremental catchup (no WS available)
            if (isIdleSnap && getTransport().isDesktop()) {
              const catchupEvents = await api.getBusEvents(id, store._lastProcessedSeq);
              if (store._asyncLifecycle.isStale(gen)) return;
              if (catchupEvents.length > 0) {
                dbg("store", "idle snapshot catchup", { count: catchupEvents.length });
                const catchupMs = await store.applyEventBatchAsync(catchupEvents, {
                  replayOnly: false,
                  isStale: store._asyncLifecycle.stalePredicate(gen),
                });
                if (catchupMs === null) return;
                const catchupSt = store.run?.status;
                if (
                  catchupSt === "idle" ||
                  catchupSt === "completed" ||
                  catchupSt === "failed" ||
                  catchupSt === "stopped"
                ) {
                  store._saveSnapshotToIdb(id);
                }
                // If catchup revealed new activity, promote cached → idle.
                if (store.phase === "cached") store._setPhase("idle");
              }
            } else if (isIdleSnap) {
              store._connection.subscribeFromSeq(id, store._lastProcessedSeq);
            }
            // Terminal: no catchup needed, just subscribe for WS if applicable
            if (!isIdleSnap) {
              store._connection.subscribeFromSeq(id, store._lastProcessedSeq);
            }
          } else {
            snapshotBody = null; // shape validation failed
          }
        }
      }

      if (!snapshotHit) {
        // Miss or snapshot corrupted → normal path
        const busEvents = await api.getBusEvents(id);
        if (store._asyncLifecycle.isStale(gen)) {
          dbg("store", "stale after getBusEvents, gen=", gen);
          return;
        }
        const ms = await store.applyEventBatchAsync(busEvents, {
          replayOnly: isTerminal,
          isStale: store._asyncLifecycle.stalePredicate(gen),
        });
        if (ms === null) return;
        reducerMs = ms;
        store._connection.subscribeFromReplay(id, busEvents);
        // Write guard: distinguish "legit empty session" from "reducer anomaly"
        if (snapshotEligible && (store.timeline.length > 0 || busEvents.length === 0)) {
          store._saveSnapshotToIdb(id);
        }
      }

      store._isLoadingReplay = false;
      // Idle load with no snapshot / no run_state in the log can leave phase
      // stuck on "loading" — settle to cached (desktop lazy) or idle.
      if (store.phase === "loading" && store.run?.status === "idle") {
        store._setPhase(getTransport().isDesktop() ? "cached" : "idle");
      }
      dbg("store", "loadRun", {
        total: Math.round(performance.now() - loadStart),
        snapshotHit,
        reducer: Math.round(reducerMs),
        entries: store.timeline.length,
      });
    } else {
      store._isLoadingReplay = false;
      // CLI mode: replay history in terminal
      const events = await api.getRunEvents(id);
      if (store._asyncLifecycle.isStale(gen)) {
        dbg("store", "stale after getRunEvents, gen=", gen);
        return;
      }
      let hasHistory = false;
      for (const event of events) {
        const text = String(
          (event.payload as Record<string, unknown>).text ??
            (event.payload as Record<string, unknown>).message ??
            "",
        );
        if (!text || !xtermRef) continue;
        if (event.type === "user") {
          xtermRef.writeText(`\x1b[1;36m> ${text}\x1b[0m\r\n`);
          hasHistory = true;
        } else if (event.type === "system") {
          xtermRef.writeText(`\x1b[90m${text}\x1b[0m\r\n`);
        }
      }
      if (hasHistory && !store.isRunning && xtermRef) {
        xtermRef.writeText(`\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n`);
      }
    }

    // After replay, reconcile phase with run.status:
    const finalStatus = store.run?.status;
    if (finalStatus === "completed" || finalStatus === "failed" || finalStatus === "stopped") {
      if (!TERMINAL_PHASES.includes(store.phase as SessionPhase)) {
        dbg("store", "reconcile phase", store.phase, "→", finalStatus);
        store._setPhase(finalStatus as SessionPhase);
      }
      // Clear replayed errors for terminal runs — they're historical, not active
      store.error = "";
    }

    // Restore per-run model from meta.json
    if (store.run?.model) {
      dbg("store", "restore run model from meta:", store.run.model);
      store.model = store.run.model;
    }
  } catch (e) {
    if (store._asyncLifecycle.isStale(gen)) return;
    store.error = String(e);
    store._setPhase("failed");
  } finally {
    if (!store._asyncLifecycle.isStale(gen)) {
      store._isLoadingReplay = false;
    }
  }
}

// ── startSession ──

export async function startSessionImpl(
  store: SessionControlAPI,
  prompt: string,
  cwd: string,
  attachments: Attachment[],
  permissionModeOverride?: string,
  creationMode?: "single" | "worktree",
  folderId?: string,
  runSurface?: RunSurface,
): Promise<string> {
  store.error = "";
  store._setPhase("spawning");

  try {
    // Refresh platformId and permissionMode from latest settings for new sessions.
    try {
      const freshSettings = await api.getUserSettings();
      const freshPid = freshSettings.active_platform_id ?? "anthropic";
      if (freshSettings.auth_mode === "api" || isKeyOptionalPlatform(freshPid)) {
        if (freshPid !== store.platformId) {
          dbg("store", "startSession: refreshing platformId", {
            old: store.platformId,
            new: freshPid,
          });
          store.platformId = freshPid;
        }
      }
      // Settings stores app-internal names (auto_all, auto_read, etc.)
      // Store uses CLI names (bypassPermissions, acceptEdits, etc.)
      const APP_TO_CLI: Record<string, string> = {
        ask: "default",
        auto_read: "acceptEdits",
        auto_all: "bypassPermissions",
        plan: "plan",
        auto: "auto",
        dont_ask: "dontAsk",
      };
      if (permissionModeOverride) {
        // Session-scoped override wins — sync UI state to match what backend will spawn with.
        if (permissionModeOverride !== store.permissionMode) {
          store.permissionMode = permissionModeOverride;
          store.permissionModeSetByUser = true;
        }
      } else if (freshSettings.permission_mode) {
        const freshPerm =
          APP_TO_CLI[freshSettings.permission_mode] ?? freshSettings.permission_mode;
        if (freshPerm !== store.permissionMode) {
          dbg("store", "startSession: refreshing permissionMode", {
            old: store.permissionMode,
            new: freshPerm,
          });
          store.permissionMode = freshPerm;
          store.permissionModeSetByUser = true;
        }
      }
    } catch {
      // Non-fatal: fall through with current store values
    }

    // Explicitly pass execution_path — source of truth for run mode
    const executionPath = store.useStreamSession ? "session_actor" : "pipe_exec";
    const run = await api.startRun(
      prompt,
      cwd,
      store.agent,
      store.model || undefined,
      store.remoteHostName || undefined,
      store.platformId || undefined,
      executionPath,
      creationMode,
      folderId,
      undefined,
      runSurface,
    );
    store.run = run;

    if (store.useStreamSession) {
      // Optimistic user message
      const optimisticId = store._pushOptimisticUser(prompt, attachments);
      // Subscribe middleware BEFORE spawning so no bus-events are dropped.
      const mw = getEventMiddleware();
      mw.subscribeCurrent(run.id, store as unknown as Parameters<typeof mw.subscribeCurrent>[1]);
      store._connection.subscribeFresh(run.id);
      dbg("store", "stream session start, run=", run.id);
      const backendAtt = mapAttachments(attachments) ?? undefined;
      try {
        await api.startSession(
          run.id,
          undefined,
          undefined,
          undefined,
          backendAtt,
          store.platformId || undefined,
          permissionModeOverride,
        );
      } catch (startErr) {
        store._removeOptimisticUser(optimisticId);
        throw startErr;
      }
      dbg("store", "startSession resolved");
      // phase will be set by run_state bus event
      store._startSpawnTimeout(run.id);
      if (store.isKnownSlashCommand(prompt)) {
        dbg("store", "skip response timeout for slash command", { cmd: prompt.split(" ")[0] });
      } else {
        store._startResponseTimeout(run.id);
      }
    } else {
      // Codex pipe mode
      store._setPhase("running");
      await api.sendChatMessage(run.id, prompt, attachments.length > 0 ? attachments : undefined);
    }

    return run.id;
  } catch (e) {
    store.error = String(e);
    store._setPhase("failed");
    throw e;
  }
}

// ── sendMessage ──

export async function sendMessageImpl(
  store: SessionControlAPI,
  text: string,
  attachments: Attachment[],
  clientMessageId?: string | null,
): Promise<void> {
  if (!store.run) throw new Error("No active run — message cannot be sent");
  store.error = "";
  store._clearStreamingState(null);
  // Invalidate idle snapshot — user is sending a new message
  snapshotCache.deleteSnapshot(store.run.id).catch((e) => dbgWarn("snapshot", "delete failed", e));

  try {
    if (store.useStreamSession && store.sessionAlive) {
      // Optimistic user message
      const optimisticId = store._pushOptimisticUser(text, attachments);
      try {
        await api.sendSessionMessage(
          store.run.id,
          text,
          mapAttachments(attachments) ?? undefined,
          clientMessageId,
        );
      } catch (sendErr) {
        store._removeOptimisticUser(optimisticId);
        // If the backend reports "Session not found", the session actor
        // died but the frontend hasn't received the bus event yet.
        const msg = String(sendErr);
        if (msg.includes("not found") || msg.includes("not_found")) {
          dbg("store", "sendMessage: session actor gone, marking dead", { runId: store.run.id });
          store._setPhase("failed");
          throw new Error("session_dead: " + msg);
        }
        throw sendErr;
      }
      if (store.isKnownSlashCommand(text)) {
        dbg("store", "skip response timeout for slash command", { cmd: text.split(" ")[0] });
      } else {
        store._startResponseTimeout(store.run.id);
      }
    } else if (store.useStreamSession && !store.sessionAlive) {
      // Stream session died — throw so the send coordinator can handle it.
      throw new Error("session_dead: stream session is no longer alive — start a new session");
    } else {
      store._setPhase("running");
      await api.sendChatMessage(
        store.run.id,
        text,
        attachments.length > 0 ? attachments : undefined,
        undefined,
        clientMessageId,
      );
    }
  } catch (e) {
    store.error = String(e);
    // Pipe mode sets phase to "running" before the await; reset on failure
    if (!store.useStreamSession && store.phase === "running") {
      store._setPhase("idle");
    }
    throw e;
  }
}

// ── sendSilentCommand ──

export async function sendSilentCommandImpl(
  store: SessionControlAPI,
  command: string,
): Promise<boolean> {
  if (!store.run || !store.sessionAlive || !store.useStreamSession) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  if (cmd !== "/model" && cmd !== "/effort") {
    dbgWarn("store", "sendSilentCommand rejected non-whitelisted command", { cmd });
    return false;
  }
  dbg("store", "sendSilentCommand", { command: trimmed });
  await api.sendSessionMessage(store.run.id, trimmed);
  return true;
}

// ── interrupt ──

export async function interruptImpl(store: SessionControlAPI): Promise<void> {
  if (!store.run || !store.isRunning) return;
  if (!store.sessionAlive) {
    // Phase shows running but session is not alive — force cleanup
    store._setPhase("stopped");
    store.run = { ...store.run, status: "stopped" };
    return;
  }
  try {
    dbg("store", "interrupt current turn");
    await api.sendSessionControl(store.run.id, "interrupt");
  } catch (e) {
    // interrupt failed (timeout or actor dead) — kill process directly
    dbg("store", "interrupt failed, killing process:", e);
    try {
      await api.stopSession(store.run.id);
    } catch (e) {
      dbgWarn("store", "stopSession also failed (session may already be dead)", e);
    }
    store._setPhase("stopped");
    store.run = { ...store.run, status: "stopped" };
  }
}

// ── stop ──

export async function stopImpl(store: SessionControlAPI): Promise<void> {
  if (!store.run) return;
  store._stopping = true;
  store._clearResponseTimeout();
  try {
    if (store.sessionAlive) {
      // Try graceful interrupt first if agent is currently running.
      // Skip during "spawning" — CLI hasn't initialized yet, interrupt would
      // wait for a control_response that may never come.
      if (store.phase === "running") {
        try {
          dbg("store", "sending interrupt before stop");
          await api.sendSessionControl(store.run.id, "interrupt");
          // Brief wait for CLI to process the interrupt
          await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          dbg("store", "interrupt failed (proceeding to kill):", e);
        }
      }
      try {
        await api.stopSession(store.run.id);
      } catch (e) {
        // Session may already be dead (process exited, actor cleaned up).
        // Force frontend state to stopped regardless.
        dbgWarn("store", "stopSession failed (forcing stopped):", e);
      }
    } else {
      await api.stopRun(store.run.id);
    }
  } catch (e) {
    dbgWarn("store", "stop failed:", e);
  } finally {
    // Always clean up frontend state, even if backend calls failed.
    store._setPhase("stopped");
    store.run = { ...store.run!, status: "stopped" };
    store._stopping = false;
  }
}

// ── resumeSession ──

export async function resumeSessionImpl(
  store: SessionControlAPI,
  runId: string,
  mode: SessionMode,
  initialMessage?: string,
  attachments?: Attachment[],
): Promise<string | null> {
  const loadGen = store._asyncLifecycle.beginResume();
  if (loadGen === null) return null;

  try {
    let run = await api.getRun(runId);
    if (store._asyncLifecycle.isStale(loadGen)) return runId;

    let metaActive = ACTIVE_PHASES.includes(run.status as SessionPhase);
    if (metaActive && mode !== "fork") {
      // meta.json says "running" — likely a stale status from an orphaned/crashed session.
      // Try to stop it first (kills process if alive, updates meta if not), then proceed.
      dbg("store", "resumeSession: meta says active, attempting stop first", {
        runId,
        status: run.status,
      });
      try {
        await api.stopRun(runId);
        const refreshed = await api.getRun(runId);
        run = refreshed;
        metaActive = ACTIVE_PHASES.includes(run.status as SessionPhase);
      } catch (e) {
        dbgWarn("store", "resumeSession: stop attempt failed:", e);
      }
      if (metaActive) {
        // Still running after stop attempt — genuinely active, can't resume
        throw new Error(t("session_stillRunning"));
      }
    }
    // Fork validates session_id internally; resume/continue need it here.
    if (mode !== "continue" && mode !== "fork" && !run.session_id) {
      throw new Error(t("session_noId"));
    }

    const resumeT0 = performance.now();

    // ★ Phase 1: async data fetch BEFORE clearing state (avoids flash)
    const isStream = run.execution_path === "session_actor";
    let snapshotBody: string | null = null;
    let busEvents: BusEvent[] = [];

    if (isStream) {
      try {
        snapshotBody = await snapshotCache.readSnapshot(runId, run.status);
      } catch {
        /* IDB unavailable */
      }
      if (store._asyncLifecycle.isStale(loadGen)) return runId;
      if (!snapshotBody) {
        busEvents = await api.getBusEvents(runId);
        if (store._asyncLifecycle.isStale(loadGen)) return runId;
        dbg("store", "resumeSession: fetched", busEvents.length, "bus events for replay");
      }
    }

    // ★ Phase 2: switch logical ownership before mutating visible state
    store._connection.beginReplay(runId);
    store.run = run;
    store.agent = run.agent;
    store.platformId = run.platform_id ?? null;
    store._clearContentState();

    // ★ Phase 3: apply snapshot or events + force invalidate
    let reducerMs = 0;
    let snapshotHit = false;
    if (isStream) {
      if (snapshotBody && store._tryApplySnapshot(snapshotBody)) {
        snapshotHit = true;
        store._connection.subscribeFromSeq(runId, store._lastProcessedSeq);
      } else {
        // Fallback: snapshot corrupted → re-fetch events if needed
        if (!busEvents.length && snapshotBody) {
          busEvents = await api.getBusEvents(runId);
          if (store._asyncLifecycle.isStale(loadGen)) return runId;
        }
        if (busEvents.length > 0) {
          const ms = await store.applyEventBatchAsync(busEvents, {
            replayOnly: true,
            isStale: store._asyncLifecycle.stalePredicate(loadGen),
          });
          if (ms === null) return runId;
          reducerMs = ms;
        }
        // Always subscribe — even empty history needs real-time events
        store._connection.subscribeFromReplay(runId, busEvents);
      }

      // Resume makes session go live → old snapshot is always stale
      snapshotCache.deleteSnapshot(runId).catch((e) => dbgWarn("snapshot", "delete failed", e));
    }

    dbg("store", "resumeSession", {
      total: Math.round(performance.now() - resumeT0),
      snapshotHit,
      reducer: Math.round(reducerMs),
      entries: store.timeline.length,
    });

    // Restore per-run model from meta.json
    if (run.model) {
      dbg("store", "resume: restore run model from meta:", run.model);
      store.model = run.model;
    }

    // Optimistic user message: add AFTER replay so it appears at the end of timeline.
    if (initialMessage) {
      store._pushOptimisticUser(initialMessage, attachments ?? undefined);
    }

    // Explicitly set phase — replay didn't touch it
    store._setPhase("spawning");

    let targetRunId = runId;

    if (mode === "fork") {
      targetRunId = await handleForkImpl(store, runId);
    } else {
      const sessionId = run.session_id;
      const backendAtt = attachments ? (mapAttachments(attachments) ?? undefined) : undefined;
      dbg("store", "resumeSession", {
        runId,
        targetRunId,
        mode,
        sessionId,
        hasMessage: !!initialMessage,
        attachments: backendAtt?.length ?? 0,
      });
      await api.startSession(
        targetRunId,
        mode,
        sessionId ?? undefined,
        initialMessage,
        backendAtt,
        run.platform_id ?? undefined,
      );
    }
    // Bus events via applyEvent (live) will transition phase:
    // - With message: spawning → running → idle (from CLI result)
    // - Without message: spawning → idle (synthetic, waiting for user input)

    // Timeout guard: if CLI never emits session_init, the UI would spin forever.
    // Fork skips this — connectSession() handles its own spawn timeout.
    if (mode !== "fork") {
      store._startSpawnTimeout(targetRunId);
      if (initialMessage && !store.isKnownSlashCommand(initialMessage)) {
        store._startResponseTimeout(targetRunId);
      } else if (initialMessage) {
        dbg("store", "skip response timeout for slash command (resume)", {
          cmd: initialMessage.split(" ")[0],
        });
      }
      // No initialMessage → no response timeout (just waiting for user input)
    }

    return targetRunId;
  } catch (e) {
    if (store._asyncLifecycle.isStale(loadGen)) return null;
    store.error = String(e);
    store._setPhase("failed");
    dbgWarn("store", "resumeSession failed:", e);
    return null;
  } finally {
    store._asyncLifecycle.endResume();
  }
}

// ── _handleFork (private helper, called from resumeSession) ──

export async function handleForkImpl(
  store: SessionControlAPI,
  runId: string,
): Promise<string> {
  dbg("store", "resumeSession: two-step fork", { runId });
  const loadGen = store._asyncLifecycle.currentGeneration;

  // Clear both routing and this store's physical owner to prevent source
  // RunState(stopped) events from interfering with the fork replay.
  getEventMiddleware().subscribeCurrent("", store as unknown as Parameters<ReturnType<typeof getEventMiddleware>["subscribeCurrent"]>[1]);
  store._connection.release();

  // Step 1: One-shot fork (backend does fork_oneshot, returns new run_id with new session_id)
  const newRunId = await api.forkSession(runId);
  if (store._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");

  const newRun = await api.getRun(newRunId);
  if (store._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");

  store._connection.beginReplay(newRunId);
  store.run = newRun;

  // Reset display state — start fresh for the fork run.
  store._clearContentState();

  // Replay copied parent events for immediate display.
  const allForkEvents = await api.getBusEvents(newRunId);
  if (store._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");
  const newEvents = allForkEvents.filter(
    (ev) =>
      ev.type === "attention_changed" ||
      ev.type === "runtime_health_changed" ||
      ev.run_id === newRunId,
  );
  if (newEvents.length > 0) {
    dbg("store", "fork: replaying", newEvents.length, "parent events");
    const ms = await store.applyEventBatchAsync(newEvents, {
      replayOnly: true,
      isStale: store._asyncLifecycle.stalePredicate(loadGen),
    });
    if (ms === null) throw new Error("Stale during fork replay");
  }
  // Subscribe to NEW run — live events from stream-json will route here.
  getEventMiddleware().subscribeCurrent(newRunId, store as unknown as Parameters<ReturnType<typeof getEventMiddleware>["subscribeCurrent"]>[1]);
  dbg("store", "fork: middleware subscribed to new run", newRunId);
  store._connection.subscribeFromReplay(newRunId, allForkEvents);

  // Step 2 (stream-json resume) is NOT started here.
  // handleResume will dismiss the overlay first, then call connectSession()
  dbg("store", "fork: step 1 complete, returning newRunId for step 2", {
    newRunId,
    sessionId: newRun.session_id,
  });
  return newRunId;
}

// ── connectSession ──

export async function connectSessionImpl(
  store: SessionControlAPI,
  runId: string,
  sessionId?: string,
): Promise<void> {
  const sid = sessionId ?? store.run?.session_id;
  if (!sid) throw new Error("No session_id available for connectSession");
  dbg("store", "connectSession: establishing stream-json connection", { runId, sessionId: sid });
  store._connection.subscribeFresh(runId);
  store._setPhase("spawning");
  await api.startSession(
    runId,
    "resume",
    sid,
    undefined,
    undefined,
    store.platformId || undefined,
  );
  store._startSpawnTimeout(runId);
}
