<p align="center">
  <img src="miwarp-banner.png" width="800" alt="MiWarp">
</p>

<p align="center">
  <strong>本地优先的 AI 编程 CLI 桌面 GUI</strong>
  <br>
  <sub>Claude Code · Codex · 15+ 供应商 · 会话管理 · 多 Agent · Fleet 视图 · 定时任务</sub>
</p>

<p align="center">
  <a href="#%E4%BB%80%E4%B9%88%E6%98%AF-miwarp">是什么</a> ·
  <a href="#%E5%8A%9F%E8%83%BD">功能</a> ·
  <a href="#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B">快速开始</a> ·
  <a href="#%E6%94%AF%E6%8C%81%E7%9A%84%E4%BE%9B%E5%BA%94%E5%95%86">支持的供应商</a> ·
  <a href="#%E6%9E%B6%E6%9E%84">架构</a> ·
  <a href="#%E8%AE%B8%E5%8F%AF%E8%AF%81">许可证</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

---

## 什么是 MiWarp？

**MiWarp** 把 AI 编程 CLI（Claude Code、Codex 等）封装成原生桌面应用 —— 你能继续用终端 agent 的能力，同时获得正经的图形界面：带 diff 的聊天历史、多会话管理、跨会话转发、以及手机远程访问。

所有数据存在你本机的 `~/.miwarp/`。应用本身没有云端后端，只有调用 LLM API 时才走网络。

**不是 Electron 应用** —— 基于 Tauri v2（Rust + 系统 WebView）构建，安装包约 50 MB，正常会话内存占用控制在 200 MB 以下。

## 适合谁？

已经在终端里用 Claude Code / Codex 的开发者，想要：

- **可视化聊天界面** —— 正常的 markdown、工具卡片、diff（而不是滚终端输出）
- **持久化历史** —— 每个 prompt、每条回复、每次文件改动都可搜索
- **多供应商切换** —— Anthropic、DeepSeek、Kimi、智谱、OpenRouter、本地 Ollama…… 不重启就能换
- **会话管理** —— fork、resume、改名、跨会话转发消息
- **远程访问** —— 手机配对、浏览器连、定时任务后台跑

如果你只想要 ChatGPT 那种网页 UI，这不适合你。如果你想让每天泡在 `claude code` 里的体验不再像 1995 年，这适合你。

## 功能

### 聊天

- **工具卡片可视化** —— 每个 Claude Code 工具调用（Read、Edit、Bash、Grep、Write、WebFetch…）内联展示，带语法高亮的 diff、结构化输出、一键复制
- **富内容** —— markdown 语法高亮、thinking 块、图片附件、文件 diff、可折叠的工具爆发组
- **可视化块** —— 内联 Mermaid 图与 Vega-Lite 图表，无需跳出聊天即可查看
- **内联斜杠命令** —— `/model`、`/diff`、`/todos`、`/tasks`、`/doctor`、`/stats`、`/preview`、`/ralph`…… 原生渲染
- **拖放** —— 图片、PDF、目录、路径引用
- **跨会话转发** —— 三层结构的会话目标选择器（标题 / 最后消息预览 / 元信息），底部显式 Cancel / Forward 按钮

### 会话

- **Run 历史与回放** —— 浏览所有历史会话，完整事件回放，从任意点 resume 或 fork，软删除可恢复
- **工作区分组** —— 按项目（cwd）分组；完整路径每个分组只显示一次
- **事件驱动侧栏** —— run 列表通过 bus-event 流实时刷新，无轮询
- **Rewind** —— checkpoint + 干跑预览 + 选择性回滚文件改动
- **CLI 会话导入** —— 发现并导入已有的 Claude Code CLI 会话
- **统一错误结构** —— 所有 IPC 调用返回 `{code, message, data, retryable}`，UI 可一致响应

### 多供应商

- **15+ LLM 供应商**（Anthropic 官方、DeepSeek、Kimi、智谱、百炼、豆包、MiniMax、小米 MiMo、腾讯混元、硅基流动……）
- **3 个 API 网关**（Vercel AI Gateway、OpenRouter、AiHubMix、ZenMux）
- **本地推理**（Ollama、CC Switch、Claude Code Router）+ 任何 Anthropic 兼容端点
- **会话内热切换供应商**
- **CLI 自动同步** —— 周期性探活（路径、版本、登录、能力），缺失时引导安装

### 团队与多 Agent

- **Team dashboard** —— Claude Code 多 agent 团队的只读视图（任务列表、状态、消息流），文件 watcher 实时更新
- **Multi-agent 页面** —— 编排并行会话、preset、team-runs
- **命令能力清单（capability manifest）** —— runtime 声明自身支持的子命令，UI 据此显示/隐藏按钮，不再靠猜

### Fleet 视图（运维）

