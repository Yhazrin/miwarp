import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  mergeWithVirtual,
  mergeProjectCommands,
  buildHelpText,
  parseRalphArgs,
} from "$lib/utils/slash-commands";
import { executeAddDir } from "$lib/utils/add-dir";
import { buildDoctorReport } from "$lib/utils/doctor";
import { getCliCommands } from "$lib/stores";
import type { TimelineEntry, CliCommand, Attachment } from "$lib/types";
import type { SessionStore } from "$lib/stores/session-store.svelte";

export interface VirtualCommandContext {
  store: SessionStore;
  appendCommandOutput: (text: string) => void;
  sendMessage: (text: string, attachments: Attachment[]) => Promise<void>;
  handleRename: (name: string) => Promise<void>;
  handlePermissionModeChange: (mode: string, opts: { toast: boolean }) => Promise<boolean>;
  handleFastModeSwitch: (mode: "on" | "off") => Promise<void>;
  handleRalphCancel: () => Promise<void>;
  handleRewind: () => void;
  openPreviewInSidebar: (url?: string) => void;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  sidebarRequestedTab: unknown;
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  projectCommands: CliCommand[];
  t: (key: string, params?: Record<string, string>) => string;
}

export function handleVirtualCommand(
  ctx: VirtualCommandContext,
  action: string,
  args: string,
): Promise<void> {
  return _handleVirtualCommand(ctx, action, args);
}

