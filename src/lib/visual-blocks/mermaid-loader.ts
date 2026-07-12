import { sanitizeMermaidForRender, sanitizeMermaidSvg } from "./security";

// mermaid is an optional dependency loaded at runtime via dynamic import().
// The specifier goes through a helper that takes a plain string so Vite's
// static import-analysis cannot resolve it at build time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function optImport(id: string): Promise<any> {
  return import(id);
}

let mermaidModule: typeof import("mermaid") | null = null;

async function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = await optImport("mermaid");
  }
  return mermaidModule.default;
}

/**
 * HSL "h s% l%" triple → "#rrggbb" hex string.
 *
 * MiWarp stores theme colors as the modern "h s% l%" space-separated form
 * (see design-tokens.css). Mermaid's `themeVariables` only accepts hex/rgb,
 * so we convert at render time. Returns the input unchanged if it doesn't
 * match the expected shape — that way an explicit `rgb(...)` or `#rrggbb`
 * coming from a future token format still passes through cleanly.
 */
export function hslTripleToHex(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  if (!m) return trimmed;
  const h = ((parseFloat(m[1]) % 360) + 360) % 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    // Clamp to [0,1] before scaling — tokens are sanitized to S/L ∈ [0,1],
    // but custom themes may push outside, and a negative c would underflow
    // Math.round to a 3-char hex like "100" that padStart(2) can't trim.
    const clamped = Math.max(0, Math.min(1, c));
    return Math.round(255 * clamped)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function readHslVar(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return hslTripleToHex(raw);
}

interface ThemePalette {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  text: string;
  mutedText: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  violet: string;
  teal: string;
  pink: string;
}

const FALLBACK_DARK: ThemePalette = {
  bg: "#0b1220",
  surface: "#1e293b",
  elevated: "#0f172a",
  border: "#334155",
  text: "#f9fafb",
  mutedText: "#94a3b8",
  accent: "#33a6ff",
  success: "#5fd1a3",
  warning: "#f0b056",
  danger: "#f87171",
  info: "#5fb3f0",
  violet: "#20b2d9",
  teal: "#36c2a3",
  pink: "#f472b6",
};

const FALLBACK_LIGHT: ThemePalette = {
  bg: "#ffffff",
  surface: "#f1f5f9",
  elevated: "#fafafa",
  border: "#cbd5e1",
  text: "#0f172a",
  mutedText: "#475569",
  accent: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#0284c7",
  violet: "#0e7490",
  teal: "#0d9488",
  pink: "#db2777",
};

function readPalette(isDark: boolean): ThemePalette {
  const fallback = isDark ? FALLBACK_DARK : FALLBACK_LIGHT;
  return {
    bg: readHslVar("--background", fallback.bg),
    surface: readHslVar("--miwarp-bg-surface", fallback.surface),
    elevated: readHslVar("--miwarp-bg-elevated", fallback.elevated),
    border: readHslVar("--border", fallback.border),
    text: readHslVar("--foreground", fallback.text),
    mutedText: readHslVar("--muted-foreground", fallback.mutedText),
    accent: readHslVar("--primary", fallback.accent),
    success: readHslVar("--miwarp-status-success", fallback.success),
    warning: readHslVar("--miwarp-status-warning", fallback.warning),
    danger: readHslVar("--miwarp-status-error", fallback.danger),
    info: readHslVar("--miwarp-status-info", fallback.info),
    violet: readHslVar("--miwarp-accent-violet", fallback.violet),
    teal: readHslVar("--miwarp-accent-teal", fallback.teal),
    pink: readHslVar("--miwarp-accent-pink", fallback.pink),
  };
}

/**
 * Build a comprehensive `themeVariables` object from the active MiWarp theme.
 *
 * Mermaid supports a long list of variables across its diagram families. We
 * cover the most common ones (flowchart, sequence, class, state, pie, git)
 * so a diagram rendered with the brand palette looks native, not "foreign".
 */
function buildThemeVariables(isDark: boolean): Record<string, string> {
  const p = readPalette(isDark);
  return {
    background: "transparent",

    fontFamily: "inherit",
    fontSize: "13px",

    primaryColor: p.surface,
    primaryBorderColor: p.border,
    primaryTextColor: p.text,

    secondaryColor: p.elevated,
    secondaryBorderColor: p.border,
    secondaryTextColor: p.text,

    tertiaryColor: p.bg,
    tertiaryBorderColor: p.border,
    tertiaryTextColor: p.text,

    lineColor: p.mutedText,
    textColor: p.text,

    mainBkg: p.surface,
    secondBkg: p.elevated,
    border1: p.border,
    border2: p.border,

    nodeBorder: p.border,
    clusterBkg: p.elevated,
    clusterBorder: p.border,
    defaultLinkColor: p.mutedText,

    titleColor: p.text,
    edgeLabelBackground: p.bg,

    nodeBkg: p.surface,
    noteBkgColor: p.elevated,
    noteTextColor: p.text,
    noteBorderColor: p.border,

    personBorder: p.border,
    personBkg: p.surface,

    labelBoxBkgColor: p.bg,
    labelBoxBorderColor: p.border,
    labelTextColor: p.text,

    errorBkgColor: p.danger,
    errorTextColor: p.bg,

    // Pie chart slots — use the same brand palette as the rest of the app
    // so a diagram and a pie chart read as one design system.
    pie1: p.accent,
    pie2: p.success,
    pie3: p.violet,
    pie4: p.warning,
    pie5: p.info,
    pie6: p.pink,
    pie7: p.teal,
    pie8: p.danger,
    pie9: p.accent,
    pie10: p.violet,
    pie11: p.success,
    pie12: p.warning,
    pieTitleTextColor: p.text,
    pieTitleTextSize: "13px",
    pieSectionTextColor: p.text,
    pieSectionTextSize: "12px",
    pieStrokeColor: p.border,
    pieStrokeWidth: "1px",
    pieOuterStrokeWidth: "1px",
    pieOuterStrokeColor: p.border,
    pieOpacity: "1",

    // Git graph slots
    git0: p.accent,
    git1: p.success,
    git2: p.violet,
    git3: p.warning,
    git4: p.info,
    git5: p.pink,
    git6: p.teal,
    git7: p.danger,
    gitBranchLabel0: p.text,
    gitBranchLabel1: p.text,
    gitBranchLabel2: p.text,
    gitBranchLabel3: p.text,
    gitBranchLabel4: p.text,
    gitBranchLabel5: p.text,
    gitBranchLabel6: p.text,
    gitBranchLabel7: p.text,
  };
}

export async function renderMermaidSvg(
  source: string,
  elementId: string,
  isDark: boolean,
): Promise<string> {
  const mermaid = await getMermaid();

  // Re-initialize on every render: themeVariables pick up the current
  // <html data-theme> CSS variables, so a user switching themes or
  // brightness modes mid-session still gets the right palette. The
  // overhead is one config-object copy per diagram — negligible.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "inherit",
    htmlLabels: false,
    themeVariables: buildThemeVariables(isDark),
  });

  const sanitized = sanitizeMermaidForRender(source);
  const { svg } = await mermaid.render(elementId, sanitized);
  return sanitizeMermaidSvg(svg);
}

/** Reset cached module state — test hook only. */
export function resetMermaidLoaderForTests(): void {
  mermaidModule = null;
}
