# Split Workspace / 分屏会话工作台 v1.0.8

> **目标**：MiWarp v1.0.8 引入"分屏工作台"第一版：把现有会话卡片从 sidebar 拖到聊天区域即可创建最多 4 个 pane 并排查看。
> **优先级**：P1 高价值体验，**不是 P0 主线**。
> **前置硬约束**：右侧边栏 suspend、pane 状态隔离、active pane 输入归属这三件事必须先做对。否则分屏会把现有会话加载问题和右侧数据加载问题全部放大。
> **评估日期**：2026-06-11
> **目标读者**：MiWarp 核心开发组
> **预估工时**：~7 pd（PR-1 ~ PR-5，1 工程师 1.5 周）

---

## 0. TL;DR

| 维度 | 决策 |
|------|------|
| 架构 | **新独立模块** `src/lib/split/` + `src/lib/components/split/`，**不**改 `ChatConversationStage.svelte` 内部 |
| 数据 | **单 store + 适配器**：active pane 走 `sessionStore`（写入路径），inactive pane 走 `SplitPaneSessionAdapter` 缓存只读快照（避免抢占 store） |
| 边界 | chat page 条件渲染：split 启用时用 `<SplitWorkspace>`，否则用 `<ChatConversationStage>`。**普通模式行为完全不变** |
| DnD | 复用 SidebarSessionItem 已有的 `ondragstart`/`ondragend` 协议，扩展 dataTransfer MIME：`application/x-miwarp-split-pane` |
| 布局 | 第一版只做预设布局：**single / dual / triple / quad**。**不做**自由 resize |
| 限制 | 单 run 不能重复开（重复拖入激活已有 pane）；最多 4 pane；**第一版只允许 active pane 发送消息** |
| 右侧边栏 | split 启用时进入 **suspended** 状态：`<ToolActivity>` 替换为 `<SplitSidebarPlaceholder>`；`<WorkspaceContextPanel>` 的 cwd $effect 跳过；`<GitWorktreePanel>` 暂停监听；memory candidates / deep search / tool activity 全部停止加载 |
| 路由 | 退出 split 时把 active pane 的 runId 写回 URL `?run=`，并把 cwd 恢复到 sidebar |
| i18n | 全部走 `t('key')`，en + zh-CN 对齐 |

---

## 1. 现有架构摸底（基于实际阅读）

> 评估日期 2026-06-11。基于 chat/+page.svelte 1599 行 + session-store.svelte.ts 3932 行 + chat page 右侧边栏装载的实际代码。

### 1.1 关键事实

- `session-store.svelte.ts` **3932 行 god store**——**已经是** god object（拆是 PLAN_V1.0.6 的工作，不在本 PR 范围内）。**绝对不能**把分屏逻辑塞进去。
- `chat/+page.svelte` 1599 行，已经是 god page；分屏集成走**条件渲染**而不是改它。
- `ChatConversationStage.svelte` 569 行：接收 `{store, settings, ...5 个 VM 对象, handlers, ...}` props。**所有 props 都从单一 store 派生**。
- `ChatInputDock.svelte` 241 行：同样绑定单一 store 的 sendMessage / permission / interrupt 等。
- `SidebarSessionItem.svelte` **已暴露** `ondragstart(e, runId)` / `ondragend()` props，Sidebar.svelte line 197 已 wire `onDragStartConversation`。
- `session-store.svelte.ts:1773 loadRun(id, xtermRef)` **已实现** `_loadGen` generation guard（line 326）。**复用的关键基础设施**。
- `<ToolActivity>` (chat page line 1518) 接收 `cwd / runId / timeline / tools` 5 个 props，**workspace tab 内部的 `<WorkspaceContextPanel>` 监听 cwd 变化触发 `memoryStore.loadCandidates(dir)`**。
- design tokens 入口：`src/lib/styles/design-tokens.css`（被 `src/app.css` import）。**所有新组件必须复用**——不允许新写颜色 / 圆角 / 阴影 / 字号硬编码。

### 1.2 风险点（已识别）

- ⚠️ `session-store` 单例同时承载 N 个 run 的状态会互相污染 → 必须隔离
- ⚠️ ToolActivity 的 `useTimeline` 派生会遍历整个 timeline；N 个 pane 同时显示 = N 倍计算
- ⚠️ WorkspaceContextPanel 的 `cwd` $effect 会 fetch memory + CLAUDE.md；切换 active pane 时若 cwd 变化会触发 fetch
- ⚠️ DnD 协议与现有"会话卡片拖到 folder"的协议共存，需用 MIME type 区分

---

## 2. 架构总览

### 2.1 模块边界（新增）

```
src/lib/split/                              ← 新增
├── split-workspace-store.svelte.ts         ← 独立 store（Svelte 5 runes）
├── split-pane-session-adapter.ts           ← pane 适配器：load/cancel/snapshot
├── split-dnd.ts                            ← DnD 协议（MIME type 常量 + helpers）
├── split-layout.ts                         ← layoutMode → CSS class 映射
└── split-workspace-store.test.ts           ← store 单元测试（vitest）

src/lib/components/split/                   ← 新增
├── SplitWorkspace.svelte                   ← 网格容器，按 layoutMode 切 CSS grid
├── SplitChatPane.svelte                    ← 单 pane：包 ChatConversationStage + SplitPaneHeader + SplitPaneInputDock
├── SplitPaneHeader.svelte                  ← pane 顶部 chrome：title / close / active 指示
└── SplitDropOverlay.svelte                 ← 拖拽时的 drop 区域视觉反馈

src/lib/components/chat/                    ← 既有，不改实现
└── ChatConversationStage.svelte            ← 通过 store prop 解耦：第一版 split 复用，不复制实现
```

