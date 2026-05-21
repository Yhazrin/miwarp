# Codex/Cowork 设计模式学习报告

> 本报告深入分析 Codex/Cowork (MiWarp) 的核心架构设计，总结可复用的设计模式，为其他类似项目提供参考。

---

## 一、Actor 消息模型与会话管理

### 核心模式

Codex/Cowork 采用 **Actor 模式**管理 CLI 会话，每个会话对应一个独立的 Actor，通过 `mpsc` 通道接收命令。

**关键实现** (`src-tauri/src/agent/session_actor.rs`):

```rust
pub enum ActorCommand {
    SendMessage {
        text: String,
        attachments: Vec<AttachmentData>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    SendControl {
        request: Value,
        reply: oneshot::Sender<Result<(String, oneshot::Receiver<Value>), String>>,
    },
    Stop { reply: oneshot::Sender<Result<(), String>> },
    // ... 其他命令
}

pub struct SessionActorHandle {
    pub cmd_tx: mpsc::Sender<ActorCommand>,  // 邮箱
    pub run_id: String,
    pub tag: Arc<()>,                         // 身份标识
    pub join_handle: tokio::task::JoinHandle<()>,
    pub shutdown_rx: oneshot::Receiver<()>,
}
```

**设计优势**:
- 顺序执行保证：无锁并发，所有操作串行化
- 清晰的生命周期：Actor 拥有进程句柄，完全控制 stdin/stdout
- 可观测性：每个 Actor 有独立的 JoinHandle，可等待完成

### 转向事务引擎 (`turn_engine.rs`)

```rust
pub struct ActiveTurn {
    pub turn_seq: u64,
    pub origin: TurnOrigin,
    pub phase: TurnPhase,
    pub started_at: Instant,
    pub soft_deadline: Instant,   // 5分钟 (用户输入)
    pub hard_deadline: Instant,  // 30分钟 (用户输入)
    pub turn_index: u32,
}
```

**超时管理**：
- 用户输入：5分钟软超时 / 30分钟硬超时
- 内部任务：15秒软超时 / 60秒硬超时
- 活动重置机制：保持对话活跃自动延长超时

---

## 二、传输层抽象

### 双模式传输

Codex/Cowork 实现了 **TauriTransport** 和 **WsTransport** 两种传输方式，通过工厂函数动态选择。

**接口定义** (`src/lib/transport/index.ts`):

```typescript
export interface Transport {
  invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  isDesktop(): boolean;
  subscribeRun(runId: string, lastSeq?: number): void;
  unsubscribeRun(runId: string): void;
}
```

**TauriTransport** (`tauri.ts`): 直接调用 `@tauri-apps/api` 的 `invoke`，支持超时控制。

**WsTransport** (`websocket.ts`): 浏览器端 WebSocket 实现，包含:
- **自动重连**：指数退避 (1s → 2s → 4s → max 30s)
- **序列号检查点**：重连后从上次位置恢复
- **事件回放缓冲区**：最多 4096 条事件

---

## 三、事件中间件与微批处理

### 事件路由

`event-middleware.ts` 实现统一的事件处理流水线：

```typescript
export function getEventMiddleware(): EventMiddleware {
  return {
    processEvent: (event, context) => {
      // 事件规范化、去重、验证
    },
    reduceState: (currentState, event) => {
      // 不可变状态更新
    }
  };
}
```

### 16ms 微批处理

```typescript
private _BATCH_INTERVAL = 16;   // ~60fps
private _MAX_BUFFER_SIZE = 500;

private _scheduleFlush(): void {
  requestAnimationFrame(() => this._flush());
  this._flushTimer = setTimeout(() => this._flush(), this._BATCH_INTERVAL);
}
```

**优势**:
- 避免过度渲染：将高频率事件合并处理
- 溢出保护：超过 500 条立即同步刷新
- 平滑动画：与浏览器 RAF 同步

---

## 四、Svelte 5 响应式状态管理

### 类模式 Store

使用 Svelte 5 `$state` 符文实现响应式状态：

```typescript
export class SessionStore {
  // 状态机阶段
  phase: SessionPhase = $state("empty");
  run: TaskRun | null = $state(null);
  timeline: TimelineEntry[] = $state([]);

  // 衍生状态
  get isRunning(): boolean { return ACTIVE_PHASES.includes(this.phase); }
  get canSend(): boolean { return ["empty", "ready", "idle"].includes(this.phase); }
}
```

### 状态机转换验证

```typescript
export type SessionPhase =
  | "empty" | "loading" | "ready" | "spawning"
  | "running" | "idle" | "completed" | "failed" | "stopped";

const VALID_TRANSITIONS: Record<SessionPhase, Set<SessionPhase>> = {
  empty: new Set(["loading", "ready", "spawning"]),
  loading: new Set(["ready", "running", "completed", "failed", "stopped", "empty"]),
  // ...
};

export function assertTransition(from: SessionPhase, to: SessionPhase): void {
  if (from === to) return;
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed?.has(to)) {
    console.warn(`[phase] invalid transition: ${from} → ${to}`);
  }
}
```

---

