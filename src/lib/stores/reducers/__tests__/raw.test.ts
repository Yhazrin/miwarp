import { describe, it, expect, vi } from "vitest";
import { reduceRaw } from "../raw";

vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn(), dbgWarn: vi.fn() }));
vi.mock("$lib/utils/uuid", () => ({
  uuid: (() => {
    let n = 0;
    return () => `raw-${++n}`;
  })(),
}));

describe("reduceRaw", () => {
  it("pushes an assistant entry for claude_stdout_text", () => {
    const pushed: unknown[] = [];
    const store = {
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
      rawFallbackCount: 0,
      strictMode: false,
    };
    reduceRaw(
      { type: "raw", run_id: "r", _seq: 1, source: "claude_stdout_text", data: "hello" } as never,
      null,
      store as never,
      false,
    );
    expect(pushed.length).toBe(1);
    const e = pushed[0] as { kind: string; content: string };
    expect(e.kind).toBe("assistant");
    expect(e.content).toBe("`[claude_stdout_text]` hello");
  });

  it("pushes an assistant entry for claude_stderr", () => {
    const pushed: unknown[] = [];
    const store = {
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
      rawFallbackCount: 0,
      strictMode: false,
    };
    reduceRaw(
      { type: "raw", run_id: "r", _seq: 1, source: "claude_stderr", data: "warn" } as never,
      null,
      store as never,
      false,
    );
    expect(pushed.length).toBe(1);
  });

  it("increments rawFallbackCount for non-pipe sources", () => {
    const store = {
      _pushTimeline: vi.fn(),
      rawFallbackCount: 0,
      strictMode: false,
    };
    reduceRaw(
      { type: "raw", run_id: "r", _seq: 1, source: "unknown", data: "x" } as never,
      null,
      store as never,
      false,
    );
    expect(store._pushTimeline).not.toHaveBeenCalled();
    expect(store.rawFallbackCount).toBe(1);
  });

  it("throws in strictMode on fallback", () => {
    const store = {
      _pushTimeline: vi.fn(),
      rawFallbackCount: 0,
      strictMode: true,
    };
    expect(() =>
      reduceRaw(
        { type: "raw", run_id: "r", _seq: 1, source: "unknown", data: "x" } as never,
        null,
        store as never,
        false,
      ),
    ).toThrow("[STRICT] raw fallback event");
  });

  it("stringifies non-string data", () => {
    const pushed: unknown[] = [];
    const store = {
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
      rawFallbackCount: 0,
      strictMode: false,
    };
    reduceRaw(
      {
        type: "raw",
        run_id: "r",
        _seq: 1,
        source: "claude_stdout_text",
        data: { foo: 1 },
      } as never,
      null,
      store as never,
      false,
    );
    const e = pushed[0] as { content: string };
    expect(e.content).toContain('"foo":1');
  });
});
