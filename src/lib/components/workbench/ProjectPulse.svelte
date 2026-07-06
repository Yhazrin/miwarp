<!--
  ProjectPulse — workbench 项目的紧凑 git 状态条。

  职责:展示当前选中项目的 git 分支 / ahead-behind / dirty count /
  最近一次提交;订阅 projectProfileStore 并在 cwd 切换时重新拉取。

  设计取舍:
  - 极紧凑一行(rounded-lg border + card/40 背景),不抢 hero / chat 主区视线。
  - 空态 / 加载态明确分叉,避免 "Loading..." 与 "No git" 同时出现。
  - 无 motion / 无 backdrop-blur / 无渐变,与控制台其它紧凑 chip 保持一致。
-->
<script lang="ts">
  import { projectProfileStore } from "$lib/workbench/project-profile-store.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    cwd: string;
  }

  let { cwd }: Props = $props();

  // cwd 变化时重拉 profile + git + notes。store 内部已有 "cwd changed → reset" 的短路,
  // 这里直接调 load(cwd) 即可,无需本地 loading 协调。
  $effect(() => {
    if (cwd) {
      void projectProfileStore.load(cwd);
    }
  });

  const git = $derived(projectProfileStore.gitStatus);
  const isLoading = $derived(projectProfileStore.loadingGit);
  const isRepo = $derived(git?.isGitRepo ?? false);
  const ahead = $derived(git?.ahead ?? null);
  const behind = $derived(git?.behind ?? null);
  const dirtyCount = $derived(git?.dirtyCount ?? 0);
  const lastCommit = $derived(git?.lastCommit ?? null);
  const showBranch = $derived(isRepo && !!git?.branch);
  const showAhead = $derived(isRepo && ahead !== null && ahead > 0);
  const showBehind = $derived(isRepo && behind !== null && behind > 0);
  const showDirty = $derived(isRepo && dirtyCount > 0);
  const showLastCommit = $derived(isRepo && !!lastCommit);
</script>

<div
  class="rounded-lg border border-border/40 bg-card/40 px-3 py-2"
  aria-label={t("workbench_pulse_branch")}
>
  {#if !isRepo && !isLoading && git !== null}
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="git-branch" size="xs" class="shrink-0 text-muted-foreground/70" />
      <span>{t("workbench_noGit")}</span>
    </div>
  {:else if isLoading && git === null}
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="git-branch" size="xs" class="shrink-0 text-muted-foreground/70" />
      <span>Loading...</span>
    </div>
  {:else if showBranch || showAhead || showBehind || showDirty || showLastCommit}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
      {#if showBranch && git}
        <span class="inline-flex items-center gap-1 font-medium">
          <Icon name="git-branch" size="xs" class="shrink-0 text-muted-foreground/70" />
          {git.branch}
        </span>
      {/if}
      {#if showAhead}
        <span class="inline-flex items-center gap-1 text-[hsl(var(--miwarp-status-info))]">
          ↑{ahead}
          <span class="sr-only">{t("workbench_pulse_ahead", { n: String(ahead ?? 0) })}</span>
        </span>
      {/if}
      {#if showBehind}
        <span class="inline-flex items-center gap-1 text-[hsl(var(--miwarp-status-warning))]">
          ↓{behind}
          <span class="sr-only">{t("workbench_pulse_behind", { n: String(behind ?? 0) })}</span>
        </span>
      {/if}
      {#if showDirty}
        <span
          class="inline-flex items-center gap-1 text-[hsl(var(--miwarp-status-warning))]"
          title={t("workbench_pulse_dirty", { n: String(dirtyCount) })}
        >
          <span
            class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--miwarp-status-warning))]"
            aria-hidden="true"
          ></span>
          {dirtyCount}
        </span>
      {/if}
      {#if showLastCommit && lastCommit}
        <span
          class="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground"
          title={t("workbench_pulse_lastCommit")}
        >
          <Icon name="circle-dot" size="xs" class="shrink-0 text-muted-foreground/70" />
          <span class="truncate">{lastCommit.subject}</span>
          <span class="shrink-0 tabular-nums">{relativeTime(lastCommit.timeIso)}</span>
        </span>
      {/if}
    </div>
  {:else if !isLoading && !isRepo}
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="git-branch" size="xs" class="shrink-0 text-muted-foreground/70" />
      <span>{t("workbench_noGit")}</span>
    </div>
  {:else}
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="git-branch" size="xs" class="shrink-0 text-muted-foreground/70" />
      <span>Loading...</span>
    </div>
  {/if}
</div>
