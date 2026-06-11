# MiWarp 架构优化报告（Ch1-7 课程知识驱动）

> 基于 Ch1–Ch7 复习笔记的具体概念逐项应用
> 评估日期：2026-06-09
> 评估人：杨昊泽
> 评估范围：Tauri 桌面 + Rust 后端 + Svelte 前端 + 移动端
> 评估基准：与 VICOO-esp 同框架报告对照

---

## 0. 摘要（TL;DR）

| 维度 | 评估 | 与 VICOO 对比 |
|------|------|--------------|
| 工程成熟度 | **高**（v1.0.7，4 份并行审计，file:line 证据） | VICOO ≈ 中 |
| 架构描述与代码一致性 | **一致**（CLAUDE.md + AGENTS.md + PLAN_V1.0.6） | VICOO 差 |
| 设计异味 | **3-4 个待治**（god store, layout, types.ts） | VICOO 7+4+7 |
| ATAM 闭环 | **4 份审计已做**，但**未执行** P0 修复 | VICOO 自评未跟踪 |
| 主动性能战术 | **6 条 Local-first 铁律**（PLAN_V1.0.6 §0.1） | VICOO 弱 |
| Ch7 课程作业（Cloud-Edge-End / RAG）| **不直接对应**（desktop-first） | VICOO 完全对应 |

**最关键发现**：
1. 🟢 **Session Actor 模式**是 Ch6 §16 mailbox/actor 模式的教科书级实现
2. 🟢 **Local-first 6 铁律 + 4 份并行审计**是 Ch4 §6.6 Performance Tactic + Ch6 §5 ATAM 的最佳实践
3. 🟡 **`session-store.svelte.ts` 3931 行** = 单一职责的代价（已经拆到 composable 级别，但 store 本身还是 god class）
4. 🟡 **`+layout.svelte` 3393 行** = 共享 shell 承担过多
5. 🟡 **`types.ts` 1741 行** = 违反 CLAUDE.md 自己定的 "types 按域分文件" 原则（部分迁移未完成）
6. 🔴 **MultiPlatform-Hardening 4 个 P0 仍未修复**（会话卡顿、parse 静默、slash 不可用、通知匮乏）

---

## 1. 现状画像（Ch3 §12 4+1 视图）

### 1.1 Scenario 视图（Ch3 §12.3）

**问题**：What does it do?

**主要参与者**：
- 主用户（开发者）
- Claude Code CLI 子进程
- Codex CLI 子进程
- 15+ LLM Provider（Anthropic / DeepSeek / Kimi / Zhipu / Bailian / DouBao / MiniMax / OpenRouter / Ollama / etc.）
- 飞书 webhook（scheduler 通知）
- 移动端伴侣（iOS / Android）
- 浏览器访问（嵌入式 Axum）

**核心用例**（来自 README + 路由列表）：
| Route | 功能 | 用例类型 |
|-------|------|---------|
| `/chat` | 跟 CLI 聊天 | 主用例 |
| `/explorer` | 文件浏览器 | 辅助 |
| `/memory` | CLAUDE.md 编辑 | 辅助 |
| `/history` | 会话历史 | 查询 |
| `/usage` | 用量分析 | 监控 |
| `/settings` | 设置（含 Theme / Provider / 权限） | 配置 |
| `/plugins` / `/skills` | 插件/技能市场 | 扩展 |
| `/scheduled-tasks` | 定时任务 | 自动化 |
| `/teams` / `/multi-agent` | 多 Agent 团队 | Ch7 §6.1 Multi-Agent Routing ✓ |
| `/browser` | 远程浏览器接入 | 远程 |
| `/release-notes` | 更新说明 | 文档 |
| `/workflow` / `/automation` | 工作流自动化 | 自动化 |

**Ch3 §5 用例图评价**：
- ✅ **完整覆盖** 5 个 Stakeholder Focus
- ✅ 已有 `docs/chat-page-map.md` 详细映射 chat page 的 use cases
- ⚠️ 但**没有集中的"全系统用例图"**（4+1 Scenario 视图要求）

### 1.2 Logical 视图（Ch3 §12.4）

**问题**：What are the parts?

**核心类**（来自 `src-tauri/src/models.rs` 2364 行）：
- `BusEvent`（事件总线枚举）
- `RunStatus` / `SessionPhase`（会话状态机）
- `TurnOrigin` / `TurnPhase`（轮次事务）
- `ActorCommand`（actor 邮箱消息）
- `AttachmentData`（多模态输入）
- 各种 DTOs

**架构核心抽象**（Rust）：
| 模块 | 职责 | Ch5 概念 |
|------|------|---------|
| `session_actor.rs` (2787) | 一个 CLI 会话的全生命周期 | **Actor 模式**（Ch6 §16） |
| `turn_engine.rs` | 轮次事务引擎 | **State Machine** + **Saga-like** |
| `claude_protocol.rs` (3077) | Stream-JSON 协议解析 | **Parser** |
| `adapter.rs` | 多 CLI 适配 | **Strategy**（Ch5 §2.7） |
| `commands/{domain}.rs` | Tauri 命令入口 | **Facade**（Ch5 §2.6） |
| `storage/` | 本地持久化 | **Repository**（Ch7 §6.4） |
| `web_server/` | Axum 嵌入 | **Adapter**（Ch5 §2.6） |
| `scheduler/` | cron 调度 | **Scheduler**（Ch4 §4.5） |
| `hooks/` | 事件钩子 | **Observer**（Ch3 §9.2 signal） |

**架构核心抽象**（前端）：
| 模块 | 职责 | 行数 |
|------|------|------|
| `session-store.svelte.ts` | 主会话状态 | **3931** ⚠️ |
| `event-middleware.ts` | 事件路由 | 508 |
| `transport/{tauri,websocket,circuit-breaker}.ts` | 跨端 IPC 抽象 | 1123 |
| `api.ts` | 类型化 invoke 包装 | 1637 |
| `chat/` (30 个 composables) | chat 域逻辑 | 分散 |
| `services/multi-agent-service.ts` | Multi-Agent 协调 | 610 |
| `services/automation-service.ts` | 自动化执行 | 566 |
| `sensory/sounds/packs.ts` | 声音反馈 | 1350 |
| `i18n/` | 双语运行时 | — |
| `conversation-insight/` | 对话分析 | — |

