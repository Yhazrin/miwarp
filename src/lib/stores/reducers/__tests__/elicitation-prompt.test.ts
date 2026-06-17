import { describe, it, expect, vi } from "vitest";
import { reduceElicitationPrompt } from "../elicitation-prompt";

vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn() }));

describe("reduceElicitationPrompt", () => {
  it("stores elicitation by request_id", () => {
    const store = { pendingElicitations: new Map() as Map<string, unknown> };
    reduceElicitationPrompt(
      {
        type: "elicitation_prompt",
        run_id: "r",
        _seq: 1,
        request_id: "req1",
        mcp_server_name: "github",
        message: "Confirm",
        elicitation_id: "elic1",
        mode: "form",
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.pendingElicitations.get("req1") as { mcpServerName: string; mode: string };
    expect(e.mcpServerName).toBe("github");
    expect(e.mode).toBe("form");
  });

  it("is idempotent on duplicate request_id", () => {
    const store = { pendingElicitations: new Map() as Map<string, unknown> };
    reduceElicitationPrompt(
      {
        type: "elicitation_prompt",
        run_id: "r",
        _seq: 1,
        request_id: "req1",
        mcp_server_name: "github",
        message: "v1",
        elicitation_id: "elic1",
      } as never,
      null,
      store as never,
      false,
    );
    reduceElicitationPrompt(
      {
        type: "elicitation_prompt",
        run_id: "r",
        _seq: 1,
        request_id: "req1",
        mcp_server_name: "github",
        message: "v2",
        elicitation_id: "elic2",
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.pendingElicitations.get("req1") as { message: string };
    expect(e.message).toBe("v2");
  });
});