**关键边界**：split 模块**不导入** `chat/+page.svelte` 任何东西；chat page **可以**导入 split 模块。单向依赖。

### 2.2 数据流（active pane）

```
┌──────────────────────────────────────────────────────────────┐
│ chat/+page.svelte（split 启用时）                              │
│                                                               │
│  {#if split.enabled}                                          │
│    <SplitWorkspace>                                           │
│      {#each split.panes as pane}                              │
│        <SplitChatPane {pane}>                                 │
│          {#if pane.runtimeState === 'active'}                 │
│            <ChatConversationStage store={sessionStore} ... />│
│            <ChatInputDock        store={sessionStore} ... /> │
│          {:else}                                              │
│            <SplitPaneSnapshotView {snapshot} ... />           │
│          {/if}                                                │
│        </SplitChatPane>                                       │
│      {/each}                                                  │
│    </SplitWorkspace>                                          │
│  {:else}                                                      │
│    <ChatConversationStage ... />                              │
│    <ChatInputDock ... />                                      │
│  {/if}                                                        │
│                                                               │
│  <ToolActivity suspended={split.rightSidebarSuspended} ... />│
└──────────────────────────────────────────────────────────────┘
```

### 2.3 数据流（inactive pane）

inactive pane **不挂** `<ChatConversationStage>`——只渲染只读快照：
- `SplitPaneSessionAdapter.snapshotFor(runId)` 异步拉 `getRun(id) + getBusEvents(id)` 一次
- 缓存到 `pane.cachedSnapshot`（timeline / run / numTurns / status）
- **不订阅** sessionStore 的 `_wsSubscribeWithSeq`，**不挂载** input dock，**不响应** active pane 的事件
- 切到 active 时调用 `store.loadRun(pane.runId, xtermRef)` 接管

### 2.4 pane 生命周期状态机

```
                    addPane(runId)
   ┌────────┐ ─────────────────────► ┌─────────┐
   │  (no   │                        │ loading │
   │  pane) │                        │ (gen++) │
   └────────┘                        └─────────┘
       ▲                                  │
       │ exit()                           │ ok
       │                                  ▼
       │        ┌──────────────────────────────┐
       │        │ active ───────────────────────┼──┐ click pane
       │        │   │                          │  │
       │        │   ▼                          │  │
       │        │ inactive (snapshot cached)  │◄─┘
       │        │   │                          │
       │        │   │ click → become active   ─┘
       │        │   ▼
       │        │ closing (cancel in-flight, release cache)
       │        │   │
       │        │   ▼
       └────────┴ (removed)
```

---

## 3. SplitWorkspaceStore（独立 store）

### 3.1 类型定义

```ts
// src/lib/split/split-workspace-store.svelte.ts

export type LayoutMode = "single" | "dual" | "triple" | "quad";
export type PaneLoadState = "idle" | "loading" | "ready" | "error";
export type PaneRuntimeState = "active" | "inactive";
export type PaneId = string; // uuid

export interface PaneScrollState {
  scrollTop: number;
  pinned: boolean; // true = at bottom
  renderLimit: number;
}

export interface PaneErrorState {
  code: "load_failed" | "stale_dropped" | "aborted";
  message: string;
}

export interface PaneSnapshot {
  /** Cached read-only view of a pane. Only filled for inactive panes. */
  run: TaskRun;
  timeline: TimelineEntry[];
  tools: HookEvent[];
  turnUsages: TurnUsage[];
  fetchedAt: number;
}

export interface PaneState {
  paneId: PaneId;
  runId: string;          // backend run id
  loadState: PaneLoadState;
  runtimeState: PaneRuntimeState;
  loadGeneration: number; // bump on (re)load; mismatched async results are discarded
  scrollState: PaneScrollState;
  errorState: PaneErrorState | null;
  cachedSnapshot: PaneSnapshot | null;
}

export const MAX_PANES = 4;

class SplitWorkspaceStore {
  enabled: boolean = $state(false);
  panes: PaneState[] = $state([]);
  activePaneId: PaneId | null = $state(null);
  layoutMode: LayoutMode = $state("single");
  rightSidebarSuspended: boolean = $state(false);
  /** Saved cwd before entering split mode — used to restore sidebar binding on exit. */
  preSplitCwd: string | null = $state(null);
  /** Toast sink — chat page wires to showToast on init. */
  onToast: ((msg: string, kind?: "info" | "error") => void) | null = null;
}
```

### 3.2 关键 actions（行为约束）

