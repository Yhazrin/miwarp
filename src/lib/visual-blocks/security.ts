import DOMPurify from "dompurify";
import { VISUAL_LIMITS } from "./limits";

const SCRIPT_TAG = /<script\b/i;
const JS_URL = /javascript:/i;
const DATA_HTML = /data:text\/html/i;
const VBSCRIPT_URL = /vbscript:/i;
const ON_EVENT_ATTR = /\bon[a-z]+\s*=/i;
const EXTERNAL_URL = /(?:https?:\/\/|\/\/)[^\s"'`)]+/i;
const MERMAID_CLICK = /^\s*click\s+/im;
const MERMAID_CALL = /\bcall\s+\w+/i;
const MERMAID_UNSAFE_INIT = /securityLevel\s*:\s*['"]?(?:antiscript|loose)['"]?/i;
const MERMAID_HTML_TAG = /<\s*\/?\s*(?:script|iframe|object|embed|link|style)\b/i;
const MERMAID_STYLE_URL = /style\s*=\s*['"][^'"]*url\s*\(/i;

export type SourceSecurityResult = { ok: true } | { ok: false; reason: string };

/** Reject obviously dangerous patterns in raw fenced-block source text. */
export function validateSourceText(source: string): SourceSecurityResult {
  if (source.length > VISUAL_LIMITS.MAX_SOURCE_CHARS) {
    return { ok: false, reason: "source_too_large" };
  }
  if (SCRIPT_TAG.test(source)) return { ok: false, reason: "script_tag" };
  if (JS_URL.test(source)) return { ok: false, reason: "javascript_url" };
  if (DATA_HTML.test(source)) return { ok: false, reason: "data_html" };
  if (VBSCRIPT_URL.test(source)) return { ok: false, reason: "vbscript_url" };
  if (ON_EVENT_ATTR.test(source)) return { ok: false, reason: "on_event" };
  return { ok: true };
}

/** Mermaid-specific hardening before render. */
export function validateMermaidSource(source: string): SourceSecurityResult {
  const base = validateSourceText(source);
  if (!base.ok) return base;

  const nonEmptyLines = source.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length > VISUAL_LIMITS.MAX_MERMAID_LINES) {
    return { ok: false, reason: "mermaid_too_many_lines" };
  }
  if (MERMAID_CLICK.test(source)) return { ok: false, reason: "mermaid_click" };
  if (MERMAID_CALL.test(source)) return { ok: false, reason: "mermaid_callback" };
  if (MERMAID_UNSAFE_INIT.test(source)) return { ok: false, reason: "mermaid_unsafe_init" };
  if (MERMAID_HTML_TAG.test(source)) return { ok: false, reason: "mermaid_html_tag" };
  if (MERMAID_STYLE_URL.test(source)) return { ok: false, reason: "mermaid_style_url" };
  if (EXTERNAL_URL.test(source)) return { ok: false, reason: "external_url" };
  return { ok: true };
}

/** Strip Mermaid click directives that slipped through validation (defense in depth). */
export function sanitizeMermaidForRender(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*click\s+/i.test(line))
    .join("\n");
}

/** Sanitize rendered Mermaid SVG before {@html} injection. */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "href", "xlink:href"],
  });
}

type JsonWalkResult = { ok: true } | { ok: false; reason: string };

/** Walk parsed JSON and reject external URLs, excessive depth/size. */
export function validateJsonValue(value: unknown, depth = 0, path: string[] = []): JsonWalkResult {
  if (depth > VISUAL_LIMITS.MAX_JSON_DEPTH) {
    return { ok: false, reason: "json_too_deep" };
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return { ok: true };
  }

  if (typeof value === "string") {
    if (JS_URL.test(value) || DATA_HTML.test(value) || VBSCRIPT_URL.test(value)) {
      return { ok: false, reason: "unsafe_string" };
    }
    if (/^https?:\/\//i.test(value) || /^\/\//.test(value)) {
      return { ok: false, reason: "external_url" };
    }
    return { ok: true };
  }

  if (Array.isArray(value)) {
    if (value.length > VISUAL_LIMITS.MAX_ARRAY_ITEMS) {
      return { ok: false, reason: "array_too_large" };
    }
    for (let i = 0; i < value.length; i++) {
      const child = validateJsonValue(value[i], depth + 1, [...path, String(i)]);
      if (!child.ok) return child;
    }
    return { ok: true };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > VISUAL_LIMITS.MAX_OBJECT_KEYS) {
      return { ok: false, reason: "object_too_large" };
    }
    for (const [key, child] of entries) {
      const childPath = [...path, key];
      if (key.toLowerCase() === "url" && path[path.length - 1] === "data") {
        return { ok: false, reason: "vega_data_url" };
      }
      if (
        key === "usermeta" ||
        key === "format" ||
        key === "loader" ||
        key === "tooltip" ||
        key === "hover" ||
        key === "datasets" ||
        key === "signals" ||
        key === "config" ||
        key === "resolve"
      ) {
        return { ok: false, reason: "vega_forbidden_key" };
      }
      if (key === "data" && child && typeof child === "object" && !Array.isArray(child)) {
        const dataRecord = child as Record<string, unknown>;
        if ("name" in dataRecord || "format" in dataRecord) {
          return { ok: false, reason: "vega_external_data" };
        }
      }
      if (key === "transform" && Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          const step = child[i];
          if (!step || typeof step !== "object" || Array.isArray(step)) continue;
          const stepRecord = step as Record<string, unknown>;
          if ("expr" in stepRecord || "on" in stepRecord || "signal" in stepRecord) {
            return { ok: false, reason: "vega_expression" };
          }
        }
      }
      const walked = validateJsonValue(child, depth + 1, childPath);
      if (!walked.ok) return walked;
    }
    return { ok: true };
  }

  return { ok: false, reason: "unsupported_type" };
}

/** Reject markdown image syntax pointing at external URLs inside visual specs. */
export function containsExternalMarkdownImage(source: string): boolean {
  return /!\[[^\]]*]\(\s*(?:https?:|\/\/)/i.test(source);
}
