import { describe, it, expect, vi } from "vitest";
import { reduceRalphStarted, reduceRalphIteration, reduceRalphComplete } from "../ralph-loop";

vi.mock("$lib/utils/uuid", () => ({
  uuid: (() => {
    let n = 0;
    return () => `sep-${++n}`;
  })(),
}));

describe("ralph loop reducers", () => {
  it("reduceRalphStarted initializes the loop state", () => {
    const store = { ralphLoop: null as Parameters<typeof reduceRalphStarted>[2]["ralphLoop"] };
    reduceRalphStarted(
      {
        type: "ralph_started",
        run_id: "r",
        _seq: 1,
        prompt: "do thing",
        max_iterations: 5,
        completion_promise: "DONE",
        started_at: "2026-06-18T00:00:00Z",
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.ralphLoop).toEqual({
      active: true,
      prompt: "do thing",
      iteration: 0,
      maxIterations: 5,
      completionPromise: "DONE",
      startedAt: "2026-06-18T00:00:00Z",
      reason: null,
    });
  });

  it("reduceRalphIteration advances counter and pushes separator", () => {
    const pushed: unknown[] = [];
    const store = {
      ralphLoop: { active: true, iteration: 0, maxIterations: 5, reason: null } as Parameters<
        typeof reduceRalphStarted
      >[2]["ralphLoop"],
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
    };
    reduceRalphIteration(
      {
        type: "ralph_iteration",
        run_id: "r",
        _seq: 1,
        iteration: 2,
        max_iterations: 5,
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.ralphLoop!.iteration).toBe(2);
    expect(store.ralphLoop!.maxIterations).toBe(5);
    expect(pushed.length).toBe(1);
    const sep = pushed[0] as { content: string };
    expect(sep.content).toBe("🔄 Ralph iteration 2/5");
  });

  it("reduceRalphIteration omits max label when max_iterations is 0", () => {
    const pushed: unknown[] = [];
    const store = {
      ralphLoop: { active: true, iteration: 0, maxIterations: 0, reason: null } as Parameters<
        typeof reduceRalphStarted
      >[2]["ralphLoop"],
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
    };
    reduceRalphIteration(
      { type: "ralph_iteration", run_id: "r", _seq: 1, iteration: 7, max_iterations: 0 } as never,
      null,
      store as never,
      false,
    );
    const sep = pushed[0] as { content: string };
    expect(sep.content).toBe("🔄 Ralph iteration 7");
  });

  it("reduceRalphComplete marks inactive and pushes completion separator", () => {
    const pushed: unknown[] = [];
    const store = {
      ralphLoop: { active: true, iteration: 5, maxIterations: 5, reason: null } as Parameters<
        typeof reduceRalphStarted
      >[2]["ralphLoop"],
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
    };
    reduceRalphComplete(
      {
        type: "ralph_complete",
        run_id: "r",
        _seq: 1,
        iteration: 5,
        reason: "max_iterations",
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.ralphLoop!.active).toBe(false);
    expect(store.ralphLoop!.reason).toBe("max_iterations");
    const sep = pushed[0] as { content: string };
    expect(sep.content).toBe("✅ Ralph Loop completed · 5 iterations · max iterations reached");
  });

  it("reduceRalphComplete uses ❌ icon for cancelled reasons", () => {
    const pushed: unknown[] = [];
    const store = {
      ralphLoop: null as Parameters<typeof reduceRalphStarted>[2]["ralphLoop"],
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
    };
    reduceRalphComplete(
      { type: "ralph_complete", run_id: "r", _seq: 1, iteration: 2, reason: "cancelled" } as never,
      null,
      store as never,
      false,
    );
    const sep = pushed[0] as { content: string };
    expect(sep.content.startsWith("❌")).toBe(true);
  });

  it("reduceRalphComplete uses raw reason when not in label map", () => {
    const pushed: unknown[] = [];
    const store = {
      ralphLoop: null as Parameters<typeof reduceRalphStarted>[2]["ralphLoop"],
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
    };
    reduceRalphComplete(
      {
        type: "ralph_complete",
        run_id: "r",
        _seq: 1,
        iteration: 1,
        reason: "weird_reason",
      } as never,
      null,
      store as never,
      false,
    );
    const sep = pushed[0] as { content: string };
    expect(sep.content).toContain("weird_reason");
  });
});
