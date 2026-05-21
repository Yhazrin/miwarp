# Claude Code/Codex 设计模式学习报告

本文档总结从 Claude Code/Codex CLI 中学习到的设计模式，并分析如何在 MiWarp 项目中落地实现。

---

## 一、MiWarp 当前架构概览

在分析借鉴点之前，先梳理 MiWarp 已有设计：

### 1.1 Actor 模型 (session_actor.rs)

MiWarp 使用 tokio actor 模型管理 CLI 会话生命周期：
- 每个 run_id 一个 actor，通过 bounded mpsc mailbox 保证顺序执行
- Actor 拥有子进程、stdin/stdout、协议状态的所有权
- 无需外部锁，消除跨系统协调中的竞态条件

```rust
pub struct SessionActorHandle {
    pub cmd_tx: mpsc::Sender<ActorCommand>,
    pub run_id: String,
    pub tag: Arc<()>,
    pub join_handle: tokio::task::JoinHandle<()>,
    pub shutdown_rx: oneshot::Receiver<()>,
}
```

### 1.2 Turn 事务引擎 (turn_engine.rs)

管理用户/内部 turn 的阶段、超时和上下文提取：
- `UserTurnKind`: Normal 和 Slash 命令区分
- `TurnPhase`: Active / Draining 阶段
- `InternalExtractor` trait 支持可插拔的内部 turn 数据提取
- 软/硬超时机制 (USER_SOFT_TIMEOUT: 300s, USER_HARD_TIMEOUT: 1800s)

### 1.3 Event Middleware (event-middleware.ts)

Svelte 前端统一事件处理：
- 注册一次 Tauri 事件监听器，通过 run_id 路由到对应的 SessionStore
- 16ms 微批次缓冲减少响应式更新
- 支持 pipe 模式和 stream 模式

### 1.4 权限模式系统 (adapter.rs)

标准化权限模式映射：
- `ask → default`, `auto_read → acceptEdits`, `auto_all → bypassPermissions`
- 支持 CLI v2.1.81+ 的 `delegate` 别名

---

## 二、Claude Code/Codex 核心设计模式

### 2.1 Ralph Loop — 自动迭代模式

**模式描述：**
Claude Code 支持 "Ralph" 自动迭代循环：自动将同一 prompt 发送给 CLI 直到满足完成条件。这解决了长任务需要多次手动续传的痛点。

**MiWarp 落地建议：**

Ralph 循环已在 `session_actor.rs` 中实现：

```rust
pub enum ActorCommand {
    StartRalphLoop {
        prompt: String,
        max_iterations: u32,
        completion_promise: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    CancelRalphLoop {
        reply: oneshot::Sender<Result<RalphCancelResult, String>>,
    },
}
```

**可增强的方向：**

1. **UI 层支持**：在 chat 界面添加 "Auto-iterate" 开关，允许用户设置 completion_promise（如检测到特定输出文本）
2. **进度可视化**：RalphLoopState 包含 `iteration`、`consecutive_failures`、`turn_toplevel_texts`，可用于 UI 展示
3. **智能中止**：当 consecutive_failures 超过阈值时自动停止，避免无限循环

---

### 2.2 Auto-Context — 自动上下文提取

**模式描述：**
Claude Code 在内部 turn 中自动执行 `/context` 命令，将输出作为后续 turn 的上下文，无需用户手动调用。

**MiWarp 落地建议：**

已有 `ContextExtractor` 实现：

```rust
impl InternalExtractor for ContextExtractor {
    fn on_event(&mut self, event: &BusEvent) {
        match event {
            BusEvent::CommandOutput { content, .. } => {
                self.emit_context_snapshot(content);
                self.captured = true;
            }
            BusEvent::MessageComplete { text, .. } if !text.is_empty() => {
                self.emit_context_snapshot(text);
                self.captured = true;
            }
            _ => {}
        }
    }
}
```

**可增强的方向：**

