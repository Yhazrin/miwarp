/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { treeExpand } from "./tree-expand-transition";

describe("treeExpand transition", () => {
  it("reports non-zero height when content exists at end of intro", () => {
    const el = document.createElement("div");
    el.style.height = "0";
    el.style.overflow = "hidden";
    const inner = document.createElement("div");
    inner.textContent = "Logical folder row";
    inner.style.height = "32px";
    el.appendChild(inner);
    document.body.appendChild(el);

    const config = treeExpand(el);
    expect(config.css).toBeDefined();
    const atEnd = config.css!(1, 1);
    expect(atEnd).toContain("height: auto");
    expect(atEnd).toContain("overflow: visible");

    el.remove();
  });
});