| Action | 入参 | 行为 | 边界检查 |
|--------|------|------|----------|
| `enter(opts)` | `{cwd, activeRunId}` | 设置 `enabled=true`、`preSplitCwd=cwd`、`rightSidebarSuspended=true`；如有 `activeRunId` 调用 `addPane(activeRunId, {silent: true})` | 必须从非 split 状态进入；已启用直接 noop |
| `exit()` | — | 检查 `activePaneId`；调用 `sessionStore.loadRun(activeRun.runId)` 恢复到普通模式；`enabled=false`；清空 `panes[]`；`rightSidebarSuspended=false`；恢复 `preSplitCwd` | 必须从 split 状态退出 |
| `addPane(runId, opts)` | `{silent?: boolean, makeActive?: boolean}` | 检查 `runId` 是否已在 `panes[]`；若有，激活那个 pane 后返回（**不新增**）；若 `panes.length >= MAX_PANES` 且 `!silent`，调 `onToast(t('split_mode_paneLimitReached'))` 后返回；否则 push 新 Pane（`loadGeneration++`、loadState='loading'），由 `SplitPaneSessionAdapter` 异步填充 | 重复 run → activate existing；超限 → toast + noop |
| `removePane(paneId)` | — | 找到 pane；调 `adapter.cancel(pane)`；从 `panes[]` 移除；如果移除的是 active pane，激活第一个剩余 pane；若无剩余 pane，自动 `exit()` | cancel 必须丢弃所有 in-flight 异步 |
| `setActive(paneId)` | — | 设置 `activePaneId`；调 `adapter.switchActive(oldActivePaneId, newPaneId)`：旧 active 缓存 snapshot，新 active 调 `sessionStore.loadRun`；被离开的 pane `runtimeState='inactive'`、被进入的 `runtimeState='active'` | 必须保证同一时刻只有一个 active；切换有锁 |
| `setLayoutMode(mode)` | — | 若 `panes.length > maxSlotsForMode(mode)` → toast + noop | `single=1, dual=2, triple=3, quad=4` |
| `markLoadResult(paneId, ok, error?)` | — | 写入 `loadState` / `errorState`；写入 `cachedSnapshot`（only for inactive 路径） | 检查 `pane.loadGeneration` 是否仍匹配；不匹配丢弃（防过期） |
| `suspendRightSidebar()` / `resumeRightSidebar()` | — | 切换 `rightSidebarSuspended` | — |

### 3.3 单元测试（必跑）

`src/lib/split/split-workspace-store.test.ts`：
- `addPane` 重复 runId → 不新增，激活已有 pane
- `addPane` 第 5 次 → toast + 不新增（用 fake `onToast` 校验）
- `removePane` 移除 active → 自动激活下一个；最后一个 → 触发 `exit()`
- `setActive` 期间并发 `markLoadResult(oldPaneId, ok)` → 必须被丢弃（generation mismatch）
- `setLayoutMode('single')` 当有 2 pane → toast + noop（避免数据丢失）
- `enter()` 后 `enabled=true`、`rightSidebarSuspended=true`；`exit()` 后恢复 `preSplitCwd`

### 3.4 模块导出

```ts
// src/lib/split/index.ts
export { splitWorkspaceStore, SplitWorkspaceStore } from "./split-workspace-store.svelte";
export type { PaneState, LayoutMode, PaneId } from "./split-workspace-store.svelte";
export { splitPaneSessionAdapter } from "./split-pane-session-adapter";
export const SPLIT_DRAG_MIME = "application/x-miwarp-split-pane";
```

---

## 4. SplitPaneSessionAdapter（隔离 active / inactive 路径）

```ts
// src/lib/split/split-pane-session-adapter.ts
import type { SessionStore } from "$lib/stores/session-store.svelte";
import { snapshotCache } from "$lib/chat/chat-bootstrap-cache";
import { getTransport } from "$lib/transport";
import * as api from "$lib/api";

class SplitPaneSessionAdapter {
  /** In-flight generation counter per pane (mirrors store._loadGen pattern). */
  private _generations = new Map<PaneId, number>();

  /** Load a pane to become active. Delegates to sessionStore.loadRun + bumps generation. */
  async activate(store: SessionStore, pane: PaneState, xtermRef?: { clear(): void; writeText(s: string): void }) {
    const gen = (this._generations.get(pane.paneId) ?? 0) + 1;
    this._generations.set(pane.paneId, gen);
    pane.loadGeneration = gen;

    await store.loadRun(pane.runId, xtermRef);

    // Discard stale result: loadRun has its own _loadGen. But our caller may
    // switch again before completion. We re-check pane.loadGeneration.
    if (pane.loadGeneration !== gen) return;

    pane.loadState = "ready";
    pane.errorState = null;
  }

  /** Load a pane as inactive (snapshot-only, no live subscription). */
  async fetchSnapshot(pane: PaneState): Promise<PaneSnapshot | null> {
    const gen = pane.loadGeneration;
    try {
      const run = await api.getRun(pane.runId);
      if (pane.loadGeneration !== gen) return null; // pane was reloaded/closed
      const events = await api.getBusEvents(pane.runId);
      if (pane.loadGeneration !== gen) return null;

      // Same parse logic as session-store replay. Reuse snapshotCache if hit.
      const cached = await snapshotCache.readSnapshot(pane.runId, run.status).catch(() => null);
      if (cached && pane.loadGeneration === gen) {
        const parsed = JSON.parse(cached);
        pane.cachedSnapshot = {
          run,
          timeline: parsed.timeline ?? [],
          tools: parsed.tools ?? [],
          turnUsages: parsed.turnUsages ?? [],
          fetchedAt: Date.now(),
        };
      } else if (pane.loadGeneration === gen) {
        pane.cachedSnapshot = {
          run,
          timeline: events.flatMap((e) => /* ... parse events ... */ []),
          tools: [],
          turnUsages: [],
          fetchedAt: Date.now(),
        };
      }
      pane.loadState = "ready";
      return pane.cachedSnapshot;
    } catch (e) {
      if (pane.loadGeneration !== gen) return null;
      pane.loadState = "error";
      pane.errorState = { code: "load_failed", message: String(e) };
      return null;
    }
  }

  /** Cancel all in-flight work for a pane. */
  cancel(pane: PaneState) {
    pane.loadGeneration++;
    // session-store's _loadGen will guard its own replay; bumping pane's gen
    // ensures any post-await assignments are discarded.
    pane.cachedSnapshot = null;
  }

  /** Switch active pane — old active cached, new active loaded. */
  async switchActive(
    store: SessionStore,
    oldPane: PaneState | null,
    newPane: PaneState,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ) {
    // Capture snapshot of old active BEFORE mutating runtimeState
    if (oldPane && !oldPane.cachedSnapshot) {
      await this.fetchSnapshot(oldPane);
    }
    if (oldPane) {
      oldPane.runtimeState = "inactive";
    }
    newPane.runtimeState = "active";
    await this.activate(store, newPane, xtermRef);
  }
}

export const splitPaneSessionAdapter = new SplitPaneSessionAdapter();
```

