# Claude Code / Codex 设计模式学习笔记

> 基于竞品分析文档和代码库研究，总结可落地到 MiWarp 的设计模式

---

## 一、已识别的 10 个核心模式（来自竞品分析）

### 1. 双信号状态指示器 ✓ 可直接实现

**来源**: Claude Code  
**现状**: MiWarp 用单一颜色表示状态  
**升级方案**: 颜色 + 图标形状同时传达两个维度

```rust
// 状态（颜色）+ 进程（形状）
// running → 绿色 + 活跃动画
// idle → 蓝色 + 静态圆点
// failed → 红色 + 叉号
// paused → 黄色 + 暂停符号
```

**落地文件**: `src/lib/components/SessionInfoPanel.svelte` 或新建 `StatusIndicator.svelte`

### 2. Peek 面板 — 空格预览会话 ✓ 建议实现

**来源**: Claude Code  
**现状**: 点击会话才看详情  
**升级方案**: 按空格预览，不离开列表

- 显示最新输出、当前需求、打开的 PR
- 多选题显示为数字键快捷选项
- Tab 填入建议回复

**落地文件**: `src/routes/explorer/+page.svelte` 或新建 `SessionPeek.svelte`

### 3. 检查点时间线 ✓ 中期实现

**来源**: Cursor + Cline  
**现状**: MiWarp 只有工具调用列表  
**升级方案**: 自动在重大变更前创建检查点

```typescript
interface Checkpoint {
  id: string;
  turnIndex: number;
  files: string[];           // 变更的文件快照
  description: string;       // 自动生成的描述
  createdAt: string;
}
```

**落地文件**: `src-tauri/src/storage/checkpoints.rs` (新建) + `src/lib/stores/checkpoint-store.svelte.ts`

### 4. 上下文窗口可视化 ✓ 建议实现

**来源**: Claude Code  
**现状**: 用户不知道 context 被什么占满了  
**升级方案**: 彩色比例条显示 context 消耗

```
┌─────────────────────────────────────┐
│ System │ Env │ CLAUDE.md │ Files │.. │  185K / 200K
└─────────────────────────────────────┘
```

**落地文件**: `src/lib/components/ContextBar.svelte` + `src/lib/stores/context-monitor.svelte.ts`

### 5. 阶段化执行显示 ✓ 可直接实现

**来源**: Cline + Codex  
**现状**: 工具调用平铺，没有结构  
**升级方案**: 清晰的阶段划分

```
┌─ Planning ─────────────────────────────────┐
│ [分析文件结构] [AST 解析] [搜索依赖]        │
├─ Executing ───────────────────────────────┤
│ [编辑 main.ts] [终端命令] [API 调用]        │
├─ Reviewing ──────────────────────────────┤
│ [汇总结果] [生成建议] [待确认]              │
└───────────────────────────────────────────┘
```

**落地文件**: `src/lib/components/PhaseIndicator.svelte` + `src/lib/stores/turn-engine.svelte.ts`

### 6. 实时摘要 ✓ 中期实现

**来源**: Claude Code + Windsurf  
**现状**: 显示原始工具输出  
**升级方案**: 用快速模型生成一句话摘要

```typescript
// 每个工具调用完成后，生成简短摘要
interface ToolCallSummary {
  toolUseId: string;
  summary: string;      // "读取 3 个文件", "修改了 5 行代码"
  duration: number;    // 执行时长 ms
  result: "success" | "failed" | "partial";
}
```

**落地文件**: `src/lib/stores/ai-summary.svelte.ts` (新建)

### 7. 转录视图模式 ✓ 建议实现

**来源**: Claude Code  
**现状**: 只有一种显示密度  
**升级方案**: 三种模式 Ctrl+O 切换

| 模式 | 显示内容 |
|------|---------|
| 普通 | 工具调用折叠为摘要，完整文本响应 |
| 详细 | 每个工具调用、文件读取、中间步骤 |
| 摘要 | 只有最终响应和所做的更改 |

**落地文件**: `src/lib/stores/transcript-view.svelte.ts` (新建) + `src/lib/components/TranscriptView.svelte`

### 8. Diff 统计 + 行内评论 ✓ 中期实现

**来源**: Claude Code + Copilot  
**现状**: diff 只是展示  
**升级方案**: `+12 -1` 可点击徽章 → 行内 diff 查看器

```typescript
interface DiffBadge {
  added: number;
  removed: number;
  file: string;
  line: number;
  comments: Comment[];
}
```

**落地文件**: `src/lib/components/DiffBadge.svelte` + `src/lib/components/InlineComment.svelte`

### 9. 云端 Agent + 制品交付 ✓ 长期愿景

**来源**: Cursor  
**现状**: 只有本地 agent  
**升级方案**: 云端 agent 产出截图/视频/日志

**优先级**: P3 长期

### 10. 分层权限系统 ✓ 建议实现

**来源**: Claude Code + Cline + Codex  
**现状**: 简单的允许/拒绝  
**升级方案**: 多层权限体系

```typescript
interface PermissionPolicy {
  toolName: string;
  autoApprove: boolean;
  sandboxLevel: "read-only" | "workspace-write" | "full";
  requiresConfirmation: boolean;
  hooks: Hook[];
}
```

**落地文件**: `src-tauri/src/commands/permission_policy.rs` + `src/lib/stores/permission-store.svelte.ts`

---

## 二、Claude Code 特色功能映射

### Haiku 实时摘要

Claude Code 每 15 秒用 Haiku 模型刷新一句话摘要。

**MiWarp 方案** (轻量级):
```typescript
// 不引入额外模型，而是从工具调用自动生成摘要
function generateSummary(tools: HookEvent[]): string {
  const counts = tools.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});
  return `使用了 ${counts.Read || 0} 个 Read，${counts.Bash || 0} 个 Bash...`;
}
```

