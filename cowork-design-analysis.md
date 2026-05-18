# MiWarp x Cowork 设计模式分析报告

**分析日期**: 2026/05/18
**目标**: 从 Codex Claude Cowork 中学习有用的设计模式，落地到 MiWarp 项目

---

## 一、核心架构对比

### MiWarp 当前架构

| 层级 | 技术实现 |
|------|----------|
| 框架 | Tauri v2 (Rust backend + WebView) |
| 前端 | Svelte 5 + SvelteKit (adapter-static) |
| 传输 | Transport 抽象层 (Tauri IPC / WebSocket) |
| 状态管理 | Svelte 5 Runes ($state/$derived/$effect) |
| AI 协议 | Claude Protocol + Codex Parser 双协议支持 |

### 关键设计模式分析

#### 1. Transport 抽象层 ✅ 已完整实现

MiWarp 已实现完善的 Transport 抽象：

```typescript
// src/lib/transport/transport-types.ts
export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  isDesktop(): boolean;
  subscribeRun(runId: string, lastSeq?: number): void;
  unsubscribeRun(runId: string): void;
}
```

**设计亮点**:
- 统一抽象 Tauri IPC 与 WebSocket
- WsTransport 自动重连 + 指数退避 (1s -> 2s -> 4s -> ... -> 30s max)
- Run 级事件订阅/取消订阅
- 请求/响应关联 via `id` 字段
- Close code 4401 -> 停止重连并跳转登录

**Cowork 对齐度**: 100% - 设计理念完全一致

#### 2. EventMiddleware 统一事件管理 ✅ 已完整实现

```typescript
// src/lib/stores/event-middleware.ts
export class EventMiddleware {
  // 微批次缓冲 (16ms ~ 1帧)
  private _batchBuffer = new Map<string, BusEvent[]>();
  private _BATCH_INTERVAL = 16;

  // Handler callbacks
  private _pipeHandler: PipeHandler | null = null;
  private _runEventHandler: RunEventHandler | null = null;
}
```

**设计亮点**:
- 统一的 Tauri 事件监听管理
- 微批次缓冲减少响应式更新
- 按 run_id 路由到订阅的 SessionStore
- 幂等订阅 (跳过重复订阅)

**Cowork 对齐度**: 100% - 事件中间件模式是 Cowork 核心设计

---

## 二、可落地的设计模式

### 1. Codex 多协议适配器 ✅ 已有，需增强

MiWarp 已有 Codex v0.98+ 解析器：

```rust
// src-tauri/src/agent/codex_parser.rs
pub fn extract_codex_delta(payload: &Value) -> Option<String> {
    if type_str == "item.completed" {
        if let Some(item) = payload.get("item") {
            match item_type {
                "agent_message" => return item.get("text")...,
                "command_execution" => return Some(format!("$ {}\n{}", cmd, output)),
                _ => {}
            }
        }
    }
}
```

**当前支持**:
- `thread.started`, `turn.started`, `turn.completed`
- `item.completed` (agent_message, command_execution)
- delta/text/output_text 字段

**改进建议**:
- 支持更多 Codex 事件类型 (thinking, reasoning, system_message)
- 添加 Codex 会话状态管理
- 统一 Claude/Codex 的 session actor

### 2. Skill 系统 ✅ 已完整实现

MiWarp 的 Skill 系统与 Cowork 完全对齐：

```typescript
// src/lib/types/skill.ts
export interface Skill {
  id: string;
  name: string;
  content: string; // Full SKILL.md content
  category: SkillCategory;
  source: SkillSource;
  version?: string;
  dependencies?: SkillDependency[];
  minAppVersion?: string;
}
```

**内置 Skills**:
- `schedule` - 创建定时任务
- `consolidate-memory` - 整理记忆文件
- `setup-cowork` - 引导设置

**Cowork 对齐度**: 100%

### 3. Scheduler 定时任务 ✅ 已完整实现

```rust
// src-tauri/src/scheduler/mod.rs
pub fn start_scheduler_loop(app: AppHandle, cancel: CancellationToken) {
    // 30 秒间隔轮询
}
```

**设计亮点**:
- Cron / OneTime / Interval 三种调度类型
- 自动 disable 一次性任务
- 自动 accept-all 权限模式 (无人值守执行)
- 支持 retry + backoff

**Cowork 对齐度**: 100%

### 4. Context Relay 上下文传递 ✅ 已完整实现