**复用现有基础设施**：
- `snapshotCache`（`chat-bootstrap-cache.ts`）— 避免重复 IO
- `sessionStore.loadRun` 的 `_loadGen` guard
- `api.getRun` / `api.getBusEvents` 的现有 transport 抽象

---

## 5. 组件设计

### 5.1 `SplitWorkspace.svelte`（网格容器）

```svelte
<script lang="ts">
  import { splitWorkspaceStore } from "$lib/split";
  import SplitChatPane from "./SplitChatPane.svelte";
  import SplitDropOverlay from "./SplitDropOverlay.svelte";
  import { SPLIT_LAYOUT_CLASSES } from "$lib/split/split-layout";
  import { fly } from "svelte/transition";

  const split = splitWorkspaceStore;
</script>

<div class="split-workspace relative h-full w-full" data-split-mode="true">
  <div
    class="split-grid h-full w-full"
    class:single={split.layoutMode === "single"}
    class:dual={split.layoutMode === "dual"}
    class:triple={split.layoutMode === "triple"}
    class:quad={split.layoutMode === "quad"}
  >
    {#each split.panes as pane (pane.paneId)}
      <div
        class="split-pane-slot"
        in:fly={{ y: 12, duration: 180 }}
        data-pane-id={pane.paneId}
        data-runtime-state={pane.runtimeState}
      >
        <SplitChatPane {pane} />
      </div>
    {/each}
  </div>
  <SplitDropOverlay />
</div>

<style>
  .split-grid { display: grid; gap: 1px; background: hsl(var(--border)); }
  .split-grid.single  { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .split-grid.dual    { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
  .split-grid.triple  { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  /* triple: pane 1 spans left column full height; pane 2 / 3 stacked right */
  .split-grid.quad    { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
</style>
```

**最大行数预算**：≤ 80 行。

### 5.2 `SplitChatPane.svelte`

```svelte
<script lang="ts">
  import type { PaneState } from "$lib/split";
  import { splitWorkspaceStore } from "$lib/split";
  import SplitPaneHeader from "./SplitPaneHeader.svelte";
  import SplitPaneSnapshotView from "./SplitPaneSnapshotView.svelte"; // internal helper
  import ChatConversationStage from "$lib/components/chat/ChatConversationStage.svelte";
  import ChatInputDock from "$lib/components/chat/ChatInputDock.svelte";
  // ... pass-through props from chat page (tl, ta, sd, settings, ...)

  let { pane }: { pane: PaneState } = $props();
  const split = splitWorkspaceStore;

  function onHeaderClick() {
    if (pane.runtimeState !== "active") split.setActive(pane.paneId);
  }
  function onClose() { split.removePane(pane.paneId); }
</script>

<div class="flex flex-col h-full bg-background" onclick={onHeaderClick}>
  <SplitPaneHeader {pane} {onClose} />
  <div class="flex-1 min-h-0 overflow-hidden">
    {#if pane.runtimeState === "active"}
      <!-- Reuse ChatConversationStage with the shared sessionStore.
           No refactor to ChatConversationStage needed; it already accepts
           store as a prop. -->
      <ChatConversationStage store={sessionStore} ... />
    {:else if pane.cachedSnapshot}
      <SplitPaneSnapshotView snapshot={pane.cachedSnapshot} />
    {:else if pane.loadState === "loading"}
      <SplitPaneLoading />
    {:else if pane.loadState === "error"}
      <SplitPaneError error={pane.errorState} />
    {/if}
  </div>
  {#if pane.runtimeState === "active"}
    <ChatInputDock store={sessionStore} ... />
  {/if}
</div>
```

**关键约束**：
- **active pane 必须点击事件能冒泡到 split.setActive**（让用户点 inactive pane 头部任意区域即可激活）
- **不重新实现** ChatConversationStage / ChatInputDock——**完全复用**，它们已经接受 `store` 作为 prop
- **不挂载 XTerminal** 到 inactive pane——XTerminal 与 sessionStore 强绑定，多实例会污染 PTY

**最大行数预算**：≤ 120 行（含 child component imports）。

### 5.3 `SplitPaneHeader.svelte`

```svelte
<script lang="ts">
  import type { PaneState } from "$lib/split";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let { pane, onClose }: { pane: PaneState; onClose: () => void } = $props();

  const title = $derived(pane.cachedSnapshot?.run.name ?? pane.runId.slice(0, 8));
  const isActive = $derived(pane.runtimeState === "active");
</script>

<div
  class="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5"
  class:active={isActive}
>
  <span class="status-dot {pane.cachedSnapshot?.run.status ?? 'pending'}"></span>
  <span class="truncate text-xs font-medium flex-1 min-w-0">{title}</span>
  {#if isActive}
    <span class="text-[10px] text-primary uppercase tracking-wider">
      {t('split_mode_activeBadge')}
    </span>
  {/if}
  <button
    type="button"
    class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    aria-label={t('split_mode_closePane')}
    onclick={(e) => { e.stopPropagation(); onClose(); }}
  >
    <Icon name="x" size="xs" />
  </button>
</div>

<style>
  .status-dot { /* reuse SessionStore statusDot color tokens via inline class */ }
  .active { background: hsl(var(--primary) / 0.08); }
</style>
```