**Ch5 §1.5 Opacity 评估**：
- ✅ **良好**：后端模块按 actor/turn/protocol/command/storage 域清晰划分
- ✅ **良好**：前端 chat 域 30 个 composables，每个单一职责
- ⚠️ **待治**：`session-store.svelte.ts` 3931 行 + `+layout.svelte` 3393 行 + `types.ts` 1741 行 = 3 个 mega files

### 1.3 Process 视图（Ch3 §12.5）

**问题**：What's concurrent? — 哪些流程并发？

**Ch3 §9 Activity Diagram 评估**：

应该画的 5 张图（按业务关键度）：

1. **会话启动 → 协议握手 → 第一条消息**（Fork/Join 关键）
2. **Session 状态机**：empty → cached → stale_cached → syncing → live → running → completed/failed（PLAN_V1.0.6 §0.4 已有类型定义）
3. **Multi-Agent 团队调度**（Ch7 §6.1 Multi-Agent Routing）
4. **Scheduler 触发 → Webhook 通知**
5. **CLI parse-fail 降级流**（MultiPlatform-Hardening A2 已识别）

**当前状态**：
- ✅ **SessionPhase 8 态状态机**已定义（PLAN_V1.0.6 §0.4）
- ✅ **Turn 事务模型**（Active → Draining）
- ⚠️ **缺可视化的活动图**
- ⚠️ **A2 描述的 parse-fail 降级**（`session_actor.rs:1401-1427`）是 3 路降级，**逻辑复杂但无图**

### 1.4 Development 视图（Ch3 §12.6）

**问题**：How organized? — 开发层面如何组织？

**包结构**（UML Package/Component Diagram 视角）：

```
src/
├── lib/
│   ├── stores/          # 状态（Svelte 5 runes）
│   ├── transport/       # 跨端 IPC 抽象
│   ├── chat/            # chat 域 composables (30 个)
│   ├── components/      # UI 组件
│   ├── services/        # 业务服务
│   ├── api.ts           # IPC 入口
│   ├── i18n/            # 双语运行时
│   ├── types/           # 类型（已部分迁移）
│   └── utils/           # 工具
├── routes/              # 页面
└── ...

src-tauri/src/
├── agent/               # CLI 通信层
│   ├── session_actor.rs
│   ├── turn_engine.rs
│   ├── claude_protocol.rs
│   ├── adapter.rs
│   └── ...
├── commands/            # Tauri 命令（按域分）
│   ├── session.rs
│   ├── chat.rs
│   ├── runs.rs
│   └── ...
├── storage/             # 本地持久化
├── web_server/          # 嵌入式 Axum
├── scheduler/           # cron
├── hooks/               # 事件钩子
└── lib.rs               # 入口
```

**Ch5 §2.1 SoC 评估**：✅ **优秀**（CLAUDE.md 自己也规定了"按域分文件"原则）

**Ch3 §11.3 Logical Organization 评估**：✅ **大体良好**
- 后端按域（agent / commands / storage / scheduler）清晰
- 前端 chat 域 30 个 composables 拆得细
- ⚠️ **例外**：`session-store.svelte.ts`、`+layout.svelte`、`types.ts` 3 个 mega file

### 1.5 Physical 视图（Ch3 §12.7）

**问题**：Where does it run?

**当前部署形态**：
```
┌──────────────────────────────────────────────────────┐
│              Desktop (Tauri v2)                      │
│  ┌─────────────────┐  ┌─────────────────────┐       │
│  │  Svelte 5 UI    │  │  Rust Backend       │       │
│  │  (WebView)      │  │  - session_actor    │       │
│  │                 │  │  - turn_engine      │       │
│  │  transport:     │  │  - scheduler        │       │
│  │  TauriTransport │←→│  - web_server       │       │
│  │                 │  │  - storage          │       │
│  └─────────────────┘  └────────┬────────────┘       │
│         │                       │                    │
│         │                       ↓                    │
│         │              ┌─────────────────┐           │
│         │              │ Child Process   │           │
│         │              │ (Claude Code    │           │
│         │              │  CLI / Codex)   │           │
│         │              └─────────────────┘           │
│         ↓                                          │
│  ┌─────────────────┐                               │
│  │ ~/.miwarp/      │  本地文件存储                  │
│  │  runs/          │  events.jsonl (事实)           │
│  │  settings.json  │  meta.json / artifacts.json   │
│  │  index.sqlite   │  本地读模型（PLAN_V1.0.6 §0.2）│
│  └─────────────────┘                               │
└──────────────────────────────────────────────────────┘

远程访问：
  Browser/iOS/Android → Embedded Axum (WebSocket) → 同样 Backend
```

**Ch3 §12.7 评估**：
- ✅ **本地 + 远程双通道** 设计清晰（Tauri IPC + Axum WebSocket）
- ✅ **README 架构图**与代码一致（与 VICOO 不同的关键优势）
- ✅ **Local-first** 是 Ch4 §5 Modifiability Tactic "delay binding" 的典范（数据本地，但展示/执行可远程）

### 1.6 C4 Level 1+2 摘要（Ch3 §15）

**Level 1 — System Context**：
```
[Developer] → [MiWarp Desktop] → [Claude Code CLI / Codex CLI]  (本地子进程)
                            ├→ [15+ LLM Provider APIs]            (HTTPS)
                            ├→ [飞书 Webhook]                      (scheduler 通知)
                            └→ [iOS / Android Companion]            (Axum WebSocket over LAN)
                            └→ [Browser Access]                    (Axum WebSocket over LAN)
```

**Level 2 — Container**：
```
[MiWarp.app] (Tauri)
   ├── [SvelteKit WebView]
   │     ├── Pages (16 routes)
   │     ├── Stores (SessionStore / TeamStore / KeybindingStore)
   │     ├── Transport (Tauri | Ws 自动切换)
   │     └── Composable Layer (30+ in chat/)
   │
   ├── [Rust Backend]
   │     ├── agent/ (session_actor, turn_engine, protocol, adapter)
   │     ├── commands/ (15+ Tauri command domains)
   │     ├── storage/ (runs, settings, events, MCP, skills, changelog)
   │     ├── web_server/ (Axum + WebSocket relay)
   │     ├── scheduler/ (cron + runner + store)
   │     ├── skill_sources/ (Feishu + cache + parser)
   │     └── hooks/ (event hooks + file watcher)
   │
   └── [Local FS ~/.miwarp/]
         ├── index.sqlite  (本地读模型)
         ├── runs/{run-id}/{meta,events.jsonl,artifacts}
         └── settings.json, keybindings.json

[Claude Code CLI]  ←  stdin/stdout  ←  session_actor
[Codex CLI]        ←  stdin/stdout  ←  session_actor
```