async function _handleVirtualCommand(
  ctx: VirtualCommandContext,
  action: string,
  args: string,
): Promise<void> {
  const {
    store,
    appendCommandOutput,
    sendMessage,
    handleRename,
    handlePermissionModeChange,
    handleFastModeSwitch,
    handleRalphCancel,
    handleRewind,
    openPreviewInSidebar,
    toggleSidebar,
    sidebarCollapsed,
    /* sidebarRequestedTab removed — unused */
    goto,
    projectCommands,
    t,
  } = ctx;

  dbg("chat", "virtualCommand", { action, args });

  if (action === "copy-last") {
    const lastAssistant = [...store.timeline].reverse().find((e) => e.kind === "assistant");
    if (lastAssistant && lastAssistant.kind === "assistant" && lastAssistant.content) {
      try {
        await navigator.clipboard.writeText(lastAssistant.content);
        const chars = lastAssistant.content.length;
        const lines = lastAssistant.content.split("\n").length;
        appendCommandOutput(
          t("chat_copiedClipboard", { chars: String(chars), lines: String(lines) }),
        );
        dbg("chat", "copied last response", { chars, lines });
      } catch (e) {
        dbgWarn("chat", "copy failed", e);
        appendCommandOutput(t("chat_copyFailed"));
      }
    } else {
      appendCommandOutput(t("chat_noResponseToCopy"));
    }
  } else if (action === "rename-session") {
    if (!store.run) {
      appendCommandOutput(t("chat_noSessionToRename"));
      return;
    }
    if (args) {
      await handleRename(args);
      appendCommandOutput(t("chat_sessionRenamed", { name: args }));
    } else if (store.sessionAlive) {
      await sendMessage("/rename", []);
    } else {
      appendCommandOutput("Usage: /rename <name>");
    }
  } else if (action === "toggle-plan") {
    const entering = store.permissionMode !== "plan";
    const newMode = entering ? "plan" : "default";
    const ok = await handlePermissionModeChange(newMode, { toast: false });
    if (ok) {
      appendCommandOutput(entering ? "Plan mode enabled" : "Plan mode disabled");
      if (args && entering) {
        await sendMessage(args, []);
      }
    }
  } else if (action === "show-help") {
    const allCmds = mergeWithVirtual(
      store.sessionInitReceived && store.sessionCommands.length > 0
        ? store.sessionCommands
        : mergeProjectCommands(getCliCommands(), projectCommands),
    );
    const skillSet = new Set<string>(store.availableSkills);
    appendCommandOutput(buildHelpText(allCmds, skillSet));
  } else if (action === "run-doctor") {
    try {
      dbg("doctor", "run-doctor triggered", { cwd: store.effectiveCwd });
      const cwd = store.effectiveCwd || localStorage.getItem("ocv:project-cwd") || "";
      const mcpSvrs = store.sessionAlive ? store.mcpServers : undefined;
      const report = await buildDoctorReport(cwd, mcpSvrs);
      appendCommandOutput(report);
    } catch (err) {
      dbgWarn("doctor", "run_diagnostics failed", err);
      appendCommandOutput(
        `❌ ${t("doctor_failed")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (action === "show-status") {
    if (sidebarCollapsed) toggleSidebar();
    ctx.sidebarRequestedTab = "info";
  } else if (action === "list-todos") {
    const esc = (s: string) => s.replace(/([\\*_~`[\]#>|])/g, "\\$1");
    const lastTodo = [...store.timeline]
      .reverse()
      .find(
        (e): e is Extract<TimelineEntry, { kind: "tool" }> =>
          e.kind === "tool" &&
          e.tool.tool_name === "TodoWrite" &&
          e.tool.status === "success" &&
          e.tool.tool_use_result != null &&
          typeof e.tool.tool_use_result === "object" &&
          "newTodos" in e.tool.tool_use_result &&
          Array.isArray(e.tool.tool_use_result.newTodos),
      );
    if (lastTodo) {
      const todos = lastTodo.tool.tool_use_result!.newTodos as Array<{
        content: string;
        status: "pending" | "in_progress" | "completed";
      }>;
      if (todos.length === 0) {
        appendCommandOutput(t("todos_empty"));
      } else {
        const lines = todos.map((td) => {
          const text = esc(td.content);
          if (td.status === "completed") return `- [x] ~~${text}~~`;
          if (td.status === "in_progress") return `- [ ] **⏳ ${text}**`;
          return `- [ ] ${text}`;
        });
        appendCommandOutput(lines.join("\n"));
      }
    } else {
      appendCommandOutput(t("todos_empty"));
    }
  } else if (action === "show-diff") {
    await handleShowDiff(ctx);
  } else if (action === "list-tasks") {
    await handleListTasks(ctx, args);
  } else if (action === "toggle-fast") {
    const arg = args.toLowerCase();
    if (arg === "on" || arg === "off") {
      await handleFastModeSwitch(arg);
    } else if (arg === "") {
      const enabling = store.fastModeState !== "on";
      await handleFastModeSwitch(enabling ? "on" : "off");
    } else {
      appendCommandOutput(t("fast_usage"));
    }
  } else if (action === "add-dir") {
    try {
      await executeAddDir(
        { agent: store.agent, sessionAlive: store.sessionAlive, args },
        {
          openDirectoryDialog: async (title: string) => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const result = await open({ directory: true, title });
            return typeof result === "string" ? result : null;
          },
          sendMessage: (text: string) => sendMessage(text, []),
          getAgentSettings: api.getAgentSettings,
          updateAgentSettings: api.updateAgentSettings,
          appendOutput: appendCommandOutput,
          t: t as (key: string, params?: Record<string, string>) => string,
        },
      );
    } catch (err) {
      dbgWarn("chat", "add-dir failed", err);
      appendCommandOutput(
        t("chat_addDirFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  } else if (action === "clear-context") {
    if (!store.run || !store.sessionAlive) {
      appendCommandOutput(t("chat_noActiveSession"));
      return;
    }
    if (!store.useStreamSession) {
      appendCommandOutput(t("chat_clearNotSupported"));
      return;
    }
    if (store.isRunning) {
      appendCommandOutput(t("chat_clearSessionBusy"));
      return;
    }
    dbg("chat", "clear-context: stopping session", { runId: store.run.id });
    try {
      await store.stop();
      dbg("chat", "clear-context: navigating to fresh chat");
      goto("/chat", { replaceState: true });
      window.dispatchEvent(new Event("ocv:runs-changed"));
    } catch (e) {
      dbgWarn("chat", "clear-context failed", e);
      store.error = String(e);
    }
  } else if (action === "rewind") {
    if (!store.run) {
      appendCommandOutput(t("rewind_noSession"));
    } else if (!store.sessionAlive) {
      appendCommandOutput(t("rewind_sessionEnded"));
    } else if (store.isRunning) {
      appendCommandOutput(t("rewind_sessionBusy"));
    } else {
      handleRewind();
    }
  } else if (action === "open-permissions") {
    window.dispatchEvent(new CustomEvent("ocv:open-permissions"));
  } else if (action === "open-stickers") {
    const url = "https://www.stickermule.com/claudecode";
    dbg("chat", "open-stickers", { url });
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (err) {
      dbgWarn("chat", "open-stickers: plugin-shell failed, fallback", err);
      window.open(url, "_blank");
    }
    appendCommandOutput("Opening sticker page in browser…");
  } else if (action === "start-ralph-loop") {
    const parsed = parseRalphArgs(args);
    if (!parsed.prompt) {
      appendCommandOutput(
        "Usage: /ralph <prompt> [--max-iterations N] [--completion-promise TEXT]",
      );
      return;
    }
    try {
      if (!store.run?.id || !store.sessionAlive) {
        await sendMessage(parsed.prompt, []);
        let retries = 0;
        while (!store.sessionAlive && retries < 20) {
          await new Promise((r) => setTimeout(r, 100));
          retries++;
        }
        if (!store.run?.id || !store.sessionAlive) {
          appendCommandOutput("Failed to start session for ralph loop.");
          return;
        }
      }
      await api.startRalphLoop(
        store.run.id,
        parsed.prompt,
        parsed.maxIterations,
        parsed.completionPromise,
      );
      appendCommandOutput(
        `Ralph loop started (max: ${parsed.maxIterations || "unlimited"}, promise: ${parsed.completionPromise ?? "none"})`,
      );
    } catch (err) {
      appendCommandOutput(
        `Failed to start loop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (action === "cancel-ralph-loop") {
    await handleRalphCancel();
  } else if (action === "toggle-preview") {
    openPreviewInSidebar(args);
  }
}

async function handleShowDiff(ctx: VirtualCommandContext): Promise<void> {
  const { store, appendCommandOutput, t } = ctx;
  const cwd = store.effectiveCwd || localStorage.getItem("ocv:project-cwd") || "";
  if (!cwd) {
    appendCommandOutput(t("diff_noCwd"));
    return;
  }
  try {
    dbg("chat", "show-diff", { cwd });
    const [unstaged, staged] = await Promise.all([
      api.getGitDiff(cwd, false),
      api.getGitDiff(cwd, true),
    ]);
    if (!unstaged.trim() && !staged.trim()) {
      appendCommandOutput(t("diff_noChanges"));
      return;
    }
    function addLineNumbers(raw: string): string {
      const lines = raw.split("\n");
      const out: string[] = [];
      let oldLn = 0,
        newLn = 0;
      for (const line of lines) {
        if (line.startsWith("@@")) {
          const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (m) {
            oldLn = parseInt(m[1]);
            newLn = parseInt(m[2]);
          }
          out.push(line);
        } else if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("--- ") ||
          line.startsWith("+++ ")
        ) {
          out.push(line);
        } else if (line.startsWith("+")) {
          out.push(`+${String(newLn).padStart(4)} │ ${line.slice(1)}`);
          newLn++;
        } else if (line.startsWith("-")) {
          out.push(`-${String(oldLn).padStart(4)} │ ${line.slice(1)}`);
          oldLn++;
        } else if (line.length > 0 && line[0] === " ") {
          out.push(` ${String(newLn).padStart(4)} │ ${line.slice(1)}`);
          oldLn++;
          newLn++;
        } else {
          out.push(line);
        }
      }
      return out.join("\n");
    }
    const parts: string[] = [];
    if (unstaged.trim()) {
      parts.push(
        `### ${t("diff_unstaged")}\n\n\`\`\`diff\n${addLineNumbers(unstaged.trimEnd())}\n\`\`\``,
      );
    }
    if (staged.trim()) {
      parts.push(
        `### ${t("diff_staged")}\n\n\`\`\`diff\n${addLineNumbers(staged.trimEnd())}\n\`\`\``,
      );
    }
    appendCommandOutput(parts.join("\n\n"));
  } catch (err) {
    dbgWarn("chat", "show-diff failed", err);
    appendCommandOutput(`${t("diff_failed")}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleListTasks(ctx: VirtualCommandContext, args: string): Promise<void> {
  const { store, appendCommandOutput, t } = ctx;
  const tasks = [...store.taskNotifications.values()];

  if (!args) {
    dbg("chat", "list-tasks", { count: store.taskNotifications.size });
    if (tasks.length === 0) {
      appendCommandOutput(t("slashTasks_empty"));
      return;
    }
    const sorted = tasks.sort((a, b) => {
      const aActive =
        a.status !== "completed" && a.status !== "failed" && a.status !== "error" ? 1 : 0;
      const bActive =
        b.status !== "completed" && b.status !== "failed" && b.status !== "error" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.startedAt - a.startedAt;
    });
    const now = Date.now();
    const elapsed = (ms: number) => {
      const sec = Math.floor((now - ms) / 1000);
      if (sec < 60) return `${sec}s`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m`;
      return `${Math.floor(min / 60)}h${min % 60}m`;
    };
    const lines: string[] = [
      "| ID | Type | Status | Description | Elapsed |",
      "|-----|------|--------|-------------|---------|",
    ];
    for (const task of sorted) {
      const shortId = task.task_id.length > 12 ? task.task_id.slice(0, 12) + "…" : task.task_id;
      const taskType = task.task_type || "—";
      const desc =
        (task.summary || task.message || "").length > 50
          ? (task.summary || task.message || "").slice(0, 50) + "…"
          : task.summary || task.message || "—";
      lines.push(
        `| \`${shortId}\` | ${taskType} | ${task.status} | ${desc} | ${elapsed(task.startedAt)} |`,
      );
    }
    lines.push("");
    lines.push(t("slashTasks_hint"));
    appendCommandOutput(lines.join("\n"));
  } else {
    dbg("chat", "list-tasks:detail", { id: args });
    let matches = tasks.filter((tk) => tk.task_id === args);
    if (matches.length === 0) {
      matches = tasks.filter((tk) => tk.task_id.startsWith(args));
    }
    if (matches.length === 0) {
      dbg("chat", "list-tasks:detail", { id: args, found: false });
      appendCommandOutput(t("slashTasks_notFound", { id: args }));
    } else if (matches.length === 1) {
      const task = matches[0];
      const hasOutput = !!task.output_file;
      dbg("chat", "list-tasks:detail", { id: args, found: true, hasOutput });
      const now = Date.now();
      const sec = Math.floor((now - task.startedAt) / 1000);
      const meta = [
        `| Field | Value |`,
        `|-------|-------|`,
        `| ID | \`${task.task_id}\` |`,
        `| Status | ${task.status} |`,
        `| Type | ${task.task_type || "—"} |`,
        `| Description | ${task.message || "—"} |`,
        task.summary ? `| Summary | ${task.summary} |` : null,
        `| Elapsed | ${sec}s |`,
        task.output_file ? `| Output file | \`${task.output_file}\` |` : null,
      ]
        .filter(Boolean)
        .join("\n");

      if (task.output_file) {
        try {
          const raw = await api.readTaskOutput(task.output_file);
          dbg("chat", "readTaskOutput", { path: task.output_file, ok: true });
          const allLines = raw.split("\n");
          const trimmed =
            allLines.length > 200
              ? `... (${allLines.length - 200} lines truncated)\n${allLines.slice(-200).join("\n")}`
              : raw;
          appendCommandOutput(`${meta}\n\n**Output:**\n\`\`\`\n${trimmed}\n\`\`\``);
        } catch (err) {
          dbgWarn("chat", "readTaskOutput failed", err);
          appendCommandOutput(
            `${meta}\n\n${t("slashTasks_outputError", { error: err instanceof Error ? err.message : String(err) })}`,
          );
        }
      } else {
        appendCommandOutput(meta);
      }
    } else {
      const list = matches.map((m) => `- \`${m.task_id}\` (${m.status})`).join("\n");
      appendCommandOutput(`${t("slashTasks_ambiguous", { id: args })}\n${list}`);
    }
  }
}
