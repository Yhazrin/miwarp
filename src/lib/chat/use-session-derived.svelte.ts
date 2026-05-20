/**
 * Composable that owns derived session state — token totals, session info,
 * platform models, CLI version, and input history.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 * Uses Svelte 5 runes (`$state`, `$derived`) for reactivity.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import type {
  AuthOverview,
  BusToolItem,
  CliModelInfo,
  ContextSnapshot,
  SessionInfoData,
  StandaloneSkill,
  TimelineEntry,
  UserSettings,
} from "$lib/types";
import type { TurnUsage } from "$lib/stores/types";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import { getCliVersionInfo_cached, getCliModels } from "$lib/stores/cli-info.svelte";
import type { CliVersionInfo } from "$lib/stores/cli-info.svelte";
import type { TimelineAnnotationsHandle } from "$lib/chat/use-timeline-annotations.svelte";

// ── Context (dependency injection) ──

export interface SessionDerivedContext {
  store: SessionStore;
  getSettings: () => UserSettings | null;
  getAuthOverview: () => AuthOverview | null;
  getVisibleTimeline: () => TimelineEntry[];
  getFilteredTimeline: () => TimelineEntry[];
  getUserCountPrefix: () => Int32Array;
  getCollapsedIndices: () => Set<number>;
  getPreloadedSkills: () => StandaloneSkill[];
  /** Optional: when provided, annotation getters delegate to this handle. */
  timelineAnnotations?: TimelineAnnotationsHandle;
}

// ── Return type ──

export interface SessionDerivedHandle {
  // Derived values (read-only via getters)
  lastAssistantIdx: number;
  userHistory: string[];
  contextHistoryMap: Map<string, ContextSnapshot[]>;
  contextHistory: ContextSnapshot[];
  cumulativeTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  currentSessionInfo: SessionInfoData | null;
  cliVersionInfo: CliVersionInfo | null;
  channelLatest: string | undefined;
  platformDisplayName: string | undefined;
  platformModels: CliModelInfo[];
  effectiveModels: CliModelInfo[];
  inputBlockedByPermission: boolean;
  pendingToolPermissions: Array<{ tool: BusToolItem; requestId: string }>;
  showPermissionPanel: boolean;
  skillItems: Array<{ name: string; description: string }>;
  usageAnnotations: Map<number, TurnUsage>;
  claudeTurnStarts: Set<number>;
  lastTurnUsage: TurnUsage | null;

  // Mutable state setter
  setContextHistoryMap: (v: Map<string, ContextSnapshot[]>) => void;
}

// ── Composable ──

