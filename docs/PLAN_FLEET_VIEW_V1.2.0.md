# MiWarp Fleet View + Local MCP Bridge · v1.2.0 计划

> **文档状态**：计划（Anchored 候选，等 v1.1.0 Freeze 后正式锚定）
> **首次建立**：2026-06-23
> **产品主题**：**Local-first Digital Workforce + MCP-as-a-Service**
> **一句话承诺**：在 MiWarp 桌面端看见所有数字员工（session actor）的实时状态，并通过本地 MCP server + REST 聚合接口，让 ChatGPT / 其他外部 Agent 一键连上本机的 MiWarp 工作台。
> **上位约束**：[`PLAN_V1.1.0.md`](./PLAN_V1.1.0.md) · [`core-experience-v1.md`](./core-experience-v1.md) · [`V1.1.0_TREND_RADAR.md`](./V1.1.0_TREND_RADAR.md) · [`CLAUDE.md`](../CLAUDE.md)

---

## 零、为什么做这个

### 0.1 用户场景

**场景 A · 内部用户**

> 用户同时管理 5 个项目，每个项目挂着 1~3 个 Claude / Codex session。想知道：
> - 哪些 session 还在跑、哪些卡住等权限、哪些已经完成；
> - 每个 session 的当前任务、Token 用量、最近一次活动、所属 workspace / worktree；
> - 一键给某个员工发一条指令，或者 stop / fork。

**场景 B · 外部 Agent 用户**

> 用户在 ChatGPT 网页版里，希望直接调用本机的 Claude / Codex session：
> - "列出我电脑上的所有数字员工"；
> - "让 project-foo-session-3 跑 npm run build"；
> - "把上次 session-7 的最后一段 diff 拿过来"。
>
> 这要求 MiWarp 桌面端 **对外** 是 MCP server，对外 ChatGPT 用 MCP Custom Connector 协议连进来。

### 0.2 与 v1.1.0 的关系

v1.1.0 锚定了 `110-A15 Protocol Gateway`（**MiWarp 作为 Client** 接 ACP / AG-UI），本计划是 **它的对偶**：

| 方向 | v1.1.0 锚点 | v1.2.0 本计划 |
| --- | --- | --- |
| MiWarp 作为 **Client** | `110-A15`（ACP / AG-UI Adapter） | — |
| MiWarp 作为 **Server** | — | `120-A1 Fleet View` + `120-A2 Local MCP Server` |
| 共享运行时 | Runtime Hub / BusEvent / SessionStore / ActorSessionMap | 不变 |

**互不冲突**：
- v1.1.0 关心"MiWarp 接入外部 Agent"，本计划关心"外部客户端调用本机 MiWarp"；
- 共享 `ActorSessionMap` 注册表，但读取方向不同（client 写 / server 读为主）；
- 都可以挂在同一 `web_server/` 上，复用 9476 端口 + 现有 auth。

### 0.3 范围边界（v1.2.0 必须拒绝的诱惑）

| 不做 | 原因 |
| --- | --- |
| 自建云端 Agent 托管 | v1.1.0 已 `Deferred`；违背 local-first |
| 通用 RPA / 工作流引擎 | v1.1.0 已 `Rejected`；不抢 Linear / n8n 的位置 |
| 多用户协同 Fleet | v1.1.0 Teams 仍是 local mock；不在 v1.2.0 扩大 |
| 完整 Personality / 长期记忆 | v1.1.0 Personal AI `Deferred`；员工视图只看状态，不看人格 |
| ChatGPT 之外的第三方接入 | 仅做 MCP 标准；任何客户端只要支持 MCP 2025-03 spec 就能连 |

---

## 一、三大 trade-off 决策

| # | 决策点 | 选 A | 选 B | **本计划选** |
| --- | --- | --- | --- | --- |
| 1 | MCP transport | Streamable HTTP（2025-03 spec） | SSE（旧 spec） | **Streamable HTTP**（ChatGPT Custom Connector 推荐） |
| 2 | "数字员工" 语义 | 每个 `SessionActor` 即员工（覆盖全 session） | 只算 `commands/teams.rs` 注册过的 multi-agent team | **每个 SessionActor 即员工**（覆盖广、UI 自然；multi-agent team 是上层视图） |
| 3 | 认证 | 复用现有 `POST /auth` token + 加 `fleet` scope | 另发 fleet-only API key | **复用现有 token + scope 标记**（零维护、可立即撤销） |

