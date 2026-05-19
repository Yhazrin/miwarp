/**
 * Run-scoped insight report state — isolated from Chat page reactive timeline scans.
 * Only executes heavy work when the user clicks Share.
 */

import { tick, untrack } from "svelte";
import * as api from "$lib/api";
import type { TaskRun, TimelineEntry } from "$lib/types";
import type { UsageState } from "$lib/stores/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { yieldToMain } from "$lib/utils/yield";
import { t } from "$lib/i18n/index.svelte";
import { buildInsightContext } from "./insight-context-builder";
import { renderInsightHtmlAsync, redactSensitiveData } from "./insight-html-renderer";
import type { InsightContext, InsightReport, InsightCardState } from "./insight-types";

type RedactedContext = ReturnType<typeof redactSensitiveData>;

export interface ConversationInsightOptions {
  getRun: () => TaskRun | null | undefined;
  getTimeline: () => TimelineEntry[];
  getUsage: () => UsageState;
  getNumTurns: () => number;
  showToast: (msg: string) => void;
}

export interface ConversationInsightHandle {
  readonly insightState: InsightCardState;
  readonly insightCardOpen: boolean;
  insightPreviewOpen: boolean;
  readonly insightHtml: string | null;
  generate: () => Promise<void>;
  copyHtml: () => Promise<void>;
  exportHtml: () => Promise<void>;
  regenerate: () => Promise<void>;
  resetInsight: () => void;
}

