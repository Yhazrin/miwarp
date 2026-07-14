import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSmoothCssPxVar } from "./smooth-css-px-var";

function mockEl() {
  const props = new Map<string, string>();
  return {
    style: {
      setProperty: (k: string, v: string) => props.set(k, v),
      getPropertyValue: (k: string) => props.get(k) ?? "",
    },
  } as unknown as HTMLElement;
}

describe("createSmoothCssPxVar", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the css var once per distinct rounded value", () => {
    const el = mockEl();
    const writer = createSmoothCssPxVar({
      getEl: () => el,
      varName: "--chat-input-dock-offset",
    });

    writer.setTarget(100.4);
    expect(el.style.getPropertyValue("--chat-input-dock-offset")).toBe("100px");

    writer.setImmediate(140);
    expect(el.style.getPropertyValue("--chat-input-dock-offset")).toBe("140px");
    writer.destroy();
  });

  it("setImmediate bypasses coalescing", () => {
    const el = mockEl();
    const onCommit = vi.fn();
    const writer = createSmoothCssPxVar({
      getEl: () => el,
      varName: "--chat-input-dock-offset",
      onCommit,
    });

    writer.setImmediate(88);
    expect(el.style.getPropertyValue("--chat-input-dock-offset")).toBe("88px");
    expect(onCommit).toHaveBeenCalledWith(88, el);
    writer.destroy();
  });
});