---

## 2. 关键代码层发现（带行号 + 课程概念引用）

### 🟡 2.1 `session-store.svelte.ts` 3931 行（Ch5 §1.1 God object 风险）

**文件**：`src/lib/stores/session-store.svelte.ts`

**类方法列表**（部分摘录）：
```
acquire/release/unmount           # OpGuard 异步操作守卫
eventTs / backfillAnchorId        # event 处理
_setPhase / assertTransition      # 状态机
_startSpawnTimeout / _startResponseTimeout  # timeout 管理
isKnownSlashCommand               # slash 命令识别
_getPermissionScan                # permission 扫描
... (隐含 40+ 方法)
```

**评估**：
- **CLAUDE.md §7.4 "长文件立即拆"** 规定 Svelte 组件 > 500 行要拆，**Store 没有明确规定行数上限**，但 3931 行 = god store
- 这个 store 实际管了：phase 状态机、timeout 管理、permission 扫描、slash 命令识别、timeline 处理、OpGuard 等
- **Ch5 §1.1 Rigidity**：改 phase 状态机要改这个文件
- **Ch5 §1.6 Needless Complexity**：可能可以拆 `SessionPhaseStateMachine` + `SessionTimeoutManager` + `SessionPermissionScanner` 三个 store

**Ch3 §12.4 评价**：Logical 视图角度，这个 store 是 **Logical Cohesion**（所有"会话"相关），但因为承担太多，**向 Coincidental Cohesion 退化**。

### 🟡 2.2 `+layout.svelte` 3393 行（Ch5 §1.1 + 共享 shell 过载）

**文件**：`src/routes/+layout.svelte`

**承担**（按 CLAUDE.md §1.3 描述）：
- sidebar with project folder tree
- icon rail
- team/chat tabs
- resize handle
- theme/locale toggles
- welcome screen
- status bar
- mobile pairing dialog
- i18n init

**Ch3 §11.3 Logical Organization 评估**：违反"shell 应该是壳"原则。
- 3393 行 = 30 个 composable + 20 个组件 + 复杂 i18n + theme system
- 实际就是 VicOO 的 `main.py` 问题在 Svelte 端的镜像

### 🟡 2.3 `types.ts` 1741 行（违反 CLAUDE.md 自己的规定）

**文件**：`src/lib/types.ts`（根目录）

**CLAUDE.md §7.4 规定**：
> types 按域分文件：`types/teams.ts` / `types/plugins.ts` / `types/bus-events.ts` / `types/marketplace.ts` / `types/scheduled-task.ts` — 不要塞回 `types/index.ts`

**实际状态**：
- `types/` 子目录已经有 7 个文件（`automation.ts` / `background.ts` / `scheduled-task.ts` / `skill-execution.ts` / `skill-pipeline.ts` / `skill.ts` / `task-execution-monitor.ts`）
- 但根目录 `types.ts` 仍有 **1741 行**
- 推测：迁移未完成

**Ch5 §1.5 Opacity**：新人不知道类型在哪。

### 🟢 2.4 `session_actor.rs` 2787 行（Ch5 §2.1 SoC 优秀案例）

**文件**：`src-tauri/src/agent/session_actor.rs`

**模块头注释**：
> One actor per run_id. All session mutations (send, control, stop) go through the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution without external locks.

**评估**：
- **Ch6 §16 Process/System Quality 案例**：Actor + Mailbox 是分布式系统的成熟模式
- 单文件 2787 行**但单一职责**（one actor per session）
- 文件头注释解释了 WHY（避免锁的 race condition）
- Ch5 §2.4 Information Hiding 优秀：内部 mailbox、stale_cached 状态机不外泄
- 这是 MiWarp 的**架构亮点**，值得在 CLAUDE.md 显式说明

### 🟢 2.5 `turn_engine.rs` 事务模型（Ch4 §2.1 + Ch3 §9.3 Fork/Join 优秀案例）

**文件**：`src-tauri/src/agent/turn_engine.rs`（80+ 行片段）

**关键设计**：
```rust
pub enum TurnOrigin { User(UserTurnKind), Internal(InternalJobKind), Ralph }
pub enum UserTurnKind { Normal { auto_ctx_id: u32 }, Slash { command: String } }
pub enum TurnPhase { Active, Draining }
pub struct ActiveTurn { turn_seq, origin, phase, started_at, soft_deadline, hard_deadline, ... }
```

**评估**：
- **Ch3 §9.3 Fork/Join 模式**：`Turn` + `ActiveTurn` + `TurnPhase` 三层就是 actor 内的 saga
- **Ch4 §2.1 Scenarios**：每个 turn 都有 soft/hard deadline，**典型的可用性 + 性能场景**
- **Ch5 §2.6 Repository**：`InternalExtractor` trait 抽象了 turn 内的提取逻辑
- **Ch7 §6.4 Memory Management**：`auto_ctx_id` 是会话级记忆的 ID，符合 Ch7 课程

### 🟢 2.6 `transport/` 三层抽象（Ch5 §2.4 Information Hiding 范例）

**文件**：
- `src/lib/transport/tauri.ts` (49 行)
- `src/lib/transport/websocket.ts` (327 行)
- `src/lib/transport/circuit-breaker.ts` (185 行)
- `src/lib/transport/index.ts` (54 行)

**评估**：
- **Ch5 §2.4 Information Hiding 范例**：`getTransport()` 隐藏了 Tauri vs WebSocket 选择
- **CLAUDE.md §6 "Transport Abstraction"** 明确规定 ESLint `no-restricted-imports` 强制
- **Ch3 §14 ADR 精神**：为什么需要这层抽象（移动端 + 浏览器访问需要走 WebSocket），决策有 rationale

**Ch3 §11.7 "Record the reasons"** 案例：CLAUDE.md 把 transport 抽象的 WHY 都写清楚了。

### 🟢 2.7 `lib.rs` 630 行（与 VICOO `main.py` 562 行对比）

**文件**：`src-tauri/src/lib.rs`

**对比 VICOO `main.py` 562 行**：
| 维度 | VICOO `main.py` | MiWarp `lib.rs` |
|------|-----------------|------------------|
| 入口大小 | 562 行 | 630 行（略大） |
| 中间件混在一起 | ✅ 是（S1 风险） | ❌ 否（按域分模块） |
| 类型化跨模块通信 | ❌ `app.state` | ✅ `tauri::manage()` + 强类型 |
| 资源生命周期 | ❌ 全在 lifespan | ✅ `ShutdownGate` (CAS) + `CancellationToken` |
| 错误处理 | ❌ 集中 | ✅ 分散到各模块 |

