<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  let {
    diff = "",
    mode = "unified" as "unified" | "split",
    title = "",
    collapsible = true,
    maxHeight = "400px",
    onApply = undefined,
    onClose = undefined,
  }: {
    /** Git diff 格式字符串 */
    diff?: string;
    /** 显示模式: unified(单列) 或 split(双列) */
    mode?: "unified" | "split";
    /** 标题 */
    title?: string;
    /** 可折叠 */
    collapsible?: boolean;
    /** 最大高度 */
    maxHeight?: string;
    /** 应用变更回调 */
    onApply?: () => void;
    /** 关闭回调 */
    onClose?: () => void;
  } = $props();

  // 展开/折叠状态
  let expanded = $state(true);

  // 解析diff为行数组
  let diffLines = $derived(diff.split("\n"));

  // 统计变更
  let stats = $derived.by(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
    return { added, removed };
  });

  // 文件列表（从 diff 中提取）
  let files = $derived.by(() => {
    const result: { name: string; added: number; removed: number; hunks: number }[] = [];
    let currentFile = "";
    let currentAdded = 0;
    let currentRemoved = 0;
    let currentHunks = 0;

    for (const line of diffLines) {
      if (line.startsWith("diff --git")) {
        if (currentFile) {
          result.push({
            name: currentFile,
            added: currentAdded,
            removed: currentRemoved,
            hunks: currentHunks,
          });
        }
        // 提取文件名
        const match = line.match(/diff --git a\/(.*) b\/(.*)/);
        currentFile = match ? match[2] : "";
        currentAdded = 0;
        currentRemoved = 0;
        currentHunks = 0;
      } else if (line.startsWith("@@")) {
        currentHunks++;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        currentAdded++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentRemoved++;
      }
    }

    if (currentFile) {
      result.push({
        name: currentFile,
        added: currentAdded,
        removed: currentRemoved,
        hunks: currentHunks,
      });
    }

    return result;
  });

  // 处理行高亮
  function getLineClass(line: string): string {
    if (line.startsWith("+")) return "bg-[hsl(var(--miwarp-status-success)/0.15)] text-[hsl(var(--miwarp-status-success))]";
    if (line.startsWith("-")) return "bg-[hsl(var(--miwarp-status-error)/0.15)] text-[hsl(var(--miwarp-status-error))]";
    if (line.startsWith("@@")) return "bg-[hsl(var(--miwarp-status-info)/0.1)] text-[hsl(var(--miwarp-status-info))] font-medium";
    if (
      line.startsWith("diff") ||
      line.startsWith("index") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    )
      return "text-muted-foreground";
    return "";
  }

  // 行号生成
  function getLineNumbers(lines: string[]): { oldLine: number | null; newLine: number | null }[] {
    let oldLine = 0;
    let newLine = 0;
    return lines.map((line) => {
      if (line.startsWith("@@")) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) {
          oldLine = parseInt(m[1]);
          newLine = parseInt(m[2]);
        }
      }
      if (line.startsWith("+")) {
        const result = { oldLine: null, newLine: newLine++ };
        return result;
      }
      if (line.startsWith("-")) {
        const result = { oldLine: oldLine++, newLine: null };
        return result;
      }
      if (!line.startsWith("diff") && !line.startsWith("index")) {
        const result = { oldLine: oldLine++, newLine: newLine++ };
        return result;
      }
      return { oldLine: null, newLine: null };
    });
  }

  let lineNumbers = $derived(getLineNumbers(diffLines));
</script>

/** * DiffPreview: 内联Diff预览组件 * * Codex 设计灵感: * 1. side-by-side 或 unified diff 视图 * 2.
语法高亮 * 3. 展开/折叠变更块 * 4. 快速应用/撤销 */
<div
  class="diff-preview rounded-xl border border-border/60 bg-background/95 overflow-hidden shadow-lg"