1. **UI 配置**：允许用户配置 auto-context 的触发时机（每次 turn / 每 N 个 turn / 仅特定命令后）
2. **上下文上限**：添加上下文长度限制（token budget），避免超出模型上下文窗口
3. **可配置的 extractor**：实现更多 extractor 类型（如 `/read`、`/search`），让 auto-context 更灵活

---

### 2.3 Multi-Agent Teams — 多智能体协作

**模式描述：**
Claude Code 支持 teams 模式：多个 agent 实例协作完成复杂任务，通过 inbox/message 机制通信。

**MiWarp 已有支持：**

- `TeamStore` 管理 teams 状态
- `teams.rs` 命令提供 list_teams、get_team_config、list_team_tasks、get_team_inbox 等
- Team runs 存储在 `storage/team_runs.rs`

**可增强的方向：**

1. **任务分发 UI**：在 Teams 面板添加任务分配界面，选择哪个 agent 执行哪个任务
2. **状态同步**：当前依赖 60s 轮询 + watcher 事件，考虑引入 WebSocket 实时推送
3. **依赖关系**：支持声明任务间的依赖关系（如 agent-B 等待 agent-A 完成）
4. **共享上下文**：team-level 的共享 memory/concepts，agent 间可访问

---

### 2.4 Session Persistence — 会话持久化与恢复

**模式描述：**
Claude Code 支持会话持久化：进程重启后可恢复之前的对话状态。

**MiWarp 落地建议：**

已有 `cli_sessions.rs` 存储会话状态。关键改进点：

1. **Snapshot 增强**：当前 snapshot 包含 remote_host_snapshot，可进一步包含：
   - 模型配置快照
   - 权限模式快照
   - Auto-context 状态
2. **Resume 策略**：区分 "cold resume"（完全重建）和 "warm resume"（从快照恢复 partial 状态）
3. **冲突检测**：检测 resume 前后的目录差异，提示用户可能的冲突

---

### 2.5 Slash Commands — 斜杠命令系统

**模式描述：**
Claude Code 的 `/` 命令系统（/edit、/web-search、/bulk-edit 等）是重要的 UX 模式，每个命令有独立的状态机。

**MiWarp 落地建议：**

已有 `use-virtual-commands.ts` 支持虚拟命令。关键改进：

1. **命令分类**：
   - Session commands: `/new`, `/clear`, `/resume`
   - Agent commands: `/model`, `/plan`, `/claude-code`
   - System commands: `/mcp`, `/skills`, `/browser`
2. **命令文档**：每个 slash command 应该有独立的帮助文本，在 UI 中可展开
3. **自定义 skills**：用户可定义自己的 slash commands（参考 skills 系统）
4. **状态隔离**：每个 slash command 有独立的权限上下文

---

### 2.6 MCP (Model Context Protocol) 集成

**模式描述：**
Claude Code 通过 MCP 与外部工具集成，定义标准化的 tool schema 和 lifecycle。

**MiWarp 已有支持：**

- `mcp_registry.rs` 存储 MCP server registry
- `mcp.rs` 命令处理 MCP 相关操作
- `storage/mcp_registry.rs` 管理本地 MCP 配置

**可增强的方向：**

1. **MCP UI 管理**：在 settings 页面提供 MCP server 的添加/编辑/删除 UI
2. **动态发现**：支持从配置文件动态加载 MCP servers
3. **MCP 资源管理**：除了 tools，还支持 resources、prompts 等 MCP 资源类型
4. **版本兼容**：检测 MCP server 版本与客户端的兼容性

---

### 2.7 Hook System — 钩子系统

**模式描述：**
Claude Code 的 hook 系统允许在特定事件（user-message、pre-tool-use、post-tool-use 等）触发自定义逻辑。

**MiWarp 落地建议：**

已有 hook-event 和 hook-usage 事件处理。关键改进：

1. **Hook 配置 UI**：在 settings 中管理 hook 脚本
2. **Hook 类型扩展**：
   - `before_agent`: Agent 执行前
   - `after_agent`: Agent 执行后
   - `on_error`: 错误发生时
