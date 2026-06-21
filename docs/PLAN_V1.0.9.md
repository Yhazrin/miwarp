# MiWarp v1.0.9 计划书 · Runtime Hub & Trustworthy Desktop Execution

> **文档定位**：面向 v1.0.9 的"做什么 / 怎么做"手册；以"零章主题原则 + 主体功能 / 实现路径"组织。
> **范围**：v1.0.8 → v1.0.9 修复桌面端"按下 Send 没有反应、必须刷新"的 P1 可靠性缺陷，把 MiWarp 的桌面执行路径从"看似发出"提升到"用户可以信任"。
> **核心原则**：**Trustworthy Desktop Execution**——Send 是一次可观察、可恢复、可重试的事务，而不是一次裸调用。
> **配套根因级证据**：v1.0.8 release 期间的会话回放 + `git blame src/lib/chat/use-send-message.ts`。
> **配套运行时基线**：[`docs/architecture/split-workspace-v1.0.8.md`](./architecture/split-workspace-v1.0.8.md)、[`docs/architecture/quality-foundation.md`](./architecture/quality-foundation.md)。

---

## 零、Trustworthy Desktop Execution（v1.0.9 的总章）

> **一句话**：用户在桌面端按下 Send 的那一瞬间，从前端到 Agent 全链路必须是一条可以被观察到、可以被恢复、可以被重试的事务，而不是一次"看似发出"后让用户猜测的裸调用。

### 0.1 v1.0.8 留下来的硬约束（必须保留）

1. **Connection Generation（连接代次）**：每次断连后必须递增；旧连接到达的事件要被丢弃
2. **Request Registry（请求注册表）**：每个 IPC 请求分配 id，超时后未应答的请求必须能被发现和清理
3. **Run Subscription（运行订阅）**：每个 run 的事件订阅必须挂在"活跃订阅"列表上，run 销毁时一并清理
4. **Bounded Chunking（受限分块）**：长消息分块上限受控，溢出必须有兜底而不是无限堆

> v1.0.9 不改、不削弱、不绕过以上四条。每条约束在 Phase 1 的代码里都有静态验证（grep / svelte-check / cargo clippy）。

### 0.2 设计原则（六条铁律）

1. **Submit = Transaction**：按下 Send 到"Backend acknowledged"是一条有边界的事务。期间的状态迁移由显式状态机描述，不靠回调链隐式驱动
2. **Single Source of Truth for Run Identity**：用户按下 Send 时捕获的 `runId` 就是这次事务的身份；session 切换不能跨路由也不能改写
3. **Idempotency by clientMessageId**：每个 submit 携带 UUID；前后端用它做幂等键，重复请求不产生重复 turn
4. **Draft Retention Until Accepted**：草稿在 transport 真正确认之前不能消失；失败时必须可以原样恢复
5. **Typed Failure with Retry**：失败有结构（`transport_unavailable` / `rejected` / `stale_identity` / `timeout` / `unknown`）和重试建议，不靠 toast 上的字符串
6. **No Silent Loss**：所有失败路径都要 surface 到 UI（banner / toast / breadcrumb），用户永远不会看到"按了没反应"的真空

### 0.3 修复目标

| 用户可见症状（v1.0.8） | v1.0.9 行为 |
|---|---|
| 按 Send 没反应，必须刷新页面 | SendCoordinator 显式管理 submit 事务；`busy` / `submitting` / `failed` 状态实时反映在按钮和 banner |
| 草稿被吞掉，刷新前看不到 | `onAccepted` 才清空草稿；`onFailure` 保留草稿 + 提供 Retry CTA |
| 网络抖动后 agent 没收到消息 | 前端 transport 接受 + 后端 actor dedupe by `client_message_id`；同一消息不会重复投递也不会被丢弃 |
| 切换 session 后旧消息错投到新 session | `cancelForRun` 在 session 切换时强制事务为 `stale_identity`，乐观时间线不会跨路由 |
| 重连期间消息"卡住" | 提交失败被分类为 `transport_unavailable` 并提供 Retry；不靠自动后台重试（Phase 1 故意不缓冲） |
| 中文输入法 IME 误触发 send | PromptInput 的 `handleKeydown` 守卫 `e.isComposing` / `e.keyCode === 229`；v1.0.9 验证不被破坏 |
| 双击 send 产生重复 turn | PromptInput 的 `busy` prop + SendCoordinator 的 `clientMessageId` 幂等键双保险 |