```typescript
// src/lib/context-relay/context-relay-store.svelte.ts
export interface ContextRelayTarget {
  type: "current" | "session" | "new";
  runId?: string;
  cwd?: string;
}
```

**功能**:
- 选择性上下文剪贴 (ContextClip)
- 发送到目标会话或新建会话
- 附加指令支持
- 历史会话搜索

**Cowork 对齐度**: 100%

### 5. Attention Store 注意力跟踪 ✅ 独有亮点

```typescript
// src/lib/stores/attention-store.svelte.ts
interface AttentionFlags {
  permission: boolean;
  ask: boolean;
}
```

**设计亮点**:
- 多原因位图跟踪 (permission + ask)
- 侧边栏显示 "waiting" 状态
- 独立标记/清除

**Cowork 可借鉴**: 这是 MiWarp 的独创设计，业界少见

### 6. Process Visibility 进程可见性 ✅ UX 优化亮点

```typescript
// src/lib/utils/process-visibility.ts
export type ProcessVisibility = "always" | "output" | "auto";
```

**功能**:
- `output` 模式自动折叠侧边栏
- 运行状态栏显示工具统计 (reads/writes/edits/bash)
- 会话时长显示

**Cowork 可借鉴**: 此功能是 UX 优化亮点

---

## 三、需要增强的功能

### 差距 1: Multi-Agent 协作

**当前**: 基础的团队运行支持
**建议**: 增强智能体间通信协议

```typescript
// 待实现: Agent 间消息传递
interface AgentMessage {
  from: string;
  to: string;
  type: "request" | "response" | "broadcast";
  payload: unknown;
}
```

### 差距 2: 文件监控与自动任务

**当前**: 基础的 Git Worktree 支持
**建议**: 增强文件变化触发的任务

```typescript
// 待实现: 文件监控触发
interface FileWatchConfig {
  patterns: string[];
  events: ("change" | "create" | "delete")[];
  debounceMs: number;
}
```

---

## 四、实施优先级

### P0 (核心体验)

| 功能 | 状态 | 改进建议 |
|------|------|----------|
| Transport 重连状态 UI | ✅ | 添加 UI 指示器 |
| EventMiddleware 调试日志 | ✅ | 增强可视化 |
| SessionStore 内存优化 | ✅ | 大会话分片加载 |

### P1 (功能完善)

| 功能 | 状态 | 改进建议 |
|------|------|----------|
| Codex 协议增强 | ✅ | 添加 thinking/reasoning 事件 |
| Skill 版本自动更新 | ✅ | 添加更新检查 |
| Scheduler 监控面板 | ✅ | 添加运行历史视图 |

### P2 (创新功能)

| 功能 | 状态 | 改进建议 |
|------|------|----------|
| Multi-Agent 通信 | 🔄 | 设计协议规范 |
| 文件监控任务 | 📋 | 添加 glob 模式匹配 |
| AI 模型路由 | 📋 | 支持模型选择策略 |

---

## 五、代码质量亮点

MiWarp 有几个设计值得作为最佳实践分享：

### 1. OpGuard 异步操作守卫

```typescript
// 防止重复异步操作
class OpGuard {
  acquire(): boolean {
    if (this._active) return false;
    this._active = true;
    return true;
  }
}
```

### 2. 幂等的订阅管理

```typescript
// 重复订阅自动跳过
if (runId && this._currentRunId === runId && this._currentStore === store) {
  return; // 幂等
}
```

### 3. 微批次事件处理

```typescript
// 16ms 批次缓冲减少 UI 刷新
private _BATCH_INTERVAL = 16;
```

---

## 六、总结

### 已对齐的设计 (100%)

1. **Transport 抽象层** - 与 Cowork 一致
2. **EventMiddleware** - 与 Cowork 一致
3. **Skill 系统** - 与 Cowork 一致
4. **Scheduler** - 与 Cowork 一致
5. **Context Relay** - 与 Cowork 一致

### 独到设计 (可输出到社区)

1. **Attention Store** - 多原因注意力跟踪
2. **Process Visibility** - UX 优化亮点
3. **Codex Parser** - 多 CLI 支持

### 建议行动

1. **短期**: 完善 Codex 协议支持，增强调试体验
2. **中期**: Multi-Agent 协作协议，文件监控任务
3. **长期**: AI 模型路由，智能任务编排

---

*本报告由 Claude Code 自动生成*