**评估**：MiWarp 做得**对**。`lib.rs` 即使 630 行，主要做的是**装配**（`tauri::Builder` 注册 commands + manage state），不是把所有逻辑塞进去。

### 🟠 2.8 MultiPlatform-Hardening 4 个 P0 仍未修复

**文件**：`docs/MultiPlatform-Hardening-2026-06-06.md`

| P0 | 现象 | 证据 | 影响 |
|----|------|------|------|
| **A1** | 会话卡顿（70 秒静默） | `session_actor.rs:1443-1487` + `QUARANTINE_DEADLINE = 10s` | 用户体验致命 |
| **A2** | CLI 同步丢失（parse 静默） | `session_actor.rs:1401-1427` + `json_parse_fail_count` 无阈值 | UI 状态错乱 |
| **A3** | Slash 命令调不出来 | `use-slash-menu.svelte.ts:51` `slashEnabled` 依赖已发 run | 新会话不可用 |
| **A4** | 通知匮乏 | `notify.rs` 只 macOS + 3 个 hook 调用点 | 长 run 用户不知 |

**Ch6 §7.3 Risk 定义**："A potentially problematic architectural decision" — 这 4 个 P0 都是**架构决策**层面的 risk（quarantine 机制、parse 降级、slash 启用条件、通知抽象），不是 bug。

**Ch6 §5 ATAM Step 9 "Present Results"** 已完成（生成了 Sprint 计划），**但 Step 5-8 的"修复"未执行**。ATAM 闭环未关。

**Sprint 1 计划 11 pd**，是 MiWarp **最该做的下一件事**。

---

## 3. Ch3 — 4+1 视图补齐清单

| 视图 | 当前 | 应补 | 难度 | 收益 |
|------|------|------|------|------|
| **Scenario** | chat-page-map 详细，全局缺 | 1 张总用例图（覆盖 5 类 actor × 12+ 路由） | 低 | 团队对齐 |
| **Logical** | Rust 模型清晰，前端 store 大 | 1 张核心类图（BusEvent / Run / Session / Agent / Provider 关系） | 中 | 复杂业务可视化 |
| **Process** | SessionPhase 状态机文字版 | **3 张活动图**（会话启动 / parse-fail 降级 / multi-agent 调度） | **高** | **揭示 parse-fail 降级复杂度** |
| **Development** | CLAUDE.md 详细，README 简略 | 1 张 Component Diagram | 低 | 解释 module 边界 |
| **Physical** | README 已有 SVG（自描述） | **0 补** | — | — |

**最值得补的**：**Process 视图**（A2 parse-fail 3 路降级 + A1 quarantine 机制）。这两段代码逻辑复杂但无图，是新团队成员 on-ramp 的主要障碍。

---

## 4. Ch4 — 质量属性场景（6-part QA Scenario）

> 复习笔记 Ch4 §2.2：QA Scenario = Source → Stimulus → Artifact → Environment → Response → Measure

补 5 个关键场景：

### 4.1 场景 A：CLI 会话启动 → 首 token 延迟（Performance）

| Part | 内容 |
|------|------|
| **Source** | 用户在 chat 输入第一条消息 |
| **Stimulus** | 点击"发送"按钮 |
| **Artifact** | `session_actor` 子进程 + Stream-JSON 协议 |
| **Environment** | 冷启动（首次 run），CLI 尚未 spawn |
| **Response** | CLI 进程 spawn → 协议握手 → 第一个 content token 抵达前端 |
| **Measure** | TTFT p50 < 3s, p99 < 8s（实测需埋点） |

**当前状态**：**无 TTFT 指标收集**。PLAN_V1.0.6 §0 提到 "可观测缓存：所有 cache hit / miss / invalidate / replay fallback / reconcile 必须有日志和指标" — 启动延迟指标可加入。

### 4.2 场景 B：CLI parse-fail 降级（Availability + Recoverability）

| Part | 内容 |
|------|------|
| **Source** | Claude Code CLI 子进程 |
| **Stimulus** | 输出 50% 非 JSON 行（协议升级 / stderr 混流） |
| **Artifact** | `session_actor.rs:1401-1427` + `json_parse_fail_count` 累加器 |
| **Environment** | CLI 实际已空闲，前端显示 running |
| **Response** | 阈值告警（建议 5/分钟）→ emit `BusEvent::ProtocolDesync` → 强制 `RunState::Failed` → 前端 toast + 解锁输入框 |
| **Measure** | parse-fail 到 UI 解锁的端到端延迟 p99 < 5s |

**当前状态**：**A2 P0 仍未修复**。文档给了完整修复方案，**未执行**。

### 4.3 场景 C：Quarantine 状态恢复（Availability）

| Part | 内容 |
|------|------|
| **Source** | Claude Code CLI 进程（因 `/context` 等命令卡死） |
| **Stimulus** | stdout 静默超过 5s（`QUARANTINE_DEADLINE` 建议从 10s 缩到 5s） |
| **Artifact** | `session_actor.rs:1443-1487` quarantine 状态 |
| **Environment** | 用户看着前端"running"但实际无响应 |
| **Response** | 进入 quarantine 时立刻 emit `SessionRecovering { reason, deadline_ms }` → 前端 banner → CLI 复活或 `SessionRecovered { ok: false }` |
| **Measure** | 用户从"开始卡顿"到"看到提示" ≤ 1s；端到端恢复 ≤ 5s（deadline 到） |

**当前状态**：**A1 P0 仍未修复**。

### 4.4 场景 D：多 Agent 团队调度（Ch7 §6.1 Multi-Agent Routing）

| Part | 内容 |
|------|------|
| **Source** | 用户在 chat 输入 `@team 帮我重构这个模块` |
| **Stimulus** | `use-team-dispatch.svelte.ts` 检测到 team trigger |
| **Artifact** | `services/multi-agent-service.ts` (610 行) + `routes/teams/+page.svelte` (1580 行) |
| **Environment** | N 个子 agent 并行执行，各有自己的 CLI session |
| **Response** | 各 agent 并行 → 进度可见 → 结果聚合 → 用户看到综合输出 |
| **Measure** | N=3 agents 时，team dispatch 启动到第一个 sub-agent 输出 ≤ 5s |

**当前状态**：
- ✅ `use-team-dispatch` 已存在
- ✅ Multi-agent service 610 行（合理大小）
- ⚠️ **没有 SLA 指标** — N agents 协调的延迟未量化

