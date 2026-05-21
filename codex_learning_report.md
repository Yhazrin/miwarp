# 从 Codex 学习心得：可落地到 MiWarp 的设计

## 概述

本报告分析 MiWarp 当前架构与 Codex CLI 的设计理念差异，总结可借鉴的设计模式并提供具体落地建议。

---

## 一、当前 MiWarp 架构分析

### 1.1 会话生命周期管理

MiWarp 使用 **Actor 模型** (`session_actor.rs`) 管理会话：

```
ActorCommand (mpsc mailbox)
    ├── SendMessage
    ├── SendControl
    ├── Stop
    ├── RespondPermission
    └── WaitReady
```

**Turn Transaction Engine** (`turn_engine.rs`) 负责 turn 的时序控制：

- `TurnOrigin::User` / `Internal` / `Ralph`
- `TurnPhase::Active` / `Draining`
- 软/硬超时机制
- Quarantine 隔离机制

### 1.2 双协议支持

MiWarp 已支持 Claude 和 Codex：

| 组件 | Claude | Codex |
|------|--------|-------|
| 协议解析 | `claude_protocol.rs` (stream-json) | `codex_parser.rs` (NDJSON) |
| 会话模式 | Actor + mpsc mailbox | `stream.rs` (独立进程管理) |
| Resume | Session ID | `thread_id` 作为 ConversationRef |

### 1.3 前端状态管理

使用 Svelte 5 Runes 模式：

```typescript
// Composable 模式
const sendMessage = createSendMessage(ctx);
const chatActions = createChatActions(ctx);

// 派生状态
let welcomeVisible = $derived(!runId && store.timeline.length === 0);
```

---

## 二、Codex 设计亮点

### 2.1 简化的事件模型

Codex 使用简洁的 NDJSON 格式：

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"type":"command_execution","command":"ls","output":"..."}}
{"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N}}
```

**可借鉴点**：事件类型更少、更扁平，解析逻辑简单清晰。

### 2.2 Command Execution 的原生输出

Codex 直接在事件中包含命令执行结果：

```json
{"type":"item.completed","item":{"type":"command_execution","command":"ls","output":"..."}}
```

MiWarp 目前需要通过 `ToolEnd` + `CommandOutput` 组合实现。

**可借鉴点**：考虑增加统一的 `CommandExecution` 事件类型。

### 2.3 Thread-based 会话模型

Codex 使用 `thread_id` 作为会话标识，天然支持：
- 多轮对话共享上下文
- 跨会话的 thread resume
- 轻量级的会话持久化

---

## 三、可落地方案

### 3.1 统一事件总线

**现状**：Claude 和 Codex 使用不同的解析路径

**改进建议**：提取公共的 `EventEmitter` trait

```rust
pub trait EventParser: Send {
    fn parse_line(&self, run_id: &str, raw: &Value) -> Vec<BusEvent>;
    fn extract_delta(&self, payload: &Value) -> Option<String>;
}

pub struct UnifiedEventRouter {
    parsers: HashMap<String, Box<dyn EventParser>>,
    active_parser: String,
}
```

### 3.2 增强 Codex 支持

**待实现功能**：

| 功能 | Claude 实现 | Codex 对应 |
|------|------------|-----------|
| 工具调用 | `ToolStart/ToolEnd` | 暂无 |
| Permission Prompt | `can_use_tool` control_request | 需要适配 |
| 上下文管理 | `/context` slash command | Codex 自身处理 |
| Fork/Resume | Session ID | `thread_id` |

**Action**: 完善 `codex_parser.rs` 以支持更多事件类型

### 3.3 Ralph Loop 的通用化

当前 Ralph Loop (`session_actor.rs`) 实现了自动迭代模式：

```rust
struct RalphLoopState {
    phase: RalphPhase,
    iteration: u32,
    max_iterations: u32,
    completion_promise: Option<String>,
    retry_after: Option<Instant>,
}
```

**可扩展方向**：
- 支持 Codex 的自动修复循环
- 添加 `AgentLoop` trait 抽象

### 3.4 团队协作增强

MiWarp 已有 `TeamDispatch` 系统，可借鉴 Codex 的 multi-agent 协作模式：

```typescript
// 当前团队分发模式
const team = createTeamDispatch({ store, getSendMessage });
team.handleTeamDispatch(teamDispatchPrompt);
```

**可增强**：
- Agent 角色定义 (architect, reviewer, coder)
- 任务队列与依赖管理
- 跨 agent 的上下文共享

### 3.5 性能优化

**现状**：每个会话一个独立的 tokio task

**可优化点**：

1. **连接池化**：复用 Codex CLI 实例
2. **增量解析**：对于长输出，使用流式解析
3. **批量事件**：合并高频事件减少 emit 开销

---

## 四、实施优先级

### P0 - 高优先级

1. **完善 Codex 协议支持**
   - 添加 `ToolStart/ToolEnd` 事件映射
   - 实现 Codex 特有的 permission handling
   - 文件修改的 diff 展示

2. **统一事件解析层**
   - 抽取 `EventParser` trait
   - 统一 `BusEvent` 到前端的事件流

### P1 - 中优先级

3. **增强团队协作**
   - 多 agent 角色系统
   - 任务依赖与串行/并行执行

4. **性能优化**
   - Delta 缓冲合并
   - 连接池化

### P2 - 低优先级

5. **Ralph Loop 通用化**
6. **Extended Thinking UI 优化**
7. **Auto-commit 增强**

---

## 五、关键技术点

### 5.1 传输层抽象

现有设计良好，支持桌面和浏览器双端运行：

```typescript
const transport = getTransport(); // TauriTransport | WsTransport
transport.invoke<T>("command", args);
```

### 5.2 安全模型

```rust
enum PermissionMode {
    Default,       // 每次询问
    AcceptEdits,   // 自动读取
    BypassPermissions, // 完全放行
    Plan,          // 仅规划模式
}
```

### 5.3 错误恢复

Quarantine 机制对 Codex 同样适用，保持现有设计。

---

## 六、总结

| 学习点 | 当前状态 | 改进方向 |
|--------|----------|----------|
| 简化事件模型 | Claude 和 Codex 分离解析 | 统一 `EventParser` trait |
| Thread-based 会话 | 使用 actor 管理 | 增强 Codex thread_id 支持 |
| 命令执行输出 | ToolEnd + CommandOutput | 添加 CommandExecution 事件 |
| 团队协作 | TeamDispatch 系统 | 增强多角色和依赖管理 |
| 性能优化 | 独立 tokio task | 连接池化 + 增量缓冲 |

**核心建议**：以统一的 `EventParser` trait 为基础，完善 Codex 协议支持，同时保持 Actor 模型的会话管理优势。

---

*生成时间：2026-05-21*
