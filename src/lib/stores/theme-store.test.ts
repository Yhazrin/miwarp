import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("$lib/i18n/index.svelte", () => ({
  t: (key: string) => key,
}));

type ThemeStoreInternals = {
  initialized: boolean;
  currentTheme: string;
  mode: string;
  colorScheme: string;
};

function mockDom() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const inlineStyles = new Map<string, string>();

  const root = {
    classList: {
      add: (...names: string[]) => names.forEach((n) => classes.add(n)),
      remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    style: {
      colorScheme: "",
      setProperty: (name: string, value: string) => inlineStyles.set(name, value),
      removeProperty: (name: string) => inlineStyles.delete(name),
    },
  };

  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });

  return { classes, attrs, inlineStyles, root };
}

describe("themeStore", () => {
  const localStorageStore = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    localStorageStore.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => localStorageStore.get(k) ?? null,
      setItem: (k: string, v: string) => localStorageStore.set(k, v),
      removeItem: (k: string) => localStorageStore.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadStore() {
    const mod = await import("./theme-store.svelte");
    return mod.themeStore as typeof mod.themeStore & ThemeStoreInternals;
  }

  it("init loads saved theme and applies data-theme to documentElement", async () => {
    localStorageStore.set(
      "miwarp-theme",
      JSON.stringify({ currentTheme: "morandi", mode: "light", colorScheme: "neutral" }),
    );
    const { attrs, classes } = mockDom();
    const themeStore = await loadStore();

    await themeStore.init();

    expect(themeStore.currentTheme).toBe("morandi");
    expect(themeStore.mode).toBe("light");
    expect(themeStore.colorScheme).toBe("neutral");
    expect(attrs.get("data-theme")).toBe("morandi-light");
    expect(classes.has("light")).toBe(true);
    expect(classes.has("scheme-neutral")).toBe(true);
  });

  it("second init() call still applies DOM (layout + window-controller)", async () => {
    localStorageStore.set(
      "miwarp-theme",
      JSON.stringify({ currentTheme: "dracula", mode: "dark", colorScheme: "warm" }),
    );
    const { attrs, classes, root } = mockDom();
    const themeStore = await loadStore();

    await themeStore.init();
    root.setAttribute("data-theme", "codex-light");
    classes.clear();
    classes.add("light");

    await themeStore.init();

    expect(attrs.get("data-theme")).toBe("dracula");
    expect(classes.has("dark")).toBe(true);
    expect(classes.has("scheme-warm")).toBe(true);
  });

  it("applyToDom mirrors current store state without persisting", async () => {
    localStorageStore.set(
      "miwarp-theme",
      JSON.stringify({ currentTheme: "nord", mode: "dark", colorScheme: "warm" }),
    );
    const { attrs } = mockDom();
    const themeStore = await loadStore();
    await themeStore.init();

    themeStore.setTheme("ocean");
    localStorageStore.clear();

    themeStore.applyToDom();

    expect(attrs.get("data-theme")).toBe("ocean");
    expect(localStorageStore.has("miwarp-theme")).toBe(false);
  });

  it("neutral colorScheme does not strip theme accent (no gray primary override)", async () => {
    localStorageStore.set(
      "miwarp-theme",
      JSON.stringify({ currentTheme: "morandi", mode: "dark", colorScheme: "neutral" }),
    );
    const { classes, attrs } = mockDom();
    const themeStore = await loadStore();

    await themeStore.init();

    expect(attrs.get("data-theme")).toBe("morandi");
    expect(classes.has("scheme-neutral")).toBe(true);
    // Accent comes from design-tokens [data-theme="morandi"], not scheme-neutral.
    expect(classes.has("scheme-warm")).toBe(false);
  });

  it("does not override explicit mode with migrated -light suffix default", async () => {
    localStorageStore.set(
      "miwarp-theme",
      JSON.stringify({ currentTheme: "morandi", mode: "light" }),
    );
    mockDom();
    const themeStore = await loadStore();

    await themeStore.init();

    expect(themeStore.mode).toBe("light");
  });
});