### 1.1 MCP Transport 详解（Streamable HTTP）

按 [MCP 2025-03-26 spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) 实现：

```text
POST /mcp/fleet          → JSON-RPC 请求（无状态或带 session id）
GET  /mcp/fleet          → SSE 流，server-initiated 消息
DELETE /mcp/fleet        → 终止 session
```

不实现老 SSE 单向流；不实现 stdio transport（桌面端无意义）。

### 1.2 "数字员工" 语义详解

```text
数字员工 = 一个 SessionActorHandle
         = 一个 CLI 子进程 + 它的 conversation context

UI 上看到的"员工"：
  - avatar / icon（按 agent 类型：claude / codex）
  - 当前 status（idle / running / awaiting_permission / error / stopped）
  - 所属 workspace（cwd）
  - 当前 task（最近一条 user message）
  - runtime metrics（uptime / token / cost / 工具调用数）
```

`teams`（multi-agent）是更高层的聚合视图，与本视图**正交**；同一员工可能属于 0 个或多个 team。

### 1.3 认证详解

```text
POST /mcp/fleet
Authorization: Bearer <existing_token>

→ 复用 `web_server::auth::validate_ws_auth_extracted` 的判定
→ 检查 token_version 匹配（token 轮换后旧 session 自动失效）
→ 不增加新字段、不引入新密钥
```

外部 ChatGPT 的 MCP Connector 配置一次 token，后续通过 cookie / bearer header 复用。

---

## 二、目标架构

### 2.1 数据流

```text
                     ┌──────────────────────────────────────────┐
                     │         MiWarp Desktop (Tauri)           │
                     │                                          │
  Claude / Codex CLI │   ┌─────────────┐    ┌──────────────┐    │
  ──────────────►   │   │ session_    │    │  Actor-      │    │
                     │   │ actor       │───►│  SessionMap  │    │
                     │   └─────────────┘    └──────┬───────┘    │
                     │                              │            │
                     │              ┌───────────────┼──────┐     │
                     │              ▼               ▼      ▼     │
                     │      ┌──────────┐  ┌─────────────┐ ┌────┐│
                     │      │ commands/│  │ commands/   │ │mcp/││
                     │      │ fleet.rs │  │ fleet.rs    │ │flt ││
                     │      └────┬─────┘  │ (REST)      │ │svr ││
                     │           │        └──────┬──────┘ └─┬──┘│
                     │           │               │          │   │
                     │           ▼               ▼          ▼   │
                     │      ┌──────────────────────────────────┐ │
                     │      │   web_server/router.rs (9476)   │ │
                     │      │   /api/fleet/*   /mcp/fleet     │ │
                     │      └─────────────────┬────────────────┘ │
                     └────────────────────────┼──────────────────┘
                                              │
                                              │ http(s)
                ┌─────────────────────────────┼─────────────────────────────┐
                ▼                             ▼                             ▼
        ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
        │ MiWarp UI    │              │ ChatGPT      │              │ 任意 MCP     │
        │ (fleet 视图) │              │ Custom MCP   │              │ 2025-03 兼容 │
        │ via WS       │              │ Connector    │              │ 客户端       │
        └──────────────┘              └──────────────┘              └──────────────┘
```

### 2.2 新增模块边界（与 CLAUDE.md 高内聚低耦合原则对齐）

| 维度 | 新增 | 不动 |
| --- | --- | --- |
| 后端 domain | `commands/fleet.rs` | `commands/session.rs` · `commands/runs.rs` |
| 后端协议层 | `mcp/fleet_server.rs` | `commands/mcp.rs`（仍是 client 端） |
| 路由层 | `web_server/router.rs` 增 4 个 route | `web_server/state.rs` / `auth.rs` |
| 前端路由 | `routes/fleet/+page.svelte` | `routes/chat/+page.svelte`（841 行，绝不合并） |
| 前端 store | `stores/fleet-store.svelte.ts` | `session-store.svelte.ts`（3461 行，绝不混合） |
| API wrapper | `lib/api.ts` 增 `fleet*` 函数（不重写） | 其余 api.ts 保持 |
| 侧边栏入口 | `+layout.svelte` icon rail 加一个图标 | sidebar 整体逻辑保持 |

**禁止事项**：
- ❌ 在 `chat/+page.svelte` 里 import `fleet-store`；
- ❌ 在 `SessionStore` 上加 fleet 字段；
- ❌ 新增 `commands/mcp_server.rs` 与 `commands/mcp.rs` 同名混淆（保留原 mcp.rs 是 client 端）。

