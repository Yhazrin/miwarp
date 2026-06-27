import { describe, expect, it } from "vitest";
import {
  buildChatUrl,
  buildSplitPanes,
  isSplitModeUrl,
  LAYOUT_QUERY_PARAM,
  PANES_QUERY_PARAM,
  parseSplitPanes,
  readLayoutFromUrl,
  readPaneSetFromUrl,
  SPLIT_QUERY_PARAM,
} from "./split-workspace-url";

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

  it("buildChatUrl preserves other query params (folder, host, etc.)", () => {
    const base = new URL("http://localhost/chat?folder=/work&run=old");
    const next = buildChatUrl(base, { split: true, runId: "run-2" });
    expect(next.searchParams.get("folder")).toBe("/work");
    expect(next.searchParams.get("run")).toBe("run-2");
    expect(next.searchParams.get("split")).toBe("1");
  });

  it("buildChatUrl with split:false removes the flag even when runId set", () => {
    const base = new URL("http://localhost/chat?split=1&run=run-x");
    const next = buildChatUrl(base, { split: false, runId: "run-x" });
    expect(next.searchParams.get("split")).toBeNull();
    expect(next.searchParams.get("run")).toBe("run-x");
  });

  it("buildChatUrl with split:true + panes writes the base64 pane payload + layout", () => {
    const base = new URL("http://localhost/chat?run=run-x");
    const next = buildChatUrl(base, {
      split: true,
      runId: "run-x",
      panes: [
        { id: "p1", r: "run-x" },
        { id: "p2", r: "run-y" },
      ],
      activePaneId: "p1",
      layout: "dual",
    });
    expect(next.searchParams.get(PANES_QUERY_PARAM)).not.toBeNull();
    expect(next.searchParams.get(LAYOUT_QUERY_PARAM)).toBe("dual");
    expect(next.searchParams.get("run")).toBe("run-x");
    expect(next.searchParams.get(SPLIT_QUERY_PARAM)).toBe("1");
  });

  it("buildChatUrl with split:false strips panes + layout", () => {
    const base = new URL("http://localhost/chat?split=1&panes=ABC&layout=dual&run=run-x");
    const next = buildChatUrl(base, { split: false, runId: "run-x" });
    expect(next.searchParams.get(PANES_QUERY_PARAM)).toBeNull();
    expect(next.searchParams.get(LAYOUT_QUERY_PARAM)).toBeNull();
    expect(next.searchParams.get(SPLIT_QUERY_PARAM)).toBeNull();
  });
});

describe("split-workspace-url — panes payload", () => {
  it("round-trips a pane set through buildSplitPanes / parseSplitPanes", () => {
    const items = [
      { id: "p1", r: "run-a" },
      { id: "p2", r: "run-b" },
    ];
    const encoded = buildSplitPanes(items, "p1");
    expect(typeof encoded).toBe("string");
    const decoded = parseSplitPanes(encoded);
    expect(decoded).toEqual({ v: 1, items, active: "p1" });
  });

  it("parseSplitPanes returns null for invalid input", () => {
    expect(parseSplitPanes(null)).toBeNull();
    expect(parseSplitPanes("not-base64!@#$")).toBeNull();
    expect(parseSplitPanes("")).toBeNull();
  });

  it("parseSplitPanes returns null when version is missing/wrong", () => {
    const bad = Buffer.from(JSON.stringify({ v: 99, items: [], active: null }), "utf-8").toString(
      "base64",
    );
    expect(parseSplitPanes(bad)).toBeNull();
  });

  it("parseSplitPanes tolerates malformed item entries", () => {
    const bad = Buffer.from(
      JSON.stringify({
        v: 1,
        items: [{ id: "p1", r: "run-a" }, { id: "p2" }, null, "str"],
        active: "p1",
      }),
      "utf-8",
    ).toString("base64");
    const decoded = parseSplitPanes(bad);
    expect(decoded).not.toBeNull();
    expect(decoded!.items).toEqual([{ id: "p1", r: "run-a" }]);
  });
});

describe("split-workspace-url — back-compat", () => {
  it("readPaneSetFromUrl: legacy ?split=1&run=X returns single-pane payload", () => {
    const params = new URLSearchParams("split=1&run=run-a");
    const set = readPaneSetFromUrl(params);
    expect(set).toEqual({ v: 1, items: [{ id: "legacy", r: "run-a" }], active: "legacy" });
  });

  it("readPaneSetFromUrl: encoded ?panes= takes precedence over ?run=", () => {
    const encoded = buildSplitPanes(
      [
        { id: "p1", r: "run-x" },
        { id: "p2", r: "run-y" },
      ],
      "p2",
    );
    const params = new URLSearchParams(`split=1&run=run-x&panes=${encoded}`);
    const set = readPaneSetFromUrl(params);
    expect(set?.items).toEqual([
      { id: "p1", r: "run-x" },
      { id: "p2", r: "run-y" },
    ]);
    expect(set?.active).toBe("p2");
  });

  it("readPaneSetFromUrl: returns null when neither panes nor run is present", () => {
    const params = new URLSearchParams("split=1");
    expect(readPaneSetFromUrl(params)).toBeNull();
  });

  it("readLayoutFromUrl defaults to 'single' for missing/invalid value", () => {
    expect(readLayoutFromUrl(new URLSearchParams(""))).toBe("single");
    expect(readLayoutFromUrl(new URLSearchParams("layout=dual"))).toBe("dual");
    expect(readLayoutFromUrl(new URLSearchParams("layout=triple"))).toBe("triple");
    expect(readLayoutFromUrl(new URLSearchParams("layout=quad"))).toBe("quad");
    expect(readLayoutFromUrl(new URLSearchParams("layout=garbage"))).toBe("single");
  });
});
