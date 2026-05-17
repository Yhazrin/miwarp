import * as api from "$lib/api";
import { formatDuration } from "$lib/utils/format";
import { dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import type { UserSettings } from "$lib/types";
import {
  normalizeProcessVisibility,
  type ProcessVisibility,
  type TranscriptRunStats,
} from "$lib/utils/process-visibility";

export function useProcessVisibility(opts: {
  getSettings: () => UserSettings | null;
  setSettings: (s: UserSettings | null) => void;
  setCachedUserSettings: (s: UserSettings) => void;
  setSidebarCollapsed: (v: boolean) => void;
}) {
  let _prevProcessVisibility = $state<ProcessVisibility | null>(null);

  const processVisibility = $derived(
    normalizeProcessVisibility(opts.getSettings()?.process_visibility),
  );

  $effect(() => {
    const pv = processVisibility;
    if (pv === "output") {
      if (_prevProcessVisibility === null || _prevProcessVisibility !== "output") {
        opts.setSidebarCollapsed(true);
      }
    }
    _prevProcessVisibility = pv;
  });

  async function persistProcessVisibility(v: ProcessVisibility) {
    try {
      const next = await api.updateUserSettings({ process_visibility: v });
      opts.setSettings(next);
      opts.setCachedUserSettings(next);
    } catch (e) {
      dbgWarn("chat", "process_visibility save failed", e);
    }
  }

  function formatRunSummaryLine(stats: TranscriptRunStats, durationMs: number): string {
    const parts: string[] = [];
    if (stats.readFiles > 0) {
      parts.push(t("runSummary_reads", { count: String(stats.readFiles) }));
    }
    if (stats.writeFiles > 0) {
      parts.push(t("runSummary_writes", { count: String(stats.writeFiles) }));
    }
    if (stats.editFiles > 0) {
      parts.push(t("runSummary_edits", { count: String(stats.editFiles) }));
    }
    if (stats.bashRuns > 0) {
      parts.push(t("runSummary_bash", { count: String(stats.bashRuns) }));
    }
    if (durationMs > 0) {
      parts.push(t("runSummary_duration", { duration: formatDuration(durationMs) }));
    }
    return parts.join(" · ");
  }

  return {
    processVisibility,
    persistProcessVisibility,
    formatRunSummaryLine,
  };
}