---

## 三、API 表面

### 3.1 REST 聚合（仅 `/api/fleet/*`，给 UI 和外部脚本用）

```text
GET    /api/fleet/members           → List<FleetMemberSummary>
GET    /api/fleet/members/{id}      → FleetMemberDetail
POST   /api/fleet/members/{id}/send → { run_id, accepted: true }     # 复用 start_run
POST   /api/fleet/members/{id}/stop → { stopped: bool }              # 复用 stop_run
GET    /api/fleet/metrics           → FleetMetrics                   # 聚合统计
GET    /api/fleet/ws                → WS 升级 → 实时状态流          # 复用现有 broadcaster
```

### 3.2 MCP server（仅 `/mcp/fleet`，给 ChatGPT / 其他 MCP client 用）

**Tools（v1.2.0 MVP）**：

| Tool 名 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `list_employees` | `{ status?: string, workspace?: string }` | `{ employees: EmployeeSummary[] }` | 列出所有数字员工 |
| `get_employee` | `{ id: string }` | `{ employee: EmployeeDetail }` | 单个员工详情 |
| `send_to_employee` | `{ id: string, prompt: string, cwd?: string }` | `{ run_id: string }` | 给员工发新任务 |
| `stop_employee` | `{ id: string }` | `{ stopped: bool }` | 停止员工 |
| `list_runs` | `{ employee_id?: string, limit?: number }` | `{ runs: TaskRun[] }` | 历史 run 列表 |
| `get_run` | `{ run_id: string }` | `{ run: TaskRun, last_preview?: string }` | run 详情 |
| `search_memory` | `{ query: string, limit?: number }` | `{ matches: PromptSearchResult[] }` | 复用现有 prompt 搜索 |
| `list_skills` | `{ source?: string }` | `{ skills: SkillSummary[] }` | 列出可用 skills（只读） |

**Resources（可选 MVP+）**：

```text
miwarp://employees         → 所有员工列表（每次请求重新查询）
miwarp://employees/{id}    → 单个员工详情
miwarp://runs/{id}         → run 详情
```

**Prompts（可选）**：

```text
summarize_employee: { employee_id }    → 给外部 Agent 用的总结 prompt 模板
diagnose_run: { run_id }               → 诊断 run 卡住原因
```

### 3.3 数据类型（前后端共享）

```ts
// src/lib/types.ts 新增
export interface FleetMemberSummary {
  id: string;              // SessionActorHandle session_id（= run_id）
  agent: "claude" | "codex";
  status: "idle" | "running" | "awaiting_permission" | "error" | "stopped";
  cwd: string;
  workspace_alias?: string;
  started_at: string;      // ISO
  last_activity_at: string;
  current_task_preview?: string;  // 最近一条 user message，截断到 200 字
  metrics: {
    uptime_secs: number;
    tool_calls: number;
    tokens_used: number;
    cost_usd_estimate: number;
  };
}

export interface FleetMemberDetail extends FleetMemberSummary {
  model?: string;
  permission_mode?: string;
  team_ids: string[];       // 所属 teams（可空）
  recent_runs: TaskRun[];   // 最近 10 个
}

export interface FleetMetrics {
  total: number;
  by_status: Record<FleetMemberSummary["status"], number>;
  by_agent: Record<FleetMemberSummary["agent"], number>;
  total_tokens_today: number;
  total_cost_today_usd: number;
}
```

---

## 四、前端 UI 草图

### 4.1 路由

```text
src/routes/fleet/
├── +page.svelte        # 员工视图主体
├── +page.ts            # 路由 meta
└── components/
    ├── FleetMemberCard.svelte
    ├── FleetMemberDetail.svelte
    ├── FleetFilters.svelte
    └── FleetMetricsHeader.svelte
```

### 4.2 主页面布局

