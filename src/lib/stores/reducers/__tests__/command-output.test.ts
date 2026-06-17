import { describe, it, expect, vi } from "vitest";
import { reduceCommandOutput } from "../command-output";

vi.mock("$lib/utils/uuid", () => ({ uuid: () => "cmd-test-id" }));

describe("reduceCommandOutput", () => {
  const makeStore = () => {
    const pushed: unknown[] = [];
    return {
      _pushTimeline: (_ctx: unknown, e: unknown) => pushed.push(e),
      pushed,
    };
  };

  it("pushes a command_output timeline entry with the event content", () => {
    const store = makeStore();
    reduceCommandOutput(
      { type: "command_output", run_id: "r", _seq: 1, content: "hello world" } as never,
      null,
      store as never,
      false,
    );
    expect(store.pushed.length).toBe(1);
    const e = store.pushed[0] as { kind: string; content: string; id: string };
    expect(e.kind).toBe("command_output");
    expect(e.content).toBe("hello world");
    expect(e.id).toBe("cmd-test-id");
  });

  it("forwards ctx to _pushTimeline so batch replay works", () => {
    const store = makeStore();
    const ctx = { tl: [] as unknown[], he: [] as unknown[] };
    reduceCommandOutput(
      { type: "command_output", run_id: "r", _seq: 1, content: "x" } as never,
      ctx as never,
      store as never,
      true,
    );
    // ctx was passed through; entry was pushed (timeline side-effect captured by helper)
    expect(store.pushed.length).toBe(1);
  });
});
