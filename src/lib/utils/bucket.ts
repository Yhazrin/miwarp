/**
 * P1-5：统一的日期 / 小时桶函数（boundary-exclusive 语义）。
 *
 * 历史背景：
 *   旧代码散落着用 `new Date(ts).toISOString().slice(0, 10)` 算日期 / 切小时，
 *   写错 1 个字符（slice(0,11) vs slice(0,10)）就会让"今天"和"昨天"漏一天。
 *   这里把 daily / hourly 桶集中起来，强制 boundary-exclusive：
 *
 *     bucketDaily(ts, tz)  → "YYYY-MM-DD"  本地时区的自然日
 *     bucketHourly(ts, tz) → "YYYY-MM-DDTHH"  本地时区的小时桶起点
 *
 * boundary-exclusive 的意思是：返回值代表桶的 *起点*，桶长度 = 1 天 / 1 小时。
 * 同一桶内所有 timestamp 都会拿到同样的 key，不会出现 23:59:59.999 与
 * 00:00:00.001 错位到不同桶的情况。
 */

const DAY_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();
const HOUR_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

/** Intl 格式缓存，避免每次调用都 new DateTimeFormat（慢）。 */
function dayFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = DAY_FORMAT_CACHE.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DAY_FORMAT_CACHE.set(tz, fmt);
  }
  return fmt;
}

function hourFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = HOUR_FORMAT_CACHE.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });
    HOUR_FORMAT_CACHE.set(tz, fmt);
  }
  return fmt;
}

/** 把 Intl parts 拼成 "YYYY-MM-DD"。 */
function partsToDateKey(parts: Intl.DateTimeFormatPart[]): string {
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** 把 Intl parts 拼成 "YYYY-MM-DDTHH"。 */
function partsToHourKey(parts: Intl.DateTimeFormatPart[]): string {
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  return `${y}-${m}-${d}T${h}`;
}

/**
 * 计算 timestamp 所在自然日（按 tz 时区）。boundary-exclusive：返回的是当天 00:00
 * 的 key，所有同一自然日内的 timestamp 都会落到同一桶。
 *
 * @param ts 毫秒或秒都可：如果数字 < 1e12 自动按秒处理，否则按毫秒。
 * @param tz IANA 时区名（如 "Asia/Shanghai"、"UTC"）。非法值时 fallback 到本地时区。
 */
export function bucketDaily(ts: number, tz: string = "UTC"): string {
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const safeTz = isValidTimeZone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return partsToDateKey(dayFormatter(safeTz).formatToParts(new Date(ms)));
}

/**
 * 计算 timestamp 所在小时桶起点（按 tz 时区）。返回 "YYYY-MM-DDTHH"。
 * boundary-exclusive：返回的是该小时 00:00 的 key。
 */
export function bucketHourly(ts: number, tz: string = "UTC"): string {
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const safeTz = isValidTimeZone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return partsToHourKey(hourFormatter(safeTz).formatToParts(new Date(ms)));
}

/**
 * 判断给定字符串是不是合法 IANA 时区（Naive fallback）。
 * 我们用 Intl.DateTimeFormat 试格式化一个固定时间，如果没抛错就当作合法。
 */
function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * 把多个 timestamp 折叠进对应桶，返回按时间顺序排好的桶 key 数组（去重）。
 * 给前端画图时方便拿来对齐 x 轴。
 */
export function uniqueBucketKeys(
  timestamps: number[],
  granularity: "day" | "hour",
  tz: string = "UTC",
): string[] {
  const fn = granularity === "day" ? bucketDaily : bucketHourly;
  const set = new Set<string>();
  for (const ts of timestamps) {
    set.add(fn(ts, tz));
  }
  return [...set].sort();
}
