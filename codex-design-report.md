# Codex/Claude Code 设计模式学习报告

## 研究目标
从 Claude Code/Cowork 设计中学习有用的设计，落地到 MiWarp 项目中。

---

## 一、核心架构设计

### 1. 事件中间件架构 (EventMiddleware) ✅ 已实现
**现状**: MiWarp 已有 `src/lib/stores/event-middleware.ts`，实现了微批次处理（16ms）、Tauri/WebSocket 统一传输、run_id 路由分发。

**可增强**:
- 添加事件优先级队列，区分高优先级（tool_end）与低优先级（delta）事件
- 实现事件去重（deduplication），避免重复处理同一条消息

### 2. Session Actor 模式 ✅ 已实现
**现状**: `src-tauri/src/agent/session_actor.rs` 已实现 tokio actor + bounded mpsc mailbox。

**可优化**:
- 添加 actor 状态快照（snapshot），支持断点重连
- 实现 actor 级别的内存估算与自动回收

---

## 二、计划任务 (Scheduled Tasks) 设计

### 3. 任务依赖与触发器 ⭐ 建议实现

Claude Code/Cowork 支持任务依赖和事件触发，MiWarp 已定义类型但未实现：

```typescript
// src/lib/types/scheduled-task.ts 已定义
interface TaskDependency {
  taskId: string;
  type: "complete" | "failed" | "any";
}

interface TaskEventTrigger {
  type: "file_change" | "task_complete" | "schedule";
  pattern?: string;
  sourceTaskId?: string;
}
```

**落地建议**:
1. 后端: `src-tauri/src/scheduler/` 添加依赖图（dependency graph）
2. 前端: 任务创建 UI 添加依赖选择器
3. 调度器: 支持文件变化监控（fs watcher）

### 4. 重试配置 ⭐ 建议实现

```typescript
interface RetryConfig {
  maxRetries: number;
  backoff: "linear" | "exponential" | "fixed";
  initialDelayMs?: number;  // Default: 1000
  maxDelayMs?: number;      // Default: 60000
}
```

**落地建议**:
- 在任务执行失败时自动应用重试策略
- 前端 UI 显示重试状态与剩余次数

### 5. 任务通知系统 ⭐ 建议实现

```typescript
interface ScheduledTask {
  notifications?: {
    onStart?: boolean;
    onComplete?: boolean;
    onFailure?: boolean;
  };
}
```

**落地建议**:
- 实现系统通知（via Tauri notification API）
- 任务运行面板添加通知开关

---

## 三、命令面板 (Command Palette) 增强

### 6. 命令使用统计 ⭐ 建议实现

当前 `src/lib/commands.ts` 已有使用统计基础设施：

```typescript
interface CommandDef {
  fuzzyKeywords?: string[];   // 模糊匹配关键词
  usageCount?: number;        // 使用次数
  icon?: string;              // 命令图标
  contextPhases?: SessionPhase[];
  showDuringRun?: boolean;
  showWhenIdle?: boolean;
}
```

**落地建议**:
1. 命令排序按使用频率（usageCount）提升优先级
2. 实现"最近使用"智能排序
3. 添加命令预览（preview function）
4. 根据当前会话阶段动态过滤可用命令

### 7. 命令模糊搜索优化

**现状**: 已有 `fuzzyKeywords` 支持。

**可增强**:
- 使用 Fuse.js 实现更智能的模糊匹配
- 支持中文拼音首字母搜索（中文用户友好）

---

## 四、Git Worktree 集成

### 8. 工作树（Worktree）管理 ✅ 已实现

`src/lib/components/GitWorktreePanel.svelte` 已完整实现：
- 提交时间线
- 分支切换
- 自动提交
- PR 创建

**可增强**:
- 添加工作树冲突检测与可视化
- 支持工作树之间的任务分配

---

## 五、Session 生命周期管理

### 9. Subagent 路由 ⭐ 建议优化

当前 `session-store.svelte.ts` 已支持 subagent thinking 路由。

**可增强**:
- 支持 subagent 并行执行可视化
- 添加 subagent 状态追踪面板

### 10. 会话持久化与恢复 ⭐ 建议实现

**落地建议**:
- 实现会话快照（snapshot）保存
- 支持断点重连（resume from checkpoint）
- 添加"Rewind"功能（时间旅行）

---

## 六、UI/UX 最佳实践

### 11. 实时状态指示器

**建议实现**:
- 添加 AI"思考中"状态动画
- 工具执行进度可视化
- 上下文窗口使用量实时显示

### 12. 消息折叠与摘要

当前 `ChatMessage.svelte` 已有 `collapsed` 状态。

**可增强**:
- AI 回复长输出自动折叠，显示"Show more"
- Tool burst 批量折叠（已部分实现）

---

## 七、优先级建议

| 优先级 | 功能 | 复杂度 | 价值 |
|--------|------|--------|------|
| P0 | 命令使用统计与智能排序 | 低 | 高 |
| P0 | 任务依赖与触发器 | 中 | 高 |
| P1 | 重试配置与通知系统 | 低 | 中 |
| P1 | 会话快照与 Rewind | 高 | 高 |
| P2 | 虚拟滚动优化 | 中 | 中 |
| P2 | Subagent 可视化 | 中 | 中 |
| P3 | 模糊搜索优化（拼音） | 低 | 中 |

---

## 八、代码规范遵循

以下设计已符合 MiWarp 代码规范：

- ✅ 使用 Svelte 5 runes ($state, $derived, $effect)
- ✅ 通过 `getTransport()` 访问 Tauri API
- ✅ i18n 使用 `t('key')`
- ✅ Commit messages 使用 Conventional Commits
- ✅ Rust 使用 cargo fmt + clippy

---

## 结论

MiWarp 已经是一个设计良好的应用，Claude Code/Cowork 的设计理念大部分已被吸收。主要改进方向：

1. **增强计划任务系统** - 依赖、触发器、重试、通知
2. **优化命令面板** - 使用统计、模糊搜索、智能排序
3. **提升会话管理** - 快照、Rewind、Subagent 可视化
4. **性能优化** - 虚拟滚动、自适应批次

建议从 P0 优先级开始迭代开发。
