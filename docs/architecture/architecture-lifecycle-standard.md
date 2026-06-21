# MiWarp 架构设计准则与生命周期标准

> 来源：软件架构课程 Ch1–Ch7 复习知识，并结合 MiWarp 的 Local-first、Session Actor、Transport Adapter、Event Sourcing 实践整理。

## 1. 架构定义

架构不是技术清单，而是：

```text
架构 = 组件 + 连接器 + 约束 + 决策理由
```

- **组件**：页面、Store、Transport、Actor、协议解析器、命令层、存储、移动端客户端。
- **连接器**：函数调用、Tauri IPC、WebSocket、事件总线、mpsc mailbox、stdin/stdout、events.jsonl。
- **约束**：顺序、唯一所有者、状态一致性、超时、重试、部署、兼容性、安全边界。
- **理由**：为什么这样设计、替代方案为何拒绝、代价是什么、如何验证。

任何架构改动都必须能从用户场景追踪到模块、运行流程、部署、测试与验收证据。

## 2. 生命周期

### 2.1 需求与业务驱动

每项工作先回答：

- 谁触发？
- 想完成什么？
- 哪些失败最不能接受？
- 成功如何量化？
- 哪个平台与网络环境？
- 数据由谁拥有？

### 2.2 质量属性场景

使用六段式：

```text
Source → Stimulus → Artifact → Environment → Response → Measure
```

MiWarp 通信核心默认指标：

- 初次连接失败必须在确定时间内显式失败，不允许 Promise 永久悬挂。
- 重连只能由一个调度器拥有，旧连接回调不得污染新连接。
- 请求超时后 pending registry 必须归零。
- 订阅 checkpoint 单调递增，重连后无重复订阅与事件倒退。
- chunk 拼装有时间、数量和字节上限。
- 用户从异常发生到看到明确状态的延迟必须可测。

### 2.3 架构选择

按主导质量属性选择风格：

- Session 内部需要严格顺序与单一所有者：Actor + Mailbox。
- 桌面与远程平台差异：Channel Adapter / Transport Adapter。
- 实时增量更新：事件驱动 + typed event bus。
- 历史事实与回放：events.jsonl 事件流 + 本地 projection。
- 请求/响应：显式 JSON-RPC correlation registry。
- 大规模演进：模块化单体 + Strangler Fig，不拆成无独立部署价值的微服务。

## 3. 4+1 视图

### Scenario

覆盖：启动会话、恢复会话、发送消息、工具审批、掉线重连、历史回放、移动端接入、多 Agent 调度。

### Logical

明确：Session、Turn、Connection、Request、Subscription、Event、Projection 的职责与所有权。

### Process

必须可视化：

1. 连接建立/失败/重连状态机；
2. 请求发出/响应/超时/断线取消；
3. run 订阅、checkpoint、replay、live 切换；
4. CLI 输出解析、desync、quarantine、恢复；
5. SessionStore replay → live 的转换。

### Development

依赖方向：

```text
UI → Controller/Store → Transport interface → Adapter
Backend command → Agent service → Actor/Protocol/Storage
```

禁止 UI 绕过 Transport，禁止 reducer 触发网络副作用，禁止 commands 模块相互调用内部实现。

### Physical

- Desktop：Svelte WebView + Tauri Rust + CLI child process + local files。
- Browser/iOS/Android：WebSocket → Axum → 同一 Rust domain/actor/storage。
- 远程通道只能改变连接方式，不能改变业务语义。

## 4. 状态与通信准则

### 4.1 单一所有者

- WebSocket 生命周期只能由 Connection Controller 管理。
- pending request 只能由 Request Registry 管理。
- run 订阅只能由 Subscription Registry 管理。
- mutable Session 状态由 SessionStore/Actor 的明确边界管理。

### 4.2 显式状态机

连接状态至少包含：

```text
idle → connecting → open
                 ↘ reconnecting
                 ↘ auth_failed
                 ↘ closed
                 ↘ disposed
```

