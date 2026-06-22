/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

const mountMock = vi.fn((_component: unknown, _options?: { props?: { tone?: string } }) => ({
  destroy: vi.fn(),
}));
const unmountMock = vi.fn();

vi.mock("svelte", () => ({
  mount: (component: unknown, options?: { props?: { tone?: string } }) =>
    mountMock(component, options),
  unmount: (instance: unknown) => unmountMock(instance),
}));

vi.mock("./components/VisualBlockHost.svelte", () => ({
  default: class VisualBlockHostMock {},
}));

import { buildVisualBlockPlaceholder } from "./render-placeholder";
import { mountVisualBlocks } from "./mount-visual-blocks";

describe("mountVisualBlocks", () => {
  it("mounts once per host and skips already-mounted hosts", () => {
    mountMock.mockClear();
    unmountMock.mockClear();

    const root = document.createElement("div");
    root.innerHTML = buildVisualBlockPlaceholder({
      kind: "miwarp-kpi",
      lang: "miwarp-kpi",
      source: JSON.stringify({ items: [{ label: "Users", value: "42" }] }),
    });

    const unmount = mountVisualBlocks(root, { tone: "default" });
    const host = root.querySelector<HTMLElement>("[data-visual-block]");
    expect(host?.dataset.visualMounted).toBe("true");
    expect(mountMock).toHaveBeenCalledTimes(1);

    mountVisualBlocks(root, { tone: "default" });
    expect(mountMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(unmountMock).toHaveBeenCalledTimes(1);
    expect(host?.dataset.visualMounted).toBeUndefined();
  });

  it("allows remount after cleanup", () => {
    mountMock.mockClear();

    const root = document.createElement("div");
    root.innerHTML = buildVisualBlockPlaceholder({
      kind: "miwarp-timeline",
      lang: "miwarp-timeline",
      source: JSON.stringify({ items: [{ title: "Launch" }] }),
    });

    const unmount = mountVisualBlocks(root, { tone: "default" });
    expect(mountMock).toHaveBeenCalledTimes(1);
    unmount();

    mountVisualBlocks(root, { tone: "on-primary" });
    expect(mountMock).toHaveBeenCalledTimes(2);
    expect(mountMock.mock.calls[1]?.[1]?.props?.tone).toBe("on-primary");
  });
});
