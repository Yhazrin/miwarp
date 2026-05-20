import * as api from "$lib/api";

export interface ToolResultCacheContext {
  getRunId: () => string | undefined;
}

export function createToolResultCache(ctx: ToolResultCacheContext) {
  const { getRunId } = ctx;

  let toolResultCache = new Map<string, Record<string, unknown>>();
  let toolResultInflight = new Map<string, Promise<Record<string, unknown> | null>>();

  function clearCache() {
    toolResultCache = new Map();
    toolResultInflight = new Map();
  }

  async function fetchToolResult(
    runId: string,
    toolUseId: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${runId}:${toolUseId}`;
    const cached = toolResultCache.get(key);
    if (cached) return cached;
    let pending = toolResultInflight.get(key);
    if (!pending) {
      pending = api.getToolResult(runId, toolUseId);
      toolResultInflight.set(key, pending);
    }
    try {
      const result = await pending;
      if (result && getRunId() === runId) {
        toolResultCache.set(key, result);
      }
      return result;
    } finally {
      toolResultInflight.delete(key);
    }
  }

  return { fetchToolResult, clearCache };
}
