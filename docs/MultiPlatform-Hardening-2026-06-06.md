# 多端体验整改指南 · 2026-06-06

> 用户反馈摘要：桌面端会话卡顿、CLI 同步丢失、内置命令调不出、通知匮乏、动画卡顿；移动端连接慢、断联严重、传输/同步逻辑有问题、对话页元素粗糙、iPadOS / iOS / Android 缺乏分别适配。
>
> 本文是 4 份并行代码审计的合并产物，每条问题都给到 `file:line` 级证据与可执行修复方案。所有修复都是“追加/调整”，未要求重写架构。优先级 P0 = 阻塞体验，P1 = 显著改善，P2 = 打磨。工作量按人日（pd）估，是单工程师粗估，不含联调。

---

## 优先级速览（建议两轮 sprint）

| Sprint | 章节 | 关键修复 | 总工作量 |
| --- | --- | --- | --- |
| **Sprint 1（救火）** | A1, A2, A4, B3, C1, C2, C4, D2 | 隔离机制可观察、parse-fail 阈值告警、OS 通知后端化、移除 theme-transitioning 全局通配符、并行 init、增量 history、断联感知、键盘 inset | 11 pd |
| **Sprint 2（打磨）** | A3, B1, B2, B4, C3, C5, C6, D1, D3, D4, D5 | slash 提前可用、虚拟滚动、autoResize 合并、双订阅消除、消息分片、协议对齐、size-class 重构、对话长按菜单、Android 双栏、UI 鸿沟 | 13 pd |

---

# A. 桌面端 · 会话同步 / CLI / 命令 / 通知

## A1. 会话卡顿（隔离机制对用户假死） — P0 · 0.5 pd

**现象**：聊天界面长时间无响应，但后端进程仍在跑。

**根因**：`session_actor.rs:1443-1487` 的 quarantine（隔离）状态会持续吞掉 stdout 但不向前端发任何事件，最长可达 `QUARANTINE_DEADLINE = 10s`（`turn_engine.rs:149-155`）；叠加 `INTERNAL_HARD_TIMEOUT = 60s`，最坏体验是**前端 70 秒静默**。`/context` 命令在某些 API 代理下会让 CLI 永久挂起（`session_actor.rs:795-827` 注释已坦承），这是触发隔离的主源。

**修复方案**：
1. 进入隔离时立刻 emit 一个 `BusEvent::SessionRecovering { reason, deadline_ms }` 让前端显示“会话恢复中…（最多 10 秒）”的非阻塞 banner。
2. 退出隔离（CLI 回 idle/failed 或 deadline 到）时再 emit `SessionRecovered { ok: bool }`。
3. `QUARANTINE_DEADLINE` 从 10s 缩到 5s — 实测中 CLI 5 秒不响应基本就是死了。
4. 前端 `event-middleware` 监听这两个事件，调用现成的 `notification-listener.notifyUser` + 顶部 banner（不要 modal）。

**验收**：人工 SIGSTOP CLI 进程，前端 1 秒内出现 banner，5 秒后看到 “session failed” 提示而非沉默假死。

---

## A2. CLI 同步丢失（parse 失败静默） — P0 · 0.5 pd

**现象**：前端显示 `running`，CLI 实际已空闲；切到别的会话再回来才会“突然”同步上。

**根因**：`session_actor.rs:1401-1427` 在 stdout JSON parse 失败时三路降级（quarantine 丢、内部 turn 丢、用户 turn 发 Raw）；`session_actor.rs:228-229` 只是把 `json_parse_fail_count` 累加，从无阈值告警。CLI 协议升级或 stderr 混流时，RunState 永远到不了，turn 引擎只能等超时。

**修复方案**：
1. 给 `json_parse_fail_count` 加阈值（建议 5/分钟）。超阈值后：
   - 后端 emit `BusEvent::ProtocolDesync { sample, fail_count }`，sample 取首 200 字节原始行，方便定位。
   - 强制把 turn 状态机推进到 `RunState::Failed { reason: "protocol_desync" }`，断开 turn 让前端解锁。
2. 前端 `recoverRunFromDisk`（`event-middleware.ts:406-415`）触发时，先弹一个“会话状态已重置”的 toast，避免静默重放制造“突然同步”错觉。

**验收**：mock 一个会输出 50% 非 JSON 行的假 CLI，前端能在 30 秒内显示 desync 提示并解锁输入框。

---

## A3. Slash 命令调不出来 — P1 · 0.5 pd

