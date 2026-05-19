/**
 * Renders an InsightReport into a single-file HTML document.
 */

import type { InsightReport, InsightContext, InsightSession } from "./insight-types";
import { buildInsightPromptContext } from "./insight-context-builder";

/**
 * Renders the insight report as a single-file HTML string.
 */
export function renderInsightHtml(report: InsightReport, context: InsightContext): string {
  const { session } = context;

  const escapedTitle = escapeHtml(report.title);
  const escapedOneSentence = escapeHtml(report.oneSentenceSummary);
  const escapedBackground = escapeHtml(report.background);
  const escapedGoals = escapeHtml(report.goals);
  const escapedFinalResult = escapeHtml(report.finalResult);

  const startedAt = session.startedAt ? new Date(session.startedAt).toLocaleString() : "N/A";
  const duration = session.durationMs ? formatDuration(session.durationMs) : "N/A";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle} - MiWarp Insight</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #fafafa;
      --surface: #ffffff;
      --border: #e5e5e5;
      --text-primary: #1a1a1a;
      --text-secondary: #666666;
      --text-muted: #999999;
      --accent: #6366f1;
      --accent-light: #eef2ff;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
      --radius: 12px;
      --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 40px 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    /* Cover */
    .cover {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
      border-radius: var(--radius);
      padding: 48px;
      margin-bottom: 32px;
      color: white;
    }
    .cover-badge {
      display: inline-block;
      background: rgba(255,255,255,0.15);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
    }
    .cover h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 16px;
      line-height: 1.3;
    }
    .cover-summary {
      font-size: 16px;
      opacity: 0.9;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .cover-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      opacity: 0.8;
    }
    .cover-meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: var(--shadow);
    }
    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--accent);
      margin-bottom: 12px;
    }
    .card h2 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text-primary);
    }
    .card p {
      color: var(--text-secondary);
      line-height: 1.7;
    }
    /* Two column grid */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 640px) {
      .two-col { grid-template-columns: 1fr; }
    }
    /* Timeline */
    .timeline {
      position: relative;
      padding-left: 24px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--border);
    }
    .timeline-item {
      position: relative;
      margin-bottom: 20px;
    }
    .timeline-item:last-child { margin-bottom: 0; }
    .timeline-item::before {
      content: '';
      position: absolute;
      left: -20px;
      top: 8px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--surface);
    }
    .timeline-phase {
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .timeline-desc {
      color: var(--text-secondary);
      font-size: 14px;
    }
    /* Table */
    .table-wrapper {
      overflow-x: auto;
      margin: 0 -24px;
      padding: 0 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      text-align: left;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background: var(--bg);
    }
    td { color: var(--text-secondary); }
    td:first-child { color: var(--text-primary); font-weight: 500; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-created { background: #dcfce7; color: #166534; }
    .badge-modified { background: #fef3c7; color: #92400e; }
    .badge-deleted { background: #fee2e2; color: #991b1b; }
    /* Tags */
    .tag {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    .tag-risk { background: #fef3c7; color: #92400e; }
    .tag-next { background: #dbeafe; color: #1e40af; }
    .tag-decision { background: #ede9fe; color: #5b21b6; }
    /* Decisions list */
    .decisions-list {
      list-style: none;
    }
    .decisions-list li {
      position: relative;
      padding-left: 24px;
      margin-bottom: 12px;
      color: var(--text-secondary);
    }
    .decisions-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
    }
    /* Appendix */
    .appendix-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .appendix-item {
      background: var(--bg);
      border-radius: 8px;
      padding: 16px;
    }
    .appendix-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .appendix-value {
      font-size: 14px;
      color: var(--text-primary);
      font-weight: 500;
    }
    .appendix-value.mono {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 12px;
    }
    /* Code blocks */
    pre, code {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    pre {
      background: var(--bg);
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      font-size: 13px;
      margin: 12px 0;
    }
    code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    pre code { background: none; padding: 0; }
    /* Footer */
    .footer {
      text-align: center;
      padding: 32px 0;
      color: var(--text-muted);
      font-size: 12px;
    }
    .footer a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Cover -->
    <div class="cover">
      <div class="cover-badge">AI Conversation Report</div>
      <h1>${escapedTitle}</h1>
      <p class="cover-summary">${escapedOneSentence}</p>
      <div class="cover-meta">
        <div class="cover-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${startedAt}
        </div>
        <div class="cover-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${duration}
        </div>
        <div class="cover-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${session.agent}
        </div>
        <div class="cover-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          ${escapeHtml(session.model)}
        </div>
        ${session.branch ? `<div class="cover-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>${escapeHtml(session.branch)}</div>` : ""}
      </div>
    </div>

    <!-- Background & Goals -->
    <div class="two-col">
      <div class="card">
        <div class="card-title">Background</div>
        <p>${escapedBackground}</p>
      </div>
      <div class="card">
        <div class="card-title">Goals</div>
        <p>${escapedGoals}</p>
      </div>
    </div>

    <!-- Key Process -->
    <div class="card">
      <div class="card-title">Key Process</div>
      <h2>How We Got Here</h2>
      <div class="timeline">
        ${report.processSteps
          .map(
            (step) => `
          <div class="timeline-item">
            <div class="timeline-phase">${escapeHtml(step.phase)}</div>
            <div class="timeline-desc">${escapeHtml(step.description)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>

    <!-- Key Decisions -->
    <div class="card">
      <div class="card-title">Key Decisions</div>
      <h2>Strategic Choices Made</h2>
      <ul class="decisions-list">
        ${report.keyDecisions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}
      </ul>
    </div>

    <!-- File Impact -->
    <div class="card">
      <div class="card-title">File Impact</div>
      <h2>Files Changed</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Responsibility</th>
            </tr>
          </thead>
          <tbody>
            ${report.fileImpact
              .map(
                (f) => `
              <tr>
                <td><code>${escapeHtml(f.path)}</code></td>
                <td><span class="badge badge-${f.type}">${f.type}</span></td>
                <td>${escapeHtml(f.responsibility)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Final Result -->
    <div class="card">
      <div class="card-title">Final Result</div>
      <h2>What Was Achieved</h2>
      <p>${escapedFinalResult}</p>
    </div>

    <!-- Risks & Next Steps -->
    <div class="card">
      <div class="card-title">Risks & Next Steps</div>
      <h2>Moving Forward</h2>
      <div>
        ${report.risksAndNextSteps
          .map((item) => {
            const isRisk =
              item.toLowerCase().includes("risk") ||
              item.toLowerCase().includes("caution") ||
              item.toLowerCase().includes("warning");
            const tagClass = isRisk ? "tag-risk" : "tag-next";
            const tagLabel = isRisk ? "Risk" : "Next";
            return `<span class="tag ${tagClass}">${tagLabel}</span> ${escapeHtml(item)}`;
          })
          .join("<br>")}
      </div>
    </div>

    <!-- Appendix -->
    <div class="card">
      <div class="card-title">Appendix</div>
      <h2>Technical Details</h2>

      <div class="appendix-grid">
        <div class="appendix-item">
          <div class="appendix-label">Tool Calls</div>
          <div class="appendix-value">${report.appendix.toolCallSummary.map((t) => `${t.name}: ${t.count}`).join(", ")}</div>
        </div>
        <div class="appendix-item">
          <div class="appendix-label">Key Commands</div>
          <div class="appendix-value mono">${report.appendix.keyCommands.map((c) => escapeHtml(c)).join("<br>")}</div>
        </div>
        <div class="appendix-item">
          <div class="appendix-label">Project</div>
          <div class="appendix-value">${escapeHtml(session.cwd)}</div>
        </div>
        <div class="appendix-item">
          <div class="appendix-label">Session ID</div>
          <div class="appendix-value mono">${escapeHtml(session.id)}</div>
        </div>
      </div>

      ${
        report.appendix.errorsAndFixes.length > 0
          ? `
        <h3 style="margin-top: 24px; font-size: 14px; font-weight: 600; color: var(--text-primary);">Errors & Fixes</h3>
        <div class="table-wrapper" style="margin-top: 12px;">
          <table>
            <thead>
              <tr><th>Error</th><th>Fix</th></tr>
            </thead>
            <tbody>
              ${report.appendix.errorsAndFixes
                .map(
                  (e) => `
                <tr>
                  <td><code>${escapeHtml(e.error)}</code></td>
                  <td>${escapeHtml(e.fix)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
          : ""
      }
    </div>

    <!-- Footer -->
    <div class="footer">
      Generated by <a href="#">MiWarp</a> &bull; ${startedAt}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Redacts sensitive information from the context before report generation.
 */
export function redactSensitiveData(context: InsightContext): InsightContext {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI API keys
    /sk-ant-[a-zA-Z0-9_-]{20,}/g, // Anthropic API keys
    /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Emails
    /password["\s]*[=:]["\s]*[^\s,}]+/gi, // password=xxx
    /token["\s]*[=:]["\s]*[^\s,}]+/gi, // token=xxx
    /Bearer\s+[a-zA-Z0-9_-]+/g, // Bearer tokens
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub tokens
    /gho_[a-zA-Z0-9]{36}/g, // GitHub OAuth
    /\/.git\//g, // .git paths
  ];

  function redactString(str: string): string {
    let result = str;
    for (const pattern of sensitivePatterns) {
      result = result.replace(pattern, "[REDACTED]");
    }
    // Truncate very long paths
    if (result.length > 500) {
      result = result.slice(0, 500) + "...[TRUNCATED]";
    }
    return result;
  }

  function redactObject<T>(obj: T): T {
    if (typeof obj === "string") {
      return redactString(obj) as T;
    } else if (Array.isArray(obj)) {
      return obj.map(redactObject) as T;
    } else if (obj && typeof obj === "object") {
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        redacted[key] = redactObject(value);
      }
      return redacted as T;
    }
    return obj;
  }

  return redactObject(context);
}

/**
 * Builds the prompt for the AI model to generate the insight report content.
 */
export function buildInsightPrompt(context: InsightContext): string {
  const promptContext = buildInsightPromptContext(context);

  return `You are generating a structured HTML session insight report for MiWarp.

You are NOT exporting a chat log. You are creating a readable HTML report that summarizes an AI coding session.

The report should highlight:
- Goals: What the user wanted to accomplish
- Process: How the session progressed through phases
- Decisions: Key choices made during the session
- Impact: What files were changed and why
- Next steps: What remains to be done

Please generate a JSON report with this exact structure:
{
  "title": "Brief session title",
  "oneSentenceSummary": "One sentence describing what was accomplished",
  "background": "Why this task matters or what context led to it",
  "goals": "What the user originally wanted to accomplish",
  "keyDecisions": ["Decision 1", "Decision 2"],
  "processSteps": [
    {"phase": "Phase name", "description": "What happened in this phase"}
  ],
  "fileImpact": [
    {"path": "/file/path", "type": "created|modified|deleted", "responsibility": "What this file does"}
  ],
  "finalResult": "Current state of implementation",
  "risksAndNextSteps": ["Risk or next step 1", "Risk or next step 2"],
  "appendix": {
    "toolCallSummary": [{"name": "ToolName", "count": 5}],
    "keyCommands": ["command1", "command2"],
    "errorsAndFixes": [{"error": "error message", "fix": "how it was resolved"}]
  }
}

IMPORTANT:
- Be concise but informative
- Focus on what matters, not every detail
- Use proper JSON with double quotes
- fileImpact type must be exactly: "created", "modified", or "deleted"
- processSteps should be 3-6 key phases
- keyDecisions should be 2-5 major decisions
- risksAndNextSteps should be 2-5 items
- Omit boring details, errors with no fixes, and repetitive tool calls

Session data:
${promptContext}`;
}
