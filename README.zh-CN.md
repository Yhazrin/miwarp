<p align="center">
  <img src="miwarp-banner.png" width="800" alt="MiWarp">
</p>

<p align="center">
  <strong>本地优先的 AI 编程 CLI 桌面 GUI</strong>
  <br>
  <sub>Claude Code · Codex · 15+ 供应商 · 会话管理 · 移动配对 · 定时任务</sub>
</p>

<p align="center">
  <a href="#%E4%BB%80%E4%B9%88%E6%98%AF-miwarp">是什么</a> ·
  <a href="#v107-%E6%9C%89%E4%BB%80%E4%B9%88%E5%8F%98%E5%8C%96">v1.0.7</a> ·
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

## v1.0.7 有什么变化？

最近一个版本专注**打磨 + 主题/转发流程的可用性**：

- **统一主题系统** —— 12 个主题，每个都有完整的亮 / 暗变体。主题与"外观模式"（亮 / 暗 / 跟随系统）独立选择。跟随 macOS / Windows 系统主题实时变化，**即使 Settings 标签页关着也工作**
- **"转发到会话"重写** —— 改成正经的"会话目标选择器"：每行三层（标题 / 最后消息预览 / 元信息），每个分组一个短项目名，底部有显式的 Cancel / Forward 按钮
- **`listRunsLite` 后端** —— 转发弹窗在几百个历史 run 的情况下以前要等几秒，现在瞬时（只读 `meta.json`，跳过 events 扫描）
- **Dialog chrome 清理** —— 去掉所有 `elevation-3` / `shadow-lg`，背景模糊从 `2xl` 升到 `3xl`，dialog 标题加 `border-b` header bar（不再贴左上角）

完整变更看 [CHANGELOG.md](CHANGELOG.md)（包含 1.0.5 → 1.0.7）。

## 功能

### 聊天

- 工具卡片可视化 —— 每个 Claude Code 工具调用（Read、Edit、Bash、Grep、Write、WebFetch…）内联展示，带语法高亮的 diff、结构化输出、一键复制
- 富内容 —— markdown 语法高亮、thinking 块、图片附件、文件 diff、可折叠的工具爆发组
- 内联斜杠命令 —— `/model`、`/diff`、`/todos`、`/tasks`、`/doctor`、`/stats`、`/preview`、`/ralph`…… 原生渲染
- 拖放 —— 图片、PDF、目录、路径引用

### 会话

- Run 历史与回放 —— 浏览所有历史会话，完整事件回放，从任意点 resume 或 fork，软删除可恢复
- 工作区分组 —— 按项目（cwd）分组；完整路径每个分组只显示一次
- 跨会话转发 —— 选目标会话，在当前会话里发消息过去
- Rewind —— checkpoint + 干跑预览 + 选择性回滚文件改动
- CLI 会话导入 —— 发现并导入已有的 Claude Code CLI 会话

### 多供应商

- 15+ LLM 供应商（Anthropic 官方、DeepSeek、Kimi、智谱、百炼、豆包、MiniMax、小米 MiMO、腾讯混元、硅基流动……）
- 3 个 API 网关（Vercel AI Gateway、OpenRouter、AiHubMix、ZenMux）
- 本地推理（Ollama、CC Switch、Claude Code Router）+ 任何 Anthropic 兼容端点
- 会话内热切换供应商

### 远程与自动化

- 移动配对 —— 扫码把手机/平板接进来当远程终端
- Web server 访问 —— 内置 HTTP server + token 鉴权，局域网或 cloudflared/ngrok 隧道
- 定时任务 —— cron 形式跑定时 AI 任务
- Ralph loop —— 自动迭代同一个 prompt 直到满足完成条件
- Hook 管理 —— 上游 CLI 钩子，事件驱动自动化

### 工作区工具

- 文件浏览器 —— 语法高亮、markdown 预览、图片预览、git diff
- 记忆编辑器 —— CLAUDE.md（user + project scope）实时预览
- Agent 编辑器 —— 自定义 agent 定义（.md）的可视化编辑，form / source 双模式
- 权限规则 —— user + project 级别，批量 Allow/Deny
- MCP 管理 —— 发现服务、查看状态、重连/切换
- 用量分析 —— 每模型 token 拆解、费用追踪、日热力图
- Team dashboard —— Claude Code 多 agent 团队的只读视图（任务列表、状态、消息流）
- Doctor 诊断 —— CLI、平台、SSH、proxy 的系统健康检查

### 应用壳

- 12 个主题（Codex、Midnight、Ocean、Dracula、Nord、Morandi、Carbon Pink、Deep Sea Milk、Aurora Pomelo、Pomegranate Mist、Aurora Lime、Dev Preview），每个都有完整的亮/暗变体
- 亮 / 暗 / 跟随系统模式，实时跟随 OS
- 自定义快捷键，支持 chord 与冲突检测
- 英文 / 简体中文 i18n
- 系统托盘 + 原生通知
- 应用内更新检查

## 快速开始

### 方式 A — 下载（macOS）

从 [Releases](https://github.com/Yhazrin/MiWarp/releases) 下载最新的 `.dmg`。

Universal 二进制（Apple Silicon + Intel）。**未做代码签名** —— 首次启动：右键 app → 打开 → "打开" 绕过 Gatekeeper。

> Linux 和 Windows 的 CI 产物能编译和运行，但没在真机上充分测试。建议用方式 B / C。

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

| 供应商                   | 端点                                            | 鉴权     |
| ------------------------ | ----------------------------------------------- | -------- |
| Anthropic                | 官方 API                                        | API Key  |
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

| 平台             | 端点                       | 鉴权    |
| ---------------- | -------------------------- | ------- |
| Vercel AI Gateway| `ai-gateway.vercel.sh`     | Bearer |
| OpenRouter       | `openrouter.ai/api`        | Bearer |
| AiHubMix         | `aihubmix.com`             | Bearer |
| ZenMux           | `zenmux.ai/api/anthropic`  | Bearer |

### 本地

| 平台                                                                | 端点                            |
| ------------------------------------------------------------------- | ------------------------------- |
| Ollama                                                              | `localhost:11434`               |
| [CC Switch](https://github.com/farion1231/cc-switch)                | `localhost:15721`               |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | `localhost:3456`            |
| 自定义                                                              | 任何 Anthropic 兼容端点         |

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

| 层      | 技术                                                                            |
| ------- | ------------------------------------------------------------------------------- |
| 框架    | [Tauri v2](https://v2.tauri.app/) (Rust + WebView)                              |
| 前端    | [Svelte 5](https://svelte.dev/) + SvelteKit (adapter-static)                    |
| 样式    | [Tailwind CSS v3](https://tailwindcss.com/) + CSS 变量                          |
| 终端    | [xterm.js](https://xtermjs.com/)                                                |
| Markdown| [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)     |
| 净化    | [DOMPurify](https://github.com/cure53/DOMPurify)                                |
| i18n    | 自研轻量运行时（en + zh-CN）                                                    |
| 测试    | [Vitest](https://vitest.dev/) + Rust 单元测试                                   |

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

**平台支持** —— 主力开发和测试在 **macOS**。Windows 和 Linux 能编译运行，但不在"充分测试"清单上。Bug 报告和平台特定修复欢迎。

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