**最大行数预算**：≤ 70 行。

### 5.4 `SplitDropOverlay.svelte`

```svelte
<script lang="ts">
  import { splitWorkspaceStore } from "$lib/split";
  import { SPLIT_DRAG_MIME } from "$lib/split";
  import { t } from "$lib/i18n/index.svelte";

  let dragDepth = $state(0);
  let isDragging = $derived(dragDepth > 0);
  let canDrop = $derived(splitWorkspaceStore.panes.length < 4);

  $effect(() => {
    function onDragEnter(e: DragEvent) {
      if (!hasSplitMime(e)) return;
      e.preventDefault();
      dragDepth++;
    }
    function onDragLeave() { dragDepth = Math.max(0, dragDepth - 1); }
    function onDragOver(e: DragEvent) {
      if (!hasSplitMime(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = canDrop ? "copy" : "none";
    }
    function onDrop(e: DragEvent) {
      if (!hasSplitMime(e)) return;
      e.preventDefault();
      dragDepth = 0;
      const runId = e.dataTransfer!.getData(SPLIT_DRAG_MIME);
      if (runId) splitWorkspaceStore.addPane(runId);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  });

  function hasSplitMime(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes(SPLIT_DRAG_MIME);
  }
</script>

{#if isDragging && splitWorkspaceStore.enabled}
  <div
    class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center
           bg-primary/5 backdrop-blur-[1px] border-2 border-dashed"
    class:border-primary={canDrop}
    class:border-destructive={!canDrop}
  >
    <div class="rounded-xl bg-background/80 px-6 py-3 text-sm font-medium shadow-lg">
      {canDrop ? t('split_mode_dropHint') : t('split_mode_paneLimitReached')}
    </div>
  </div>
{/if}
```

**关键约束**：
- **只在 `split.enabled` 时挂载**——不影响现有 drag-to-folder 协议
- **只响应对应 MIME type**——与 drag-to-folder / drag-to-prompt-drop 完全共存
- **dropEffect = "none"** 时视觉变红，提示用户已达上限

**最大行数预算**：≤ 90 行。

### 5.5 SplitPaneSnapshotView（内部辅助组件，inactive pane 只读视图）

```svelte
<!-- 这是一个简化版 ChatTimelineEntries，用于 inactive pane 的 snapshot -->
<!-- 复用 ChatMessage / ChatTimelineEntries 但传入只读 timeline -->
<!-- 不挂 ChatInputDock / XTerminal / 不订阅 sessionStore -->
<!-- 不实现 rewind / permission / interrupt / send -->
<!-- 滚到底部也禁用（inactive pane 只读） -->
```

最大行数预算：≤ 150 行（如果太大再考虑再切）。

---

## 6. 与 chat/+page.svelte 的集成

### 6.1 改动点（最小化）

```svelte
<!-- chat/+page.svelte line 1336 附近 -->
{#if splitWorkspaceStore.enabled}
  <SplitWorkspace />
{:else}
  <ChatConversationStage ... />
{/if}
```

### 6.2 右侧边栏 suspend 触发

```svelte
<!-- chat/+page.svelte line 1518 附近 -->
{#if splitWorkspaceStore.rightSidebarSuspended}
  <SplitSidebarPlaceholder />
{:else}
  <ToolActivity ... />
{/if}
```

### 6.3 init / cleanup hooks

- `$effect` on mount: 若 URL 有 `?split=1`，自动调用 `splitWorkspaceStore.enter({cwd, activeRunId})`
- `$effect` on beforeNavigate: 若 split 启用，调用 `splitWorkspaceStore.exit()`（先回 store.loadRun 再清 panes）
- i18n 入口新增 `split_mode_*` keys

### 6.4 不改的清单（显式）

- ❌ `ChatConversationStage.svelte` 内部逻辑（保持 569 行）
- ❌ `ChatInputDock.svelte` 内部逻辑（保持 241 行）
- ❌ `session-store.svelte.ts` 内部状态机（保持 3932 行）
- ❌ `chat/+page.svelte` 的 input / send / permission handlers
- ❌ 普通模式 URL `?run=xxx` → 直接走 store.loadRun，不进 split
- ❌ DnD 协议中现有"会话卡片拖到 folder"的 dataTransfer

---

## 7. 右侧边栏 suspend 协议（最关键）

### 7.1 现状数据流

```
ToolActivity (chat page line 1518)
  → cwd / runId / timeline / tools / contextHistory
  → WorkspaceContextPanel (cwd prop)
    → $effect on cwd → memoryStore.loadCandidates(dir) + api.readTextFile
  → GitWorktreePanel (cwd + runId prop)
    → $effect on cwd → api.gitSummary + file tree
  → FilesPanel / FilePreviewPane / PreviewPanel
```

### 7.2 Suspend 协议

**第 1 步：`<ToolActivity>` 接收 `suspended: boolean` prop**

```svelte
<!-- ToolActivity.svelte -->
let { suspended = false, ... } = $props();
{#if suspended}
  <SplitSidebarPlaceholder />
{:else}
  <!-- 原有 Tabs / Workspace / Tools / Files / Preview / Tasks -->
{/if}
```

