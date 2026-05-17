/**
 * Composable: chat page derived values.
 *
 * Computes derived state from store + composables that isn't owned by
 * useChatHandlers or useChatLifecycle. Keeps the page template thin.
 */
import type { SessionStore } from "$lib/stores";
import type {
  BusToolItem,
  TimelineEntry,
  CliModelInfo,
  ContextSnapshot,
  SessionInfoData,
} from "$lib/types";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import {
  detectBatchGroups,
  detectToolBursts,
  isPlanFilePath,
  planFileName,
  extractPlanContent,
} from "$lib/utils/tool-rendering";
import type { ToolBurst } from "$lib/utils/tool-rendering";
import { parseContextMarkdown } from "$lib/utils/context-parser";
import { formatTokenCount } from "$lib/utils/format";
import type { TurnUsage } from "$lib/stores/types";
import { CONTEXT_CLEARED_MARKER } from "$lib/utils/slash-commands";
import { getCliModels, getCliVersionInfo_cached } from "$lib/stores";

const EMPTY_BATCH_MAP = new Map();
const EMPTY_BURST_MAP = new Map() as Map<number, ToolBurst>;

export interface UseChatDerivedOptions {
  store: SessionStore;
  filteredTimeline: () => TimelineEntry[];
  visibleTimeline: () => TimelineEntry[];
  toolFilter: () => string | null;
  settings: () => import("$lib/types").UserSettings | null;
  cliVersionInfo: () => ReturnType<typeof getCliVersionInfo_cached>;
  channelLatest: () => string | undefined;
  platformDisplayName: () => string | undefined;
  authOverview: () => import("$lib/types").AuthOverview | null;
}

