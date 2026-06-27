import { describe, expect, it } from "vitest";
import { buildChatUrl, isSplitModeUrl, SPLIT_QUERY_PARAM } from "./split-workspace-url";

describe("split-workspace-url", () => {
  it("detects split mode query flag", () => {
    const params = new URLSearchParams("split=1&run=abc");
    expect(isSplitModeUrl(params)).toBe(true);
    expect(new URLSearchParams("run=abc").get(SPLIT_QUERY_PARAM)).toBeNull();
  });

  it("builds chat URLs with split and run params", () => {
    const base = new URL("http://localhost/chat?run=old");
    const split = buildChatUrl(base, { split: true, runId: "run-2" });
    expect(split.searchParams.get("split")).toBe("1");
    expect(split.searchParams.get("run")).toBe("run-2");

    const normal = buildChatUrl(split, { split: false, runId: "run-2" });
    expect(normal.searchParams.get("split")).toBeNull();
  });
});