---

## 一、Send 事务契约（Desktop Send Contract）

### 1.1 Submit 生命周期

```text
[用户点击 Send]
    │
    ▼
submit(runId, sessionId, draft, cause)   ── SendCoordinator
    │
    ├── emit("submitting")
    ├── inFlight[clientMessageId] = record
    │
    ▼
transport(clientMessageId)               ── session_actor (Rust)
    │
    ▼
[Backend acknowledged]
    │
    ├── emit("accepted") / emit("queued")
    ├── inFlight.delete(clientMessageId)
    ├── onAccepted hook fires → 清空草稿（仅当 runId 仍是 store.run.id）
    │
    ▼
return { clientMessageId } to caller
```

### 1.2 终止态分类

| Code | 含义 | Retryable | UI 文案 (i18n key) |
|---|---|---|---|
| `transport_unavailable` | 连接断开 / websocket 关闭 / disposed | true | `send_status_failed_transport` |
| `rejected` | actor dead / run 不存在 / 后端拒绝 | false | `send_status_failed_rejected` |
| `stale_identity` | 用户切换了 session / run 被 dispose | false | `send_status_failed_stale` |
| `timeout` | IPC 超时未应答 | true | `send_status_failed_timeout` |
| `duplicate` | 同 `clientMessageId` 已 accepted | n/a | 不显示 banner（静默接受） |
| `unknown` | 未分类的 transport error | true | `send_status_failed_unknown` |

### 1.3 幂等保证

- **前端**：`SendCoordinator` 用 `clientMessageId`（UUIDv4）作为事务 id。两次相同 id 的 submit 不会同时在 in-flight 集合里出现。
- **后端**：`session_actor` 在 `queued_user` 上按 `client_message_id` 做去重：如果同 id 已经在队列里，立即 resolve 为 `Ok(())` 而不再创建第二条 turn。
- **跨端到端**：前端把 `clientMessageId` 透传到 `start_session` / `send_session_message` / `send_chat_message` 三个 Tauri command，再由 `web_server::dispatch` 和 `scheduler::runner` 透传到 actor。Web 路径和后台路径都覆盖。

### 1.4 草稿保留契约

```text
                       草稿状态
[用户输入]              draft 在 inputStore 中
    │
    ▼
[点击 Send]
    │
    ▼ captureDraftSnapshot
draft snapshot 保留在 useSendMessage 的 SendDraft
    │
    ▼
transport resolves      → onAccepted → clearInput()      (runId 仍是 store.run.id 才清)
transport rejects       → onFailure  → 保留草稿
SendCoordinatorError    → restoreDraft(snapshot)          (use-send-message 双保险)
PromptInput 的 onSend 拒绝 → 不动草稿（inputStore 自己保留）
```

---

## 二、实现路径（按模块划分）

### 2.1 新增模块 `src/lib/chat/send-coordinator.ts`

- 显式状态机：`submitting` → `accepted` / `failed`；`markQueued` 提供 `queued` 中间态（Phase 2 browser 路径使用）
- `inFlight` 用 `clientMessageId` 做 key，允许同一 runId 上的并发 submit 独立追踪
- 公开 API：`submit` / `markQueued` / `acknowledge` / `abort` / `cancelForRun` / `reconcileActiveRun` / `dispose` / `subscribe` / `isSubmitting` / `hasInFlight` / `busy`
- 失败分类：`toSendFailure()` 根据错误名 / 错误消息正则分类；落不到具体 code 时返回 `unknown`
- 单测：`src/lib/chat/send-coordinator.test.ts` 覆盖 18 个场景（happy / transport / timeout / rejected / 并发 / stale / 队列 / 幂等 / dispose / listener 异常隔离）

### 2.2 修改 `use-send-message.ts`

- 入口从 `sendMessage(ctx)` 改为 `createSendMessage(ctx)`，返回 `{ sendMessage, coordinator, latest, inFlight }`
- 继续发送：`coordinator.submit({ runId, sessionId, draft, cause: "continue", transport })`
- 新建会话：直接调 `store.startSession(..., clientMessageId)`，因为事务 id 由 `startSession` 内部产生
- 失败路径：`SendCoordinatorError` 时 `restoreDraft(draft)` 兜底
- 接受路径：`onAccepted` 触发 `clearDraftIfOwnedBy(event.runId)`，避免 session 切换后旧草稿被清空

