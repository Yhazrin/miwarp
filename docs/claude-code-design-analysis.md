# Claude Code 设计模式分析报告

> 基于对 Claude Code 设计理念的研究，结合 MiWarp 当前架构，提出可落地的改进建议。

## 一、Claude Code 核心设计模式

### 1. Session 管理模式

Claude Code 采用磁盘持久化的 Session 管理：
- 每个会话存储为独立的 `.claude/projects/{id}/sessions/` 目录
- 包含完整的会话历史、上下文快照、工具调用记录
- 支持 fork、resume、continue 三种会话模式

**MiWarp 现状**：
- Session 通过 `session_actor.rs` 管理，使用 Actor 模式
- Run 存储在 `~/.miwarp/runs/{run_id}/` 目录
- 支持 New/Resume/Fork/Continue 模式

**可借鉴的设计**：
- [ ] 引入会话快照（Snapshot）机制，支持快速恢复历史状态
- [ ] 实现会话对比功能，比较两个会话的差异

### 2. Turn Transaction Engine（回合事务引擎）

Claude Code 的核心创新之一是显式的 Turn 管理：
- 每个 stdin 写入都归属于一个明确的 Turn
- 支持 User Turn 和 Internal Turn（如 auto-context）
- 实现软截止时间和硬截止时间双重超时机制
- Ralph Loop（自动迭代）支持

**MiWarp 现状**：
- 已有 `turn_engine.rs` 实现类似设计
- 支持 User/Internal/Ralph Turn
- 软超时 5 分钟，硬超时 30 分钟
- Quarantine 机制用于超时恢复

**可借鉴的设计**：
- [x] **已实现** - Turn Engine 架构与 Claude Code 一致
- [ ] 增强 turn 之间的时间追踪和统计
- [ ] 提供 turn 级别的资源使用报告

### 3. Protocol 解析层

Claude Code 使用 JSON Streaming Protocol：
- 纯函数式的事件映射：`raw JSON → Vec<BusEvent>`
- 状态累加器模式（tool tracking、JSON accumulation）
- 完整的事件验证机制

**MiWarp 现状**：
- `claude_protocol.rs` 实现了类似设计
- 使用 `ProtocolState` 封装累加器状态
- 事件验证通过 `validate_bus_event` 实现

**可借鉴的设计**：
- [ ] 增强解析统计的可见性（unknown_event_count、parse_warn_count）
- [ ] 支持协议版本协商

### 4. 工具权限系统

Claude Code 的工具权限模式：
- `ask` - 每次使用前询问
- `acceptEdits` - 自动接受文件编辑
- `bypassPermissions` - 完全信任模式
- `plan` - 只读规划模式
- 支持 per-tool 的权限控制

**MiWarp 现状**：
- 在 `adapter.rs` 中实现了权限模式映射
- 支持 ask、auto_read、auto_all 等模式
- `PermissionPrompt` 事件用于前端交互

**可借鉴的设计**：
- [ ] 实现工具级别的细粒度权限控制
- [ ] 添加权限使用统计和审计日志

### 5. 上下文管理

Claude Code 的上下文管理策略：
- 自动上下文窗口监控
- `/context` 命令提取当前上下文
- 智能截断策略
- 支持增量上下文更新

**MiWarp 现状**：
- `ContextExtractor` 实现 auto-context 提取
- 当前 auto-context 功能因 CLI 代理兼容性问题已禁用
- Context 窗口信息通过 `UsageUpdate` 事件传递

**可借鉴的设计**：
- [ ] 重新启用 auto-context 功能
- [ ] 实现智能上下文压缩策略
- [ ] 添加上下文使用可视化

### 6. 钩子系统

Claude Code 的 Hook 机制：
- PreToolUse - 工具执行前回调
- PostToolUse - 工具执行后回调
- 在途变更（In-Flight Change）检测
- 支持自定义 hook 脚本

**MiWarp 现状**：
- `HookCallback` 事件支持 PreToolUse 和其他 hook 类型
- Hook 审查卡片用于前端交互
- Hook 状态跟踪（pending/allowed/denied/cancelled）

**可借鉴的设计**：
- [ ] 添加 PostToolUse hook 支持
- [ ] 实现 hook 脚本注册和管理
- [ ] 提供 hook 执行历史

### 7. 多 Agent 支持

Claude Code 的 `--agents` 功能：
- 定义子 agent 配置
- Agent 间任务委托
- 支持动态 agent 切换

**MiWarp 现状**：
- 支持 `--agents` 参数
- `availableAgents` 字段跟踪可用 agent
- Agent 设置通过 `AgentSettings` 管理

**可借鉴的设计**：
- [ ] 实现 agent 市场（Agent Marketplace）
- [ ] 支持 agent 模板和分享
- [ ] 添加 agent 性能对比功能

### 8. 远程执行

Claude Code 的远程执行支持：
- SSH 远程主机连接
- 远程工作目录同步
- 远程 MCP 服务器

**MiWarp 现状**：
- 已在 `agent/ssh.rs` 中实现 SSH 支持
- `remoteHostName` 字段跟踪远程状态
- `isRemote` 派生属性

**可借鉴的设计**：
- [ ] 增强远程会话的断线重连
- [ ] 添加远程文件同步可视化
- [ ] 支持多远程主机并行执行