- **员工 / Fleet 总览** —— 一屏看完所有 agent、runtime 和它们的健康状态
- **本地 MCP server（Streamable HTTP）** —— 在本机通过类型化的 MCP 契约，把部分 IPC 能力暴露给外部工具
- **Browser Lite runtime** —— 嵌入式 WebView runtime（基于 Chrome profile），用于沙箱化自动化，与系统 WebView 并存
- **Runtime diagnostics observer** —— 最近 runtime 事件的 bounded ring buffer，便于事后排查

### 远程与自动化

- **移动配对** —— 扫码把手机 / 平板接进来当远程终端
- **内置 Web server** —— 带 token 鉴权的 HTTP + WebSocket relay；局域网访问或 cloudflared / ngrok 隧道
- **iOS WebSocket 契约** —— 为 iOS 伴侣 App 提供一等传输层（由架构契约检查保证）
- **定时任务** —— cron 形式的 AI 任务，支持 retry / abort signal 集成
- **Ralph loop** —— 自动迭代同一个 prompt 直到满足完成条件
- **Hook 管理** —— 上游 CLI 钩子，事件驱动自动化

### 扩展

- **Plugins 中心** —— 发现、安装、启用 / 禁用插件；插件清单的 source / form 可视化编辑
- **Skills** —— 一等社区 Skills 注册中心，按需拉取与导入
- **Skill sources** —— 注册外部 skill source（如 Git 仓库），原地检查更新
- **MCP marketplace** —— 发现 MCP server、查看状态、重连 / 切换

### 工作区工具

- **文件浏览器** —— 语法高亮、markdown 预览、图片预览、git diff
- **记忆编辑器** —— `CLAUDE.md`（user + project scope）实时预览
- **Agent 编辑器** —— 自定义 agent 定义（`.md`）的可视化编辑，form / source 双模式
- **权限规则** —— user + project 级别，批量 Allow / Deny
- **工作区设置** —— 每个项目可覆盖（cwd alias、默认 runtime、环境）
- **用量分析** —— 每模型 token 拆解、费用追踪、日热力图
- **Doctor 诊断** —— CLI、平台、SSH、proxy、本地 LLM 端点的系统健康检查

### 应用壳

- **12 个主题**（Codex、Midnight、Ocean、Dracula、Nord、Morandi、Carbon Pink、Deep Sea Milk、Aurora Pomelo、Pomegranate Mist、Aurora Lime、Dev Preview），每个都有完整的亮 / 暗变体
- **亮 / 暗 / 跟随系统** 模式，实时跟随 OS（即使 Settings 标签页关着也工作）
- **自定义快捷键**，支持 chord 与冲突检测
- **英文 / 简体中文** i18n，CI 强制 key 对齐与占位符一致性
- **系统托盘** + 原生通知 + 截图热键
- **应用内更新**（桌面 signed updater，浏览器走 GitHub fallback）
- **应用内 Release notes** —— 直接在应用内看发了什么
- **Command palette** —— 跨页面、会话、命令的模糊搜索

## 快速开始

### 方式 A — 下载

