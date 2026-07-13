// vega-embed and vega are optional peer dependencies loaded at runtime via
// dynamic import().  The specifier goes through a helper that takes a plain
// string so Vite's static import-analysis cannot resolve it at build time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function optImport(id: string): Promise<any> {
  return import(id);
}

type VegaEmbedResult = Awaited<typeof import("vega-embed")>["default"] extends (
  ...a: never[]
) => Promise<infer R>
  ? R
  : unknown;

let vegaEmbedModule: typeof import("vega-embed") | null = null;
let vegaLoaderModule: typeof import("vega") | null = null;

async function getVegaEmbed() {
  if (!vegaEmbedModule) {
    vegaEmbedModule = await optImport("vega-embed");
  }
  return vegaEmbedModule!.default;
}

async function createBlockedLoader() {
  if (!vegaLoaderModule) {
    vegaLoaderModule = await optImport("vega");
  }
  const createVegaLoader = vegaLoaderModule!.loader;
  const base = createVegaLoader({ baseURL: "" });
  const rejectExternal = (uri: string) => {
    if (/^https?:\/\//i.test(uri) || /^\/\//.test(uri) || /^file:/i.test(uri)) {
      return Promise.reject(new Error("external_load_disabled"));
    }
    return undefined;
  };
  return {
    load(uri: string, options?: Parameters<typeof base.load>[1]) {
      const blocked = rejectExternal(uri);
      if (blocked) return blocked;
      return base.load(uri, options);
    },
    sanitize(uri: string, options: Parameters<typeof base.sanitize>[1]) {
      const blocked = rejectExternal(uri);
      if (blocked) return blocked;
      return base.sanitize(uri, options);
    },
    http(_uri: string, _options: Parameters<typeof base.http>[1]) {
      return Promise.reject(new Error("external_load_disabled"));
    },
    file(_filename: string) {
      return Promise.reject(new Error("external_load_disabled"));
    },
  } satisfies ReturnType<typeof createVegaLoader>;
}

export type VegaRenderHandle = {
  dispose: () => void;
};

export async function renderVegaLite(
  container: HTMLElement,
  spec: Record<string, unknown>,
  isDark: boolean,
): Promise<VegaRenderHandle> {
  const [vegaEmbed, loader] = await Promise.all([getVegaEmbed(), createBlockedLoader()]);
  container.replaceChildren();
  const result: VegaEmbedResult = await vegaEmbed(container, spec, {
    actions: false,
    renderer: "svg",
    theme: isDark ? "dark" : undefined,
    tooltip: false,
    hover: false,
    downloadFileName: "chart",
    logLevel: 0,
    loader,
  });

  return {
    dispose() {
      result.view?.finalize();
      container.replaceChildren();
    },
  };
}

/** Reset cached module state — test hook only. */
export function resetVegaLoaderForTests(): void {
  vegaEmbedModule = null;
  vegaLoaderModule = null;
}