### /goal 实时面板

显示长任务的运行时间、轮次、token 消耗。

**MiWarp 已有基础**:
- `turnUsages` 数组记录 per-turn usage
- 需要添加 UI 组件显示

### Peek 面板

**MiWarp 可借用**:
```svelte
{#if hoveredSession}
  <div class="peek-panel">
    <SessionPreview session={hoveredSession} />
    <div class="actions">
      <kbd>Space</kbd> 继续对话
      <kbd>Tab</kbd> 填入建议
    </div>
  </div>
{/if}
```

---

## 三、Codex CLI 协议解析参考

### NDJSON 事件类型

MiWarp 已实现的解析 (`codex_parser.rs`):

```rust
// Codex v0.98+ 格式
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"type":"command_execution","command":"ls","output":"..."}}
{"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N}}
```

**落地**: 扩展 `codex_parser.rs` 支持更多 item 类型

---

## 四、立即可落地的 P0 功能

### 1. 双信号状态指示器

```svelte
<!-- src/lib/components/StatusIndicator.svelte -->
<script lang="ts">
  interface Props {
    state: 'running' | 'idle' | 'failed' | 'paused' | 'stopped';
    isActive?: boolean;  // 进程是否活跃
  }
  
  const shapes = {
    running: { active: '◉', inactive: '○' },
    idle: { active: '●', inactive: '·' },
    failed: { active: '✗', inactive: '✗' },
    paused: { active: '⏸', inactive: '⏸' },
    stopped: { active: '■', inactive: '■' },
  };
</script>

<span class="indicator" class:active={isActive}>
  {shapes[state][isActive ? 'active' : 'inactive']}
</span>
```

### 2. 阶段化执行显示

```svelte
<!-- src/lib/components/PhaseIndicator.svelte -->
<script lang="ts">
  type Phase = 'planning' | 'executing' | 'reviewing';
  
  interface Props {
    currentPhase: Phase;
    progress: { planning: number; executing: number; reviewing: number };
  }
</script>

<div class="phases">
  {#each ['planning', 'executing', 'reviewing'] as phase}
    <div class="phase" class:active={currentPhase === phase}>
      <span class="icon">{phase === 'planning' ? '📋' : phase === 'executing' ? '⚡' : '🔍'}</span>
      <span class="label">{phase}</span>
      <div class="progress" style="width: {progress[phase]}%"></div>
    </div>
  {/each}
</div>
```

### 3. 上下文窗口可视化

```svelte
<!-- src/lib/components/ContextBar.svelte -->
<script lang="ts">
  interface Props {
    used: number;
    max: number;  // 通常 200000 for 200K context
    breakdown: { label: string; size: number; color: string }[];
  }
  
  const getColor = (label: string) => {
    const colors = {
      'System': '#6B7280',
      'Environment': '#10B981',
      'CLAUDE.md': '#3B82F6',
      'Files': '#F59E0B',
      'Tools': '#EF4444',
    };
    return colors[label] || '#9CA3AF';
  };
</script>

<div class="context-bar">
  <div class="bar">
    {#each breakdown as segment}
      <div 
        class="segment" 
        style="width: {segment.size / max * 100}%; background: {segment.color}"
        title="{segment.label}: {segment.size}"
      ></div>
    {/each}
  </div>
  <span class="label">{used.toLocaleString()} / {max.toLocaleString()}</span>
</div>
```

### 4. 转录视图模式切换

```svelte
<!-- src/lib/components/TranscriptView.svelte -->
<script lang="ts">
  type ViewMode = 'normal' | 'detailed' | 'summary';
  
  let mode: ViewMode = $state('normal');
  
  function toggle() {
    const modes: ViewMode[] = ['normal', 'detailed', 'summary'];
    const idx = modes.indexOf(mode);
    mode = modes[(idx + 1) % modes.length];
  }
</script>

<div class="transcript" data-mode={mode}>
  <!-- 根据 mode 渲染不同密度 -->
</div>
```

---

## 五、架构层面的借鉴

### 1. Actor 模型（已实现）

MiWarp 的 `SessionActor` 已经是成熟的 actor 模型:
- 单个 actor 拥有进程 stdin/stdout
- 所有操作通过 mailbox 顺序执行
- 这与 Claude Code 的架构一致

### 2. Turn Engine（已实现）

`turn_engine.rs` 实现了:
- User Turn / Internal Turn 区分
- Soft/Hard timeout
- Activity-based deadline reset
- Quarantine 机制

这与 Claude Code 的 turn 管理方式类似。

### 3. Ralph Loop（已实现）

MiWarp 的 `RalphLoopState` 实现了自动重试机制。

---

## 六、建议的优先级排序

### P0 — 立即实施（1-2周）
1. 双信号状态指示器
2. 阶段化执行显示
3. 上下文窗口可视化
4. 转录视图模式

### P1 — 短期实施（1个月）
5. Peek 面板
6. 实时摘要（轻量版）
7. Diff 统计 + 行内评论
8. 检查点时间线

### P2 — 中期实施（2-3个月）
9. 分层权限系统
10. /goal 实时面板
11. 成本追踪
12. 多 Agent 平铺

### P3 — 长期愿景
13. 云端 Agent + 制品
14. 远程桌面接管
15. Flow 感知

---

## 七、参考资源

- Claude Code 文档: docs.anthropic.com/en/docs/claude-code
- Codex CLI: github.com/sourcegraph/sourcegraph/tree/main/client/cmd/cody
- 竞品分析: docs/COMPETITIVE_ANALYSIS.md