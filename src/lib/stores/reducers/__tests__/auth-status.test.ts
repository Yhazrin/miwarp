import { describe, it, expect } from "vitest";
import { reduceAuthStatus } from "../auth-status";

describe("reduceAuthStatus", () => {
  it("writes is_authenticating + output to store.authStatus", () => {
    const store = { authStatus: null as { is_authenticating: boolean; output: string[] } | null };
    reduceAuthStatus(
      {
        type: "auth_status",
        run_id: "r",
        _seq: 1,
        is_authenticating: true,
        output: ["Logging in...", "Token saved"],
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.authStatus).toEqual({
      is_authenticating: true,
      output: ["Logging in...", "Token saved"],
    });
  });

  it("defaults output to empty array", () => {
    const store = { authStatus: null as { is_authenticating: boolean; output: string[] } | null };
    reduceAuthStatus(
      { type: "auth_status", run_id: "r", _seq: 1, is_authenticating: false } as never,
      null,
      store as never,
      false,
    );
    expect(store.authStatus).toEqual({ is_authenticating: false, output: [] });
  });
});