**现象**：会话还没启动时，输入 `/` 没反应；启动后才有命令。

**根因**：`use-slash-menu.svelte.ts:51` 把 `slashEnabled` 定义成 `agent === "claude" && !!useStreamSession()`，而 `useStreamSession` 依赖 `run.execution_path === "session_actor"`（`session-store.svelte.ts:673-676`） — 也就是必须**已发起过一次 run**。命令源是 `session_init` 事件 + `getCliCommands()` 全局缓存的合并，全局缓存在应用启动时未必已 hydrate（`cli-info.svelte.ts:13-15`）。

**修复方案**：
1. `slashEnabled` 改为 `agent === "claude"` 单条件，移除 `useStreamSession` 依赖。
2. 应用启动时主动预拉一次 `getCliCommands()`，缓存到 `cli-info` store。
3. 菜单顶部加一句 i18n 提示 “session_init 未到达，仅显示内置命令”，让用户知道是降级状态。
4. 前端兜底命令表（`commands/cli-commands.ts` 或类似 fallback table）补全 `/code-review`、`/usage-credits`（已通过远程 #129 同步）+ 任何 2.1.150+ 的新命令。

**验收**：冷启动应用，未点任何 session，输入 `/` 立即出现菜单，含 ≥10 条内置命令。

---

## A4. 通知匮乏 — P0 · 1.5 pd

**现象**：长 run 跑完没有系统通知；定时任务失败前端不知；MCP 报错只在 console。

**根因**：通知三层都不闭环：
- 应用内 toast `notification-listener.ts:83-84` 只监听 `run_state` 与 `permission_prompt`，**不**响应 `task_notification`、MCP error、远端连接事件。
- 系统 OS 通知 `notify.rs` 注释写 “macOS notifications”，且只在 PreToolUse hook / elicitation / can_use_tool 三处调用（`session_actor.rs:1784/1862/1930`），**run 完成/失败时根本没调**。
- 后端 webhook 仅 Feishu（`scheduler/runner.rs:332/372/387`）。

**修复方案**：
1. 把 `notify.rs` 的 “macOS” 限定改成跨平台条件分支（已有 `tauri-plugin-notification`，三端都能用）。
2. 在 `session_actor.rs::handle_eof` 的 run 完成/失败路径，根据 `app.is_focused()` 决定是否调 `notify_if_background`。这样 OS 通知不再依赖前端 JS 是否运行。
3. `notification-listener.ts` 补 3 个事件类型：
   - `task_notification.completed/failed`（scheduled task）
   - `mcp_error`
   - `remote_connection_changed`
4. 引入统一的 `NotificationService`（前端单例），把现在散落在 toast-store / event-middleware / notification-listener 的入口收敛。Settings 加“通知偏好”面板。

**验收**：跑一个 30 分钟 run，最小化窗口；run 完成后系统级通知出现；点击通知激活窗口并跳到该会话。

---

# B. 桌面端 · 性能 / 渲染 / 动画

## B1. 大量消息时渲染慢 — P1 · 2 pd

**现象**：会话超过 200 条消息后，滚动掉帧、新消息进入卡顿。

**根因**：
- `ChatTimelineEntries.svelte:166` 的 `{#each visibleTimeline as entry, i (entry.id)}` 全量渲染，无虚拟滚动。`VirtualList.svelte` 已存在但只用在 `ProjectFolderItem`。
- `content-visibility: auto` 可救场（`app.css:1139` 的 `.cv-auto`），但 `ChatConversationStage.svelte:306` 硬编码 `contentVisibilityEnabled={false}`，把它关了。
- `ChatTimelineEntries.svelte:130-153` 自己开了一路 Tauri `bus-event` 监听器，`message_complete` 时 `new Map(seqByMessageId)` 全量拷贝。

**修复方案**：
1. 短期（0.5 pd）：把 `contentVisibilityEnabled` 还原为 `true`（或暴露成用户开关，默认开）。这是零代价提速。
2. 中期（1.5 pd）：`ChatTimelineEntries` 接入 `VirtualList`，以 `entry.id` 为 key，配合预估行高 + IntersectionObserver。注意 InlineToolCard 的高度是动态的，需要渲染后回写实际高度。
3. 把 `seqByMessageId` 维护移到 `SessionStore._reduce` 的 `message_complete` 分支，**消除组件层的第二路 Tauri 监听**。

**验收**：500 条消息会话，滚动 60 fps，新消息进入帧时间 < 16 ms（用 `performance.measure` 验证）。