### 4.5 场景 E：Local-first 缓存命中（Modifiability + Performance）

| Part | 内容 |
|------|------|
| **Source** | 用户打开应用壳（冷启动） |
| **Stimulus** | T0 启动壳（0~100ms） |
| **Artifact** | `index.sqlite` 本地读模型 + `~/.miwarp/runs/{id}/meta.json` + active session snapshot |
| **Environment** | 最近 100+ runs，UI 还没显示 |
| **Response** | 应用壳立即显示最近会话列表 + 上次 active session 的 cached snapshot |
| **Response Measure** | T0 阶段 ≤ 100ms；sidebar 列表渲染可见 ≤ 300ms |

**当前状态**：
- ✅ **PLAN_V1.0.6 §0.3 已有 T0-T3 分层加载设计**
- ❌ **未实施**（仍按 v1.0.6 计划要落地）
- ✅ Sprint 1 已经识别为性能改进目标

---

## 5. Ch5 — 设计异味 + 耦合/内聚

### 5.1 CLAUDE.md 自己的异味清单

**复习笔记 Ch5 §1 + Ch5 §3 + Ch5 §4 完美对应**：

CLAUDE.md §"代码异味清单" 列了 19 个 smell item：
- God object ✓
- Prop drilling ✓
- 循环依赖 ✓
- 重复代码 ✓
- 魔法字符串 / 魔法数字 ✓
- `any` 类型 ✓
- `@ts-ignore` ✓
- 死代码 ✓
- 冗余抽象 ✓
- 跨层泄漏 ✓
- 过度耦合测试 ✓
- 可变全局 ✓
- 过深缩进 ✓
- 注释解释 WHAT ✓
- Suspicious 名字 ✓
- 组件 > 500 行 ✓
- 函数 > 50 行 ✓
- 参数 > 4 个 ✓
- 混合关注点 ✓

**Ch5 §1 完整覆盖**。**这是课程知识落地到工程实践的最佳案例**。

### 5.2 实际剩余异味（基于本评估）

| # | 异味 | 证据 | 复习笔记引用 |
|---|------|------|--------------|
| 1 | **God store** | `session-store.svelte.ts` 3931 行 | Ch5 §1.1 Rigidity |
| 2 | **God layout** | `+layout.svelte` 3393 行 | Ch5 §1.1 |
| 3 | **Type file 拆分未完成** | `types.ts` 1741 行（违反自己 CLAUDE.md 规定） | Ch5 §1.5 Opacity |
| 4 | **P0 修复未执行** | A1-A4 4 个 P0 risk 未修 | Ch6 §7.3 Risk |
| 5 | **缺全局 Activity Diagram** | parse-fail 3 路降级逻辑（session_actor.rs:1401-1427）无图 | Ch3 §9 + Ch5 §1.5 |

### 5.3 耦合分析（Ch5 §3）

| 强度 | 类型 | 证据 | 评估 |
|------|------|------|------|
| **Content** | ❌ 未发现 | session_actor 内部 state 都通过 mailbox 通信 | ✓ 优秀 |
| **Common** | `app.manage()` 共享 state | 但类型化 | ✓ 良好 |
| **Control** | `commands/{domain}.rs` 接受 frontend params | 合理 | ✓ |
| **Stamp** | `api.ts` 大量 `invoke<T>(cmd, args)` 传 dict | 可接受 | ✓ |
| **Data** | storage 共享 local FS | **local-first 设计需要这种耦合**，是 Non-Risk | ✓ |

**Ch5 §3.5 Control Coupling 注意点**：
- `commands/session.rs` 2692 行 — 命令过多，**可能有部分应该拆成子模块**
- 类似 VICOO 的 `routers/donations.py` 237 行的放大版

### 5.4 内聚分析（Ch5 §4）

| 评价 | 证据 |
|------|------|
| **Functional**（最好）| `security.py` / `transport/{tauri,websocket}` 单一职责 ✓ |
| **Sequential** | `turn_engine` 流程清晰 ✓ |
| **Communicational** | `session_store` 操作同一会话的所有 state — **过载**，但内部模块化 |
| **Logical**（差）| `session-store` 把所有"会话"塞一起 |
| **Coincidental**（最差）| `+layout.svelte` 把 shell + theme + i18n + status bar + pairing 都塞一起 |

---

## 6. Ch6 — ATAM 9 步评估（基于已有审计材料）

> MiWarp 已经做了 **5/9 步**（Step 1-4 + 7），剩下 4 步（Step 5 效用树 + 6 架构方法分析 + 8 新场景 + 9 结果展示）需要补。

### 6.1 效用树（Ch6 §6 Utility Tree）— 建议补

**根节点**：MiWarp 架构质量

```
Utility
├── A. Performance            [H] ─ T0 启动 + 长会话流畅
│   ├── A1. T0 启动壳 < 100ms [H,H] → Risk (未实施)
│   ├── A2. 长会话 (1000+ 消息) 流畅 [H,H] → Risk (B1 虚拟滚动)
│   └── A3. CLI 首 token < 3s [H,M] → 未量化
├── B. Availability           [H] ─ 会话不能假死
│   ├── B1. parse-fail 30s 内解锁 [H,H] → **A2 P0**
│   ├── B2. quarantine 5s 内有反馈 [H,H] → **A1 P0**
│   └── B3. 通知系统跨平台 [H,M] → **A4 P0**
├── C. Modifiability          [H] ─ 频繁新增 CLI / Provider / Skill
│   ├── C1. 添加新 LLM provider [H,H] → 已支持（PLAN_V1.0.6 表格）
│   ├── C2. 添加新 CLI (Gemini) [M,H] → adapter.rs 抽象足够
│   └── C3. 第三方 Skill 集成 [M,M] → Skill Marketplace
├── D. Security               [M] ─ local-first 风险面小
│   ├── D1. CLI 进程隔离 [M,H] → 已用 Job Object (Windows)
│   ├── D2. 远程访问 token 轮换 [M,M] → 已实现 CAS
│   └── D3. 移动端 token 存储加固 [H,M] → v1.0.6 P0 已修
└── E. Cross-platform         [H] ─ Desktop/iOS/Android 一致
    ├── E1. 状态同步正确 [H,H] → Risk
    ├── E2. 设计语言一致 [H,M] → CLAUDE.md 12 主题统一
    └── E3. iPadOS/iOS/Android 分别适配 [H,H] → **Hardening 报告待修**
```

### 6.2 ATAM 4 大输出（Ch6 §7）