3. **Hook 隔离**：Hook 代码在独立 sandbox 中执行，避免影响主进程
4. **Hook 日志**：记录 hook 执行历史，便于调试

---

### 2.8 SSH Remote — 远程执行

**模式描述：**
Claude Code 支持 SSH 连接到远程机器执行操作。

**MiWarp 已有支持：**

- `ssh.rs` 实现 SSH 连接管理
- `remote_fs.rs` 处理远程文件系统
- `RemoteHost` 模型

**可增强的方向：**

1. **连接管理 UI**：显示已连接的远程主机列表，支持添加/删除
2. **端口转发**：支持通过 SSH 隧道访问远程 MCP servers
3. **同步状态**：保持本地和远程的状态同步
4. **会话迁移**：在连接断开后支持会话迁移到其他主机

---

### 2.9 Artifacts — 结构化输出

**模式描述：**
Claude Code 的 Artifacts 系统支持生成可交互的结构化输出（React 组件、SVG、代码文件等）。

**MiWarp 已有支持：**

- `artifacts.rs` 存储和管理 artifacts
- `artifact-store.svelte` 前端状态

**可增强的方向：**

1. **实时预览**：在 UI 中实时渲染 artifacts（特别是 React 组件）
2. **版本历史**：保存 artifact 的版本历史，支持回滚
3. **多格式导出**：支持导出为 HTML、PNG、PDF 等格式
4. **协作编辑**：多人同时编辑同一 artifact

---

### 2.10 Permission Escalation — 权限升级

**模式描述：**
Claude Code 的权限系统支持渐进式授权：默认拒绝危险操作，用户确认后才执行。

**MiWarp 已有支持：**

- `permission_mode` 配置（ask、auto_read、auto_all 等）
- `use-permission-handlers.ts` 处理权限请求

**可增强的方向：**

1. **权限粒度**：支持更细粒度的权限控制（如 "仅允许读取文件" vs "允许写入"）
2. **权限历史**：记录用户的历史权限决策，作为未来决策的参考
3. **信任级别**：基于用户行为自动调整信任级别（如连续批准多次后可自动批准类似操作）
4. **临时权限**：支持 "本次会话有效" 的临时权限提升

---

### 2.11 Attention Tracking — 注意力追踪

**模式描述：**
Claude Code 追踪哪些窗口/标签页处于活跃状态，避免在非活跃位置执行操作。

**MiWarp 已有支持：**

- `attention-store.svelte` 管理注意力状态
- `markAttention`、`clearAttention` API

**可增强的方向：**

1. **多标签页同步**：确保多个标签页不会同时对同一会话执行冲突操作
2. **注意力指示器**：在 UI 中直观显示当前注意力位置
3. **自动切换策略**：配置 "当其他标签页获得注意力时自动停止当前操作"

---

### 2.12 Tool Burst Collapsing — 工具批次折叠

**模式描述：**
当 AI 连续执行多个小工具调用时（如多个 read 文件），将其折叠为单个 "batch" 条目显示。

**MiWarp 已有支持：**

- `use-tool-burst-collapse.svelte.ts` 实现工具批次折叠

**可增强的方向：**

1. **配置阈值**：用户可配置触发折叠的最小工具数量
2. **展开/折叠切换**：用户可手动展开/折叠批次
3. **智能合并**：识别语义相关的工具调用，合并为逻辑批次（如 "read config, read env, read credentials" → "load project config"）

---

### 2.13 Fork & Branch Management — 分支管理

**模式描述：**
Claude Code 支持创建会话分支（fork），每个分支有独立的历史。

**MiWarp 已有支持：**

- `use-fork-lifecycle.ts` 管理 fork 生命周期
- `use-fork-overlay.svelte.ts` 显示 fork 状态

**可增强的方向：**