## 五、定时任务系统

### 调度器实现

`src-tauri/src/scheduler/` 实现基于 cron 的定时任务：

```rust
pub fn start_scheduler_loop(app: AppHandle, cancel: CancellationToken) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_secs(30)) => tick(&app).await,
            }
        }
    });
}
```

**任务类型**:
- `Cron`: 循环执行 (如每天 9:00)
- `OneTime`: 单次执行后自动禁用
- `Interval`: 间隔执行

**权限模式**: 定时任务默认使用 `auto-accept-all` 以适应无人值守运行。

---

## 六、命令面板与模糊搜索

### 多字段加权匹配

```typescript
let flatListWithScores = $derived.by(() => {
  const fields: Record<string, string> = {
    name: cmd.name,
    description: cmd.description,
    id: cmd.id,
    ...Object.fromEntries(
      (cmd.fuzzyKeywords || []).map((kw, i) => [`kw${i}`, kw])
    ),
  };

  const weights: Record<string, number> = {
    name: 1.5,
    description: 1.0,
    id: 0.5,
  };

  const result = multiFieldFuzzyMatch(q, fields, { weights, threshold: 0.2 });
  const usage = usageStats[cmd.id] || 0;

  return { cmd, score: result.score * 10 + usage * 0.5 };
});
```

**特性**:
- 使用频率加权：常用命令优先
- 上下文感知：`showDuringRun`, `showWhenIdle` 控制显示
- 模糊关键词：支持别名和缩写

---

## 七、快捷键中央调度

```typescript
export class KeybindingStore {
  bindings = $state<KeyBinding[]>([...APP_DEFAULTS, ...CLI_DEFAULTS]);

  resolved = $derived.by(() => {
    return this.bindings.map((b) => {
      const o = this.overrides.find((x) => x.command === b.command);
      return o ? { ...b, key: o.key } : b;
    });
  });

  dispatch(e: KeyboardEvent): void { /* 单点调度 */ }
  registerCallback(command: string, cb: () => void): void { /* 注册 */ }
}
```

**设计优势**:
- 单点真相：所有键盘事件统一处理
- 冲突检测：上下文矩阵防止冲突
- 平台适配：自动转换 Cmd ↔ Ctrl

---

## 八、插件与技能系统

### 技能执行器

```typescript
export class SkillExecutor {
  private handlers: SkillHandler[] = [];

  private registerBuiltInHandlers(): void {
    this.registerHandler({
      name: "schedule",
      canHandle: (skill) => skill.name === "schedule",
      execute: async (skill, args) => this.handleScheduleSkill(skill, args),
    });
  }

  async execute(skill: Skill, args: string = ""): Promise<ExecutionResult> {
    const handler = this.handlers.find((h) => h.canHandle(skill, args));
    if (handler) {
      return await handler.execute(skill, args);
    }
    return { success: true, output: this.formatSkillOutput(skill, args) };
  }
}
```

### 插件发现

```rust
fn discover_plugin_components(plugin_dir: &Path) -> PluginComponents {
    PluginComponents {
        skills: list_subdir_names(&plugin_dir.join("skills")),
        commands: list_md_stems(&plugin_dir.join("commands")),
        agents: list_md_stems(&plugin_dir.join("agents")),
        hooks: plugin_dir.join("hooks").is_dir(),
        mcp_servers: read_mcp_config(&plugin_dir),
    }
}
```

---

## 九、i18n 国际化

### 核心设计

```typescript
const messageCache: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  "zh-CN": zhCN as Record<string, string>,
};

export function switchLocale(newLocale: string): void {
  if (messageCache[newLocale]) {
    // 已缓存 — 即时切换
    _locale = newLocale;
    persistLocale(newLocale);
  } else {
    // 未缓存 — 异步加载
    _locale = newLocale;
    loadMessages(newLocale);
  }
}
```

**策略**:
- 核心语言静态缓存，零闪烁
- 次要语言动态加载
- localStorage 持久化 + 遗留迁移

---

## 十、存储层设计

### 原子性保存

```rust
pub fn data_dir() -> PathBuf {
    home_dir()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".miwarp")
}

// 写入流程
fn save_settings(&self, settings: &UserSettings) -> Result<(), StorageError> {
    let path = Self::path()?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(settings)?)?;
    tmp.rename(&path)?;  // 原子性替换
    Ok(())
}
```

---

## 总结：可迁移到其他项目的关键设计

| 设计模式 | 核心价值 | 适用场景 |
|---------|---------|---------|
| Actor + mpsc | 顺序执行保证 | CLI 进程管理 |
| Transport 抽象 | 跨平台兼容 | 桌面 + Web |
| 16ms 微批处理 | 性能优化 | 高频事件流 |
| 状态机 + 转换验证 | 类型安全 | 会话生命周期 |
| 中央快捷键调度 | 避免冲突 | 复杂快捷键 |
| 技能执行器 | 插件化 | 扩展系统 |
| 序列号检查点 | 断线恢复 | WebSocket |
| JSON-RPC 分发 | 统一接口 | 后端通信 |

---

*报告生成时间: 2026/05/21*