/**
 * Locale-aware formatting functions based on Intl API.
 *
 * All functions use currentLocale() for locale-sensitive output.
 * Every function includes Invalid Date / NaN / Infinity guards.
 *
 * Formatters are memoized per `(kind, locale, optionsHash)` because the
 * sidebar / chat list call these helpers hundreds of times during a render
 * pass — `new Intl.DateTimeFormat(...)` is roughly 100× more expensive than
 * a single `.format()` call, so we cache the constructed instance.
 */
import { currentLocale } from "./index.svelte";

// ── Helpers ─────────────────────────────────────────────────────

function toDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

// ── Formatter cache ────────────────────────────────────────────
//
// Intl.*Format constructors are expensive. `currentLocale()` is reactive, so
// invalidation happens implicitly: when locale flips we just miss the cache
// briefly until callers re-warm it. The Map key includes a stable JSON of
// options so different shapes never collide.

type FormatterKind = "date" | "time" | "datetime" | "full" | "number" | "relative";

const formatterCache = new Map<
  string,
  Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat
>();

function getFormatter<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  kind: FormatterKind,
  options?: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | Intl.RelativeTimeFormatOptions,
): T {
  const locale = currentLocale();
  const key = `${kind}|${locale}|${JSON.stringify(options ?? {})}`;
  let cached = formatterCache.get(key) as T | undefined;
  if (!cached) {
    if (kind === "date")
      cached = new Intl.DateTimeFormat(
        locale,
        options as Intl.DateTimeFormatOptions,
      ) as unknown as T;
    else if (kind === "time")
      cached = new Intl.DateTimeFormat(
        locale,
        options as Intl.DateTimeFormatOptions,
      ) as unknown as T;
    else if (kind === "datetime")
      cached = new Intl.DateTimeFormat(
        locale,
        options as Intl.DateTimeFormatOptions,
      ) as unknown as T;
    else if (kind === "full")
      cached = new Intl.DateTimeFormat(
        locale,
        options as Intl.DateTimeFormatOptions,
      ) as unknown as T;
    else if (kind === "number")
      cached = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions) as unknown as T;
    else
      cached = new Intl.RelativeTimeFormat(
        locale,
        options as Intl.RelativeTimeFormatOptions,
      ) as unknown as T;
    formatterCache.set(key, cached);
  }
  return cached;
}

// ── Number formatting ───────────────────────────────────────────

/** Format a number with locale-aware thousand separators. NaN/Infinity → "0". */
export function fmtNumber(n: number): string {
  if (isNaN(n) || !isFinite(n)) return "0";
  return getFormatter<Intl.NumberFormat>("number").format(n);
}

// ── Date/time formatting ────────────────────────────────────────

/** Time only: "12:30". Invalid Date → "—". */
export function fmtTime(d: Date | string): string {
  const date = toDate(d);
  if (!isValidDate(date)) return "—";
  return getFormatter<Intl.DateTimeFormat>("time", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Short date: "Feb 20" / "2月20日". Invalid Date → "—". */
export function fmtDate(d: Date | string): string {
  const date = toDate(d);
  if (!isValidDate(date)) return "—";
  return getFormatter<Intl.DateTimeFormat>("date", {
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Date + time: "2/20 12:30". Invalid Date → "—". */
export function fmtDateTime(d: Date | string): string {
  const date = toDate(d);
  if (!isValidDate(date)) return "—";
  return getFormatter<Intl.DateTimeFormat>("datetime", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Full date-time (for tooltips): "2026/2/20 12:30:45". Invalid Date → "—". */
export function fmtFull(d: Date | string): string {
  const date = toDate(d);
  if (!isValidDate(date)) return "—";
  return getFormatter<Intl.DateTimeFormat>("full", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

// ── Relative time ───────────────────────────────────────────────

/** Relative time: "3 minutes ago" / "3 分钟前". Invalid Date → "—". */
export function fmtRelative(d: Date | string): string {
  const date = toDate(d);
  if (!isValidDate(date)) return "—";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  const rtf = getFormatter<Intl.RelativeTimeFormat>("relative", { numeric: "auto" });

  if (diffSec < 10) return rtf.format(0, "second"); // "now" / "现在"
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  if (diffHr < 24) return rtf.format(-diffHr, "hour");
  if (diffDay < 7) return rtf.format(-diffDay, "day");

  // Beyond 7 days: show formatted date
  return fmtDate(date);
}