`SplitSidebarPlaceholder` 是一个静态组件：
```svelte
<div class="flex h-full items-center justify-center px-6 text-center">
  <div class="space-y-2">
    <Icon name="columns" size="lg" class="mx-auto text-muted-foreground/40" />
    <p class="text-xs text-muted-foreground">
      {t('split_mode_sidebarSuspended')}
    </p>
  </div>
</div>
```

**第 2 步：`<WorkspaceContextPanel>` 内部 `cwd` $effect 加 `suspended` 短路**

```svelte
<!-- WorkspaceContextPanel.svelte -->
let { suspended = false, cwd = "", ... } = $props();
$effect(() => {
  if (suspended) return;          // ← 新增：suspend 时跳过 fetch
  const c = cwd;
  if (c && c !== _lastCwd) {
    _lastCwd = c;
    loadWorkspaceContext(c);
  }
});
```

**第 3 步：`<GitWorktreePanel>` 同样加 suspended 短路**

**第 4 步：`memoryStore.loadCandidates` 内部加 active guard**

```ts
// memory-store.svelte.ts
loadCandidates(dir: string) {
  if (splitWorkspaceStore.rightSidebarSuspended) return;  // ← 新增
  // ... 既有逻辑
}
```

### 7.3 Resume 协议

`exit()` 调用时：
1. `sessionStore.loadRun(activePane.runId)` — store 重新接管
2. `splitWorkspaceStore.enabled = false`
3. `splitWorkspaceStore.rightSidebarSuspended = false`
4. ToolActivity 重新挂载，WorkspaceContextPanel $effect 因 cwd 变化（或主动 re-trigger）重新 fetch
5. 把 active pane 的 `runId` 写回 URL `?run=xxx`，sidebar 重新同步

**验证**：
- 进入 split → console 应该看不到 `memory-store loadCandidates` 日志
- 退出 split → 进入 split 之前 cwd 的 `loadWorkspaceContext` 会重新跑一次

### 7.4 风险与回退

- 若 ToolActivity 在 inactive pane 期间还被 chat page 引用，suspend 不生效 → 必须 **整个替换** ToolActivity mount 点
- `memoryStore.loadCandidates` 是同步函数返回 Promise，guard 简单
- 若 chat page 其他组件订阅 cwd 变化（如 `use-project-data`），需要逐个排查

---

## 8. DnD 协议（与现有共存）

### 8.1 MIME type 常量

```ts
// src/lib/split/split-dnd.ts
export const SPLIT_DRAG_MIME = "application/x-miwarp-split-pane";

export interface SplitDragPayload {
  runId: string;
  source: "sidebar";
}
```

### 8.2 Sidebar 改动（最小）

```svelte
<!-- SidebarSessionItem.svelte ondragstart 接收方 -->
<!-- Sidebar.svelte line 197 附近 -->
function onDragStartConversation(e: DragEvent, runId: string) {
  // 既有 folder-drag 协议（保留）
  e.dataTransfer?.setData("application/x-miwarp-run", runId);

  // 新增：split-pane 协议
  e.dataTransfer?.setData(SPLIT_DRAG_MIME, runId);
  // 同时设置两种 MIME 让两侧都能识别
}
```

### 8.3 chat page Drop zone

- `<SplitDropOverlay>` 监听 window-level dragenter/dragover/drop
- 只对 `SPLIT_DRAG_MIME` 响应；其他 MIME 完全透传给现有 handlers
- **不需要** 改 SidebarSessionItem.svelte 内部（已有 ondragstart props）

### 8.4 边界

- 不响应 Sidebar → Folder 拖拽（folder drop target 自己处理 `application/x-miwarp-run`）
- 不响应 Sidebar → Chat prompt file drop（`ChatDragOverlay` 仍然工作）
- 三套协议用 MIME type 完全隔离

---

## 9. UI / Design tokens 复用

### 9.1 必须复用

- ✅ 颜色：`hsl(var(--primary))`、`hsl(var(--background))`、`hsl(var(--border))`、`hsl(var(--muted))`、`hsl(var(--muted-foreground))`、`hsl(var(--accent))`
- ✅ 状态颜色：`hsl(var(--miwarp-status-info))`、`hsl(var(--miwarp-status-success))`、`hsl(var(--miwarp-status-warning))`、`hsl(var(--miwarp-status-error))`
- ✅ 圆角：`rounded-lg / rounded-md / rounded-xl`（Tailwind 默认，绑定 token）
- ✅ 字号：`text-xs / text-sm`（Tailwind 默认）
- ✅ 间距：`gap-1 / gap-2 / px-3 / py-1.5`（Tailwind 默认）
- ✅ 动画：`svelte/transition` 的 `fly / fade`，duration 150–200ms（与现有 motion.css 对齐）

### 9.2 禁止

- ❌ 新增自定义 CSS 变量（除非写进 `design-tokens.css` PR 同步）
- ❌ 硬编码颜色 `#xxx` / `rgb(...)`
- ❌ 写新 font-size / new shadow utility

---

## 10. Timeline 渲染保守策略（pane 数量放大效应）

### 10.1 现状（已实现）

- `use-timeline-state.svelte.ts` 的 `renderLimit` 控制可见 entry 数量
- `use-tool-burst-collapse` 折叠 burst
- progressive render 在 `ChatTimelineEntries` 已通过 `filteredTimeline.length - renderLimit > 0` 触发

### 10.2 split mode 强化

