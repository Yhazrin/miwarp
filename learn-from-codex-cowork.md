# 从 Claude Code / Cowork 学习心得 - MiWarp 落地指南

## 一、核心架构设计已对齐 ✅

MiWarp 的架构已经实现了 Claude Code 的核心设计：

| Claude Code 模式 | MiWarp 实现 | 状态 |
|----------------|-----------|------|
| Actor + mpsc 邮箱 | `session_actor.rs` - 每个 CLI session 一个 actor | ✅ |
| Turn Engine 超时管理 | `turn_engine.rs` - 软/硬超时、活动检测 | ✅ |
| 流式 JSON 协议解析 | `claude_protocol.rs` / `pipe_parser.rs` | ✅ |
| Transport 抽象层 | `TauriTransport` / `WsTransport` 双模式 | ✅ |
| 权限路由到前端 | `PermissionPanel.svelte` / `ElicitationDialog.svelte` | ✅ |
| 序列号检查点恢复 | WebSocket 重连时序列号对齐 | ✅ |
| 16ms 微批次处理 | Event middleware 高性能事件处理 | ✅ |

---

## 二、推荐落地的设计与功能

### 1. Session 活动状态可视化 🚀

**参考 Claude Code：** Session 有明确的 `idle | thinking | streaming | waiting_approval | paused` 状态。

**当前 MiWarp：** `TurnPhase` 只有 `Active` / `Draining`。

**落地建议：**
```typescript
// src/lib/stores/session-store.svelte.ts 新增
export type SessionActivityState = 
  | 'idle'           // 空闲等待输入
  | 'thinking'       // AI 正在思考
  | 'streaming'      // 正在流式输出
  | 'waiting_approval' // 等待用户确认权限
  | 'paused';        // 已暂停

// 视觉反馈：动画 + 颜色
const stateStyles = {
  idle: 'bg-green-500/20 text-green-500',
  thinking: 'bg-blue-500/20 text-blue-500 animate-pulse',
  streaming: 'bg-purple-500/20 text-purple-500 animate-pulse',
  waiting_approval: 'bg-amber-500/20 text-amber-500',
  paused: 'bg-gray-500/20 text-gray-500',
};
```

**实现位置：** `src/lib/components/SessionInfoPanel.svelte`

---

### 2. 思维过程打字机效果 📝

**参考 Claude Code：** Thinking 内容逐字显示，带时长指示器。

**落地建议：**
```svelte
<!-- src/lib/components/ThinkingDisplay.svelte -->
<script lang="ts">
  let { content = '', duration = 0 } = $props();
  let displayText = $state('');
  
  $effect(() => {
    displayText = '';
    const chars = content.split('');
    let i = 0;
    const interval = setInterval(() => {
      if (i < chars.length) {
        displayText += chars[i++];
      } else {
        clearInterval(interval);
      }
    }, 20); // 50 chars/sec
  });
</script>

<div class="thinking-container">
  <span class="thinking-badge">💭</span>
  <span class="thinking-text">{displayText}</span>
  {#if duration > 0}
    <span class="thinking-duration">{duration}s</span>
  {/if}
</div>
```

---

### 3. 工具爆发可折叠显示 🔧

**参考 Claude Code：** 多个工具执行时显示汇总徽章，悬停展开详情。

**当前 MiWarp：** `ToolBurstHeader.svelte` 已有基础实现。

**增强建议：**
```svelte
<!-- 扩展 ToolBurstHeader.svelte -->
<div class="tool-burst-collapsible">
  <button class="tool-burst-badge" onclick={() => expanded = !expanded}>
    <span>🔧</span>
    <span>{tools.length} tools</span>
    {#if !expanded}
      <span class="summary">{summarizeTools(tools)}</span>
    {/if}
    <span class="chevron" class:rotated={expanded}>▼</span>
  </button>
  
  {#if expanded}
    <div class="tool-list">
      {#each tools as tool}
        <ToolDetailView {tool} />
      {/each}
    </div>
  {/if}
</div>
```

---

### 4. Fork 分支可视化 🌳

**参考 Claude Code：** 时间线式分支图，快速切换 (Cmd+\)。