1. **分支可视化**：在 timeline 中显示分支点，允许用户点击切换分支
2. **分支对比**：比较两个分支的差异
3. **分支合并**：支持将一个分支合并回主分支
4. **分支命名**：允许用户为分支命名，便于识别

---

### 2.14 Scheduled Tasks — 定时任务

**模式描述：**
Claude Code 支持 cron 语法定时任务。

**MiWarp 已有支持：**

- `scheduler/` 目录实现定时任务系统
- `scheduled-tasks` 路由页面
- `schedule` skill 可用

**可增强的方向：**

1. **自然语言时间**：支持 "每周一早上9点" 等自然语言描述
2. **任务模板**：预设常见任务模板，减少配置成本
3. **执行历史**：记录定时任务的执行历史，包括成功/失败状态
4. **错误通知**：任务失败时发送系统通知

---

### 2.15 Usage Tracking — 使用量追踪

**模式描述：**
Claude Code 追踪 token 使用量和成本。

**MiWarp 已有支持：**

- `usage` 路由页面
- `stats.rs` 命令处理统计
- `runs.rs` 中的使用量数据

**可增强的方向：**

1. **实时预算控制**：当接近预算上限时发出警告或停止
2. **成本分析**：按项目、按 agent、按时间段的成本分析
3. **优化建议**：基于使用模式提供 token 节省建议
4. **多模型比较**：对比不同模型的性价比

---

## 三、实施优先级建议

基于对 MiWarp 当前架构的理解，建议按以下优先级落地：

### 高优先级（核心体验）

1. **Slash Commands 增强**：当前虚拟命令系统较基础，增强后可显著提升 UX
2. **Fork UI 完善**：分支管理 UI 的可视化（timeline 分支点）
3. **Permission 粒度增强**：更细粒度的权限控制提升安全性

### 中优先级（功能完善）

4. **MCP UI 管理**：图形化 MCP server 管理界面
5. **Scheduled Tasks 增强**：自然语言时间描述 + 任务模板
6. **Attention Tracking 完善**：多标签页同步

### 低优先级（高级功能）

7. **Artifacts 实时预览**：实时渲染 React 组件
8. **Branch 对比/合并**：分支差异对比和合并
9. **Hook System 扩展**：更丰富的 hook 类型
10. **SSH 增强**：连接管理和端口转发

---

## 四、关键技术决策

### 4.1 状态管理

继续使用 Svelte 5 runes ($state, $derived, $effect)，避免迁移到其他状态管理库。

### 4.2 事件处理

当前 Event Middleware 的微批次设计（16ms 缓冲）已经很好，不需要大改。可以考虑：

```typescript
// 可选的增强：动态批次大小
private _adaptiveBatchInterval = this._BATCH_INTERVAL;
private _adjustBatchInterval(eventsPerSecond: number) {
    if (eventsPerSecond > 100) {
        this._adaptiveBatchInterval = 32; // 降低更新频率
    } else {
        this._adaptiveBatchInterval = 16;
    }
}
```

### 4.3 插件系统

现有的 `plugins.rs` 和 `community_skills.rs` 是良好的基础。考虑：

- Skill 的版本化管理和自动更新
- Skill marketplace 的浏览和安装 UI

### 4.4 测试覆盖

已有的 `event-middleware.test.ts` 提供了良好的测试模式示范。新功能应该：

- 添加对应的单元测试
- 使用 mock transport 进行隔离测试
- 测试边界条件和错误路径

---

## 五、总结

MiWarp 已经实现了许多 Claude Code/Codex 的核心设计模式，包括 Actor 模型、Turn 引擎、Event Middleware、权限系统和 Teams 协作。剩余的工作主要是：

1. **增强已有系统**（如 slash commands、fork UI、permission granularity）
2. **补充缺失功能**（如 MCP UI、scheduled task 增强）
3. **优化 UX**（如 attention tracking、多标签页同步）

通过持续借鉴 Claude Code 的设计，MiWarp 可以成为一个更强大的 AI 编程辅助工具。