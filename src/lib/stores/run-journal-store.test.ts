import { describe, expect, it, vi, beforeEach } from "vitest";
import { RunJournalStore } from "./run-journal-store.svelte";
import type { RunJournalEvent, RunJournalSnapshot } from "$lib/types/run-journal";

vi.mock("$lib/api", () => ({
  getRunJournal: vi.fn(),
  listRunJournalEvents: vi.fn(),
  createRunCheckpoint: vi.fn(),
  reconcileRunJournalAfterRestart: vi.fn(),
}));

import * as api from "$lib/api";

const baseSnapshot = (runId: string): RunJournalSnapshot => ({
  schema_version: 1,
  run_id: runId,
  objective: "obj",
  stage: "executing",
  plan_revision: 0,
  accepted_messages: [],
  actions: [],
  pending_approvals: [],
  checkpoints: [],
  recovery_cursor: { cursor_seq: 0, last_bus_seq: 0 },
  recovery_assessment: { kind: "no_action", reason: "init", assessed_at: "t0" },
  journal_degraded: false,
  revision: 1,
  last_journal_seq: 1,
  created_at: "t0",
  updated_at: "t0",
});

describe("RunJournalStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes and sorts incremental events", async () => {
    const store = new RunJournalStore();
    const runId = "run-1";
    const events: RunJournalEvent[] = [
      {
        id: "e1",
        run_id: runId,
        seq: 1,
        event: { type: "initialized", objective: "obj", stage: "starting" },
        timestamp: "t1",
      },
      {
        id: "e2",
        run_id: runId,
        seq: 2,
        event: {
          type: "user_message_accepted",
          client_message_id: "cid-1",
        },
        timestamp: "t2",
      },
    ];
    store.eventsByRunId = { [runId]: [events[0]!] };
    vi.mocked(api.listRunJournalEvents).mockResolvedValue([events[1]!, events[0]!]);

    const loaded = await store.loadEvents(runId);
    expect(loaded.map((e) => e.seq)).toEqual([1, 2]);
    expect(api.listRunJournalEvents).toHaveBeenCalledWith(runId, 1);
  });

  it("single-flights snapshot loads per run", async () => {
    const store = new RunJournalStore();
    const runId = "run-2";
    let resolve!: (value: RunJournalSnapshot) => void;
    const pending = new Promise<RunJournalSnapshot>((r) => {
      resolve = r;
    });
    vi.mocked(api.getRunJournal).mockReturnValue(pending);

    const first = store.loadSnapshot(runId);
    const second = store.loadSnapshot(runId);
    expect(api.getRunJournal).toHaveBeenCalledTimes(1);

    resolve(baseSnapshot(runId));
    await Promise.all([first, second]);
    expect(store.snapshotFor(runId)?.run_id).toBe(runId);
  });

  it("single-flights event loads per run", async () => {
    const store = new RunJournalStore();
    const runId = "run-3";
    vi.mocked(api.listRunJournalEvents).mockResolvedValue([]);

    const first = store.loadEvents(runId);
    const second = store.loadEvents(runId);
    await Promise.all([first, second]);
    expect(api.listRunJournalEvents).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached recovery data after reconciliation changes", async () => {
    const store = new RunJournalStore();
    store.snapshotsByRunId = { "run-1": baseSnapshot("run-1") };
    store.eventsByRunId = { "run-1": [] };
    vi.mocked(api.reconcileRunJournalAfterRestart).mockResolvedValue({
      scanned: 1,
      recovered_pending_mutations: 0,
      restart_reconciled: 1,
      marked_uncertain: 0,
      impossible_resume: 0,
      unchanged: 0,
      failures: [],
    });

    await store.reconcileAfterRestart();

    expect(store.snapshotsByRunId).toEqual({});
    expect(store.eventsByRunId).toEqual({});
  });
});