---

## B2. 输入打字 lag — P1 · 1 pd

**现象**：在 `PromptInput` 高频敲字时，光标跟手有延迟。

**根因**：
- token 估算已防抖（`use-file-handling.svelte.ts:95-100`，300 ms），不是问题。
- `PromptInput.svelte` 内有 **8 处** `requestAnimationFrame()` 散落（`:138/353/371/555/780/939/1016/1025/1054/1063`），handleInput / autoResize / 权限切换叠加触发。
- `:171-179` 一个 `setInterval(10s)` 轮询 git branch（已加 `visibilityState` 但仍在 PromptInput 内执行）。
- `ChatInputDock.svelte:81-98` 的 `ResizeObserver` 同步写两个 CSS 变量，dock 高度变化时持续触发。

**修复方案**：
1. 把 8 处 `rAF(autoResize)` 合并成单个 `pendingResize` 标志：每帧最多 commit 一次。
2. ResizeObserver 回调用 `requestAnimationFrame` 节流，并改用 `box: "border-box"` 让浏览器合并通知。
3. git branch 轮询移到 SessionStore 单例 + `document.visibilitychange` 唤醒拉取，改为按需。
4. 把 `PromptInput.svelte` 拆出 `PromptInputCore` + `PromptToolbar`，让 toolbar 状态变化不触发 textarea 子树重新调度（已是 PR3 路线图，参见 `MEMORY.md` `project_chat_refactor_roadmap`）。

**验收**：长文本（10k 字符）下连续敲键，输入到屏幕显示 < 32 ms（Chrome Performance）。

---

## B3. 动画卡顿（主题切换 + glass blur） — P0 · 0.5 pd

**现象**：切换主题时全屏抖动；工具卡密集时滚动掉帧。

**根因**：
- `app.css:18-29` 的 `html.theme-transitioning *` 通配符在主题切换 300 ms 内对**每一个** DOM 元素施加 6 条 transition（背景/前景/边框/阴影/fill/stroke），数千个元素同时重绘 = 重绘风暴。
- `app.css:74-88` 的 `.glass-panel` / `.glass-card` 每个都创建独立 backdrop-filter 复合层；`InlineToolCard.svelte:744/882/1017/1281/1564` 一个组件 5 处 glass-card，长会话累积上百层 GPU 合成。
- `app.css:945` `.collapsing-burst-tool` 用 `transition: max-height` — 触发 layout reflow。

**修复方案**：
1. theme-transitioning 改为只对顶层 shell 元素挂 transition：
   ```css
   html.theme-transitioning :is(body, .glass-sidebar, .chat-shell, header) {
     transition: background-color 300ms, color 300ms;
   }
   ```
   不再用通配符 `*`。
2. `InlineToolCard` 中非 hover/active 态的 glass-card 改为半透明纯色 `bg-miwarp-bg-elevated/85`，只有顶部第一张工具卡保留 backdrop-filter。
3. `.collapsing-burst-tool` 的 `max-height` 动画改为 Web Animations API 控制（`element.animate(...)`）或 `transform: scaleY` + `transform-origin: top`。

**验收**：50 个工具卡的会话，滚动 GPU 使用 < 30%（Chrome Performance Memory tab）；主题切换无明显闪烁。

---

## B4. 事件压力 / 双订阅 — P1 · 1 pd

**现象**：Streaming 大量 token 时 UI 偶发掉帧。

**根因**：
- `event-middleware.ts:381-403` 16 ms rAF + setTimeout 批处理是好的。
- 但 `session-store.svelte.ts:2994` 的 `message_delta` 在**单条事件路径**（无 ctx）下直接 `this.streamingText += ev.text` — 每个 token 都触发一次响应式刷新。
- `ChatTimelineEntries.svelte:130-153` 的独立 `bus-event` 监听器使同一事件被路由两次。

**修复方案**：
1. 单条 `applyEvent` 入口里把 `streamingText` 改成微任务批处理：把 delta 推进 `pendingDeltas: string[]`，下一个 microtask 一次性 `streamingText += pendingDeltas.join("")`。
2. 删除 `ChatTimelineEntries.svelte` 自己的 Tauri 监听器，全部走 SessionStore 派发出的派生 state。

**验收**：streaming 一个 5k token 的回答，主线程 long task ≤ 1 个，每帧 < 16 ms。

---

# C. 移动端 · 传输 / 连接 / 同步