export function createSessionDerived(ctx: SessionDerivedContext): SessionDerivedHandle {
  const {
    store,
    getSettings,
    getAuthOverview,
    getVisibleTimeline,
    getFilteredTimeline,
    getUserCountPrefix,
    getCollapsedIndices,
    getPreloadedSkills,
    timelineAnnotations,
  } = ctx;

  // ── Mutable state ──

  let contextHistoryMap = $state<Map<string, ContextSnapshot[]>>(new Map());

  // ── Derived: last assistant entry index ──

  const lastAssistantIdx = $derived.by(() => {
    const vt = getVisibleTimeline();
    for (let j = vt.length - 1; j >= 0; j--) {
      if (vt[j].kind === "assistant") return j;
    }
    return -1;
  });

  // ── Derived: input history (most recent first) ──

  const userHistory = $derived.by(() =>
    store.timeline
      .filter((e): e is Extract<TimelineEntry, { kind: "user" }> => e.kind === "user")
      .map((e) => e.content)
      .reverse(),
  );

  // ── Derived: context history for current run ──

  const contextHistory = $derived(contextHistoryMap.get(store.run?.id ?? "") ?? []);

  // ── Derived: cumulative session token totals ──

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

  // ── Derived: CLI version info (reactive) ──

  const cliVersionInfo = $derived(getCliVersionInfo_cached());

  // ── Derived: CLI update channel ──

  const channelLatest = $derived.by(() => {
    if (!cliVersionInfo?.installed) return undefined;
    return cliVersionInfo.channel === "stable" ? cliVersionInfo.stable : cliVersionInfo.latest;
  });

  // ── Derived: platform display name ──

  const platformDisplayName = $derived.by(() => {
    const pid = store.platformId;
    if (!pid) return undefined;
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    const authOverview = getAuthOverview();
    return preset?.name ?? authOverview?.app_platform_name ?? pid;
  });

  // ── Derived: provider-aware model list ──

  const platformModels = $derived.by((): CliModelInfo[] => {
    const pid = store.platformId;
    if (!pid || pid === "anthropic") return [];
    const settings = getSettings();
    const cred = findCredential(settings?.platform_credentials ?? [], pid);
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

  // ── Derived: permission and skill state ──

  const inputBlockedByPermission = $derived(store.hasPendingPermission || store.hasElicitation);
  const pendingToolPermissions = $derived(store.pendingToolPermissions);
  const showPermissionPanel = $derived(pendingToolPermissions.length > 0 && store.sessionAlive);

  const skillItems = $derived.by(() => {
    const preloadedSkills = getPreloadedSkills();
    const detailMap = new Map(preloadedSkills.map((s) => [s.name, s]));
    const names = store.availableSkills;
    if (names.length > 0) {
      return names.map((name) => ({
        name,
        description: detailMap.get(name)?.description ?? "",
      }));
    }
    return preloadedSkills.map((s) => ({ name: s.name, description: s.description }));
  });

  // ── Derived: per-turn usage annotations in timeline ──
  // Delegates to timelineAnnotations handle when provided; otherwise computes inline.

  const usageByTurn = $derived(new Map(store.turnUsages.map((tu) => [tu.turnIndex, tu])));

  const usageAnnotations = $derived.by(() => {
    if (timelineAnnotations) return timelineAnnotations.usageAnnotations;
    const map = new Map<number, TurnUsage>();
    if (usageByTurn.size === 0) return map;
    const vt = getVisibleTimeline();
    const filtered = getFilteredTimeline();
    const hidden = filtered.length - vt.length;
    let userCount = getUserCountPrefix()[hidden];
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
    if (timelineAnnotations) return timelineAnnotations.claudeTurnStarts;
    const starts = new Set<number>();
    const vt = getVisibleTimeline();
    const collapsed = getCollapsedIndices();
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind !== "tool") continue;
      if (collapsed.has(i)) continue;
      for (let j = i - 1; j >= 0; j--) {
        if (collapsed.has(j)) continue;
        if (vt[j].kind === "tool") continue;
        if (vt[j].kind === "user") starts.add(i);
        break;
      }
    }
    return starts;
  });

  const lastTurnUsage = $derived.by(() => {
    if (timelineAnnotations) return timelineAnnotations.lastTurnUsage;
    const prefix = getUserCountPrefix();
    const userCount = prefix[prefix.length - 1] ?? 0;
    if (userCount === 0) return null;
    return usageByTurn.get(userCount) ?? null;
  });

  // ── Derived: session info for InfoPanel ──

  const currentSessionInfo = $derived.by((): SessionInfoData | null => {
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
      platformName: platformDisplayName || undefined,
      cliUpdateAvailable:
        store.cliVersion && channelLatest && channelLatest !== store.cliVersion
          ? channelLatest
          : undefined,
    };
  });

  // ── Public API ──

  return {
    get lastAssistantIdx() {
      return lastAssistantIdx;
    },
    get userHistory() {
      return userHistory;
    },
    get contextHistoryMap() {
      return contextHistoryMap;
    },
    get contextHistory() {
      return contextHistory;
    },
    get cumulativeTokens() {
      return cumulativeTokens;
    },
    get currentSessionInfo() {
      return currentSessionInfo;
    },
    get cliVersionInfo() {
      return cliVersionInfo;
    },
    get channelLatest() {
      return channelLatest;
    },
    get platformDisplayName() {
      return platformDisplayName;
    },
    get platformModels() {
      return platformModels;
    },
    get effectiveModels() {
      return effectiveModels;
    },
    get inputBlockedByPermission() {
      return inputBlockedByPermission;
    },
    get pendingToolPermissions() {
      return pendingToolPermissions;
    },
    get showPermissionPanel() {
      return showPermissionPanel;
    },
    get skillItems() {
      return skillItems;
    },
    get usageAnnotations() {
      return usageAnnotations;
    },
    get claudeTurnStarts() {
      return claudeTurnStarts;
    },
    get lastTurnUsage() {
      return lastTurnUsage;
    },
    setContextHistoryMap: (v: Map<string, ContextSnapshot[]>) => {
      contextHistoryMap = v;
    },
  };
}
