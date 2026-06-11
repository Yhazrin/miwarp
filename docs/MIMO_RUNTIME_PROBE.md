# MiMo-Code Runtime Probe Report

## 1. 本机环境

| 项目 | 值 |
|------|-----|
| 二进制路径 | `/Users/yanghaoze/.mimocode/bin/mimo` |
| 版本号 | `0.1.0` |
| 安装方式 | MiMo-Code 官方安装器 |

## 2. CLI 可用参数摘要

### 核心命令
| 命令 | 用途 |
|------|------|
| `mimo [project]` | 启动 TUI（默认） |
| `mimo run [message]` | 非交互式执行，支持 `--format json` |
| `mimo serve` | 无头 HTTP 服务器 |
| `mimo acp` | ACP（Agent Client Protocol）服务器 |
| `mimo attach <url>` | 连接到运行中的服务器 |
| `mimo session` | 会话管理（list/delete/import-claude） |
| `mimo providers` | 管理 AI providers 和凭证 |
| `mimo models` | 列出可用模型 |
| `mimo export/export` | 导出会话数据为 JSON |
| `mimo web` | 启动服务器并打开 Web 界面 |

### 关键 flags（用于 Runtime 集成）
| Flag | 用途 |
|------|------|
| `--format json` | **JSON 事件流输出**（核心接入点） |
| `--session <id>` | 指定会话 ID 继续 |
| `--continue` | 继续最近一次会话 |
| `--fork` | 分叉会话 |
| `--dir <path>` | 工作目录 |
| `--model <provider/model>` | 指定模型 |
| `--agent <name>` | 指定 agent |
| `--dangerously-skip-permissions` | 自动批准权限 |
| `--thinking` | 显示 thinking blocks |
| `--attach <url>` | 连接远程服务器 |
| `--port` | 本地服务器端口 |
| `--pure` | 不加载外部插件 |

## 3. JSON 协议分析（`mimo run --format json`）

### 输出格式
每行一个 JSON 对象（NDJSON），事件类型如下：

| 事件类型 | 含义 | 关键字段 |
|----------|------|----------|
| `step_start` | 步骤开始 | `part.id`, `part.messageID`, `part.sessionID`, `part.snapshot` |
| `tool_use` | 工具调用（含结果） | `part.tool`, `part.callID`, `part.state.status`, `part.state.input`, `part.state.output`, `part.state.time` |
| `step_finish` | 步骤结束 | `part.reason` ("tool-calls" / "stop"), `part.tokens`, `part.cost` |
| `text` | 助手文本 | `part.text`, `part.time.start/end` |
| `reasoning` | 思考过程 | `part.text`（需 `--thinking`） |
| `error` | 错误 | `error` |

### 事件示例
```json
{"type":"tool_use","timestamp":1781164162636,"sessionID":"ses_...","part":{"type":"tool","tool":"read","callID":"call_...","state":{"status":"completed","input":{...},"output":"...","time":{"start":...,"end":...}}}}
{"type":"text","timestamp":1781164169071,"sessionID":"ses_...","part":{"type":"text","text":"项目结构：..."}}
{"type":"step_finish","timestamp":1781164169105,"sessionID":"ses_...","part":{"reason":"stop","tokens":{"total":34731,"input":222,"output":76},"cost":0}}
```

### 支持的工具类型
从源码 `run.ts` 可知，MiMo-Code 支持以下工具：
- `bash` — Shell 命令执行
- `read` — 文件读取
- `write` — 文件写入
- `edit` — 文件编辑
- `glob` — 文件模式匹配
- `grep` — 内容搜索
- `webfetch` — 网页抓取
- `codesearch` — 代码搜索（Exa）
- `websearch` — 网页搜索
- `actor` — 子代理（subagent）
- `skill` — 技能调用
- `apply_patch` — 补丁应用
- `multiedit` — 多文件编辑
- `lsp` — LSP 集成
- `task` — 任务管理
- `memory` — 记忆系统

## 4. 协议能力评估

| 能力 | 支持情况 | 说明 |
|------|---------|------|
| **Headless / JSON** | ✅ 完整支持 | `mimo run --format json` 输出 NDJSON |
| **STDIN/STDOUT** | ✅ 支持 | 通过 `mimo run` 的 stdin 接收输入 |
| **Session ID** | ✅ 支持 | `--session <id>`, `--continue`, `--fork` |
| **Resume** | ✅ 支持 | `--continue` 或 `--session` |
| **Permission** | ✅ 支持 | `permission.asked` 事件，可通过 SDK 回复 |
| **Tool Call 可解析** | ✅ 完整 | 每个 tool 事件包含 tool name、input、output、status、timing |
| **Token/Cost** | ✅ 支持 | `step_finish` 事件包含 tokens 和 cost |
| **多轮对话** | ✅ 支持 | 通过 session 机制 |
| **流式文本** | ✅ 支持 | `text` 事件 |
| **Reasoning/Thinking** | ✅ 支持 | `reasoning` 事件（需 `--thinking`） |