#### A. 风险（Risk）—— 7 个

| # | 风险 | 来源 | Sprint |
|---|------|------|--------|
| **R1** | A1 quarantine 70s 静默 | `session_actor.rs:1443-1487` | Sprint 1 |
| **R2** | A2 parse-fail 静默 | `session_actor.rs:1401-1427` | Sprint 1 |
| **R3** | A3 slash 命令启动不可用 | `use-slash-menu.svelte.ts:51` | Sprint 1 |
| **R4** | A4 通知匮乏 | `notify.rs` + 3 hook 调用 | Sprint 1 |
| **R5** | B1 长会话渲染掉帧 | `ChatTimelineEntries.svelte:166` | Sprint 2 |
| **R6** | session-store 3931 行 god store | 自身评估 | 待启动 |
| **R7** | +layout 3393 行 god shell | 自身评估 | 待启动 |

#### B. 非风险（Non-Risk）—— 4 个（要记录！）

| # | 决策 | 理由 |
|---|------|------|
| **NR1** | **Session Actor 模式**（mailbox + 单 actor per run） | Ch6 §16 经典 actor 模式，避免锁 |
| **NR2** | **Local-first 设计**（数据本地 + 远程仅 WebSocket） | Ch4 §5 Modifiability 最佳 |
| **NR3** | **Transport 抽象**（Tauri IPC vs WebSocket） | Ch5 §2.4 Information Hiding 范例 |
| **NR4** | **多 Session 隔离用 git worktree** | Ch3 §1.2 Forward Engineering 支持 |

**复习笔记 Ch6 §7.4**：Non-Risk 价值在于**避免未来重复争论**。MiWarp 的 Session Actor / Local-first / Transport 抽象都值得写 ADR 记录 rationale。

#### C. 敏感点（Sensitivity Point）—— 3 个

| # | 敏感点 | 影响的 QA |
|---|--------|----------|
| **SP1** | `QUARANTINE_DEADLINE = 10s`（建议 5s） | Availability (B2) |
| **SP2** | `json_parse_fail_count` 阈值 | Availability (B1) |
| **SP3** | Local SQLite index 同步频率 | Performance (A1) |

#### D. 权衡点（Tradeoff Point）—— 3 个

| # | 设计属性 | 提升 | 降低 |
|---|---------|------|------|
| **TP1** | Local-first 缓存（events.jsonl + sqlite index） | Performance | Storage 占用 |
| **TP2** | Session Actor 严格顺序执行 | Correctness | 单 session 吞吐（已有 mpsc bound） |
| **TP3** | 类型化 IPC（api.ts 包装 invoke） | Type Safety | 灵活性（动态命令较难） |

---

## 7. Ch6 §15 — Strangler Fig 演进路径

> MiWarp 当前是**单体桌面 app**，没有"拆微服务"诉求。但**前端 god file 拆分**是同构问题。

| Phase | 目标 | 理由 | 风险 |
|-------|------|------|------|
| **1** | `session-store.svelte.ts` 拆为 3-4 个 store | God store 阻碍维护 | 跨 store 通信变复杂 |
| **2** | `+layout.svelte` 拆 shell + sidebar + status bar | God shell | i18n 重新注入 |
| **3** | `types.ts` 全部按域迁移到 `types/` | 遵循自己定的原则 | 大量 import 路径更新 |
| **4** | `commands/session.rs` 2692 行拆子模块 | 维持单一职责 | Tauri invoke_handler 需同步 |

**Ch6 §15.3 Distributed Monolith 警告**：拆时**严禁出现"store 拆分但 events 同步互调"**的伪拆分。

---

## 8. Ch6 §17 — DORA Metrics（建议接入）

| 指标 | 当前 | 建议 |
|------|------|------|
| Deployment Frequency | v1.0.6 → v1.0.7 = 1 天 1 版 ✅ | 已达成 |
| Lead Time for Changes | `feat/xxx` 分支 + CHANGELOG 节奏好 | 维持 |
| Change Failure Rate | 4 P0 待修 = 当前架构 fragile | **修 P0 后才能量化** |
| MTTR | 无 | **加 release-regression.md 跟踪**（已有！） |

**评估**：**MiWarp 的 release 节奏是课程级范例**。`v1.0.6 → v1.0.7` 1 天 1 版，且每个版本都有 CHANGELOG + 修复 + 新增的均衡。

---

## 9. Ch6 §12 — Fitness Functions（建议补充到 CI）

> MiWarp 已经有 `npm run verify` 全 CI gate（lint + format + check + i18n + test + build + rust）。

**建议增加 5 个架构 Fitness Function**：

```bash
# 1. session-store 行数 < 2500（拆 god store 验证）
if wc -l src/lib/stores/session-store.svelte.ts | awk '$1 > 2500'; then exit 1; fi

# 2. +layout 行数 < 2500
if wc -l src/routes/+layout.svelte | awk '$1 > 2500'; then exit 1; fi

# 3. types.ts 行数 < 500（按 CLAUDE.md 应拆分）
if wc -l src/lib/types.ts | awk '$1 > 500'; then exit 1; fi

# 4. 强制没有直接 import @tauri-apps/api 在非 transport 目录
if grep -r "from '@tauri-apps/api" src/ --include="*.svelte" --include="*.ts" | grep -v "src/lib/transport/"; then exit 1; fi

# 5. 强制没有 god Rust 文件 (> 3000 行)
if find src-tauri/src -name "*.rs" -exec wc -l {} \; | awk '$1 > 3000'; then exit 1; fi
```

---

## 10. Ch6 §16.2 + Ch3 §14 — ADR（建议补）

**当前状态**：决策散落在 CLAUDE.md、PLAN_V1.0.6、MultiPlatform-Hardening。

**建议创建 `docs/adr/`**：

```
docs/adr/
├── 0001-session-actor-pattern.md    # Ch6 §16 Actor + Mailbox
├── 0002-local-first-data-model.md   # Ch4 §5 + Ch4 §6.6
├── 0003-transport-abstraction.md    # Ch5 §2.4 + Ch3 §14
├── 0004-event-bus-typed.md          # BusEvent 枚举统一
├── 0005-multi-platform-strategy.md  # Tauri + iOS + Android
├── 0006-svelte-5-runes-only.md      # 已隐式
├── 0007-types-by-domain.md          # CLAUDE.md §7.4
├── 0008-rust-actor-runtime.md       # tokio mpsc + CancellationToken
└── 0009-multi-agent-routing.md      # Ch7 §6.1
```

---