export function useConversationInsight(
  options: ConversationInsightOptions,
): ConversationInsightHandle {
  let insightState = $state<InsightCardState>({ status: "idle" });
  let insightCardOpen = $state(false);
  let insightPreviewOpen = $state(false);
  let insightHtml = $state<string | null>(null);
  let generateGen = 0;

  function resetInsight() {
    generateGen++;
    insightState = { status: "idle" };
    insightHtml = null;
    insightPreviewOpen = false;
    insightCardOpen = false;
  }

  $effect(() => {
    const runId = options.getRun()?.id;
    runId;
    untrack(resetInsight);
  });

  function isStale(gen: number, runId: string | undefined): boolean {
    return gen !== generateGen || options.getRun()?.id !== runId;
  }

  async function generate() {
    const run = options.getRun();
    if (!run) {
      dbgWarn("chat", "insight.generate: no run");
      options.showToast(t("export_noConversation"));
      return;
    }

    const gen = ++generateGen;
    const runId = run.id;

    insightState = { status: "generating" };
    insightCardOpen = true;
    insightHtml = null;
    insightPreviewOpen = false;
    dbg("chat", "insight.generate: start", { runId });

    await tick();
    await yieldToMain();

    try {
      const context = await buildInsightContext(
        run,
        options.getTimeline(),
        options.getUsage(),
        options.getNumTurns() || 0,
        { isStale: () => isStale(gen, runId) },
      );

      if (isStale(gen, runId)) return;

      const redactedContext = redactSensitiveData(context);

      await yieldToMain();
      if (isStale(gen, runId)) return;

      const summaryResult = await api.summarizeConversation(runId);
      if (isStale(gen, runId)) return;

      const { summary } = summaryResult;
      const title = run.name || run.prompt?.slice(0, 80) || "Session Report";

      const report: InsightReport = {
        title,
        oneSentenceSummary: summary || "This session accomplished various development tasks.",
        background: `Work in ${redactedContext.session.cwd} using ${redactedContext.session.agent} agent.`,
        goals: redactedContext.session.prompt || "General development and coding tasks.",
        keyDecisions: extractKeyDecisions(redactedContext),
        processSteps: extractProcessSteps(redactedContext),
        fileImpact: extractFileImpact(redactedContext),
        finalResult: summary || "Session completed with various changes made.",
        risksAndNextSteps: extractRisksAndNextSteps(redactedContext),
        appendix: {
          toolCallSummary: extractToolCallSummary(redactedContext),
          keyCommands: extractKeyCommands(redactedContext),
          errorsAndFixes: extractErrorsAndFixes(redactedContext),
        },
      };

      await yieldToMain();
      if (isStale(gen, runId)) return;

      const html = await renderInsightHtmlAsync(report, redactedContext);
      if (isStale(gen, runId)) return;

      insightState = { status: "ready", report, html };
      insightHtml = html;
      dbg("chat", "insight.generate: done");
    } catch (e) {
      if (isStale(gen, runId)) return;
      dbgWarn("chat", "insight.generate failed", e);
      insightState = {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
      options.showToast(t("insight_error_default"));
    }
  }

  async function copyHtml() {
    if (!insightHtml) return;
    try {
      await navigator.clipboard.writeText(insightHtml);
      options.showToast(t("insight_copied"));
    } catch {
      options.showToast(t("insight_copy_failed"));
    }
  }

  async function exportHtml() {
    const run = options.getRun();
    if (!insightHtml || !run) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const title = run.name || run.prompt?.slice(0, 40) || "session";
      const date = new Date().toISOString().slice(0, 10);
      const path = await save({
        defaultPath: `miwarp-insight-${title.replace(/[^a-zA-Z0-9]/g, "-")}-${date}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) return;
      await api.writeHtmlExport(path, insightHtml);
      options.showToast(t("summarize_success"));
    } catch (e) {
      dbgWarn("chat", "insight.export failed", e);
      options.showToast(t("insight_export_failed"));
    }
  }

  async function regenerate() {
    await generate();
  }

  return {
    get insightState() {
      return insightState;
    },
    get insightCardOpen() {
      return insightCardOpen;
    },
    insightPreviewOpen,
    get insightHtml() {
      return insightHtml;
    },
    generate,
    copyHtml,
    exportHtml,
    regenerate,
    resetInsight,
  };
}

function extractKeyDecisions(ctx: RedactedContext): string[] {
  const decisions: string[] = [];
  for (const tc of ctx.toolCalls.slice(0, 20)) {
    if (tc.name === "Read" || tc.name === "Edit" || tc.name === "Write") {
      if (!decisions.includes("Code implementation approach")) {
        decisions.push("Code implementation approach");
      }
    }
    if (tc.name === "Bash" && tc.input.includes("git commit")) {
      if (!decisions.includes("Git commit for changes")) {
        decisions.push("Git commit for changes");
      }
    }
  }
  return decisions.length > 0 ? decisions : ["Various development tasks were completed."];
}

function extractProcessSteps(ctx: RedactedContext): { phase: string; description: string }[] {
  const steps: { phase: string; description: string }[] = [];
  steps.push({
    phase: "Initiation",
    description: `Session started with ${ctx.session.agent} in ${ctx.session.cwd}`,
  });
  if (ctx.messages.length > 2) {
    steps.push({
      phase: "Analysis",
      description: `User messages processed: ${ctx.messages.filter((m) => m.role === "user").length}`,
    });
  }
  if (ctx.fileChanges.length > 0) {
    steps.push({
      phase: "Implementation",
      description: `${ctx.fileChanges.length} file(s) modified: ${ctx.fileChanges
        .map((f) => f.path.split("/").pop())
        .slice(0, 3)
        .join(", ")}${ctx.fileChanges.length > 3 ? "..." : ""}`,
    });
  }
  if (ctx.errors.length > 0) {
    steps.push({
      phase: "Debugging",
      description: `${ctx.errors.length} error(s) encountered and addressed`,
    });
  }
  steps.push({
    phase: "Completion",
    description: `Session ended with status: ${ctx.session.status}`,
  });
  return steps;
}

function extractFileImpact(
  ctx: RedactedContext,
): { path: string; type: "created" | "modified" | "deleted"; responsibility: string }[] {
  return ctx.fileChanges.slice(0, 10).map((fc) => ({
    path: fc.path,
    type: fc.type,
    responsibility: `${fc.type} file`,
  }));
}

function extractRisksAndNextSteps(ctx: RedactedContext): string[] {
  const items: string[] = [];
  if (ctx.errors.length > 0) {
    items.push(`Risk: ${ctx.errors.length} error(s) were encountered during the session`);
  }
  if (ctx.fileChanges.length > 0) {
    items.push(`Next: Review the ${ctx.fileChanges.length} changed file(s) for correctness`);
  }
  if (!ctx.session.endedAt) {
    items.push("Next: Session may be continued to complete remaining tasks");
  }
  items.push("Next: Run tests to verify changes work correctly");
  return items.length > 0 ? items : ["No immediate risks or next steps identified."];
}

function extractToolCallSummary(ctx: RedactedContext): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tc of ctx.toolCalls) {
    counts.set(tc.name, (counts.get(tc.name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function extractKeyCommands(ctx: RedactedContext): string[] {
  const commands: string[] = [];
  for (const tc of ctx.toolCalls) {
    if (tc.name === "Bash") {
      const cmd = tc.input.replace(/^command=/, "").trim();
      if (cmd && !commands.includes(cmd)) commands.push(cmd);
    }
  }
  return commands.slice(0, 5);
}

function extractErrorsAndFixes(ctx: RedactedContext): { error: string; fix: string }[] {
  return ctx.errors.slice(0, 5).map((e) => ({
    error: e.message.slice(0, 100),
    fix: e.resolved ? "Resolved during session" : "May require attention",
  }));
}