export function useChatDerived(opts: UseChatDerivedOptions) {
  const { store } = opts;

  // ── Created files tracking ──
  const createdFiles = $derived.by(() => {
    const files: { path: string; name: string; tool: string; timestamp: number }[] = [];
    const seen = new Set<string>();
    for (const entry of store.timeline) {
      if (entry.kind !== "tool") continue;
      const tool = entry.tool;
      if (tool.status !== "success") continue;
      const output = tool.output as Record<string, unknown> | undefined;
      if (!output) continue;
      const path =
        (output.path as string) || (output.file_path as string) || (output.created_path as string);
      if (path && !seen.has(path)) {
        seen.add(path);
        files.push({
          path,
          name: path.split("/").pop() ?? path,
          tool: tool.tool_name,
          timestamp: ((entry as Record<string, unknown>).seq as number) ?? Date.now(),
        });
      }
    }
    return files.sort((a, b) => a.timestamp - b.timestamp);
  });
  const hasCreatedFiles = $derived(createdFiles.length > 0);

  // ── Batch groups ──
  const batchGroups = $derived(
    opts.toolFilter()
      ? (EMPTY_BATCH_MAP as Map<number, BusToolItem[]>)
      : detectBatchGroups(opts.visibleTimeline()),
  );

  // ── Tool burst groups ──
  const toolBursts = $derived(
    opts.toolFilter() ? EMPTY_BURST_MAP : detectToolBursts(opts.visibleTimeline()),
  );

  // ── Auto-collapse ──
  let manualOverrides = $state(new Map<string, boolean>());

  const autoCollapsed = $derived.by(() => {
    const keys = new Set<string>();
    for (const [, burst] of toolBursts) {
      const needsInteraction = burst.tools.some(
        (t) => t.status === "permission_prompt" || t.status === "ask_pending",
      );
      if (burst.stats.running === 0 && burst.stats.total > 0 && !needsInteraction) {
        keys.add(burst.key);
      }
    }
    return keys;
  });

  function toggleBurst(key: string) {
    const next = new Map(manualOverrides);
    const currentlyCollapsed = effectiveCollapsed.has(key);
    next.set(key, currentlyCollapsed);
    manualOverrides = next;
  }

  const effectiveCollapsed = $derived.by(() => {
    const result = new Set<string>();
    for (const [, burst] of toolBursts) {
      const needsInteraction = burst.tools.some(
        (t) => t.status === "permission_prompt" || t.status === "ask_pending",
      );
      if (needsInteraction) continue;
      const manual = manualOverrides.get(burst.key);
      if (manual === true) continue;
      if (manual === false) {
        result.add(burst.key);
        continue;
      }
      if (autoCollapsed.has(burst.key)) {
        result.add(burst.key);
      }
    }
    return result;
  });

  const burstHiddenIndices = $derived.by(() => {
    const hidden = new Set<number>();
    for (const [, burst] of toolBursts) {
      if (effectiveCollapsed.has(burst.key)) {
        for (let j = burst.startIndex; j <= burst.endIndex; j++) hidden.add(j);
      }
    }
    return hidden;
  });

  // ── Input history ──
  const userHistory = $derived.by(() =>
    store.timeline
      .filter((e): e is Extract<TimelineEntry, { kind: "user" }> => e.kind === "user")
      .map((e) => e.content)
      .reverse(),
  );

  const toolNamesInTimeline = $derived.by(() => {
    const names = new Set<string>();
    for (const entry of store.timeline) {
      if (entry.kind === "tool") names.add(entry.tool.tool_name);
    }
    return [...names].sort();
  });

  // ── Cumulative tokens ──
  const cumulativeTokens = $derived.by(() => {
    const mu = store.usage.modelUsage;
    if (!mu || Object.keys(mu).length === 0) {
      return {
        input: store.usage.inputTokens,
        output: store.usage.outputTokens,
        cacheRead: store.usage.cacheReadTokens,
        cacheWrite: store.usage.cacheWriteTokens,
      };
    }
    let input = 0,
      output = 0,
      cacheRead = 0,
      cacheWrite = 0;
    for (const entry of Object.values(mu)) {
      input += entry.input_tokens;
      output += entry.output_tokens;
      cacheRead += entry.cache_read_tokens;
      cacheWrite += entry.cache_write_tokens;
    }
    return { input, output, cacheRead, cacheWrite };
  });

  // ── Per-turn usage annotations ──
  const usageByTurn = $derived(new Map(store.turnUsages.map((tu) => [tu.turnIndex, tu])));

  const userCountPrefix = $derived.by(() => {
    const ft = opts.filteredTimeline();
    const arr = new Int32Array(ft.length + 1);
    for (let i = 0; i < ft.length; i++) {
      arr[i + 1] = arr[i] + (ft[i].kind === "user" ? 1 : 0);
    }
    return arr;
  });

  const usageAnnotations = $derived.by(() => {
    const map = new Map<number, TurnUsage>();
    if (usageByTurn.size === 0) return map;
    const vt = opts.visibleTimeline();
    const hidden = opts.filteredTimeline().length - vt.length;
    let userCount = userCountPrefix[hidden];
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind === "user") {
        if (userCount > 0) {
          const tu = usageByTurn.get(userCount);
          if (tu) map.set(i, tu);
        }
        userCount++;
      }
    }
    return map;
  });

  const claudeTurnStarts = $derived.by(() => {
    const starts = new Set<number>();
    const vt = opts.visibleTimeline();
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind !== "tool") continue;
      if (burstHiddenIndices.has(i)) continue;
      for (let j = i - 1; j >= 0; j--) {
        if (burstHiddenIndices.has(j)) continue;
        if (vt[j].kind === "tool") continue;
        if (vt[j].kind === "user") starts.add(i);
        break;
      }
    }
    return starts;
  });

  const lastTurnUsage = $derived.by(() => {
    const userCount = opts.filteredTimeline().filter((e) => e.kind === "user").length;
    if (userCount === 0) return null;
    return usageByTurn.get(userCount) ?? null;
  });

  // ── Session info ──
  const currentSessionInfo: SessionInfoData | null = $derived.by(() => {
    if (!store.run) return null;
    return {
      sessionId: store.run.session_id,
      runId: store.run.id,
      runName: store.run.name,
      cwd: store.sessionCwd || store.run.cwd,
      numTurns: store.numTurns,
      status: store.run.status ?? "pending",
      startedAt: store.run.started_at ?? null,
      endedAt: store.run.ended_at ?? null,
      lastTurnDurationMs: store.durationMs,
      tokensEstimated: !store.usage.modelUsage || Object.keys(store.usage.modelUsage).length === 0,
      model: store.run.model ?? store.model,
      agent: store.run.agent ?? store.agent,
      cliVersion: store.cliVersion,
      permissionMode: store.permissionMode,
      fastModeState: store.fastModeState,
      cost: store.usage.cost,
      inputTokens: cumulativeTokens.input,
      outputTokens: cumulativeTokens.output,
      cacheReadTokens: cumulativeTokens.cacheRead,
      cacheWriteTokens: cumulativeTokens.cacheWrite,
      contextWindow: store.contextWindow,
      contextUtilization: store.contextUtilization,
      compactCount: store.compactCount,
      microcompactCount: store.microcompactCount,
      mcpServers: store.mcpServers,
      remoteHostName: store.remoteHostName,
      platformId: store.platformId,
      cliUsageIncomplete: store.run.cli_usage_incomplete ?? false,
      runSource: store.run.source,
      authSourceLabel: store.authSourceLabel || undefined,
      platformName: opts.platformDisplayName() || undefined,
      cliUpdateAvailable:
        store.cliVersion && opts.channelLatest() && opts.channelLatest() !== store.cliVersion
          ? opts.channelLatest()
          : undefined,
    };
  });

  // ── Platform models ──
  const platformModels = $derived.by((): CliModelInfo[] => {
    const pid = store.platformId;
    if (!pid || pid === "anthropic") return [];
    const cred = findCredential(opts.settings()?.platform_credentials ?? [], pid);
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (!models?.length) return [];
    return models.map((m, i) => ({
      value: m,
      displayName: m,
      description: i === 0 ? "Default" : "",
    }));
  });

  const effectiveModels = $derived(platformModels.length > 0 ? platformModels : getCliModels());

  // ── Skill items ──
  function skillItems(preloadedSkills: Array<{ name: string; description: string }>) {
    const detailMap = new Map(preloadedSkills.map((s) => [s.name, s]));
    const names = store.availableSkills;
    if (names.length > 0) {
      return names.map((name) => ({
        name,
        description: detailMap.get(name)?.description ?? "",
      }));
    }
    return preloadedSkills.map((s) => ({ name: s.name, description: s.description }));
  }

  // ── Timeline ID index ──
  const timelineIdIndex = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < store.timeline.length; i++) {
      map.set(store.timeline[i].id, i);
    }
    return map;
  });

  // ── Last clear separator ID ──
  const lastClearSepId = $derived.by(() => {
    for (let i = store.timeline.length - 1; i >= 0; i--) {
      const e = store.timeline[i];
      if (e.kind === "separator" && e.content === CONTEXT_CLEARED_MARKER) return e.id;
    }
    return null;
  });

  // ── Latest plan tool ID ──
  const latestPlanToolId = $derived.by(() => {
    for (let i = store.timeline.length - 1; i >= 0; i--) {
      const e = store.timeline[i];
      if (e.kind !== "tool" || !e.tool) continue;
      const fp = String(e.tool.input?.file_path ?? e.tool.input?.path ?? "");
      if ((e.tool.tool_name === "Write" || e.tool.tool_name === "Edit") && isPlanFilePath(fp)) {
        return e.tool.tool_use_id;
      }
    }
    return null;
  });

  // ── Welcome visibility ──
  const welcomeVisible = $derived(
    store.timeline.length === 0 && !store.streamingText && !store.run && store.phase !== "loading",
  );

  // ── Permission/input state ──
  const inputBlockedByPermission = $derived(store.hasPendingPermission || store.hasElicitation);
  const pendingToolPermissions = $derived(store.pendingToolPermissions);
  const showPermissionPanel = $derived(pendingToolPermissions.length > 0 && store.sessionAlive);

  // ── Last assistant index ──
  function lastAssistantIdx(visibleTimeline: TimelineEntry[]) {
    for (let j = visibleTimeline.length - 1; j >= 0; j--) {
      if (visibleTimeline[j].kind === "assistant") return j;
    }
    return -1;
  }

  return {
    createdFiles,
    hasCreatedFiles,
    batchGroups,
    toolBursts,
    manualOverrides,
    autoCollapsed,
    effectiveCollapsed,
    burstHiddenIndices,
    toggleBurst,
    userHistory,
    toolNamesInTimeline,
    cumulativeTokens,
    usageByTurn,
    usageAnnotations,
    claudeTurnStarts,
    lastTurnUsage,
    currentSessionInfo,
    platformModels,
    effectiveModels,
    skillItems,
    timelineIdIndex,
    lastClearSepId,
    latestPlanToolId,
    welcomeVisible,
    inputBlockedByPermission,
    pendingToolPermissions,
    showPermissionPanel,
    lastAssistantIdx,
  };
}