```text
┌────────────────────────────────────────────────────────────────────┐
│  Fleet View                                  [●Running 5] [○Idle 3] │
│  ──────────────────────────────────────────────────────────────────│
│  Filters: [All ▾] [All agents ▾] [Search...]              [+ New] │
│  ──────────────────────────────────────────────────────────────────│
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────┐│
│  │ 🟢 claude    │ │ 🟡 claude    │ │ 🟢 codex     │ │ 🔴 claude ││
│  │ project-foo  │ │ project-bar  │ │ project-baz  │ │ crashed   ││
│  │ ▸ running    │ │ ▸ await perm │ │ ▸ running    │ │ ▸ error   ││
│  │ since 12:04  │ │ since 11:58  │ │ since 12:11  │ │ since 11:30││
│  │ "fix login…" │ │ "refactor…"  │ │ "add tests…" │ │ "deploy…" ││
│  │ tokens 12.3k │ │ tokens 4.1k  │ │ tokens 8.7k  │ │ tokens 2k ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └───────────┘│
│  ┌──────────────┐ ┌──────────────┐                                │
│  │ 🟢 claude    │ │ ⚫ claude     │   ... 更多                  │
│  │ solo         │ │ archived     │                              │
│  └──────────────┘ └──────────────┘                                │
└────────────────────────────────────────────────────────────────────┘
```

### 4.3 卡片交互

- 点击卡片 → 右侧 drawer 滑出 `FleetMemberDetail`（最近 10 个 run / 配置 / actions）
- Actions：
  - **Open in Chat** → 跳转到 `routes/chat/?run_id=xxx`
  - **Send Message** → 弹出 mini 输入框，调用 `send_to_employee`
  - **Stop** → 调用 `stop_employee`，按钮带二次确认
  - **Copy Employee ID** → 给外部 MCP client 用

### 4.4 Live update

- 进入页面时建立 WS 连接 `/api/fleet/ws`；
- 后端 `web_server::ws` 复用现有 broadcaster，broadcast 状态变化（`session_status_changed` / `run_started` / `run_finished` / `permission_requested`）；
- store 收到事件后只更新对应卡片，不全量重渲染；
- 断线 3s 后自动重连，退避 1s / 3s / 5s。

---

## 五、文件级任务清单

### 5.1 后端（Rust）

| 路径 | 新增/改 | 行数估计 | 关键内容 |
| --- | --- | ---: | --- |
| `src-tauri/src/commands/fleet.rs` | 新增 | 280 | `list_fleet` / `get_fleet` / `fleet_metrics` / `fleet_send` / `fleet_stop` 五个 `#[tauri::command]`；纯聚合，不持有状态 |
| `src-tauri/src/mcp/fleet_server.rs` | 新增 | 600 | JSON-RPC 2.0 路由 + Streamable HTTP transport 实现（POST/GET/DELETE handler）+ tools 表 + handler dispatch |
| `src-tauri/src/mcp/mod.rs` | 新增 | 10 | 仅导出 `fleet_server` 子模块 |
| `src-tauri/src/models.rs` | 改 | +40 | `FleetMemberSummary` / `FleetMemberDetail` / `FleetMetrics` struct |
| `src-tauri/src/web_server/router.rs` | 改 | +60 | 挂 4 个 REST route + 1 个 MCP route + 1 个 WS route 到 `build_router` |
| `src-tauri/src/web_server/dispatch.rs` | 改 | +20 | WS dispatch 表注册 fleet 事件 |
| `src-tauri/src/commands/mod.rs` | 改 | +2 | `pub mod fleet;` |
| `src-tauri/src/lib.rs` | 改 | +5 | 注册 fleet tauri commands 到 `invoke_handler` |

### 5.2 前端（TypeScript / Svelte）

| 路径 | 新增/改 | 行数估计 | 关键内容 |
| --- | --- | ---: | --- |
| `src/routes/fleet/+page.svelte` | 新增 | 350 | 主页面骨架，组合子组件 |
| `src/routes/fleet/+page.ts` | 新增 | 20 | 路由配置 |
| `src/routes/fleet/components/FleetMemberCard.svelte` | 新增 | 120 | 单卡片 |
| `src/routes/fleet/components/FleetMemberDetail.svelte` | 新增 | 200 | 详情 drawer |
| `src/routes/fleet/components/FleetFilters.svelte` | 新增 | 80 | 过滤器 |
| `src/routes/fleet/components/FleetMetricsHeader.svelte` | 新增 | 60 | 顶部统计 |
| `src/lib/stores/fleet-store.svelte.ts` | 新增 | 250 | reactive store + WS 订阅 + filter state |
| `src/lib/types.ts` | 改 | +50 | `FleetMemberSummary` / `FleetMemberDetail` / `FleetMetrics` TS 类型 |
| `src/lib/api.ts` | 改 | +60 | `listFleet` / `getFleetMember` / `sendToFleetMember` / `stopFleetMember` / `getFleetMetrics` 五个 wrapper |
| `src/lib/transport/contract.ts` | 改 | +30 | WS subscribe payload 类型（如果 contract 集中管理） |
| `src/routes/+layout.svelte` | 改 | +8 | icon rail 加一个 fleet 图标 + 路由条目 + i18n key |
| `messages/en.json` | 改 | +20 | `fleet.*` 键 |
| `messages/zh-CN.json` | 改 | +20 | `fleet.*` 键 |