## 11. Ch7 §6 — AI Agent 架构模式评估

### 11.1 Multi-Agent Routing（Ch7 §6.1）— 已落地

> Ch7 §6.1：通过 intent classifier 路由到专门 agent

**MiWarp 实现**：
- ✅ `routes/teams/+page.svelte` 1580 行 — 多 agent 团队 dashboard
- ✅ `routes/multi-agent/+page.svelte` 155 行 — multi-agent 主入口
- ✅ `services/multi-agent-service.ts` 610 行 — 业务服务
- ✅ `use-team-dispatch.svelte.ts` — chat 内触发
- ✅ `useChatDerived / useChatHandlers` — coordinator

**评估**：
- **Ch7 §6.1 Blackboard + Rule-Based** 隐式实现（rule-based 触发，blackboard 是 `SessionStore`）
- **Ch3 §9.3 Fork/Join** 隐式（多个 sub-agent 并行）
- **亮点**：**不是单一 LLM**（用真实 CLI 子进程），是**多进程协作** — 比 VICOO 的"单一 LLM endpoint"更彻底

### 11.2 RAG Pipeline（Ch7 §6.3）— 不直接适用

**MiWarp 不自己做 RAG** — 它**包装** Claude Code / Codex CLI（这些 CLI 自己有 RAG 能力）。

**Ch7 §6.3 评估**：
- 用户的上下文检索由 CLI 自己做
- MiWarp 的 "memory" 路由（`routes/memory`）是让用户管理 CLAUDE.md 喂给 CLI
- 这是 **Ch7 §6.4 Memory Management** 的实现层 — 让用户编辑 memory 文件

**这是 MiWarp 与 VICOO 的关键区别**：
- VICOO = 自己实现 AI（包括 RAG）
- MiWarp = **包装现有 AI 工具**（CLI 子进程）

### 11.3 Channel Adapter（Ch7 §6.5）— 出色实现

**Ch7 §6.5**：Channel Adapter = 解耦平台 SDK 与核心逻辑

**MiWarp 实现**：
- ✅ **`src/lib/transport/`** = Channel Adapter 抽象层
- ✅ 桌面（tauri.ts 49 行）vs 浏览器（websocket.ts 327 行）vs 远程（mobile 用 websocket）
- ✅ `circuit-breaker.ts` 185 行 = Ch4 §4.5 Availability Tactic（Fault Recovery）

**评估**：
- **Ch3 §14 ADR 精神**：transport 抽象的 WHY 写在 CLAUDE.md §6
- **Ch5 §2.4 Information Hiding**：底层差异被 `getTransport()` 完全封装
- **Ch3 §11.7 Record the reasons**：✅ 满足

### 11.4 Event Sourcing / CQRS（Ch7 §6.2）— 部分实现

**Ch7 §6.2**：Event Sourcing = 每次状态变化保存为不可变事件

**MiWarp 实现**：
- ✅ **`events.jsonl`** = 事件流（事实来源，PLAN_V1.0.6 §0.1 第 1 原则）
- ✅ **`index.sqlite`** = 读模型（PLAN_V1.0.6 §0.2）
- ✅ **SessionPhase 状态机**（PLAN_V1.0.6 §0.4）

**评估**：
- **这是**"event log + local projection"** 的教科书实现**（PLAN_V1.0.6 §0.2 原话）
- 比 VICOO 强 10 倍（VICOO 没用 ES）

---

## 12. MiWarp vs VICOO 对比（关键洞察）

| 维度 | VICOO-esp | MiWarp | 差距 |
|------|-----------|--------|------|
| **架构文档** | 1 份 system-arch + 1 份 audit + 1 份 micro-eval（已过期） | CLAUDE.md + AGENTS.md + 4 份并行审计 + PLAN_V1.0.6 | **MiWarp 强** |
| **代码异味** | 7 + 4 耦合 + 7 内聚 | 3-4（god store / layout / types.ts） | **MiWarp 强** |
| **质量属性场景** | 0 个 | 5 个（4 份审计已写 4+ 个） | **MiWarp 强** |
| **ATAM 闭环** | 自评未跟踪 | Sprint 1+2 计划但未执行 | **MiWarp 略强** |
| **Ch6 Actor 模式** | ❌（FastAPI request handler 同步） | ✅ Session Actor 模式 | **MiWarp 强** |
| **Ch6 Fitness Function** | 0 | 建议 5 个（`npm run verify` 已有 gate） | **MiWarp 强** |
| **Ch7 Multi-Agent** | ❌（单 LLM） | ✅ 多 CLI 协作 | **MiWarp 强** |
| **Ch7 Channel Adapter** | ❌（4 端各写 request） | ✅ Transport 抽象 | **MiWarp 强** |
| **Ch7 Event Sourcing** | ❌ | ✅ events.jsonl + index.sqlite | **MiWarp 强** |
| **部署** | 1 docker compose | 桌面 + 移动 + 远程 | **MiWarp 强** |
| **DORA 节奏** | 不明 | v1.0.6→1.0.7 = 1 天 | **MiWarp 强** |

**关键洞察**：
> MiWarp 的"local-first + Session Actor + Transport 抽象 + Event Sourcing"四件套是**真正落地 Ch4-Ch7 课程知识**的工程实践。VICOO 的"模块化单体 + 微服务文档 + mock 污染"是**理论正确但执行未闭环**的反例。

**VICOO 团队可以从 MiWarp 借鉴的 5 件事**：
1. CLAUDE.md 写明 code smell checklist（VICOO 没有）
2. 4 份并行审计 + file:line 证据（VICOO 有 audit 但无证据粒度）
3. Session Actor 模式（如果未来要支持实时协作）
4. Transport 抽象（VICOO 4 端请求层重复）
5. events.jsonl + index.sqlite 双层（VICOO 没用 Event Sourcing）

---

## 13. 90 天路线图