### 9. Settings 配置系统

Claude Code 的配置文件：
- `.claude/settings.json` - 项目级设置
- `.claude/commands/` - 自定义 slash 命令
- `.claude/hooks/` - Hook 脚本
- 环境变量覆盖机制

**MiWarp 现状**：
- `~/.miwarp/settings.json` 存储全局设置
- 支持 agent 级别的设置覆盖
- 平台凭证（Platform Credentials）管理

**可借鉴的设计**：
- [ ] 支持项目级 `.miwarp/settings.json` 覆盖
- [ ] 实现自定义 slash 命令目录
- [ ] 添加设置导入/导出功能

### 10. MCP (Model Context Protocol) 集成

Claude Code 的 MCP 支持：
- 动态 MCP 服务器发现
- 服务器配置管理
- Elicitation（征询）机制

**MiWarp 现状**：
- `McpConfiguredPanel` 和 `McpDiscoverPanel` 组件
- `ElicitationPrompt` 支持用户输入
- MCP 服务器通过 `mcp_registry` 管理

**可借鉴的设计**：
- [ ] MCP 服务器性能监控
- [ ] MCP 工具使用统计
- [ ] MCP 资源消耗可视化

---

## 二、架构级改进建议

### 高优先级

1. **Turn Performance Metrics（Turn 性能指标）**
   - 当前状态：Turn Engine 有时间追踪，但未暴露给用户
   - 建议：为每个 turn 记录开始时间、结束时间、工具调用次数、token 使用量
   - 收益：帮助用户理解 AI 响应速度和资源消耗

2. **Smart Context Compaction（智能上下文压缩）**
   - 当前状态：使用固定截断策略
   - 建议：基于语义相似度的上下文压缩，保留关键决策点
   - 收益：更高效的长对话处理

3. **Agent Marketplace（Agent 市场）**
   - 当前状态：Agent 以代码形式存在，难以分享
   - 建议：创建 JSON 格式的 agent 定义规范，支持导入/导出
   - 收益：社区共享和复用

### 中优先级

4. **Hook Scripting System（Hook 脚本系统）**
   - 当前状态：Hook 回调只能通过前端响应
   - 建议：支持注册本地脚本作为 hook 处理程序
   - 收益：自动化工作流增强

5. **Session Comparison（会话对比）**
   - 当前状态：无会话对比功能
   - 建议：实现 diff 视图，对比两个会话的执行路径
   - 收益：便于复盘和优化

6. **Settings Version Control（设置版本控制）**
   - 当前状态：设置直接覆盖
   - 建议：添加设置变更历史，支持回滚
   - 收益：降低配置错误风险

### 低优先级

7. **Protocol Version Negotiation（协议版本协商）**
   - 建议：前端和 CLI 之间协商支持的协议版本
   - 收益：更好的向后兼容性

8. **Tool Permission Audit（工具权限审计）**
   - 建议：记录所有工具调用的决策历史
   - 收益：安全合规和调试

9. **Remote Session Sync（远程会话同步）**
   - 建议：支持多设备间的会话状态同步
   - 收益：跨设备工作流

---

## 三、代码级具体建议

### 3.1 Turn Engine 增强

```rust
// 在 turn_engine.rs 中添加统计收集
pub struct TurnMetrics {
    pub turn_index: u32,
    pub started_at: Instant,
    pub ended_at: Option<Instant>,
    pub tool_call_count: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_cost_usd: f64,
}

impl TurnMetrics {
    pub fn duration(&self) -> Duration {
        self.ended_at
            .map(|end| end - self.started_at)
            .unwrap_or_else(|| Instant::now() - self.started_at)
    }
}
```

### 3.2 Settings 层级系统

```rust
// 支持多层设置覆盖
pub enum SettingsSource {
    System,      // 系统默认
    User,       // 用户设置 (~/.miwarp/settings.json)
    Project,    // 项目设置 (.miwarp/settings.json)
    Env,        // 环境变量
    Runtime,    // 运行时参数
}

pub struct LayeredSettings {
    pub source: SettingsSource,
    pub settings: AllSettings,
}
```

### 3.3 Hook 注册表

```rust
// hook 注册表，支持脚本处理
pub struct HookRegistry {
    hooks: Vec<HookDefinition>,
}

pub struct HookDefinition {
    pub name: String,
    pub trigger: HookTrigger,
    pub handler: HookHandler,
    pub timeout: Duration,
}

pub enum HookHandler {
    Script(PathBuf),
    HttpEndpoint(Url),
    Inline(String),
}
```

---

## 四、总结

MiWarp 已经在核心架构上与 Claude Code 保持一致，包括：

- Actor 模式的 Session 管理
- Turn Transaction Engine
- JSON Streaming Protocol 解析
- 权限和 Hook 系统
- Multi-Agent 支持

主要可改进方向：

1. **数据可见性** - 增强统计和指标的可视化
2. **配置灵活性** - 支持多层配置覆盖和版本控制
3. **扩展性** - Hook 脚本系统和 Agent 市场
4. **智能化** - 智能上下文压缩和会话对比

这些改进可以逐步落地，建议从高优先级的 Turn Performance Metrics 开始，它能在不改变核心架构的情况下提升用户体验。
