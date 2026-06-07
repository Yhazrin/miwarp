/**
 * v1.0.6 / 4.7: HTML session insight report.
 *
 * Generate a self-contained HTML file from a session's timeline +
 * usage. The file uses inline CSS so it works offline (no external
 * assets). Optionally pass `theme: "dark" | "light"` to flip the
 * default palette.
 */
import type { TimelineEntry } from "$lib/types";
import type { TurnUsage, UsageState } from "$lib/stores/types";
import type { TaskRun } from "$lib/types";

export interface InsightReportInput {
  run: TaskRun;
  timeline: TimelineEntry[];
  usage: UsageState;
  turnUsages: TurnUsage[];
  theme?: "light" | "dark";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function entrySummary(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "user":
      return `> ${(entry as { content: string }).content.slice(0, 200)}`;
    case "assistant":
      return (entry as { content: string }).content.slice(0, 200);
    case "tool":
      return `[tool] (see timeline)`;
    default:
      return "";
  }
}

export function renderInsightReport(input: InsightReportInput): string {
  const { run, timeline, usage, turnUsages } = input;
  const theme = input.theme ?? "light";
  const displayTitle = run.name ?? run.id;
  const totalCost = turnUsages.reduce((acc, t) => acc + (t.cost ?? 0), 0);
  const totalInput = turnUsages.reduce((acc, t) => acc + t.inputTokens, 0);
  const totalOutput = turnUsages.reduce((acc, t) => acc + t.outputTokens, 0);

  const css = `
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 900px; margin: 0 auto; color: ${theme === "dark" ? "#e2e8f0" : "#0f172a"}; background: ${theme === "dark" ? "#0f172a" : "#f8fafc"}; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid ${theme === "dark" ? "#334155" : "#cbd5e1"}; padding-bottom: 4px; }
    .meta { color: ${theme === "dark" ? "#94a3b8" : "#475569"}; font-size: 0.875rem; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 1rem; }
    .stat { padding: 12px; border-radius: 8px; background: ${theme === "dark" ? "#1e293b" : "#fff"}; border: 1px solid ${theme === "dark" ? "#334155" : "#e2e8f0"}; }
    .stat-label { font-size: 0.75rem; color: ${theme === "dark" ? "#94a3b8" : "#64748b"}; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 1.25rem; font-weight: 600; margin-top: 4px; }
    .timeline-entry { padding: 8px 12px; border-left: 3px solid ${theme === "dark" ? "#3b82f6" : "#2563eb"}; background: ${theme === "dark" ? "#1e293b" : "#fff"}; margin-bottom: 8px; border-radius: 4px; font-size: 0.875rem; }
    .timeline-entry.user { border-left-color: #10b981; }
    .timeline-entry.tool { border-left-color: #f59e0b; }
    .turn-row { display: flex; justify-content: space-between; font-size: 0.875rem; padding: 4px 0; }
  `;

  const body = `
    <h1>${escapeHtml(displayTitle)}</h1>
    <div class="meta">
      Agent: ${escapeHtml(run.agent ?? "?")} · Status: ${escapeHtml(run.status ?? "?")}
      · Started: ${escapeHtml(run.started_at ?? "?")}
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Total cost</div>
        <div class="stat-value">${formatUsd(totalCost)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Input tokens</div>
        <div class="stat-value">${totalInput.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Output tokens</div>
        <div class="stat-value">${totalOutput.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Messages</div>
        <div class="stat-value">${timeline.length}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cumulative cost</div>
        <div class="stat-value">${formatUsd(usage.cost ?? 0)}</div>
      </div>
    </div>

    <h2>Per-turn usage</h2>
    ${turnUsages
      .map(
        (t) => `
      <div class="turn-row">
        <span>Turn ${t.turnIndex + 1}</span>
        <span>${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out · ${formatUsd(t.cost)}</span>
      </div>`,
      )
      .join("")}

    <h2>Timeline (${timeline.length} entries)</h2>
    ${timeline
      .slice(0, 200)
      .map(
        (e) => `
      <div class="timeline-entry ${escapeHtml(e.kind)}">
        <strong>${escapeHtml(e.kind)}</strong>: ${escapeHtml(entrySummary(e))}
      </div>`,
      )
      .join("")}
    ${timeline.length > 200 ? `<div class="meta">… and ${timeline.length - 200} more entries.</div>` : ""}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(displayTitle)} — MiWarp Insight Report</title>
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}
