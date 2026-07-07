import { describe, expect, it, vi } from "vitest";
import { ConnectionState } from "./connection-state";
import { TauriTransport } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("1.2.3")) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "main" })),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ setZoom: vi.fn() })),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  Webview: class {
    static getByLabel = vi.fn();
  },
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/tmp/selected")),
  save: vi.fn(() => Promise.resolve("/tmp/saved.md")),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(() => Promise.resolve()),
}));
vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn(), dbgWarn: vi.fn() }));

describe("TauriTransport connection health", () => {
  it("reports an always-open local IPC channel", () => {
    const transport = new TauriTransport();
    expect(transport.getConnectionState()).toBe(ConnectionState.Open);
  });

  it("returns a no-op connection listener cleanup", () => {
    const transport = new TauriTransport();
    const listener = vi.fn();
    const unsubscribe = transport.onConnectionStateChange(listener);

    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("TauriTransport desktop API surface", () => {
  it("reads the app version via lazy @tauri-apps/api/app import", async () => {
    const transport = new TauriTransport();
    await expect(transport.getAppVersion()).resolves.toBe("1.2.3");
  });

  it("resolves the current desktop window", async () => {
    const transport = new TauriTransport();
    const win = await transport.getCurrentWindow();
    expect(win).toMatchObject({ label: "main" });
  });

  it("resolves the current desktop webview window with setZoom", async () => {
    const transport = new TauriTransport();
    const wv = await transport.getCurrentWebviewWindow();
    expect(typeof wv.setZoom).toBe("function");
  });

  it("loads the @tauri-apps/api/webview module on demand", async () => {
    const transport = new TauriTransport();
    const mod = await transport.loadWebviewModule();
    expect(typeof mod.Webview).toBe("function");
  });

  it("loads the @tauri-apps/api/dpi module on demand", async () => {
    const transport = new TauriTransport();
    const mod = await transport.loadDpiModule();
    const size = new mod.LogicalSize(10, 20);
    expect(size).toMatchObject({ width: 10, height: 20 });
  });

  it("opens a native dialog through the dialog plugin", async () => {
    const transport = new TauriTransport();
    const result = await transport.openDialog({ directory: true });
    expect(result).toBe("/tmp/selected");
  });

  it("opens a native save dialog through the dialog plugin", async () => {
    const transport = new TauriTransport();
    const result = await transport.saveDialog({ defaultPath: "foo.md" });
    expect(result).toBe("/tmp/saved.md");
  });

  it("opens a shell path via the shell plugin", async () => {
    const transport = new TauriTransport();
    await expect(transport.shellOpen("/tmp/somewhere")).resolves.toBeUndefined();
  });
});
