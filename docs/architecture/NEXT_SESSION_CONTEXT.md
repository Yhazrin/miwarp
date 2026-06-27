# MiWarp 架构重构：下一会话上下文

## 1. 当前目标

基于软件架构课程知识，对 MiWarp 进行增量式架构重构，优先解决：

- WebSocket 建连、重连、超时与断线恢复；
- run 订阅重复、提前退订和 replay/live 错位；
- SessionStore、EventMiddleware、Transport 所有权混乱；
- chunk 大消息在 Web/iOS/Android/Rust 间协议不一致；
- 恢复请求被重复 debounce 吞掉；
- 后端 UTF-8 分片、资源上限和 `_full_reload` 可靠性。

核心原则：

```text
架构 = 组件 + 连接器 + 约束 + 决策理由 + 验证证据
```

采用 Strangler Fig 增量演进，禁止一次性重写整个 SessionStore 或前后端。

---

## 2. 工作区与安全状态

所有改动都在隔离 worktree：

```text
/Users/yanghaoze/.devspace/worktrees/miwarp-7c3e07cc
```

DevSpace workspaceId：

```text
ws_477fc609-7eba-4a3c-b465-2728d4b908f7
```

原项目：

```text
/Users/yanghaoze/Desktop/PROJECT/miwarp
branch: feat/architecture-deepening
```

当前状态：

- 未 merge；
- 未 commit；
- 未 push；
- 原项目未跟踪文件未覆盖；
- 自动 Claude Code 任务已完成，无后台任务继续修改。

下一会话必须先检查：

```bash
git status --short
git diff --stat
git diff --check
```

---

## 3. 已建立的架构准则

新增：

```text
.codex/skills/architecture-lifecycle/SKILL.md
docs/architecture/architecture-lifecycle-standard.md
docs/architecture/miwarp-communication-refactor.md
```

更新：

```text
CLAUDE.md
```

已建立 ADR：

```text
docs/adr/0003-websocket-connection-lifecycle.md
docs/adr/0004-session-run-subscription-ownership.md
docs/adr/0005-single-flight-recovery-and-transport-health.md
docs/adr/0006-bounded-cross-platform-websocket-chunking.md
```

架构方法包含：质量属性场景、4+1、C4、ADR、ATAM、Fitness Function、显式状态机、单一所有者、失败路径测试和增量迁移。

---

## 4. Phase 1：WebSocket Transport 内核

已完成模块化：

```text
src/lib/transport/connection-state.ts
src/lib/transport/request-registry.ts
src/lib/transport/run-subscriptions.ts
src/lib/transport/chunk-assembler.ts
src/lib/transport/timer-api.ts
src/lib/transport/websocket.ts
```

已修复：

- 首次连接 error/close Promise 悬挂；
- reconnect 状态无法真正重新连接；
- 重复 reconnect timer；
- 旧 socket generation 污染新连接；
- pending RPC 断线/超时/dispose 清理；
- typed lifecycle/request/RPC errors；
- owner-based run subscription；
- legacy 默认 owner 重复调用幂等；
- checkpoint 单调与 `_full_reload` reset；
- bounded chunk 数量、UTF-8 字节、总内存和超时；
- `onerror` 没有后续 `onclose` 时仍能失败。

专项验证：

```text
75 / 75 transport tests passed
```

---

## 5. Phase 2：Session run 订阅所有权

新增：

```text
src/lib/chat/session-run-connection.ts
src/lib/chat/session-run-connection.test.ts
```

架构：

```text
每个 SessionStore
└── 一个 SessionRunConnection
    ├── inactive
    ├── selected
    ├── replaying
    ├── live
    ├── reloading
    └── disposed
```

关键结果：

- 每个 Store 使用稳定唯一 owner；
- 已删除危险的模块级全局 controller；
- load/resume/fork 在可见状态变化前先释放旧 run；
- EventMiddleware 不再直接调用 transport unsubscribe；
- `_full_reload` 保留 owner 身份并重置 replay checkpoint；
- `session-subscription.ts` 只保留纯函数 `replayCheckpoint`。

验证：

```text
SessionRunConnection + EventMiddleware: 23 tests
SessionStore + Transport focused: 347 tests
Phase 2 combined focused: 370 tests
```

---

## 6. Phase 3：恢复 single-flight 与连接健康接口

新增：

```text
src/lib/chat/session-recovery-controller.ts
src/lib/chat/session-recovery-controller.test.ts
src/lib/transport/tauri.test.ts
```

修复：

- 删除 EventMiddleware 与 SessionStore 双重 2 秒 debounce；
- 同一 run 的并发恢复共享一个 in-flight Promise；
- 恢复完成后的新故障不会被 cooldown 吞掉；
- recovery notice timer/generation 统一管理；
- Store 销毁时清理恢复生命周期。

Transport 接口新增：

```ts
getConnectionState()
onConnectionStateChange(listener)
```

- WsTransport 返回真实状态；
- TauriTransport 固定返回 `open`；
- 业务层不再依赖具体 WsTransport 类。

前端最终已验证：