- 每个 pane 的初始 `renderLimit` = 200（普通模式是 500）
- `use-tool-burst-collapse` 在 inactive pane 中**默认全部折叠**（active 用户才会去展开）
- 不实现"延迟渲染 markdown/code block"（**未来 PR**）

---

## 11. i18n 清单

新增到 `src/lib/i18n/messages/en.json` 和 `zh-CN.json`：

```jsonc
{
  "split_mode_enter": "Split workspace",
  "split_mode_exit": "Exit split",
  "split_mode_activeBadge": "Active",
  "split_mode_closePane": "Close pane",
  "split_mode_dropHint": "Drop here to add a pane",
  "split_mode_paneLimitReached": "Up to 4 panes. Close one first.",
  "split_mode_duplicateRun": "Already open — focusing existing pane.",
  "split_mode_sidebarSuspended": "Sidebar paused in split mode",
  "split_mode_layoutSingle": "1 pane",
  "split_mode_layoutDual": "2 panes (side by side)",
  "split_mode_layoutTriple": "3 panes (1 left, 2 right)",
  "split_mode_layoutQuad": "4 panes (2x2)"
}
```

zh-CN 对应翻译。

跑 `npm run i18n:check` 验证。

---

## 12. v1.0.8 路线图（5 个 PR，~7 pd）

### PR-1: Store + Adapter 基础（~1.5 pd）

**包含**：
- `src/lib/split/split-workspace-store.svelte.ts`
- `src/lib/split/split-pane-session-adapter.ts`
- `src/lib/split/split-layout.ts`
- `src/lib/split/split-workspace-store.test.ts`
- `src/lib/split/index.ts`
- i18n keys (`split_mode_*`)

**验收**：
- `npm test` 全过
- `pnpm check` 0 错
- `pnpm i18n:check` 0 错
- `pnpm lint` 0 错

**风险**：低；纯新增 store + adapter，无 UI 集成。

### PR-2: SplitDropOverlay + DnD 协议（~1 pd）

**包含**：
- `src/lib/components/split/SplitDropOverlay.svelte`
- `src/lib/split/split-dnd.ts`
- Sidebar.svelte 改 1 行（dragstart 多 setData 一条 MIME）
- `SplitWorkspace.svelte` 挂载 SplitDropOverlay

**验收**：
- 进入 split mode 后从 sidebar 拖出会话卡到聊天区域 → overlay 显示 "Drop here to add a pane"
- 拖到 folder 仍正常工作
- 拖到 chat prompt file drop 仍正常工作

**风险**：中；DnD 协议与现有协议共存，必须三协议都验证。

### PR-3: SplitWorkspace + SplitChatPane + SplitPaneHeader + Snapshot view（~2 pd）

**包含**：
- `src/lib/components/split/SplitWorkspace.svelte`
- `src/lib/components/split/SplitChatPane.svelte`
- `src/lib/components/split/SplitPaneHeader.svelte`
- `src/lib/components/split/SplitPaneSnapshotView.svelte`
- `src/lib/components/split/SplitSidebarPlaceholder.svelte`
- Layout CSS（复用 design tokens）
- snapshot 渲染测试（手动 + screenshot）

**验收**：
- 创建 1/2/3/4 pane 都正常显示
- 切换 layout mode（single/dual/triple/quad）CSS grid 正确
- inactive pane 显示 loading → snapshot
- active pane 显示真实 timeline
- 关闭 pane 不报错
- 普通模式 URL 直接进入 split mode 正常

**风险**：中-高；多 pane 渲染可能放大现有 timeline 性能问题。

### PR-4: chat/+page.svelte 集成 + active 切换（~1.5 pd）

**包含**：
- chat page 条件渲染：`{#if split.enabled} <SplitWorkspace> {:else} <ChatConversationStage> {/if}`
- onMount hook：`?split=1` 自动 enter
- beforeNavigate hook：退出 chat 时 exit
- active pane 切换：旧 active 缓存 snapshot + 新 active `store.loadRun`
- input / stop / resume / permission response 路由验证（**pane 切换前后发消息必须到正确 runId**）

**验收**：
- 在 split 中切 active，发的消息进入正确 run
- 退出 split 后 active pane 的会话保持 URL `?run=xxx`
- 关闭 active pane 自动激活下一个；最后一个触发 exit
- 普通模式行为完全不变（最关键回归测试）

**风险**：高；sessionStore 单例与多 pane 切换的边界最容易踩坑。**必须**做手动 e2e：
1. 进入 split（2 pane：run A active, run B inactive）
2. 在 active pane 发消息 → run A 收到 ✓
3. 点 B pane 头部 → 切换 active（B 现在 active）
4. 在 B 发消息 → run B 收到 ✓
5. A 应该仍然显示之前的 timeline（snapshot 缓存生效）✓
6. 退出 split → URL 变 `?run=B`，普通模式正确显示 B

### PR-5: 右侧边栏 suspend + 性能 + 收尾（~1 pd）

**包含**：
- ToolActivity 接收 `suspended` prop；替换为 `SplitSidebarPlaceholder`
- WorkspaceContextPanel `$effect` 加 `suspended` 短路
- GitWorktreePanel 同上
- memoryStore.loadCandidates 加 split.suspended guard
- 4 pane 并排 + 长 timeline 性能 benchmark（手动）
- 边界 case：pane 关闭 + 切换 + 快速拖拽不串线
- `pnpm verify` 全过

**验收**：
- 进入 split 后 Network 看不到 memory / file tree / git fetch
- 退出 split 后 Network 重新看到 fetch
- 4 pane 长会话不卡死（DevTools Performance 验证 < 100ms frame）
- 快速操作（1 秒内拖 3 次 + 关 1 次 + 切 2 次）无 timeline 串线