>
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-border/40 px-4 py-2 bg-muted/30">
    <div class="flex items-center gap-3">
      <span class="text-sm font-semibold text-foreground">{title || t("diff_inlineTitle")}</span>
      {#if files.length > 0}
        <span class="text-[11px] text-muted-foreground">
          {files.length} file{files.length > 1 ? "s" : ""}
        </span>
      {/if}
      {#if stats.added > 0 || stats.removed > 0}
        <div class="flex items-center gap-1.5 text-[11px]">
          <span class="text-[hsl(var(--miwarp-status-success))]">+{stats.added}</span>
          <span class="text-[hsl(var(--miwarp-status-error))]">-{stats.removed}</span>
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <!-- 模式切换 -->
      <div class="flex rounded-lg border border-border/40 p-0.5">
        <button
          class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors {mode ===
          'unified'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (mode = "unified")}
        >
          Unified
        </button>
        <button
          class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors {mode === 'split'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (mode = "split")}
        >
          Split
        </button>
      </div>

      <!-- 操作按钮 -->
      {#if onApply}
        <button
          class="rounded-lg bg-[hsl(var(--miwarp-status-success))] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[hsl(var(--miwarp-status-success)/0.9)] transition-colors"
          onclick={onApply}
        >
          Apply
        </button>
      {/if}

      {#if collapsible}
        <button
          class="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onclick={() => (expanded = !expanded)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            class="h-4 w-4 transition-transform {expanded ? 'rotate-180' : ''}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      {/if}

      {#if onClose}
        <button
          class="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onclick={onClose}
          aria-label={t("common_close")}
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <!-- Content -->
  {#if expanded}
    <div
      class="diff-content overflow-auto {mode === 'split' ? 'grid grid-cols-2' : ''}"
      style="max-height: {maxHeight}"
    >
      {#if !diff.trim()}
        <div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
          {t("diff_noChanges")}
        </div>
      {:else}
        <!-- 语法高亮容器 -->
        <div class="diff-lines font-mono text-[12px] leading-5">
          {#each diffLines as line, i}
            {@const lineNum = lineNumbers[i]}
            <div class="flex {getLineClass(line)}">
              {#if mode === "unified"}
                <!-- 单列模式：显示行号和内容 -->
                <span
                  class="diff-line-num w-12 shrink-0 select-none text-right pr-2 text-muted-foreground/40 bg-muted/20"
                >
                  {lineNum.oldLine ?? ""}
                </span>
                <span
                  class="diff-line-num w-12 shrink-0 select-none text-right pr-2 text-muted-foreground/40"
                >
                  {lineNum.newLine ?? ""}
                </span>
                <span class="diff-line-content px-2">{line}</span>
              {:else}
                <!-- 分列模式 -->
                <div class="flex-1 flex">
                  <span
                    class="diff-line-num w-8 shrink-0 select-none text-right pr-2 text-muted-foreground/40"
                  >
                    {lineNum.oldLine ?? ""}
                  </span>
                  <span
                    class="diff-line-content px-1 flex-1 {line.startsWith('-') ? '' : 'opacity-30'}"
                    >{line}</span
                  >
                </div>
                <div class="flex-1 flex border-l border-border/40">
                  <span
                    class="diff-line-num w-8 shrink-0 select-none text-right pr-2 text-muted-foreground/40"
                  >
                    {lineNum.newLine ?? ""}
                  </span>
                  <span
                    class="diff-line-content px-1 flex-1 {line.startsWith('+') ? '' : 'opacity-30'}"
                    >{line}</span
                  >
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Footer hint -->
  {#if expanded && diff.trim()}
    <div class="border-t border-border/40 px-4 py-2 bg-muted/20">
      <p class="text-[10px] text-muted-foreground/70 text-center">
        {t("diff_inlineHint")}
      </p>
    </div>
  {/if}
</div>

<style>
  .diff-preview {
    font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }

  .diff-lines {
    tab-size: 2;
  }

  .diff-line-content {
    white-space: pre;
  }

  .diff-content::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .diff-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .diff-content::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.2);
    border-radius: 3px;
  }

  .diff-content::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.3);
  }
</style>
