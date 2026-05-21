# Codex Claude Code 设计模式研究 & MiWarp 落地建议

> 生成时间: 2026/05/21
> 基于代码库分析和 Codex CLI 研究

---

## 一、Codex 与 Claude Code 的核心差异

| 维度 | Codex | Claude Code |
|------|-------|-------------|
| 通信模式 | NDJSON (pipe-exec) | Stream-JSON (交互式) |
| stdin | 无 (批处理模式) | 双向 |
| 会话模型 | Thread-based | Session-based |
| 实时 UI | 否 (运行至完成) | 是 (流式) |
| 功能范围 | 精简 | 完整 |

---

## 二、Codex 值得借鉴的设计模式

### 1. 结构化事件协议 (NDJSON)

**现状**: Codex 使用 NDJSON 流输出结构化事件，包含类型标记和完整的元数据。

**可借鉴点**:
- 使用 `type` 字段区分事件类型 (`agent_message`, `command_execution`, `turn.completed`)
- 包含 token 使用统计 (`usage` 字段)
- 命令输出格式化为 `$ cmd\noutput`

**落地建议**:
```typescript
// 在前端增强事件显示
interface ParsedEvent {
  type: 'agent_message' | 'command_execution' | 'turn.completed';
  data: AgentMessage | CommandExecution | TurnCompleted;
  timestamp: number;
}
```

### 2. Session Threading 模型

**现状**: Codex 捕获 `thread_id` 用于会话恢复。

**可借鉴点**:
- 会话可以被持久化和恢复
- 支持多轮对话上下文

**落地建议**:
```rust
// 在 Rust 端增强 thread_id 存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadContext {
    thread_id: String,
    created_at: DateTime<Utc>,
    last_accessed: DateTime<Utc>,
}
```

### 3. 特性标志系统

**现状**: `agent-features.ts` 定义了每个 agent 支持的功能:

```typescript
const AGENT_FEATURES: Record<AgentType, AgentFeatureFlags> = {
  'claude-code': {
    showEffortSelector: true,
    showPlanModeToggle: true,
    showPermissionMode: true,
    showSlashMenu: true,
    showAddDirectory: true,
  },
  'codex': {
    showEffortSelector: false,
    showPlanModeToggle: false,
    showPermissionMode: false,
    showSlashMenu: false,
    showAddDirectory: false,
  },
};
```

**可借鉴点**: 功能开关而非条件代码，使新功能更容易按 agent 启用。

### 4. Mini App / 插件系统

**潜在方向**: Codex 风格的可扩展小应用机制。

---

## 三、具体落地建议清单

### 高优先级

1. **完善 Codex Session Resume 功能**
   - 当前 `canResumeRun` 对 Codex 返回 false
   - 实现 thread_id 持久化和恢复 UI

2. **增强 token 使用统计**
   - 在前端显示 input/output tokens
   - 添加 usage 面板

3. **优化命令输出格式化**
   - 统一显示格式: `$ command\noutput`
   - 添加语法高亮

### 中优先级

4. **Agent Feature Flags 扩展**
   - 添加 `showContext7` / `showBrowser` 等标志
   - 在 UI 层根据标志条件渲染

5. **NDJSON 事件解析增强**
   - 添加对更多事件类型的支持
   - 实现事件回放功能

6. **Scheduler 多 Agent 支持**
   - 当前支持 Codex 作为 agent
   - 考虑添加 agent 选择器

---

## 四、参考实现文件

| 文件 | 说明 |
|------|------|
| `src-tauri/src/agent/codex_parser.rs` | Codex NDJSON 解析器 |
| `src-tauri/src/agent/pipe_parser.rs` | 管道输出解析 trait |
| `src/lib/utils/agent-features.ts` | Agent 特性标志定义 |
| `src/lib/stores/` | Svelte 5 状态管理 |
| `src-tauri/src/storage/` | 本地持久化 |

---

## 五、行动计划

1. [ ] Review Codex parser 实现，确认完整性
2. [ ] 实现 Session Resume UI for Codex
3. [ ] 添加 Token Usage 面板
4. [ ] 统一命令输出格式化
5. [ ] 扩展 Agent Feature Flags

---

*此报告由 scheduled task 自动生成*