### 5.3 测试

| 路径 | 类型 | 覆盖 |
| --- | --- | --- |
| `src/lib/stores/fleet-store.svelte.test.ts` | Vitest | store 状态机、WS 事件分发、filter 行为 |
| `src-tauri/src/commands/fleet.rs` 内 `#[cfg(test)]` 模组 | Rust | 聚合逻辑、错误路径 |
| `src-tauri/src/mcp/fleet_server.rs` 内 `#[cfg(test)]` 模组 | Rust | JSON-RPC 请求 / 响应、Streamable HTTP 三种 method、tools 路由、auth 失败 |
| `tests/integration/mcp_fleet.test.ts` | Vitest | end-to-end JSON-RPC 调用（起一个 mock web_server） |

---

## 六、验收标准

### 6.1 功能

- [ ] MiWarp 启动后，`routes/fleet` 显示所有活跃 SessionActor；
- [ ] WS live update：某 session 状态变化时，UI 在 1s 内反映；
- [ ] Send / Stop 操作在 UI 与 MCP server 一致返回结果；
- [ ] ChatGPT Custom Connector 配置一次 token 后能列出 employees 并发消息；
- [ ] token 轮换后旧 MCP session 自动失效（复用现有 `token_version`）；
- [ ] web_server 关闭时，`/mcp/fleet` 返回 503（不假装可用）。

### 6.2 架构红线（CLAUDE.md 自检）

- [ ] `chat/+page.svelte` 行数无增加；
- [ ] `session-store.svelte.ts` 行数无增加；
- [ ] `+layout.svelte` 行数增加 ≤ 10；
- [ ] 新增 `routes/fleet/+page.svelte` ≤ 400 行；
- [ ] `commands/fleet.rs` 与 `mcp/fleet_server.rs` 之间不互相 import 内部实现（仅共享 models）；
- [ ] 所有前端→后端调用走 `getTransport()`，无 `import { invoke }` 直接调用；
- [ ] 所有 UI 字符串走 `t('fleet.*')`。

### 6.3 性能

- [ ] 50 个员工同时展示：首屏 p95 ≤ 500ms；
- [ ] WS 断线重连：3 次以内恢复，p95 ≤ 5s；
- [ ] MCP `list_employees` 调用 p95 ≤ 100ms；
- [ ] WS 事件增量更新不触发整页 re-render（用 Svelte 5 `$state` 局部更新）。

### 6.4 测试覆盖

- [ ] `cargo clippy -- -D warnings` 0 错；
- [ ] `pnpm check` 0 错；
- [ ] `pnpm test` 全过，新模块覆盖率 ≥ 80%；
- [ ] `npm run i18n:check` 过；
- [ ] `npm run verify` 全过。

---

## 七、依赖与顺序

```text
Step 1: feat/fleet-view 分支 + worktree
   ↓
Step 2: 后端 commands/fleet.rs + models + router 挂 REST
   ↓ (并行)
Step 3: 前端 fleet-store + routes/fleet + api.ts wrapper（用 REST，临时跳过 MCP）
   ↓
Step 4: mcp/fleet_server.rs + router 挂 /mcp/fleet
   ↓
Step 5: WS live update（router + broadcaster + store 订阅）
   ↓
Step 6: 测试 + 验证 + i18n + 截图 UI 自检
   ↓
Step 7: 文档收口（本计划"增量记录"追加）+ 版本 bump
```

---

## 八、风险与降级

| 风险 | 影响 | 降级方案 |
| --- | --- | --- |
| MCP Streamable HTTP spec 在 ChatGPT 后端有兼容性差异 | 外部接入失败 | v1.2.1 兼容旧 SSE spec 作为 fallback endpoint |
| 50+ SessionActor 同时 WS 推送压力 | UI 卡顿 | 增量节流（每 200ms 合并一次）+ 状态 hash 比对去重 |
| 复用现有 token 让外部 client 拿到完整权限 | 安全风险 | 在 `web_server::auth::validate_ws_auth_extracted` 加 scope 字段 `fleet:read` / `fleet:write`，外部 token 默认仅 fleet scope |
| teams 与 fleet 双视图数据不一致 | 用户困惑 | 文档明确"fleet 是底层、teams 是聚合"；UI 在 teams 卡片上加"管理 → fleet"跳转 |