## C1. 连接慢（串行 init） — P0 · 0.5 pd

**现象**：进入 chat 页有 200-500 ms 空白才出消息。

**根因**：`ChatView.swift:62-63` 的 `.task` 串行 `await loadHistory()` → `subscribeToEvents()`。订阅在 history 拉完后才建立，期间实时事件可能漏帧。`WorkspaceStore.swift:100-103` 已展示并行模式（`async let` 三路并发），chat 没用。

**修复方案**：
```swift
.task {
    async let history: () = viewModel.loadHistory()
    async let subscribe: () = viewModel.subscribeToEvents()
    _ = await (history, subscribe)
}
```
订阅与 history 同时启动；订阅传 `last_seq=0` 拿全量，history 走暖缓存（`BusEventCache`）秒出，二者由 reducer 的 seq dedup 自动合并。

**验收**：长会话冷启动到首屏 < 200 ms；实时消息无漏帧。

---

## C2. 断联（心跳 + 网络感知） — P0 · 1.5 pd

**现象**：地铁/电梯出来后 App 断联很久才恢复；后台切回来要 1-2 分钟才同步。

**根因**：
- iOS 心跳 30 s（`MiWarpWebSocketClient.swift:457`）vs 服务端检查间隔 300 s（`ws.rs:451`），不对称 — 服务端 5 分钟才发现“幽灵连接”。
- iOS、Android 全局 grep 都搜不到 `NWPathMonitor` / `scenePhase` / `ConnectivityManager.NetworkCallback`，**完全没有网络变化感知**。
- 退避算法（iOS `pow(2, attempt)`、Android `1L shl minOf(attempt, 5)`）都没有 jitter，雷群效应风险。

**修复方案**：
1. iOS：
   - 加 `NWPathMonitor`，`pathUpdateHandler` 中网络可用即触发 `reconnectImmediate()`。
   - 监听 `scenePhase`：`active` → 立即 ping，超时即重连；`background` → 暂停重连。
2. Android：用 `ConnectivityManager.NetworkCallback` 同等处理。
3. 服务端 `ws.rs:451` 心跳间隔从 300 s 降到 30 s，加 ping-pong 超时 60 s，超时即关连接。
4. 退避加 jitter：`delay = base * 2^attempt + random(0, base)`；最大值上限 30 s。

**验收**：飞行模式切回 5 秒内重连；前后台切换 < 1 秒同步上。

---

## C3. 传输（无分片 / 无 ack） — P1 · 2 pd

**现象**：大 artifact 触发 “Message too long” → 断联 → 重连 → 同帧重放 → 死循环。

**根因**：自研 JSON-RPC（`MiWarpWebSocketClient.swift:252`）无 jsonrpc 字段、无批量、无分片。服务端 `ws.rs:191` 一条 bus-event = 一帧 WS text，artifact 整帧。iOS 注释（`MiWarpWebSocketClient.swift:41-49`）已记录历史 1 MB → 64 MB 的扩容血泪史。dedup 两套（`MiWarpWebSocketClient.swift:395-399` + `MiWarpEventReducer.swift:100-101`）逻辑分散。

**修复方案**：
1. 服务端在序列化 bus-event 前 sniff payload 大小，> 256 KB 自动切片（`ChunkBegin/Chunk/ChunkEnd { msg_id, idx, total }`）。客户端在 ws 层重组后再交给 reducer。
2. dedup 收到 ws 层：删除 reducer 的 `seenSeqs`，由 `MiWarpWebSocketClient` 单一来源。
3. Android `handleMessage` 用字符串 `contains("\"id\"")` 区分 RPC vs broadcast（`MiWarpWebSocketClient.kt:148`）改为标准 JSON 解析后看 `id is null`，与 iOS（`MiWarpWebSocketClient.swift:352`）对齐。

**验收**：传输一个 5 MB 的 artifact 不再触发重连；丢包模拟下消息按 seq 顺序到达，无重复无错位。

---

## C4. 同步（增量补齐而非全量替换） — P0 · 1 pd

**现象**：每次进 chat 都从 0 重放历史，长会话越来越慢。

**根因**：`BusEventCache.swift:354` 以 runId 为 key 存整个数组，无 seq 索引。`ChatViewModel.subscribeToEvents()` 用 `reducer.lastSeq` 走 `_subscribe{last_seq}` 增量补齐（OK），但 `loadHistory()` 仍调 `get_bus_events`（无 `since_seq` 参数，`MiWarpRPC.swift:32-51`）拉全量再 `reset()` 整 reducer（`MiWarpEventReducer.swift:176-179`）。暖路径秒出，但紧接的 freshen 又把它替换了。

