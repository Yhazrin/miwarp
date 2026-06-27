/** Query flag that enables split workspace mode on `/chat`. */
export const SPLIT_QUERY_PARAM = "split";

export function isSplitModeUrl(params: URLSearchParams): boolean {
  return params.get(SPLIT_QUERY_PARAM) === "1";
}

export function buildChatUrl(base: URL, opts: { runId?: string | null; split?: boolean }): URL {
  const url = new URL(base.href);
  if (opts.split) {
    url.searchParams.set(SPLIT_QUERY_PARAM, "1");
  } else {
    url.searchParams.delete(SPLIT_QUERY_PARAM);
  }
  if (opts.runId) {
    url.searchParams.set("run", opts.runId);
  }
  return url;
}