**风险**：中；性能问题可能暴露，需要看实际数据决定是否需要进一步优化。

---

## 13. 验收清单（整体 v1.0.8 发布前）

- [ ] 拖入会话可创建 2/3/4 pane ✓
- [ ] 关闭 pane、激活 pane、退出分屏正常 ✓
- [ ] 分屏状态下右侧边栏不加载数据（Network 验证）✓
- [ ] active pane 发送不会发错会话（手动 e2e 验证 5 步流程）✓
- [ ] 快速拖拽、关闭、切换不会出现 timeline 串线（压力测试）✓
- [ ] 长会话和大工具结果不会明显卡死（4 pane × 1000 entries benchmark）✓
- [ ] 普通非分屏聊天模式行为完全不变（回归 test）✓
- [ ] 4 pane 上限触发时显示 toast ✓
- [ ] 重复 run 拖入激活已有 pane ✓
- [ ] i18n 双语对齐 ✓
- [ ] design tokens 复用，无硬编码颜色 / 圆角 / 阴影 ✓
- [ ] `pnpm verify` 全过 ✓
- [ ] `pnpm test` 全过（含 split store 单元测试）✓
- [ ] 单元测试覆盖率 split 模块 ≥ 70% ✓

---

## 14. 风险登记

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| **R1** | session-store 单例与多 pane 状态隔离冲突 | 🔴 高 | PR-4 强制 1 个 active pane 策略；inactive pane 走 snapshot 不订阅 store |
| **R2** | 4 pane × 长 timeline 性能 | 🟠 中 | renderLimit 200 + burst 默认折叠 + PR-5 benchmark 验证；不达标则继续压缩 |
| **R3** | 右侧边栏 suspend 不完整 | 🟠 中 | PR-5 强制 Network 验证；若仍有 fetch 找到源头补 guard |
| **R4** | DnD 协议冲突 | 🟡 低 | MIME type 完全隔离；三套协议并存测试 |
| **R5** | pane 关闭后 active 切换丢失消息 | 🔴 高 | PR-4 强制 e2e：切 active + 发消息 + 切回原 active 验证消息未丢 |
| **R6** | XTerminal 与多 store 兼容 | 🟡 低 | XTerminal 只挂 active pane（PR-3 显式约束） |
| **R7** | split 启用时 store.run 状态对应 active pane；URL 与 store 不同步 | 🟠 中 | 退出 split 写回 URL `?run=activePane.runId`；普通模式直接走现有逻辑 |

---

## 15. 与现有架构资产的复用

| 资产 | 复用位置 |
|------|----------|
| `sessionStore._loadGen` generation guard | `SplitPaneSessionAdapter` 沿用同一模式（每个 pane 自己 _generations Map） |
| `snapshotCache` (chat-bootstrap-cache.ts) | `SplitPaneSessionAdapter.fetchSnapshot` 走 cache 命中 |
| `api.getRun / getBusEvents / loadRun` | adapter 全部走 transport 抽象 |
| `ChatConversationStage` + `ChatInputDock` | SplitChatPane 直接复用（不复制实现） |
| `use-timeline-state` renderLimit | split mode 初始 200（参数化） |
| `use-tool-burst-collapse` | inactive pane 默认全折叠 |
| SidebarSessionItem `ondragstart` 协议 | 扩展 setData 1 条 MIME，不改组件 |
| design tokens / motion.css | 新组件全部复用 |

---

## 16. 不在本 PR 范围内（v1.0.8 不做）

- ❌ 自由 resize pane
- ❌ 同时多 pane 写
- ❌ 拖拽重排 pane 顺序
- ❌ pane 布局记忆（localStorage 持久化 layoutMode）
- ❌ 大 markdown / code block 延迟渲染
- ❌ 把 split 模式从普通 chat 路由到独立 route（保持同一 `/chat` 路由）
- ❌ god file 拆分（session-store / +layout / types.ts）—— PLAN_V1.0.6 工作
- ❌ ADR / Fitness Function —— Phase 4 工作
- ❌ ADR-0011 Split Workspace（建议 PR-1 完成后写 1 个 ADR 记录架构决策）

---

## 17. 决策记录（待 PR-1 完成后写 ADR）

### ADR-0011: Split Workspace 第一版单 store + adapter 策略

- **状态**：proposed（v1.0.8 PR-1 完成后定稿）
- **背景**：分屏需要 N 个 run 的状态共存，但 sessionStore 是单例 god store（3932 行，拆分不在本 PR 范围）
- **决策**：active pane 走 sessionStore（写入路径），inactive pane 走 snapshot cache（只读路径）
- **代价**：inactive pane 不显示实时事件（用户可接受：第一版定位是"查看"，不是"协作"）
- **替代方案**：实例化 N 个 SessionStore（拒绝：god store 已经 3932 行，实例化会放大复杂度）
- **替代方案**：拆 sessionStore 后再上 split（拒绝：拆分是 PLAN_V1.0.6 Phase 3，跨季度工作）
- **何时重新评估**：若用户强烈要求"inactive pane 也看实时事件"，触发 v1.1.x 重做

---

**文档结束。**

> 第一版核心是**控制风险**：P0 三件事（suspend / 隔离 / 归属）做对就成功。**避免**一上来就支持多 pane 写入 / 自由 resize / 重排 / 持久化。**先把分屏跑起来，行为正确，性能可控**，v1.1 / v1.2 再迭代。