不得使用多个互相矛盾的 boolean 表示同一生命周期。

### 4.3 失败语义

- 错误必须 typed，保留 code/message/data/context。
- timeout、auth、network、protocol、cancelled 必须可区分。
- 断线时所有 pending 请求必须统一结算。
- 重连不自动重放非幂等请求。
- protocol desync 必须触发显式恢复或失败，不允许静默保持 running。

### 4.4 订阅语义

- 多个消费者订阅同一 run 时必须引用计数或 token ownership。
- lastSeq 只增不减。
- unsubscribe 只有最后一个 owner 释放时才发送。
- reconnect 恢复订阅必须幂等。
- replay 与 live 交界要有 checkpoint，不允许重复或丢失。

### 4.5 流与分片

- chunk id 唯一。
- part index 越界、total 不一致、重复 part、超时、超限必须丢弃并记录。
- 每条消息与全局 buffer 都有上限。
- dispose/断线必须清空未完成 buffer。

## 5. 内聚、耦合与异味

### 高内聚

- `websocket.ts` 负责装配，不同时承担所有生命周期细节。
- Reducer 只做确定性 projection。
- Store 不混合协议解析、持久化、网络、DOM、计时器与 UI 文案。
- Rust Actor 只拥有一个 session 的生命周期。

### 低耦合

- 通过接口和 typed DTO 跨层。
- 不共享可变全局状态。
- 平台实现不泄漏到业务层。
- 组件不直接 import Transport 内部类。

重点异味：God Store、God Layout、Mega Facade、双重订阅所有权、散落 timeout、重复 reconnect、事件与副作用混合、无界 Map/Buffer。

## 6. ATAM 输出

每次大改记录：

- **Risk**：可能导致质量属性失败的决策。
- **Non-Risk**：已有证据支持的稳定决策。
- **Sensitivity Point**：阈值变化会显著影响结果的参数。
- **Tradeoff Point**：提升一种质量但降低另一种质量的决策。

MiWarp 当前 Non-Risk：Session Actor、Local-first、Transport abstraction、typed event bus。

当前高风险：WebSocket 生命周期、订阅所有权、SessionStore 过载、EventMiddleware 多职责、协议 desync/quarantine、跨平台状态一致性。

## 7. 演进策略

严格采用 Strangler Fig：

1. 先补行为测试和日志；
2. 建立稳定 seam；
3. 一次迁移一个职责；
4. 保持外部语义；
5. 验证新路径；
6. 删除旧路径；
7. 更新 ADR、图、文档和 CI fitness function。

禁止一次性重写 Transport + EventMiddleware + SessionStore + Rust backend。

## 8. 验证与验收

通信改动至少覆盖：

- 成功连接；
- 首次连接失败；
- 连接超时；
- 退避重连；
- auth failure；
- 旧 generation 回调；
- pending 请求超时和断线清理；
- 结构化 RPC error；
- 重复订阅与最后 owner 释放；
- checkpoint 恢复；
- chunk 正常、重复、缺失、越界、超限、超时；
- dispose 清理；
- replay/live 连续性。

验收证据必须包含实际命令、退出码、测试结果和剩余风险。

## 9. 架构 Fitness Functions

建议持续检查：

- 非 transport 目录禁止直接导入 Tauri API。
- Transport 关键失败路径必须有测试。
- connection/request/subscription/chunk 模块不允许无界 Map 或 timer。
- SessionStore、layout、api.ts、session.rs 的体积与职责持续下降。
- BusEvent 后端枚举、广播映射、前端 union 保持同步。
- `npm run verify` 与 Rust gate 必须通过。

## 10. 完成标准

架构重构完成必须同时满足：

- 用户场景更稳定；
- 质量指标可验证；
- 所有权与边界更清晰；
- 失败路径可恢复；
- 测试覆盖真实竞态；
- 文档与代码一致；
- 旧路径被删除；
- 没有把复杂度从一个 God Object 平移到另一个。
