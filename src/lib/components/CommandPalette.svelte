<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    filterCommands,
    groupByCategory,
    categoryLabels,
    getRecentCommands,
    recordRecentCommand,
    getCommandUsageStats,
    matchNLQuery,
    getNLCandidates,
    type CommandDef,
    type CommandCategory,
  } from "$lib/commands";
  import { multiFieldFuzzyMatch } from "$lib/utils/fuzzy";
  import * as api from "$lib/api";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";
  import { getIcon, commandIconMap } from "$lib/icons";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fade, fly } from "svelte/transition";

  let {
    open = $bindable(false),
    agent = "claude",
    runId = "",
    cwd = "/",
    onSendPrompt,
    onTogglePlanMode,
    onOpenModelSelector,
    onOpenFolderBrowser,
  }: {
    open: boolean;
    agent?: string;
    runId?: string;
    cwd?: string;
    onSendPrompt?: (prompt: string) => void;
    onTogglePlanMode?: () => void;
    onOpenModelSelector?: () => void;
    onOpenFolderBrowser?: () => void;
  } = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let previewContent = $state<string | null>(null);
  let hoveredCmdId = $state<string | null>(null);
  let searchMode = $state<"basic" | "fuzzy" | "nl">("basic");
  let _nlMatchResult = $state<CommandDef | null>(null);

  // Compute flat list with fuzzy scores
  let flatListWithScores = $derived.by(() => {
    const q = query.trim();
    const usageStats = getCommandUsageStats();

    // Check for natural language match first
    if (q && searchMode === "nl") {
      const nlMatch = matchNLQuery(q);
      if (nlMatch) {
        _nlMatchResult = nlMatch;
        return [{ cmd: nlMatch, score: 100 }]; // Highest priority for NL match
      }
      _nlMatchResult = null;
    }

    // Get NL candidates for suggestions
    const nlCandidates = searchMode === "nl" ? getNLCandidates(q) : [];

    // Get base filtered commands
    let cmds = filterCommands(q, agent);

    if (!q) {
      // No query: return with default score (usage-based sorting from filterCommands)
      return cmds.map((cmd) => ({
        cmd,
        score: usageStats[cmd.id] || 0,
      }));
    }

    // Apply fuzzy scoring for better matching
    return cmds.map((cmd) => {
      const fields: Record<string, string> = {
        name: cmd.name,
        description: cmd.description,
        id: cmd.id,
        ...Object.fromEntries((cmd.fuzzyKeywords || []).map((kw, i) => [`kw${i}`, kw])),
      };

      const weights: Record<string, number> = {
        name: 1.5,
        description: 1.0,
        id: 0.5,
      };

      const result = multiFieldFuzzyMatch(q, fields, { weights, threshold: 0.2 });
      const usage = usageStats[cmd.id] || 0;

      // Boost score if this command appears in NL candidates
      const nlBoost = nlCandidates.find((c) => c.id === cmd.id) ? 20 : 0;

      // Combined score: fuzzy score + usage bonus + NL boost
      return {
        cmd,
        score: result.matched ? result.score * 10 + usage * 0.5 + nlBoost : 0,
      };
    });
  });

  // Sort by score
  let flatList = $derived(
    [...flatListWithScores].sort((a, b) => b.score - a.score).map((item) => item.cmd),
  );

  let recentCommands = $derived(getRecentCommands(agent));
  let showRecent = $derived(!query && recentCommands.length > 0);
  let grouped = $derived(groupByCategory(flatList));

  // Reset on open
  $effect(() => {
    if (open) {
      query = "";
      selectedIndex = 0;
      previewContent = null;
      hoveredCmdId = null;
      searchMode = "basic";
      _nlMatchResult = null;
      requestAnimationFrame(() => inputEl?.focus());
    }
  });

  // Clear preview when query changes or selection changes
  $effect(() => {
    // Track changes to reset preview
    void query;
    void selectedIndex;
    previewContent = null;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      open = false;
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, indexMap.size - 1);
      scrollToSelected();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
      return;
    }
    if (e.key === "Enter" && indexMap.size > 0) {
      e.preventDefault();
      executeCommand(commandByIndex[selectedIndex]);
      return;
    }
    if (e.key === "Tab" && hoveredCmdId) {
      // Preview command on Tab
      e.preventDefault();
      showCommandPreview(
        flatList.find((c) => c.id === hoveredCmdId) || commandByIndex[selectedIndex],
      );
      return;
    }
    // Toggle fuzzy mode with Ctrl+F, NL mode with Ctrl+N
    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      searchMode = searchMode === "fuzzy" ? "basic" : "fuzzy";
      return;
    }
    if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      searchMode = searchMode === "nl" ? "basic" : "nl";
      return;
    }
  }

  function scrollToSelected() {
    const el = document.querySelector(`[data-cmd-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function showCommandPreview(cmd: CommandDef) {
    if (!cmd) return;

    // Generate preview based on action type
    let preview = "";
    switch (cmd.action) {
      case "navigate":
        preview = `${t("cmd_previewNavigate")}: ${cmd.payload || "/"}`;
        break;
      case "send_prompt":
        preview = `${t("cmd_previewSendPrompt")}: ${cmd.payload?.slice(0, 60)}${cmd.payload && cmd.payload.length > 60 ? "..." : ""}`;
        break;
      case "toggle_state":
        preview = cmd.payload === "plan_mode" ? t("cmd_previewTogglePlan") : `${t("cmd_previewToggleState")}: ${cmd.payload}`;
        break;
      case "open_modal": {
        const modalNames: Record<string, string> = {
          "model-selector": t("cmd_modalModelSelector"),
          "folder-browser": t("cmd_modalFolderBrowser"),
          "version-info": t("cmd_modalVersionInfo"),
          permissions: t("cmd_modalPermissions"),
        };
        preview = `${t("cmd_previewOpen")}: ${modalNames[cmd.payload || ""] || cmd.payload}`;
        break;
      }
      case "ipc_command": {
        const ipcNames: Record<string, string> = {
          get_git_diff: t("cmd_ipcGitDiff"),
          get_git_status: t("cmd_ipcGitStatus"),
          get_run_artifacts: t("cmd_ipcRunArtifacts"),
          export_conversation: t("cmd_ipcExportMd"),
          export_conversation_html: t("cmd_ipcExportHtml"),
          stop_run: t("cmd_ipcStopRun"),
          check_agent_cli: t("cmd_ipcCheckCli"),
        };
        preview = `${t("cmd_previewExecute")}: ${ipcNames[cmd.payload || ""] || cmd.payload}`;
        break;
      }
      case "panel:multi-agent":
        preview = t("cmd_previewMultiAgent");
        break;
      case "preset:fullstack":
        preview = `🚀 ${t("cmd_previewFullstack")}`;
        break;
      case "preset:review":
        preview = `🔍 ${t("cmd_previewReview")}`;
        break;
      case "preset:test":
        preview = `🧪 ${t("cmd_previewTest")}`;
        break;
      case "preset:docs":
        preview = `📝 ${t("cmd_previewDocs")}`;
        break;
      default:
        if (cmd.payload) {
          preview = `${t("cmd_previewExecute")}: ${cmd.payload}`;
        }
    }

    // Add shortcut hint if available
    if (cmd.shortcut) {
      preview += ` [${cmd.shortcut}]`;
    }

    // Add permission hint
    if (requiresPermission(cmd)) {
      preview += ` ⚠️ ${t("cmd_requiresConfirm")}`;
    }

    previewContent = preview;
  }

  function requiresPermission(cmd: CommandDef): boolean {
    const permissionRequiredActions = ["ipc_command", "send_prompt", "panel:multi-agent"];
    return permissionRequiredActions.includes(cmd.action) && cmd.action !== "navigate";
  }

  async function executeCommand(cmd: CommandDef) {
    open = false;
    recordRecentCommand(cmd.id);
    previewContent = null;

    switch (cmd.action) {
      case "navigate":
        if (cmd.payload) goto(cmd.payload);
        break;

      case "send_prompt":
        if (cmd.payload) onSendPrompt?.(cmd.payload);
        break;

      case "toggle_state":
        if (cmd.payload === "plan_mode") onTogglePlanMode?.();
        break;

      case "open_modal":
        if (cmd.payload === "model-selector") onOpenModelSelector?.();
        else if (cmd.payload === "folder-browser") onOpenFolderBrowser?.();
        else if (cmd.payload === "version-info") showVersionInfo();
        else if (cmd.payload === "permissions") {
          window.dispatchEvent(new CustomEvent("ocv:open-permissions"));
        }
        break;

      case "ipc_command":
        await handleIpcCommand(cmd);
        break;

      case "panel:multi-agent":
        window.dispatchEvent(new CustomEvent("ocv:open-multi-agent"));
        break;

      case "preset:fullstack":
      case "preset:review":
      case "preset:test":
      case "preset:docs":
        // Dispatch preset command
        window.dispatchEvent(new CustomEvent("miwarp:execute-preset", { detail: cmd.action }));
        break;
    }
  }

  async function handleIpcCommand(cmd: CommandDef) {
    switch (cmd.payload) {
      case "get_git_diff":
        try {
          const diff = await api.getGitDiff(cwd, false);
          showResultModal(t("cmd_gitDiff"), diff || t("cmd_noChanges"));
        } catch (e) {
          showResultModal(t("cmd_error"), String(e));
        }
        break;

      case "get_git_status":
        try {
          const status = await api.getGitStatus(cwd);
          showResultModal(t("cmd_gitStatus"), status || t("cmd_workingTreeClean"));
        } catch (e) {
          showResultModal(t("cmd_error"), String(e));
        }
        break;

      case "get_run_artifacts":
        if (runId) {
          try {
            const a = await api.getRunArtifacts(runId);
            const info = [
              `${t("cmd_artifactCost")}: ${a.cost_estimate != null ? "$" + a.cost_estimate.toFixed(4) : "N/A"}`,
              `${t("cmd_artifactFiles")}: ${a.files_changed.length}`,
              `${t("cmd_artifactCommands")}: ${a.commands.length}`,
            ].join("\n");
            showResultModal(t("cmd_runInfo"), info);
          } catch (e) {
            showResultModal(t("cmd_error"), String(e));
          }
        }
        break;

      case "export_conversation":
        if (runId) {
          try {
            const md = await api.exportConversation(runId);
            const { save } = await import("@tauri-apps/plugin-dialog");
            const path = await save({
              defaultPath: `conversation-${runId.slice(0, 8)}.md`,
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (path) await api.writeTextFile(path, md);
          } catch (e) {
            dbgWarn("cmd", "command error", e);
          }
        }
        break;

      case "export_conversation_html": {
        dbg("palette", "dispatching ocv:export-html");
        let acked = false;
        const onAck = () => {
          acked = true;
        };
        window.addEventListener("ocv:export-html-ack", onAck, { once: true });
        window.dispatchEvent(new CustomEvent("ocv:export-html"));
        setTimeout(() => {
          window.removeEventListener("ocv:export-html-ack", onAck);
          if (!acked) dbgWarn("palette", "export-html: no ack — not on chat page?");
        }, 500);
        break;
      }

      case "stop_run":
        if (runId) {
          try {
            await api.stopRun(runId);
          } catch (e) {
            dbgWarn("cmd", "stop_run error", e);
          }
        }
        break;

      case "check_agent_cli":
        try {
          const claude = await api.checkAgentCli("claude");
          const lines = [
            `Claude: ${claude.found ? t("cmd_cliInstalled") : t("cmd_cliNotFound")}`,
            claude.path ? `  ${t("cmd_cliPath")}: ${claude.path}` : "",
            claude.version ? `  ${t("cmd_cliVersion")}: ${claude.version}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          showResultModal(t("cmd_doctor"), lines);
        } catch (e) {
          showResultModal(t("cmd_error"), String(e));
        }
        break;
    }
  }

  // Simple result modal state
  let resultModalOpen = $state(false);
  let resultModalTitle = $state("");
  let resultModalContent = $state("");

  function showResultModal(title: string, content: string) {
    resultModalTitle = title;
    resultModalContent = content;
    resultModalOpen = true;
  }

  function showVersionInfo() {
    showResultModal(t("cmd_versionInfo"), t("cmd_versionContent"));
  }

  // Compute global index for each command in grouped view
  let indexMap = $derived.by(() => {
    const map = new Map<string, number>();
    let idx = 0;
    const categoryOrder: CommandCategory[] = [
      "chat",
      "tools",
      "navigation",
      "settings",
      "diagnostics",
    ];
    if (showRecent) {
      for (const cmd of recentCommands) {
        if (!map.has(cmd.id)) map.set(cmd.id, idx++);
      }
    }
    for (const cat of categoryOrder) {
      for (const cmd of grouped[cat]) {
        if (!map.has(cmd.id)) map.set(cmd.id, idx++);
      }
    }
    return map;
  });

  // Reverse lookup: visual index → command
  let commandByIndex = $derived.by(() => {
    const arr: CommandDef[] = new Array(indexMap.size);
    for (const [id, idx] of indexMap) {
      const cmd = recentCommands.find((c) => c.id === id) || flatList.find((c) => c.id === id);
      if (cmd) arr[idx] = cmd;
    }
    return arr;
  });

  // Get icon for command
  function getCommandIcon(cmd: CommandDef): string {
    const iconName = commandIconMap[cmd.id];
    if (iconName) {
      return getIcon(iconName);
    }
    // Fallback to built-in search icon
    return getIcon("search");
  }

  // Handle mouse enter for preview
  function handleMouseEnter(cmd: CommandDef) {
    hoveredCmdId = cmd.id;
    showCommandPreview(cmd);
  }

  function handleMouseLeave() {
    hoveredCmdId = null;
    previewContent = null;
  }

  // Helper to get search mode label
  let searchModeLabel = $derived.by(() => {
    switch (searchMode) {
      case "fuzzy":
        return t("cmd_searchFuzzy");
      case "nl":
        return t("cmd_searchSemantic");
      default:
        return t("cmd_searchExact");
    }
  });

  // Get usage count for a command
  function getCommandUsageCount(cmdId: string): number {
    try {
      const raw = localStorage.getItem("miwarp:command-usage-stats");
      if (!raw) return 0;
      const stats = JSON.parse(raw);
      return stats[cmdId] || 0;
    } catch {
      return 0;
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 bg-miwarp-overlay backdrop-blur-sm"
      transition:fade={{ duration: 150 }}
      onclick={() => (open = false)}
      onkeydown={(e) => {
        if (e.key === "Escape" || e.key === "Enter" || e.key === " ") open = false;
      }}
    ></div>

    <!-- Palette Container -->
    <div class="relative z-50 w-full max-w-xl">
      <!-- Main Palette -->
      <div class="rounded-lg border bg-background shadow-2xl overflow-hidden"
        transition:fly={{ y: -10, duration: 200 }}>
        <!-- Search -->
        <div class="flex items-center gap-3 border-b px-4 py-3">
          <span class="text-muted-foreground shrink-0">{@html getIcon("search")}</span>
          <input
            bind:this={inputEl}
            bind:value={query}
            onkeydown={handleKeydown}
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t("cmd_placeholder")}
            aria-label={t("cmd_placeholder")}
          />
          <div class="flex items-center gap-2">
            {#if previewContent}
              <span
                class="text-xs text-muted-foreground bg-muted px-2 py-1 rounded animate-fade-in max-w-[200px] truncate"
                title={previewContent}
              >
                {previewContent}
              </span>
            {/if}
            <!-- Search mode indicator -->
            <button
              class="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 hover:bg-accent transition-colors"
              onclick={() => {
                // Cycle through: basic -> fuzzy -> nl -> basic
                const modes: Array<"basic" | "fuzzy" | "nl"> = ["basic", "fuzzy", "nl"];
                const currentIdx = modes.indexOf(searchMode);
                searchMode = modes[(currentIdx + 1) % modes.length];
              }}
              title={t("cmd_searchModeTooltip")}
            >
              {searchModeLabel}
            </button>
            <kbd class="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5"
              >{t("cmd_esc")}</kbd
            >
          </div>
        </div>

        <!-- Results -->
        <div class="max-h-[40vh] overflow-y-auto p-2">
          {#if showRecent}
            <div class="mb-1">
              <p
                class="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("cmd_cat_recent")}
              </p>
              {#each recentCommands as cmd (cmd.id)}
                {@const idx = indexMap.get(cmd.id) ?? 0}
                {@const usage = getCommandUsageCount(cmd.id)}
                <button
                  data-cmd-idx={idx}
                  class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors
                    {idx === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'}"
                  onclick={() => executeCommand(cmd)}
                  onmouseenter={() => handleMouseEnter(cmd)}
                  onmouseleave={handleMouseLeave}
                >
                  <span class="flex-1 text-left">{cmd.name}</span>
                  <span class="text-xs text-muted-foreground">{cmd.description}</span>
                  {#if usage > 0}
                    <span class="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5">
                      {usage}×
                    </span>
                  {/if}
                  {#if cmd.shortcut}
                    <kbd class="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5"
                      >{cmd.shortcut}</kbd
                    >
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          {#each ["chat", "tools", "navigation", "settings", "diagnostics"] as cat (cat)}
            {#if grouped[cat as CommandCategory].length > 0}
              <div class="mb-1">
                <p
                  class="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {categoryLabels[cat as CommandCategory]}
                </p>
                {#each grouped[cat as CommandCategory] as cmd (cmd.id)}
                  {@const idx = indexMap.get(cmd.id) ?? 0}
                  {@const usage = getCommandUsageCount(cmd.id)}
                  <button
                    data-cmd-idx={idx}
                    class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors
                      {idx === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'}"
                    onclick={() => executeCommand(cmd)}
                    onmouseenter={() => handleMouseEnter(cmd)}
                    onmouseleave={handleMouseLeave}
                  >
                    <!-- Icon -->
                    <span
                      class="flex h-5 w-5 items-center justify-center shrink-0 text-muted-foreground [&_svg]:w-4 [&_svg]:h-4"
                    >
                      {@html getCommandIcon(cmd)}
                    </span>

                    <!-- Name -->
                    <span class="flex-1 text-left font-medium">{cmd.name}</span>

                    <!-- Description -->
                    <span class="text-xs text-muted-foreground truncate max-w-[120px]">
                      {cmd.description}
                    </span>

                    <!-- Usage count -->
                    {#if usage > 0}
                      <span
                        class="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 shrink-0"
                      >
                        {usage}×
                      </span>
                    {/if}

                    <!-- Shortcut -->
                    {#if cmd.shortcut}
                      <kbd
                        class="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0"
                      >
                        {cmd.shortcut}
                      </kbd>
                    {/if}

                    <!-- Permission indicator -->
                    {#if requiresPermission(cmd) && idx === selectedIndex}
                      <span
                        class="text-[10px] text-miwarp-status-warning shrink-0"
                        title={t("cmd_requiresConfirm")}
                      >
                        ⚠️
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          {/each}

          {#if indexMap.size === 0}
            <EmptyState
              icon="🔍"
              title={query ? t("cmd_noCommandsFound") : t("cmd_noCommandsAvailable")}
              class="py-6"
            />
          {/if}
        </div>

        <!-- Footer hint -->
        <div
          class="border-t px-4 py-2 flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>{t("cmd_footerHints")}</span>
          {#if indexMap.size > 0}
            <span>{t("cmd_footerCount", { count: indexMap.size.toString() })}</span>
          {/if}
        </div>
      </div>

      <!-- Quick Actions Bar (Claude Code style) -->
      <div class="mt-2 flex items-center gap-2 px-1">
        <button
          class="flex items-center gap-1.5 rounded-md bg-accent/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          onclick={() => {
            open = false;
            window.dispatchEvent(new CustomEvent("miwarp:open-workflows"));
          }}
        >
          <span>⚡</span>
          <span>{t("cmd_quickWorkflows")}</span>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-md bg-accent/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          onclick={() => {
            open = false;
            window.dispatchEvent(new CustomEvent("miwarp:open-skills"));
          }}
        >
          <span>🧩</span>
          <span>{t("cmd_quickSkills")}</span>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-md bg-accent/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          onclick={() => {
            open = false;
            window.dispatchEvent(new CustomEvent("miwarp:open-history"));
          }}
        >
          <span>📜</span>
          <span>{t("cmd_quickHistory")}</span>
        </button>
        <!-- Natural language shortcut -->
        <button
          class="flex items-center gap-1.5 rounded-md bg-[hsl(var(--miwarp-accent-primary)/0.15)] px-3 py-1.5 text-xs text-miwarp-accent-primary hover:bg-[hsl(var(--miwarp-accent-primary)/0.25)] transition-colors"
          onclick={() => {
            searchMode = "nl";
            inputEl?.focus();
          }}
          title={t("cmd_semanticTooltip")}
        >
          <span>✨</span>
          <span>{t("cmd_searchSemantic")}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Result modal -->
{#if resultModalOpen}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => {
      if (e.key === "Escape") resultModalOpen = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 bg-miwarp-overlay backdrop-blur-sm"
      onclick={() => (resultModalOpen = false)}
      onkeydown={(e) => e.key === "Escape" && (resultModalOpen = false)}
    ></div>
    <div
      class="relative z-[60] w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg animate-fade-in"
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">{resultModalTitle}</h2>
        <button
          class="rounded-md p-1 hover:bg-accent transition-colors"
          aria-label="Close"
          onclick={() => (resultModalOpen = false)}
        >
          <Icon name="x" size="md" />
        </button>
      </div>
      <pre
        class="max-h-[50vh] overflow-auto rounded-lg bg-muted/50 p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap">{resultModalContent}</pre>
    </div>
  </div>
{/if}
