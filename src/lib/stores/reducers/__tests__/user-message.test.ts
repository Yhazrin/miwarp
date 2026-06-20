import { describe, expect, it, vi } from "vitest";
import type { HookEvent, TimelineEntry } from "$lib/types";
import { reduceUserMessage } from "../user-message";

vi.mock("$lib/utils/uuid", () => ({ uuid: () => "generated-user-id" }));

function makeStore(options: { isStream?: boolean } = {}) {
  return {
    timeline: [] as TimelineEntry[],
    tools: [] as HookEvent[],
    _pushTimeline(ctx: { tl: TimelineEntry[] } | null, entry: TimelineEntry) {
      if (ctx) ctx.tl.push(entry);
      else this.timeline = [...this.timeline, entry];
    },
    _findHeIdxByStatus(ctx: { he: HookEvent[] } | null, toolUseId: string, status: string) {
      const entries = ctx ? ctx.he : this.tools;
      return entries.findIndex(
        (entry) =>
          (entry as HookEvent & { tool_use_id?: string }).tool_use_id === toolUseId &&
          entry.status === status,
      );
    },
    _isStreamMode: vi.fn(() => options.isStream ?? false),
  };
}

function userEvent(text: string, uuid?: string) {
  return {
    type: "user_message",
    run_id: "run-1",
    _seq: 10,
    text,
    uuid,
  } as never;
}

describe("reduceUserMessage", () => {
  it("merges a live CLI confirmation into the optimistic user entry", () => {
    const store = makeStore();
    store.timeline = [
      {
        kind: "user",
        id: "optimistic-id",
        anchorId: "optimistic-id",
        content: "hello",
        ts: "2026-06-21T00:00:00.000Z",
      },
    ];

    reduceUserMessage(userEvent("hello", "cli-id"), null, store as never, false);

    expect(store.timeline).toHaveLength(1);
    expect(store.timeline[0]).toMatchObject({
      id: "optimistic-id",
      anchorId: "cli-id",
      cliUuid: "cli-id",
      content: "hello",
    });
  });

  it("does not collapse matching messages during replay", () => {
    const store = makeStore();
    store.timeline = [
      {
        kind: "user",
        id: "existing-id",
        anchorId: "existing-id",
        content: "hello",
        ts: "2026-06-21T00:00:00.000Z",
      },
    ];

    reduceUserMessage(userEvent("hello", "replayed-cli-id"), null, store as never, true);

    expect(store.timeline).toHaveLength(2);
    expect(store.timeline[1]).toMatchObject({
      id: "generated-user-id",
      anchorId: "replayed-cli-id",
      cliUuid: "replayed-cli-id",
      content: "hello",
    });
  });

  it("appends a new user entry when there is no optimistic match", () => {
    const store = makeStore();

    reduceUserMessage(userEvent("new message", "cli-id"), null, store as never, false);

    expect(store.timeline).toEqual([
      expect.objectContaining({
        kind: "user",
        id: "generated-user-id",
        anchorId: "cli-id",
        cliUuid: "cli-id",
        content: "new message",
      }),
    ]);
  });

  it("resolves a pending AskUserQuestion tool and its non-stream hook", () => {
    const store = makeStore();
    store.timeline = [
      {
        kind: "tool",
        id: "ask-1",
        anchorId: "ask-1",
        ts: "2026-06-21T00:00:00.000Z",
        tool: {
          tool_use_id: "ask-1",
          tool_name: "AskUserQuestion",
          input: {},
          status: "ask_pending",
        },
      },
    ];
    store.tools = [
      {
        run_id: "run-1",
        hook_type: "PreToolUse",
        tool_name: "AskUserQuestion",
        status: "running",
        timestamp: "2026-06-21T00:00:00.000Z",
        tool_use_id: "ask-1",
      } as HookEvent & { tool_use_id: string },
    ];

    reduceUserMessage(userEvent("approved"), null, store as never, false);

    expect(store.timeline[0]).toMatchObject({
      kind: "tool",
      tool: { status: "success", output: { answer: "approved" } },
    });
    expect(store.timeline[1]).toMatchObject({ kind: "user", content: "approved" });
    expect(store.tools[0]).toMatchObject({ status: "done", hook_type: "PostToolUse" });
  });

  it("does not mirror hook completion in stream mode", () => {
    const store = makeStore({ isStream: true });
    store.timeline = [
      {
        kind: "tool",
        id: "ask-1",
        anchorId: "ask-1",
        ts: "2026-06-21T00:00:00.000Z",
        tool: {
          tool_use_id: "ask-1",
          tool_name: "AskUserQuestion",
          input: {},
          status: "ask_pending",
        },
      },
    ];
    store.tools = [
      {
        run_id: "run-1",
        hook_type: "PreToolUse",
        tool_name: "AskUserQuestion",
        status: "running",
        timestamp: "2026-06-21T00:00:00.000Z",
        tool_use_id: "ask-1",
      } as HookEvent & { tool_use_id: string },
    ];

    reduceUserMessage(userEvent("approved"), null, store as never, false);

    expect(store.timeline[0]).toMatchObject({ tool: { status: "success" } });
    expect(store.tools[0]).toMatchObject({ status: "running", hook_type: "PreToolUse" });
  });
});