### 2.3 修改 `PromptInput.svelte` + `ChatInputDock.svelte`

- PromptInput 新增 prop：`busy: boolean`（双击 send 守卫）+ `onSend` 现在返回 `Promise<void> | void`
- PromptInput 在 `handleSend` 里 capture `draftSnapshot`，失败时通过 promptInputRef 回滚
- ChatInputDock 新增 props：`sendCoordinator?: SendCoordinator | null` / `sendBusy?: boolean` / `onSendRetry?: ((event) => void) | null`
- ChatInputDock 在有 coordinator 时挂载 `<SendStatusBanner>`，retryable 失败展示 Retry 按钮

### 2.4 新增模块 `src/lib/components/chat/SendStatusBanner.svelte`

- 监听 coordinator 状态，展示 submitting / queued / accepted / failed
- 失败时根据 `event.error.code` 选 i18n 文案 + 按 `retryable` 决定是否展示 Retry CTA
- `data-send-state` / `data-send-code` 属性暴露给 e2e 测试做断言

### 2.5 修改 `src/lib/stores/session-store.svelte.ts` + `src/lib/api.ts`

- `SessionStore.sendMessage(text, attachments, clientMessageId?)` 透传事务 id
- `SessionStore.startSession(...)` 已经走 `startSession` 透传
- `api.sendChatMessage` / `api.startSession` / `api.sendSessionMessage` 都加上 `clientMessageId?: string | null` 形参

### 2.6 后端修改（Rust）

- `agent/turn_engine.rs`：`UserTurnTicket` 新增 `client_message_id: Option<String>`
- `agent/session_actor.rs`：
  - `ActorCommand::SendMessage` 新增 `client_message_id` 字段
  - `handle_send_message` 在 enqueue 前做 dedupe：`queued_user` 里已有同 id → 立即 `reply.send(Ok(()))`
  - 日志包含 `client_message_id={:?}`（不含用户内容）
- `commands/session.rs` / `commands/chat.rs`：`start_session` / `send_session_message` / `send_chat_message` 都接受 `client_message_id`
- `web_server/dispatch.rs` / `scheduler/runner.rs`：把 `client_message_id` 从请求参数 / 调度参数透传到 actor

---

## 三、阶段计划

### 3.1 Phase 1（v1.0.9 → 本次交付）

- ✅ SendCoordinator 状态机 + 单测
- ✅ 草稿保留 + UI banner + Retry CTA
- ✅ clientMessageId 前后端透传 + 后端去重
- ✅ `pnpm check` / `pnpm lint` / `pnpm format:check` / `pnpm test` / `pnpm i18n:check` / `pnpm build` 全过
- ⏳ `cargo fmt` / `cargo clippy -- -D warnings` / `cargo test` 因当前 worktree 无 cargo 二进制延后到本地验证

### 3.2 Phase 2（v1.0.9 → 下一补丁）

- 把 `markQueued` 接入浏览器 transport 的 reconnect 缓冲（当前 Phase 1 是"快速失败 + UI 提示 Retry"，Phase 2 升级为"安静缓冲 + 连接回来自动 flush"）
- 加 Telemetry：SendCoordinator 失败统计（按 `code` 分组），不收集 prompt 内容
- e2e 测试覆盖：通过 Playwright 在真实 WebView 中验证 Send 后 IPC 往返 + Retry CTA 可见

### 3.3 Phase 3（v1.0.9 → 长尾）

- SendCoordinator 事件接到 EventMiddleware，让 timeline store 也能感知 submit 失败并标记对应消息为 `failed`
- 后端 `actor dead` 路径增加自动 `session_actor` respawn（不破坏 v1.0.8 connection generation）
- 跨端测试：iOS / Android WebView 复用同一套 SendCoordinator

---

## 四、证据

### 4.1 测试