**落地建议：**
```svelte
<!-- src/lib/components/SessionBranchTimeline.svelte -->
<script lang="ts">
  let { sessions = [] } = $props();
  
  // 渲染分支树结构
  // 主分支为垂直线
  // fork 点显示分支点
  // 快速切换按钮
</script>

<div class="branch-timeline">
  <div class="main-trunk">
    {#each timeline as event}
      {#if event.type === 'fork'}
        <div class="fork-node" onclick={() => switchTo(event.sessionId)}>
          <span class="fork-label">{event.label}</span>
        </div>
      {:else}
        <div class="turn-node">
          <span class="turn-index">{event.turnIndex}</span>
        </div>
      {/if}
    {/each}
  </div>
</div>
```

---

### 5. 命令面板增强 🎯

**当前 MiWarp：** `CommandPalette.svelte` 已实现模糊搜索 + 语义搜索 + 使用频率加权。

**参考 Claude Code 可进一步增强：**
- **图标显示**：每个命令旁边显示对应图标（当前已有 `commandIconMap`）
- **搜索高亮**：`highlightMatches()` 已实现，确保高亮清晰
- **快捷键提示**：悬停时显示键盘快捷键（已在 footer 实现）
- **上下文感知过滤**：
  ```typescript
  function filterCommands(query: string, agent: string) {
    let cmds = allCommands;
    
    // 运行中隐藏部分命令
    if (sessionStore.isRunning) {
      cmds = cmds.filter(cmd => cmd.showDuringRun !== false);
    }
    
    // 根据上下文过滤
    if (hasGitChanges) {
      cmds = cmds.filter(cmd => cmd.contextRequires?.git !== true);
    }
    
    return cmds;
  }
  ```

---

### 6. 多 Agent 并行可视化 📊

**当前 MiWarp：** `multi-agent/+page.svelte` 基础实现。

**参考 Claude Code Team 增强：**
```svelte
<!-- src/lib/components/AgentExecutionTimeline.svelte -->
<div class="agent-timeline">
  <!-- Gantt 风格时间线 -->
  <div class="timeline-header">
    <span>Agent</span>
    <span class="time-axis">
      {#each timeMarkers as marker}
        <span>{marker}</span>
      {/each}
    </span>
  </div>
  
  {#each agents as agent}
    <div class="agent-row">
      <div class="agent-identity">
        <Avatar name={agent.name} color={agent.color} />
        <StatusIndicator status={agent.status} />
      </div>
      <div class="execution-bar" 
           style="left: {agent.startPct}%; width: {agent.durationPct}%">
      </div>
    </div>
  {/each}
  
  <!-- 依赖箭头 -->
  <svg class="dependency-arrows">
    {#each dependencies as dep}
      <path d={dep.path} marker-end="url(#arrow)" />
    {/each}
  </svg>
</div>
```

---

### 7. 欢迎页个性化 �个性化的引导

**参考 Claude Code：** 根据项目类型显示不同快捷操作。

**落地建议：**
```typescript
// src/lib/components/WelcomeScreen.svelte
function detectProjectType(cwd: string): ProjectType {
  if (hasFile(cwd, 'package.json')) return 'node';
  if (hasFile(cwd, 'Cargo.toml')) return 'rust';
  if (hasFile(cwd, 'go.mod')) return 'go';
  if (hasFile(cwd, 'requirements.txt')) return 'python';
  return 'generic';
}

const projectShortcuts = {
  node: ['npm install', 'npm run dev', 'npm test'],
  rust: ['cargo build', 'cargo run', 'cargo test'],
  // ...
};
```

---

### 8. Phase-based Processing 多阶段处理 📋

**参考 Claude Code：** 复杂任务分解为多个阶段执行。

**落地建议：**
```rust
// src-tauri/src/agent/phase_processor.rs
pub struct PhaseProcessor {
    phases: Vec<Phase>,
    current: usize,
}

#[derive(Debug, Clone)]
pub struct Phase {
    pub name: String,
    pub description: String,
    pub executor: Box<dyn Fn(&str) -> Result<(), Error>>,
}

// 使用示例
let processor = PhaseProcessor::new(vec![
    Phase { name: "Take stock", description: "分析现状", executor: take_stock },
    Phase { name: "Consolidate", description: "整合信息", executor: consolidate },
    Phase { name: "Tidy index", description: "整理索引", executor: tidy_index },
]);
```

---