```text
75 test files
1550 tests passed
npm run check: 0 errors / 0 warnings
npm run format:check: passed
targeted ESLint: 0 errors / 0 warnings
npm run build: passed
```

构建仍有项目既有 Svelte state、bundle size、字体路径 warning，不是本次新增错误。

---

## 7. Phase 4：Rust WebSocket 协议

修改：

```text
src-tauri/src/web_server/ws.rs
```

已修复：

- 固定字节切割中文/emoji 导致 UTF-8 失败；
- Rust 现在只在合法 char boundary 分片；
- 最大逻辑消息 10 MiB；
- Axum max message 10 MiB、max frame 1 MiB；
- 超大 RPC result 转为小型字符串错误，不再让客户端只等 timeout；
- send_result/send_error 失败写日志；
- 删除服务端 `_full_reload` 30 秒 cooldown，防止第二次真实 overflow 被吞掉。

Rust 验证：

```text
UTF-8 chunk tests: 5 / 5 passed
cargo test --lib: 457 / 457 passed
cargo clippy --lib --tests -- -D warnings: passed
cargo fmt --check: passed
```

顺便清理两条既有 Clippy warning：

```text
len() >= 1 → !is_empty()
skip(0) → 删除
```

---

## 8. 移动端 chunk 协议：当前状态

### iOS

新增：

```text
apps/ios/MiWarpMobile/MiWarpMobile/Core/MiWarpChunkAssembler.swift
apps/ios/MiWarpMobile/MiWarpMobileTests/MiWarpChunkAssemblerTests.swift
```

修改：

```text
MiWarpWebSocketClient.swift
Package.swift
project.yml
```

结果：

- chunk assembler 从 WebSocket client 提取；
- disconnect/cancel reset；
- JSONSerialization 解析 chunk；
- 33 个测试已通过临时 SPM `swift test`；
- 尚未完成正式 iOS Simulator `xcodebuild test` 全链验证。

### Android

新增：

```text
apps/android/.../rpc/BoundedChunkAssembler.kt
apps/android/.../rpc/BoundedChunkAssemblerTest.kt
```

修改：

```text
MiWarpWebSocketClient.kt
```

结果：

- 删除 Regex 解析 chunk data；
- 使用 kotlinx.serialization JSON；
- 33 个 JVM 测试已写；
- 当前 Android 工程没有 gradlew/gradlew.bat，PATH 也无 Gradle，因此测试尚未实际执行。

### 移动端仍需人工收敛

下一会话先检查并修正：

1. 达到 max active messages 时，当前实现可能淘汰旧 buffer；建议改为拒绝新 begin，避免随机破坏有效消息。
2. 越界 idx 当前部分实现静默忽略；建议丢弃对应 message buffer。
3. 每次 consume 前是否真正调用 cleanupExpired，不能只提供方法。
4. iOS 完整 Xcode scheme / simulator 测试。
5. Android 恢复 Gradle Wrapper 或可用 Gradle 环境后执行 33 项测试。

移动端当前应视为：

```text
代码初版完成
iOS 核心逻辑已验证
Android 未实际执行
协议语义待一次最终人工复核
```

---

## 9. 仍未完成的大项

- 尚未把 architecture-lifecycle skill 安装到全局 `~/.claude/skills/`；
- 尚未更新全局 `~/.claude/CLAUDE.md`；
- SessionStore 仍约 3500 行，未进行全面拆分；
- Event projection 与副作用尚未完全分离；
- protocol desync / quarantine 尚未形成统一恢复状态机；
- Rust BusEvent、Web union、iOS/Android model 尚无自动协议一致性检查；
- Transport connection health 尚未接入正式 UI；
- 移动端和 Web 尚无完整 E2E 连接测试；
- worktree 改动尚未最终 review、commit、merge。

---

## 10. 下一会话推荐顺序

不要立刻继续大拆分。按以下顺序：

1. 检查 worktree `git status` 与完整 diff；
2. 独立审查移动端 assembler 和客户端集成；
3. 修正 active-limit、out-of-range、timeout cleanup 语义；
4. 运行 iOS 正式 build/test；
5. 恢复 Android Gradle Wrapper并运行测试；
6. 再跑前端 1550 tests、Rust 457 tests、Clippy、format、build；
7. 更新 ADR 0006 的移动端验证证据；
8. 做一次最终 architecture review；
9. 将改动拆成逻辑 commits；
10. 经用户确认后再合并回 `feat/architecture-deepening`。

禁止：

- 不要直接在原 checkout 做大改；
- 不要删除用户原有未跟踪文件；
- 不要把“写了测试”当成“测试已通过”；
- 不要声称整个 MiWarp 已完成全面重构；
- 不要一次同时重构 SessionStore、Rust protocol 和移动端 UI。

---

## 11. 当前准确结论

```text
架构方法与 Skill：项目内完成
Web Transport：完成并验证
Session 订阅所有权：完成并验证
恢复机制：完成并验证
Rust WebSocket 协议：完成并验证
iOS chunk：核心测试通过，完整 Xcode 验证待完成
Android chunk：代码和测试已写，实际测试待执行
SessionStore 全面拆分：未开始
最终 commit / merge / release：未进行
```