从 [Releases](https://github.com/Yhazrin/MiWarp/releases) 下载最新的已签名安装包：

- **macOS** —— universal `.dmg`（Apple Silicon + Intel），已签名并公证
- **Windows** —— CI 产出并签名的 `.msi` / `.exe`

> Linux 桌面构建已退役 —— Linux 仍可作为开发环境（从源码 `npm run tauri dev`），但不再发布打包安装包。终端用户推荐 macOS / Windows 或下面的方式 B / C。

### 方式 B — 自动安装（macOS）

```bash
git clone https://github.com/Yhazrin/MiWarp.git
cd MiWarp
./scripts/setup.sh          # 加 --yes 跳过确认
npm run tauri dev
```

setup 脚本自动检测缺失依赖（Xcode CLI Tools、Homebrew、Node.js、Rust）并安装。

### 方式 C — 手动安装

**前置依赖**

- [Node.js](https://nodejs.org/) ≥ 20
- [Rust](https://rustup.rs/) ≥ 1.75

**macOS**

```bash
xcode-select --install
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Linux（Debian / Ubuntu）**

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Windows**

从 <https://rustup.rs> 安装 Rust，从 <https://nodejs.org> 安装 Node.js。

**然后**

```bash
git clone https://github.com/Yhazrin/MiWarp.git
cd MiWarp
npm install
npm run tauri dev
```

### 首次启动

安装向导引导你完成：

1. CLI 检测 —— 自动检测 Claude Code / Codex，缺失时引导安装
2. 鉴权 —— OAuth 或 API key
3. 开始对话

随时可以从 **Settings → Setup Wizard** 重新运行。

## 支持的供应商

### LLM 供应商

| 供应商                   | 端点                                           | 鉴权    |
| ------------------------ | ---------------------------------------------- | ------- |
| Anthropic                | 官方 API                                       | API Key |
| DeepSeek                 | `api.deepseek.com/anthropic`                   | Bearer  |
| Kimi (Moonshot)          | `api.moonshot.cn/anthropic`                    | Bearer  |
| Kimi For Coding          | `api.kimi.com/coding/`                         | Bearer  |
| Zhipu (智谱)             | `open.bigmodel.cn/api/anthropic`               | Bearer  |
| Zhipu (智谱 Intl)        | `api.z.ai/api/anthropic`                       | Bearer  |
| Bailian (Coding Plan)    | `coding.dashscope.aliyuncs.com/apps/anthropic` | Bearer  |
| Bailian (百炼 API)       | `dashscope.aliyuncs.com/apps/anthropic`        | Bearer  |
| DouBao (豆包)            | `ark.cn-beijing.volces.com/api/coding`         | Bearer  |
| MiniMax                  | `api.minimax.io/anthropic`                     | Bearer  |
| MiniMax (China)          | `api.minimaxi.com/anthropic`                   | Bearer  |
| Xiaomi MiMO (小米)       | `api.xiaomimimo.com/anthropic`                 | Bearer  |
| Xiaomi MiMO (Token Plan) | `token-plan-cn.xiaomimimo.com/anthropic`       | Bearer  |
| Tencent Hunyuan (混元)   | `api.hunyuan.cloud.tencent.com/anthropic`      | Bearer  |
| SiliconFlow (硅基流动)   | `api.siliconflow.com/`                         | Bearer  |

### API 网关

| 平台              | 端点                      | 鉴权   |
| ----------------- | ------------------------- | ------ |
| Vercel AI Gateway | `ai-gateway.vercel.sh`    | Bearer |
| OpenRouter        | `openrouter.ai/api`       | Bearer |
| AiHubMix          | `aihubmix.com`            | Bearer |
| ZenMux            | `zenmux.ai/api/anthropic` | Bearer |

### 本地

| 平台                                                                   | 端点                    |
| ---------------------------------------------------------------------- | ----------------------- |
| Ollama                                                                 | `localhost:11434`       |
| [CC Switch](https://github.com/farion1231/cc-switch)                   | `localhost:15721`       |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | `localhost:3456`        |
| 自定义                                                                 | 任何 Anthropic 兼容端点 |

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  MiWarp 桌面 (Tauri v2)                                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  前端 (Svelte 5 + SvelteKit static)             │   │
│  │  • 聊天 UI · 工具卡片 · 设置 · 主题            │   │
│  └─────────────────────────────────────────────────┘   │
│                          │  IPC                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  后端 (Rust)                                     │   │
│  │  • session_actor (每个 run 的进程生命周期)      │   │
│  │  • turn_engine (阶段 / 超时)                    │   │
│  │  • storage (runs, events, settings, …)          │   │
│  │  • web server (移动配对)                        │   │
│  │  • scheduler · hook manager                      │   │
│  └─────────────────────────────────────────────────┘   │
│                          │  stream-JSON / PTY / pipe    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Claude Code CLI  /  Codex CLI                  │   │
│  │  (常驻子进程)                                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**技术栈**

| 层       | 技术                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 框架     | [Tauri v2](https://v2.tauri.app/) (Rust + WebView)                          |
| 前端     | [Svelte 5](https://svelte.dev/) + SvelteKit (adapter-static)                |
| 样式     | [Tailwind CSS v3](https://tailwindcss.com/) + CSS 变量                      |
| 终端     | [xterm.js](https://xtermjs.com/)                                            |
| Markdown | [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/) |
| 净化     | [DOMPurify](https://github.com/cure53/DOMPurify)                            |
| i18n     | 自研轻量运行时（en + zh-CN）                                                |
| 测试     | [Vitest](https://vitest.dev/) + Rust 单元测试                               |

**数据存储** —— 全部在 `~/.miwarp/`，无云端：

```
~/.miwarp/
├── settings.json          # 用户设置
├── keybindings.json       # 自定义快捷键
├── runs/                  # 会话历史
│   └── {run-id}/
│       ├── meta.json      # run 元数据
│       ├── events.jsonl   # 事件日志
│       └── artifacts.json # 摘要
└── …
```

**平台支持** —— 主力开发和测试在 **macOS** 与 **Windows**（两者都从 CI 发布签名产物）。Linux 仍可作为开发环境，但不为终端用户打包。Bug 报告和平台特定修复欢迎。

## 开发

```bash
npm install              # 装依赖
npm run tauri dev        # dev 模式 + 热重载
npm test                 # 跑 vitest
npm run lint             # eslint
npm run format           # prettier
npm run check            # svelte-check (类型)
npm run i18n:check       # i18n key 对齐
npm run verify           # 完整 CI gate (lint + format + check + i18n + test + build + rust)
```

代码规范、commit 风格、PR 准则看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)

Copyright 2025-2026 MiWarp Contributors.