### 9. 技能市场与社区技能 💎

**当前 MiWarp：** `SkillMarketplace.svelte` + `community_skills.rs`。

**参考 Claude Code 增强：**
- 技能使用统计与排行
- 技能相似度推荐
- 技能版本管理
- 技能依赖自动安装

---

### 10. 上下文敏感建议 💡

**参考 Claude Code：** 根据最近工具序列推断下一个意图。

**落地建议：**
```typescript
// src/lib/stores/intent-suggestions.svelte.ts
export function suggestNextIntent(
  recentTools: Tool[],
  context: SessionContext
): Suggestion[] {
  // 模式检测
  const pattern = detectPattern(recentTools);
  
  switch (pattern) {
    case 'edit-flow':
      return [
        { action: 'git_diff', label: '查看改动' },
        { action: 'git_commit', label: '提交代码' },
      ];
    case 'test-flow':
      return [
        { action: 'run_test', label: '运行测试' },
        { action: 'open_coverage', label: '查看覆盖率' },
      ];
    // ...
  }
}
```

---

## 三、落地优先级

### 🔥 高优先级（快速落地）

| 功能 | 复杂度 | 收益 | 实现文件 |
|-----|-------|------|---------|
| Session 状态动画 | 低 | 高 | `SessionInfoPanel.svelte` |
| 思维过程显示 | 低 | 高 | 新建 `ThinkingDisplay.svelte` |
| 工具爆发折叠 | 低 | 中 | 增强 `ToolBurstHeader.svelte` |
| 命令面板图标 | 低 | 中 | `CommandPalette.svelte` |
| 快捷键提示 | 低 | 高 | 全局 hover 提示 |

### 🚧 中优先级（功能增强）

| 功能 | 复杂度 | 收益 | 实现文件 |
|-----|-------|------|---------|
| Fork 分支时间线 | 中 | 高 | 新建 `BranchTimeline.svelte` |
| 多 Agent 可视化 | 中 | 高 | 增强 `multi-agent/+page.svelte` |
| 欢迎页个性化 | 中 | 中 | 增强 `+page.svelte` (首页) |
| Phase Processor | 中 | 高 | 新建 `phase_processor.rs` |
| 意图建议 | 中 | 中 | 新建 `intent-suggestions.svelte.ts` |

### 🔮 长期规划（架构增强）

| 功能 | 复杂度 | 收益 | 说明 |
|-----|-------|------|------|
| 任务分解器 | 高 | 高 | AI 驱动复杂任务拆分 |
| 连接器注册表 | 高 | 高 | 统一工具集成 |
| 内存自动管理 | 高 | 中 | 定期清理/优化上下文 |
| 跨 Agent 通信 | 高 | 高 | 更丰富的团队协作模式 |

---

## 四、关键参考文件

### 后端 (Rust)
- `src-tauri/src/agent/session_actor.rs` - Session 生命周期管理
- `src-tauri/src/agent/turn_engine.rs` - Turn 超时与活动检测
- `src-tauri/src/agent/claude_protocol.rs` - JSON 协议解析
- `src-tauri/src/scheduler/` - 定时任务调度

### 前端 (Svelte)
- `src/lib/stores/session-store.svelte.ts` - Session 状态管理
- `src/lib/components/CommandPalette.svelte` - 命令面板 ⭐️ 已很完善
- `src/routes/multi-agent/+page.svelte` - 多 Agent 执行
- `src/routes/teams/+page.svelte` - 团队协作
- `src/lib/components/PermissionPanel.svelte` - 权限管理

### 工具与服务
- `src/lib/commands/` - 命令定义与搜索
- `src/lib/services/multi-agent-service.ts` - 多 Agent 服务
- `src/lib/transport/` - Transport 抽象层

---

## 五、总结

MiWarp 的架构设计已经很好地对齐了 Claude Code 的核心模式。主要的提升空间在于：

1. **UI/UX 体验增强** - 状态动画、视觉反馈、交互细节
2. **智能化功能** - 意图建议、上下文感知、个性化推荐
3. **可视化增强** - 分支图、Agent 时间线、执行进度
4. **高级编排** - 任务分解、多阶段处理、并行优化

建议从 **Session 状态可视化** 和 **命令面板增强** 开始，这两个功能影响面广且实现成本低。