## 5. ACP（Agent Client Protocol）

MiMo-Code 实现了 [Agent Client Protocol](https://agentclientprotocol.com/) v1：
- JSON-RPC over stdio
- 支持 `session/new`, `session/load`, `session/prompt`
- 可集成到 Zed 等编辑器
- **当前限制**：不支持流式响应、工具调用进度报告

## 6. HTTP 服务器模式（`mimo serve`）

- 基于 Hono 框架的 HTTP API
- SSE 事件流（`/event` 端点）
- REST API 用于会话管理
- 可通过 `mimo run --attach <url>` 连接

## 7. 推荐接入路径

### 🏆 首选方案：StreamJson（`mimo run --format json`）

**理由**：
1. 已有稳定的 JSON 事件流协议
2. 事件结构清晰，包含 tool、text、step、token 等完整信息
3. 支持 session resume
4. 与 Claude Code 的 stream-json 模式高度对齐
5. 无需 PTY，纯文本解析

**接入方式**：
```
MiWarp 启动 mimo 进程:
  mimo run --format json --dir <cwd> --session <session_id> "<prompt>"

通过 stdout 读取 NDJSON 事件:
  每行一个 JSON 对象
  解析 event.type 映射到 MiWarp BusEvent

通过 stdin 发送输入:
  用于 permission reply 等交互
```

### 备选方案：PTY（TUI 嵌入）

仅在 StreamJson 不可用时使用。MiMo-Code 的 TUI 基于 Solid.js + OpenTUI，嵌入复杂度高。

## 8. 第一版实现边界

### 必须实现
1. ✅ Runtime 抽象层（`AgentRuntimeKind::MiMoCode`）
2. ✅ MiMoCode 进程管理（spawn/stop/cwd）
3. ✅ JSON 事件解析器（`mimo_protocol.rs`）
4. ✅ 事件映射到 MiWarp BusEvent
5. ✅ Session resume 支持
6. ✅ Raw fallback（原始输出落盘）
7. ✅ 设置页配置

### 暂不实现（V2）
- ACP 协议集成
- HTTP 服务器模式
- 权限交互（第一版用 `--dangerously-skip-permissions`）
- 子代理（actor tool）深度集成
- MCP server 管理

### 兼容性保证
- Claude Code Runtime 完全不受影响
- 老会话无 runtime_kind 时默认 ClaudeCode
- MiMo 原始输出完整落盘，不静默丢弃
- 不泄露 API key / token 到日志

## 9. 事件类型映射表

| MiMo-Code 事件 | MiWarp BusEvent | 说明 |
|----------------|-----------------|------|
| `step_start` | （内部状态） | 步骤开始 |
| `tool_use` (status=completed/running) | `ToolStart` / `ToolEnd` | 工具调用 |
| `step_finish` (reason=stop) | `RunState { state: "completed" }` | 步骤完成 |
| `text` | `MessageDelta` / `MessageComplete` | 文本输出 |
| `reasoning` | （扩展 BusEvent） | 思考过程 |
| `error` | `RunState { state: "failed" }` | 错误 |
| session.error | `RunState { state: "failed" }` | 会话错误 |
| permission.asked | `ToolStart` (permission) | 权限请求 |
| `step_finish` (tokens) | `UsageUpdate` | Token 用量 |

## 10. 源码参考

| 文件 | 路径 | 用途 |
|------|------|------|
| RunCommand | `packages/opencode/src/cli/cmd/run.ts` | `mimo run` 实现，JSON 格式输出 |
| Session | `packages/opencode/src/session/session.ts` | 会话管理 |
| Permission | `packages/opencode/src/permission/index.ts` | 权限系统 |
| Tool Registry | `packages/opencode/src/tool/registry.ts` | 工具注册 |
| Server | `packages/opencode/src/server/server.ts` | HTTP 服务器 |
| Event Bus | `packages/opencode/src/bus/bus-event.ts` | 事件总线 |
| ACP | `packages/opencode/src/acp/` | Agent Client Protocol |