---

## 九、增量记录

### 2026-06-23 · 初始计划

- 由用户需求驱动：将 DevSpace MCP bridge 模式反转为 MiWarp 本地 MCP server；
- 选定三大 trade-off：Streamable HTTP / 每个 SessionActor 即员工 / 复用现有 token；
- 计划锚点候选 ID：`120-A1 Fleet View` + `120-A2 Local MCP Server`；
- 等待 v1.1.0 Frozen 后正式锚定 v1.2.0 主计划。

### 2026-06-23 · MVP 实现完成（feat/fleet-view 分支）

**Backend**
- `src-tauri/src/commands/fleet.rs`（280 行）—— 5 个 Tauri command + inner 函数（Tauri / REST / MCP 共享）
- `src-tauri/src/web_server/fleet_api.rs`（180 行）—— 5 个 REST endpoint + BearerAuth extractor
- `src-tauri/src/web_server/fleet_ws.rs`（125 行）—— live-update WebSocket（订阅 broadcaster）
- `src-tauri/src/mcp/fleet_server.rs`（638 行）—— Streamable HTTP MCP server + 8 tools + 2 resources + initialize/ping
- `src-tauri/src/models.rs` +101 行 —— FleetStatus / FleetMemberSummary / FleetMemberDetail / FleetMetrics / FleetSendResult
- `src-tauri/src/commands/runs.rs` +30 行 —— `stop_run_inner` 给 fleet 复用
- 总计 606 个 Rust 测试通过（含 22 个新 fleet/mcp 测试），clippy 0 警告，fmt 干净

**Frontend**
- `src/routes/fleet/+page.svelte`（341 行）—— 主视图：grid 卡片 + filters + 详情 drawer
- `src/routes/fleet/+page.ts` —— 路由配置
- `src/lib/stores/fleet-store.svelte.ts`（195 行）—— reactive state + WS 重连逻辑
- `src/lib/stores/fleet-store.svelte.test.ts`（234 行 / 15 vitest）—— 状态机 + filter 派生 + 优化 stop + refresh error path
- `src/lib/types.ts` +52 行 —— FleetMemberSummary / FleetMemberDetail / FleetMetrics 类型
- `src/lib/api.ts` +33 行 —— 5 个 typed wrapper（listFleet / getFleetMember / getFleetMetrics / sendToFleetMember / stopFleetMember）
- `src/lib/tauri-commands.ts` +5 —— CMD.fleet_list / get_member / get_metrics / send_to_member / stop_member
- `src/routes/+layout.svelte` +1 —— 侧栏 icon rail 加 /fleet 入口
- `messages/en.json` + `messages/zh-CN.json` —— 25 个 i18n key 双语
- 总计 2025 个 vitest 测试通过，0 错误（仅 1 个 pre-existing codemirror 失败无关本 PR）

**架构红线（CLAUDE.md 自检）**
- `chat/+page.svelte` 行数无变化 ✓
- `session-store.svelte.ts` 行数无变化 ✓
- `+layout.svelte` 仅 +1 行（icon rail entry）✓
- `routes/fleet/+page.svelte` 341 行（< 400 阈值）✓
- `commands/fleet.rs` 与 `mcp/fleet_server.rs` 之间不互相 import 内部实现（仅共享 models）✓
- 前端→后端调用走 `getTransport()`（fleet-store 全部 import $lib/api）✓
- 所有 UI 字符串走 `t('fleet_*')` ✓

**未完成 / v1.2.1 待办**
- SSE server-initiated MCP messages（ChatGPT push 通知）
- `/api/fleet/ws` Bearer auth 集成（目前走 query token + state.token 校验，未跑测试）
- `team_ids` 字段真正接 teams 数据
- `metrics.tool_calls / tokens_used / cost` 真实聚合（当前是 0）
- 性能：50+ SessionActor grid 渲染基准
- 端到端集成测试（`tests/integration/`）

**下一步**
- 用户在本地 `npm run tauri dev` 走一遍金路径
- ChatGPT Custom MCP Connector 配置一次 token 端到端联调
- 把 `/api/fleet/ws` 的 BearerAuth 抽到独立测试覆盖