**修复方案**：
1. `BusEventCache` 元数据增加 `lastSeq: Int64`、`writtenAt: Date`。
2. `get_bus_events` RPC 加 `since_seq` 可选参数；后端基于该 seq 增量返回。
3. `ChatViewModel.loadHistory()` freshen 步骤改为传 `since_seq=cache.lastSeq`，merge 而不 reset。
4. 或者更激进：彻底跳过 `loadHistory` 的 freshen，直接靠 `_subscribe{last_seq}` 增量。`get_bus_events` 仅用于完全无缓存的冷启动。

**验收**：1000 条消息会话二次进入耗时 < 100 ms（首次 < 500 ms）。

---

## C5. 协议对齐 / 缓存对齐 — P2 · 2 pd

**现象**：iOS 用得顺手的功能 Android 没有。

**根因（Android 缺失）**：
- 无 `BusEventCache` 磁盘暖路径。
- 无 `ArtifactCache` LRU 磁盘缓存。
- 无截断（`_truncated`）的 “View Full” 机制。
- 无 preflight HTTP 探测。

**修复方案**：把 iOS 这 4 块封装成跨语言的协议描述（YAML 或 OpenAPI 子集），Android 按描述实现 Kotlin 等价物。可由 `Supply Chain Strategist` 风格的“契约文档”作为 single source of truth。

**验收**：Android 冷启动到首屏与 iOS 相差 ≤ 100 ms。

---

## C6. iPadOS 适配（size class 重构） — P1 · 1 pd

**现象**：iPad 多任务分屏时布局抖动；mini 竖屏在 768pt 临界点行为飘忽。

**根因**：`MWAdaptiveLayout.swift:49` 用 `GeometryReader` + `geometry.size.width < 768` 作为唯一断点。Stage Manager / Split View 下 width 在边界附近跳动 → 布局频繁 compact↔regular 切换 → GeometryReader 引起布局循环。`AppRouter.swift:118` `columnVisibility: .constant(.all)` 让用户无法折叠中栏。

**修复方案**：
1. 主断点换成 `@Environment(\.horizontalSizeClass)`，仅在需要具体像素值时用 GeometryReader。
2. `columnVisibility` 改为 `@State` 让用户可折叠；记忆化到 UserDefaults。
3. 在 11"/13" iPad Pro 横屏下追加 expanded 档（`detailMaxWidth = 1100` 等）。

**验收**：iPad mini 竖横切换、Stage Manager resize 不再有“先 compact 后 regular”的双次重排。

---

# D. 移动端 · UI / 适配

## D1. iPad 三栏 + Android 双栏 — P1 · 2 pd

iOS 部分见 C6；Android 部分独立列出：

**Android 现状**：`AppNavGraph.kt` 完全无 `WindowSizeClass` 引用，所有平板/折叠屏都套手机单栏。

**修复方案**：
1. 引入 Compose `material3-window-size-class`（已在依赖里？grep 一下）。
2. expanded 宽度（≥ 840 dp）下：左 `NavigationRail`，中会话列表，右聊天 — 套用 `MWAdaptiveLayout` 同一断点语义。
3. 所有页面接入 `LocalWindowSizeClass`，去掉硬编码 padding。

---

## D2. 对话页元素优化 — P0 · 1 pd

**现象**：键盘弹出最后一条消息被遮挡；streaming 时滚动不跟随；气泡不能长按复制。

**根因 + 修复**：

| 问题 | 证据 | 修复 |
| --- | --- | --- |
| iOS 键盘 inset 不全 | `ChatView.swift:181` `.safeAreaInset(.bottom)` + `MessageListView.swift:39-44` 注释 | 监听 `keyboardWillShow/Hide`，对 ScrollView contentInset.bottom 加键盘高度 - safeAreaInsets.bottom |
| streaming 不跟随滚动 | `MessageListView.swift:50-56` 仅监听 `last?.id` | 改 `onChange(of: messages.last?.content)` + 节流（每 100 ms 最多滚一次） |
| 气泡无长按菜单 | 全文件无 `.contextMenu` | 给 message bubble 加 `.contextMenu { Button("复制") {...} Button("引用") {...} }` |
| Android 输入栏不跟键盘 | `ChatInputBar.kt` 无 `imePadding()` | `Modifier.imePadding().navigationBarsPadding()` |
| Android `messages.size` 不跟 streaming | `MessageList.kt:24` | 同 iOS，监听最后一条 content + 节流 |