```
第 0–14 天 (P0 止血)
├── S1.1: 修 A1 quarantine 静默（MultiPlatform-Hardening §A1）
├── S1.2: 修 A2 parse-fail 静默 + 加阈值告警
├── S1.3: 修 A3 slash 启动不可用
├── S1.4: 修 A4 通知跨平台 + 3 类事件
└── S1.5: Sprint 1 11 pd 剩余（C1/C2/C4/D2 隔离、并发 init、键盘 inset）

第 15–45 天 (P1 打磨 + Sprint 2)
├── S2.1: Sprint 2 13 pd（B1 虚拟滚动 / B2 autoResize / B4 双订阅消除 / C3 消息分片 / 等）
├── S2.2: PLAN_V1.0.6 落地 — T0-T3 分层加载（Performance 优化）
└── S2.3: PLAN_V1.0.6 落地 — index.sqlite 本地读模型

第 46–60 天 (God file 治理)
├── G1: session-store 拆 3-4 个 store（按 phase / timeout / permission 拆）
├── G2: +layout 拆 shell / sidebar / status bar
└── G3: types.ts 完成按域拆分（CLAUDE.md §7.4）

第 61–90 天 (持续评估 + ADR)
├── A1: docs/adr/0001-0009 创建
├── A2: 5 个 Fitness Function 加入 CI
├── A3: DORA 4 指标埋点（部署频率已有；lead time 量化；change failure rate 修完后量化；MTTR 加 release-regression.md 跟踪）
└── A4: 4+1 视图补齐（活动图 3 张 + 全局用例图）
```

---

## 14. 立即可做的 5 件事（一周内）

| # | 动作 | 影响 | 工时 |
|---|------|------|------|
| 1 | **修 A1 quarantine**（`session_actor.rs:1443-1487` 加 BusEvent::SessionRecovering 发射） | **高** | 0.5 pd |
| 2 | **修 A2 parse-fail 阈值**（`session_actor.rs:1401-1427` 加 PROTOCOL_DESYNC_THRESHOLD） | **高** | 0.5 pd |
| 3 | **修 A3 slash 启动不可用**（`use-slash-menu.svelte.ts:51` 移除 useStreamSession 依赖） | 高 | 0.5 pd |
| 4 | **修 A4 通知跨平台**（`notify.rs` 移除 macOS 限定 + 补 3 个事件） | 高 | 1.5 pd |
| 5 | **写 ADR-0001 Session Actor 模式**（记录 Non-Risk rationale） | 中 | 1h |

**Sprint 1 P0 一周内可全部修完**。这 5 件事对应 `MultiPlatform-Hardening-2026-06-06.md` Sprint 1 表格前 4 行（11 pd 中的 4 pd）。

---

## 15. 课程知识到 MiWarp 的对应表

| 复习笔记知识点 | 章节 | MiWarp 现状 | 你的"动作"或"团队对齐要点" |
|---------------|------|------------|---------------------------|
| 4+1 视图 | Ch3 §12 | 4/5 已隐式（差 Process） | 补活动图 |
| C4 模型 | Ch3 §15 | README 已有 SVG | 无需补 |
| ADR | Ch3 §14, Ch6 §16.2 | 缺失 | 写 9 个 ADR |
| QA Scenario 6 部分 | Ch4 §2.2 | 4 份审计已写 4+ 个 | 已在 §4 列出 5 个 |
| Availability Tactics | Ch4 §4.5 | circuit-breaker 实现 Ping/Echo + Heartbeat | 良好 |
| Modifiability Tactics | Ch4 §5.3-5.4 | transport 抽象 + SessionPhase 状态机 | 优秀 |
| Performance Tactics | Ch4 §6.6 | T0-T3 分层 + Local SQLite index（设计中） | 优秀 |
| Design Smells | Ch5 §1 | CLAUDE.md 列 19 项 | 范例 |
| 5 Coupling | Ch5 §3 | 几乎无 Content Coupling | 优秀 |
| 7 Cohesion | Ch5 §4 | transport 4 个文件 Functional | 优秀 |
| ATAM 9 步 | Ch6 §5 | 5/9 已做（差 Utility Tree + Sensitivity/Tradeoff 输出） | §6.1 补 |
| ATAM 4 输出 | Ch6 §7 | 4 个 P0 + 3 个 P0 风险已识别 | §6.2 完整 |
| Utility Tree | Ch6 §6 | 缺 | §6.1 已给完整树 |
| Strangler Fig | Ch6 §15.1 | 不适用（不拆微服务） | §7 用于 god file 拆分 |
| Fitness Functions | Ch6 §12 | `npm run verify` 已有 CI gate | §9 建议 5 个 |
| DORA Metrics | Ch6 §17 | Deployment Frequency 1 天 1 版 | §8 强 |
| Multi-Agent Routing | Ch7 §6.1 | 优秀实现 | §11.1 |
| RAG Pipeline | Ch7 §6.3 | 不直接适用（CLI 自己做） | §11.2 |
| Channel Adapter | Ch7 §6.5 | 出色实现（Transport 抽象） | §11.3 |
| Event Sourcing/CQRS | Ch7 §6.2 | events.jsonl + index.sqlite | §11.4 |
| MVA | Ch6 §10.3 | 隐式达成 | — |

---

## 16. 关键洞察（给团队）

### 16.1 MiWarp 的核心优势（值得保留）

1. **CLAUDE.md 写明 code smell checklist** — 这是**工程治理的范式转变**
2. **4 份并行审计 + file:line 证据** — 这是**ATAM 的最佳实践**
3. **Session Actor 模式** — 教科书级 Ch6 §16 实现
4. **Local-first 6 铁律** — 主动应用 Ch4 §6.6 Performance Tactics
5. **Transport 抽象** — 教科书级 Ch5 §2.4 Information Hiding
6. **events.jsonl + index.sqlite** — Ch7 §6.2 Event Sourcing 本地化

### 16.2 MiWarp 的最大风险（4 P0 仍未修）

> **ATAM 闭环未关**：Step 5-9（分析 + 修复 + 结果展示）只完成 Step 7（识别风险），**未执行 Step 8（修复）**。

**修 Sprint 1 P0 是这周最该做的事**。这 4 个 P0 不是"nice to have"——是**用户能直接感知到的痛点**（70s 静默、parse 静默、slash 不可用、通知缺失）。

### 16.3 给 VICOO 团队的对照参考

VICOO 报告（v1 + v2）列出的 7 个异味、3 个 S1 风险，与 MiWarp 的 4 P0 **同构**。VICOO 团队可以借鉴 MiWarp 的：

- **CLAUDE.md 模式**：把 code smell checklist 写进文档
- **file:line 证据文化**：risk-audit 不能只有 S1 标签，要给行号
- **Sprint 1 表格**：11 pd 可完成 P0，**强承诺**
- **Local-first 思维**：VICOO 的 RabbitMQ 闲置就是 "未应用 Ch4 §6.6 Resource Management" 的反例

---

**报告结束。**

> 致团队：MiWarp 已经是课程级架构实践。**最关键的"今日就做"是修 Sprint 1 P0**——文档已经写得很清楚，剩下的只是动手。其他 90 天路线图按优先级执行即可。
