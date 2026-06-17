import { describe, it, expect } from "vitest";
import {
  reduceHookStarted,
  reduceHookProgress,
  reduceHookResponse,
  reduceHookCallback,
} from "../hook-events";

describe("hook-events reducers", () => {
  const makeStore = () => ({ hookEvents: [] as unknown[] });

  it("reduceHookStarted appends to hookEvents with hook_name", () => {
    const store = makeStore();
    reduceHookStarted(
      {
        type: "hook_started",
        run_id: "r",
        _seq: 1,
        hook_id: "h1",
        hook_name: "pre-commit",
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.hookEvents.length).toBe(1);
    const e = store.hookEvents[0] as { hook_id: string; hook_name: string };
    expect(e.hook_id).toBe("h1");
    expect(e.hook_name).toBe("pre-commit");
  });

  it("reduceHookProgress appends with minimal fields", () => {
    const store = makeStore();
    reduceHookProgress(
      { type: "hook_progress", run_id: "r", _seq: 1, hook_id: "h1" } as never,
      null,
      store as never,
      false,
    );
    const e = store.hookEvents[0] as { type: string; hook_id: string };
    expect(e.type).toBe("hook_progress");
    expect(e.hook_id).toBe("h1");
  });

  it("reduceHookResponse captures stdout/stderr/exit_code", () => {
    const store = makeStore();
    reduceHookResponse(
      {
        type: "hook_response",
        run_id: "r",
        _seq: 1,
        hook_id: "h1",
        hook_name: "x",
        stdout: "ok",
        stderr: "",
        exit_code: 0,
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.hookEvents[0] as { stdout: string; exit_code: number };
    expect(e.stdout).toBe("ok");
    expect(e.exit_code).toBe(0);
  });

  it("reduceHookCallback marks status='hook_pending' for PreToolUse", () => {
    const store = makeStore();
    reduceHookCallback(
      {
        type: "hook_callback",
        run_id: "r",
        _seq: 1,
        hook_id: "h1",
        request_id: "req1",
        hook_event: "PreToolUse",
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.hookEvents[0] as { status: string; request_id: string };
    expect(e.status).toBe("hook_pending");
    expect(e.request_id).toBe("req1");
  });

  it("reduceHookCallback marks status='allowed' for non-PreToolUse", () => {
    const store = makeStore();
    reduceHookCallback(
      {
        type: "hook_callback",
        run_id: "r",
        _seq: 1,
        hook_id: "h1",
        request_id: "req1",
        hook_event: "PostToolUse",
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.hookEvents[0] as { status: string };
    expect(e.status).toBe("allowed");
  });

  it("caps hookEvents at 500 (drops oldest first)", () => {
    const existing = Array.from({ length: 500 }, (_, i) => ({ hook_id: `old-${i}` }));
    const store = { hookEvents: existing };
    reduceHookProgress(
      { type: "hook_progress", run_id: "r", _seq: 1, hook_id: "new" } as never,
      null,
      store as never,
      false,
    );
    expect(store.hookEvents.length).toBe(500);
    expect((store.hookEvents[0] as { hook_id: string }).hook_id).toBe("old-1");
    expect((store.hookEvents[499] as { hook_id: string }).hook_id).toBe("new");
  });
});
