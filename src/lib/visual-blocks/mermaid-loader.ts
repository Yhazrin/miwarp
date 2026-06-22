import { sanitizeMermaidForRender, sanitizeMermaidSvg } from "./security";

let mermaidModule: typeof import("mermaid") | null = null;
let initTheme: "dark" | "default" | null = null;

async function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = await import("mermaid");
  }
  return mermaidModule.default;
}

export async function renderMermaidSvg(
  source: string,
  elementId: string,
  isDark: boolean,
): Promise<string> {
  const mermaid = await getMermaid();
  const theme = isDark ? "dark" : "default";
  if (initTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
      fontFamily: "inherit",
      htmlLabels: false,
    });
    initTheme = theme;
  }

  const sanitized = sanitizeMermaidForRender(source);
  const { svg } = await mermaid.render(elementId, sanitized);
  return sanitizeMermaidSvg(svg);
}

/** Reset cached module state — test hook only. */
export function resetMermaidLoaderForTests(): void {
  mermaidModule = null;
  initTheme = null;
}