---

## D3. 设计系统三档断点 — P2 · 0.5 pd

**修复**：
- iOS `MWAdaptiveLayout` 增加 `medium` 档（768-1024pt），数值介于 compact 与 expanded。
- Android `MWTypography.kt` 改用 `MaterialTheme.typography` 的 Material 3 Type Scale，自动响应 fontScale。

---

## D4. iOS / Android UI 鸿沟 — P1 · 2 pd

| 能力 | iOS | Android | 修复 |
| --- | --- | --- | --- |
| Session 过滤 | agent / status / source 三维 + 搜索 + swipe-stop + contextMenu | 仅 4 固定 filter | Android 抄 iOS：`SessionFiltersView` 等价物 + `SwipeToDismissBox` |
| Artifact 预览 | `ArtifactsView` + `DiffPreviewView` | 字符串硬编码 `"Artifacts"`/`"Raw Events"` | Android 接入 `strings.xml`；diff 视图加横向 `Modifier.horizontalScroll()` |
| ComposerBar 能力 | 附件 + provider/model | 仅 send + stop | Android 补附件按钮、provider 信息 chip |
| ChatHeader 控件 | 标准 IconButton | `Text + .clickable` | 改 `IconButton(onClick=...)` 配 `contentDescription` |

---

## D5. 细节 — P2 · 1 pd

| 问题 | 证据 | 修复 |
| --- | --- | --- |
| iOS tool 输出展开后仍 15 行 | `MessageListView.swift:320` `lineLimit(15)` | 展开态 `lineLimit(nil)` |
| 代码块无横向滚动 | iOS / Android 都是普通 `Text` | 包 `ScrollView(.horizontal)` / `Modifier.horizontalScroll()`；考虑 syntax highlight（轻量做法：iOS `AttributedString` + 简易 tokenizer） |
| iOS 暗色闪烁 | `MWTheme.swift:92` `var systemColorScheme = .dark` | 初值改成 `@Environment(\.colorScheme)` 读取 |
| Android 无 dynamicColor | `MWTheme.kt` 手动分支 | API 31+ 用 `dynamicLightColorScheme` / `dynamicDarkColorScheme`，旧版本回退手动 |
| 可访问性 | iOS bubble 碎片读、Android 无 `semantics` | 两端给 bubble 加 `accessibilityElement(children: .combine)` / `Modifier.semantics { contentDescription = ... }` |
| 动态字体 | 硬编码 sp/字号 | iOS 改 `Font.system(.body)` 自动响应 Dynamic Type；Android 改用 Material Typography token |

---

# 联调与验收

每个 P0 项目修完后跑：

```bash
npm run verify              # 桌面端全栈门禁
xcodebuild test -scheme MiWarpMobile -destination 'platform=iOS Simulator,name=iPhone 15'
./gradlew :app:testDebugUnitTest
```

外加三类手工冒烟：
1. **桌面**：起 50 个工具卡的会话，滚动 + 主题切换 + 主动断 CLI 观察 banner / OS 通知。
2. **iOS**：iPhone + iPad + iPad mini Split View + 飞行模式切换 + 后台 / 前台。
3. **Android**：手机 + 折叠屏 expanded + 网络切换 + 大 artifact。

---

## 资料来源

- 代码审计 4 份子报告（2026-06-06）覆盖：
  - 桌面同步层：`session_actor.rs / turn_engine.rs / event-middleware.ts / notification-listener.ts / use-slash-menu`
  - 桌面渲染层：`ChatTimelineEntries / InlineToolCard / PromptInput / app.css / theme-store`
  - 移动传输层：`MiWarpWebSocketClient（iOS+Android）/ MiWarpRPC / BusEventCache / ArtifactCache / ws.rs`
  - 移动 UI 层：`AppRouter / ChatView / MessageListView / SessionHubView / MWAdaptiveLayout / Android Compose ChatScreen 等`
- 整改路线参考 `MEMORY.md` 中既有：
  - `project_chat_refactor_roadmap`（PR 路线图）
  - `project_stability_hardening`（PR #10 已修内容）
  - `project_mobile_connectivity`（10 步移动修复，待真机验证）

> 本文应作为接下来 4 周的实施基线，逐项修复完成后在 commit message 中引用本文章节锚点。
