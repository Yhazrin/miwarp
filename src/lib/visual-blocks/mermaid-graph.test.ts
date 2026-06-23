/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  buildEdgeAdjacency,
  nodeIdFromElementId,
  parseEdgeDataId,
  parseNodeCommentMap,
} from "./mermaid-graph";

describe("parseNodeCommentMap", () => {
  it("attaches a comment to the next node definition", () => {
    const src = ["flowchart LR", "// user types a message", "A[User Input] --> B[Transport]"].join(
      "\n",
    );
    const map = parseNodeCommentMap(src);
    expect(map.get("A")).toBe("user types a message");
    expect(map.has("B")).toBe(false);
  });

  it("allows blank lines and mermaid directives between the comment and node", () => {
    const src = ["%%{init: {}}%%", "// the bridge", "", "  X[Bridge]  "].join("\n");
    const map = parseNodeCommentMap(src);
    expect(map.get("X")).toBe("the bridge");
  });

  it("does not consume a comment if the next non-comment line is a directive", () => {
    const src = ["// notes about the diagram", "subgraph S1", "  A[Node A]", "end"].join("\n");
    const map = parseNodeCommentMap(src);
    expect(map.has("A")).toBe(false);
  });

  it("first comment wins for the same node id", () => {
    const src = [
      "// first description",
      "A[Node A]",
      "// second description — should be ignored",
      "A[Node A again]",
    ].join("\n");
    const map = parseNodeCommentMap(src);
    expect(map.get("A")).toBe("first description");
  });

  it("resets the pending comment when an unrelated line appears first", () => {
    const src = ["// orphan comment", "classDef accent fill:#33A6FF", "A[Node A]"].join("\n");
    const map = parseNodeCommentMap(src);
    expect(map.has("A")).toBe(false);
  });
});

describe("nodeIdFromElementId", () => {
  it("extracts the node id from a flowchart element id", () => {
    expect(nodeIdFromElementId("probe-flowchart-flowchart-A-0")).toBe("A");
    expect(nodeIdFromElementId("abc-flowchart-foo-3")).toBe("foo");
  });

  it("returns null for ids that don't match the flowchart pattern", () => {
    expect(nodeIdFromElementId("flowchart-v2-pointEnd")).toBeNull();
    expect(nodeIdFromElementId("probe-flowchart-L_A_B_0")).toBeNull();
    expect(nodeIdFromElementId("")).toBeNull();
  });
});

describe("parseEdgeDataId", () => {
  it("parses L_SOURCE_TARGET_INDEX into structured fields", () => {
    expect(parseEdgeDataId("L_A_B_0")).toEqual({ source: "A", target: "B", index: 0 });
    expect(parseEdgeDataId("L_user_input_session_2")).toEqual({
      source: "user_input",
      target: "session",
      index: 2,
    });
  });

  it("returns null for non-edge data-ids", () => {
    expect(parseEdgeDataId("")).toBeNull();
    expect(parseEdgeDataId("not_an_edge")).toBeNull();
    expect(parseEdgeDataId("L_A_B")).toBeNull();
  });
});

describe("buildEdgeAdjacency", () => {
  it("groups edge paths by their source and target ids", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeLink = (dataId: string) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("data-id", dataId);
      p.classList.add("flowchart-link");
      svg.appendChild(p);
      return p;
    };
    const eAB = makeLink("L_A_B_0");
    const eBC = makeLink("L_B_C_0");
    const eAC = makeLink("L_A_C_1");

    const adj = buildEdgeAdjacency(svg);
    expect(adj.get("A")).toEqual([eAB, eAC]);
    expect(adj.get("B")).toEqual([eAB, eBC]);
    expect(adj.get("C")).toEqual([eBC, eAC]);
  });

  it("ignores paths without a data-id", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.classList.add("flowchart-link");
    svg.appendChild(p);
    expect(buildEdgeAdjacency(svg).size).toBe(0);
  });
});
