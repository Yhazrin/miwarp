<script lang="ts">
  import Icon from "$lib/components/icons/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { BusToolItem, TeamRun, TeamMemberRun } from "$lib/types";
  import { extractOutputText, extractTaskToolMeta } from "$lib/utils/tool-rendering";

  type TaskStackStatus = "pending" | "running" | "completed" | "failed";

  interface TaskStackItem {
    id: string;
    title: string;
    actor: string;
    detail: string;
    status: TaskStackStatus;
  }

  let {
    tools = [],
    teamRun,
    maxVisible = 6,
  }: {
    tools?: BusToolItem[];
    teamRun?: TeamRun;
    maxVisible?: number;
  } = $props();

  function compactText(value: unknown, fallback = ""): string {
    if (typeof value !== "string") return fallback;
    return value
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  }

  function firstMeaningfulLine(value: unknown, fallback = ""): string {
    if (typeof value !== "string") return fallback;
    const line = value
      .split("\n")
      .map((part) => compactText(part))
      .find(Boolean);
    return line ?? fallback;
  }

  function clampText(value: string, max = 96): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1).trimEnd()}…`;
  }

  function toolStatus(status: BusToolItem["status"]): TaskStackStatus {
    if (status === "success") return "completed";
    if (status === "error" || status === "denied" || status === "permission_denied")
      return "failed";
    return "running";
  }

  function memberStatus(status: TeamMemberRun["status"]): TaskStackStatus {
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "running") return "running";
    return "pending";
  }

  function outputSummary(tool: BusToolItem): string {
    const directSummary = compactText(tool.summary);
    if (directSummary) return directSummary;
    const output = extractOutputText(tool.output);
    return firstMeaningfulLine(output);
  }

  function itemFromTool(tool: BusToolItem): TaskStackItem {
    const meta = tool.tool_name === "Task" ? extractTaskToolMeta(tool.input) : null;
    const prompt = firstMeaningfulLine(meta?.prompt ?? tool.input?.prompt);
    const title = compactText(meta?.description) || prompt || tool.tool_name;
    const actor =
      compactText(meta?.subagentType) || compactText(tool.input?.agent) || tool.tool_name;
    const detail =
      outputSummary(tool) ||
      prompt ||
      compactText(meta?.model) ||
      (tool.status === "ask_pending" || tool.status === "permission_prompt"
        ? t("agentTaskStack_waiting")
        : t("agentTaskStack_working"));

    return {
      id: tool.tool_use_id,
      title: clampText(title, 72),
      actor: clampText(actor, 32),
      detail: clampText(detail, 110),
      status: toolStatus(tool.status),
    };
  }

  function itemFromMember(member: TeamMemberRun): TaskStackItem {
    const detail =
      compactText(member.summary) ||
      compactText(member.error) ||
      compactText(member.role) ||
      t("agentTaskStack_working");
    return {
      id: member.id,
      title: clampText(compactText(member.task) || member.role || member.memberName, 72),
      actor: clampText(member.memberName || member.role, 32),
      detail: clampText(detail, 110),
      status: memberStatus(member.status),
    };
  }

  let items = $derived.by<TaskStackItem[]>(() => {
    if (teamRun) return teamRun.memberRuns.map(itemFromMember);
    return tools.map(itemFromTool);
  });

  let visibleItems = $derived(items.slice(0, maxVisible));
  let hiddenCount = $derived(Math.max(0, items.length - visibleItems.length));
  let completedCount = $derived(items.filter((item) => item.status === "completed").length);
  let failedCount = $derived(items.filter((item) => item.status === "failed").length);
  let runningCount = $derived(items.filter((item) => item.status === "running").length);
  let heading = $derived(
    teamRun
      ? t("agentTaskStack_teamHeading", { count: String(items.length) })
      : t("agentTaskStack_parallelHeading", { count: String(items.length) }),
  );

  function statusClasses(status: TaskStackStatus): string {
    if (status === "completed") return "text-emerald-500 bg-emerald-500/10";
    if (status === "failed") return "text-red-500 bg-red-500/10";
    if (status === "pending") return "text-muted-foreground/60 bg-muted-foreground/10";
    return "text-blue-500 bg-blue-500/10";
  }
</script>

{#if items.length > 0}
  <section
    class="w-full rounded-xl border border-border/45 bg-background/48 px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-md"
    aria-label={heading}
  >
    <div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span class="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon name={teamRun ? "users" : "bot"} size={12} />
      </span>
      <span class="font-medium text-foreground/78">{heading}</span>
      <span class="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
        {completedCount}/{items.length}
        {t("agentTaskStack_done")}
        {#if runningCount > 0}
          · {runningCount}
          {t("agentTaskStack_running")}
        {/if}
        {#if failedCount > 0}
          · <span class="text-red-500">{failedCount} {t("agentTaskStack_failed")}</span>
        {/if}
      </span>
    </div>

    <div class="space-y-1">
      {#each visibleItems as item (item.id)}
        <div
          class="group/task-stack grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2 rounded-lg px-1.5 py-1.5 transition-colors duration-200 hover:bg-muted/28"
        >
          <span
            class="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full {statusClasses(
              item.status,
            )}"
            aria-hidden="true"
          >
            {#if item.status === "completed"}
              <Icon name="check" size={10} strokeWidth={2.6} />
            {:else if item.status === "failed"}
              <Icon name="x" size={10} strokeWidth={2.6} />
            {:else if item.status === "pending"}
              <span class="h-1.5 w-1.5 rounded-full bg-current opacity-55"></span>
            {:else}
              <span class="relative flex h-2 w-2">
                <span class="absolute h-2 w-2 animate-ping rounded-full bg-current opacity-40"
                ></span>
                <span class="relative h-2 w-2 rounded-full bg-current"></span>
              </span>
            {/if}
          </span>

          <div class="min-w-0">
            <div class="truncate text-[12px] font-medium leading-5 text-foreground/88">
              {item.title}
            </div>
            <div class="truncate text-[11px] leading-4 text-muted-foreground/72">
              {item.detail}
            </div>
          </div>

          <div
            class="max-w-[128px] truncate rounded-md bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground/80"
          >
            {item.actor}
          </div>
        </div>
      {/each}
    </div>

    {#if hiddenCount > 0}
      <div class="mt-1.5 px-1.5 text-[10px] text-muted-foreground/65">
        {t("agentTaskStack_more", { count: String(hiddenCount) })}
      </div>
    {/if}
  </section>
{/if}