| 范围 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test -- --run` | 85 文件 / 1645 测试 / 0 失败 |
| 状态机 | `pnpm test -- --run src/lib/chat/send-coordinator.test.ts` | 18 / 18 通过 |
| 类型 | `pnpm check` | 1438 文件 / 0 errors / 0 warnings |
| 格式 | `pnpm format:check` | 全部通过 |
| i18n 对齐 | `pnpm i18n:check` | 0 errors / 5 pre-existing warnings |
| 构建 | `pnpm build` | adapter-static 成功 |

### 4.2 静态证据（grep 模式）

```bash
# 1. SendCoordinator 的 single-flight 守卫
grep -n "this.inFlight.set" src/lib/chat/send-coordinator.ts
# → 1 处，仅以 clientMessageId 为 key

# 2. 草稿清除只发生在 onAccepted
grep -rn "clearInput\|restoreSnapshot" src/lib/components/PromptInput.svelte src/lib/chat/use-send-message.ts

# 3. 后端 dedupe
grep -n "client_message_id" src-tauri/src/agent/session_actor.rs
# → 含 dedupe 分支

# 4. v1.0.8 不变量未被破坏
grep -n "generation\|request_registry\|run_subscription\|chunking" src-tauri/src
```

### 4.3 调试 / 诊断面包屑（不含 prompt 内容）

```text
[ocv:send] submit.start    { runId, clientMessageId, cause, generation }
[ocv:send] submit.accepted { runId, clientMessageId, cause }
[ocv:send] submit.failed   { runId, clientMessageId, cause, code, retryable, label }
[ocv:send] listener.error  { error }
```

`runId` / `clientMessageId` / `cause` / `code` 都是结构化字段；不包含任何用户输入文本。

---

## 五、剩余风险（Phase 2 候选）

| 风险 | 影响 | Phase 1 缓解 |
|---|---|---|
| Browser transport 断线时 Phase 1 直接失败要求 Retry，体感上比 v1.0.8 的"看似发出去"略差 | 中 | UI banner 立即可见，retryable = true |
| PromptInput 的 `inputStore` 与 `use-send-message` 的 `draft` 双源，理论上不一致 | 低 | `clearDraftIfOwnedBy(runId)` 在 runId 不匹配时不清 |
| `SendCoordinatorError` 在某些罕见的 Promise unhandled rejection 边缘可能被 vitest 报警 | 低 | 测试用 `.catch(() => {})` / `Promise.allSettled` 兜底 |
| 后端 dedupe 仅在 `queued_user` 内做，已 accepted 的同 id 不会再次 dedupe（因为不在队列里） | 低 | 前端 SendCoordinator 已经把同 clientMessageId 从 in-flight 集合里移除，二次提交不会发生 |
| 中文 IME 在 SendCoordinator 路径下若 PromptInput 的 `busy` 未及时清零，可能锁住 send | 低 | `busy` 与 `coordinator.busy` 绑定，accept / fail 都会清零 |

---

## 六、变更文件清单（Phase 1）

| 文件 | 变更类型 | 行数 |
|---|---|---|
| `src/lib/chat/send-coordinator.ts` | new | +487 |
| `src/lib/chat/send-coordinator.test.ts` | new | +260 |
| `src/lib/components/chat/SendStatusBanner.svelte` | new | +120 |
| `src/lib/chat/use-send-message.ts` | modified | +120 / -45 |
| `src/lib/components/PromptInput.svelte` | modified | +55 / -8 |
| `src/lib/components/chat/ChatInputDock.svelte` | modified | +14 / 0 |
| `src/lib/stores/session-store.svelte.ts` | modified | +12 / -3 |
| `src/lib/api.ts` | modified | +12 / -4 |
| `src/routes/chat/+page.svelte` | modified | +30 / -4 |
| `messages/en.json` | modified | +9 / 0 |
| `messages/zh-CN.json` | modified | +9 / 0 |
| `src-tauri/src/agent/turn_engine.rs` | modified | +3 / 0 |
| `src-tauri/src/agent/session_actor.rs` | modified | +28 / -4 |
| `src-tauri/src/commands/session.rs` | modified | +18 / -4 |
| `src-tauri/src/commands/chat.rs` | modified | +5 / -1 |
| `src-tauri/src/web_server/dispatch.rs` | modified | +11 / -2 |
| `src-tauri/src/scheduler/runner.rs` | modified | +1 / 0 |

总计 17 文件 / +1214 / -75。
