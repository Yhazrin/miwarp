<p align="center">
  <img src="miwarp-banner.png" width="800" alt="MiWarp">
</p>

<p align="center">
  <strong>Local-first desktop GUI for AI coding CLIs</strong>
  <br>
  <sub>Claude Code · Codex · 15+ providers · sessions · mobile pairing · scheduling</sub>
</p>

<p align="center">
  <a href="#what-is-miwarp">What is it</a> ·
  <a href="#what-changed-in-v107">v1.0.7</a> ·
  <a href="#capabilities">Capabilities</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#supported-providers">Providers</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

## What is MiWarp?

**MiWarp** wraps AI coding CLIs (Claude Code, Codex, …) in a native desktop app, so you get the power of the terminal agent plus a proper visual interface — chat history with diffs, multi-session management, cross-session forwarding, and remote access from your phone.

Everything stays on your machine under `~/.miwarp/`. The app itself has no cloud backend; only the LLM API calls go over the network.

It's **not** an Electron app — built on Tauri v2 (Rust + system WebView), so the install is ~50 MB and RAM usage stays under 200 MB for a normal session.

## Who is it for?

Developers who already use Claude Code / Codex from the terminal and want:

- a **visual chat interface** with proper markdown, tool cards, and diffs (instead of scrolling terminal output)
- **persistent history** — every prompt, every response, every file change, searchable
- **multi-provider switching** — Anthropic, DeepSeek, Kimi, Zhipu, OpenRouter, local Ollama, … without restarting
- **session management** — fork, resume, rename, forward messages between sessions
- **remote access** — pair your phone, run from the browser, schedule tasks to run while you're away

If you just want a chatGPT-style web UI, this isn't it. If you spend hours a day in `claude code` and want it to feel less like 1995, this is.

## What changed in v1.0.7?

The most recent release focuses on **polish and the theme/forward workflows that ship in every session**:

- **Unified theme system** — 12 themes, each with proper light *and* dark variants. Pick a theme and an "appearance mode" (light / dark / follow system) independently. Follows macOS / Windows system theme live, even when the Settings tab is closed.
- **Forward to session** rewritten as a proper "session target selector" — three layered lines per row (title / last message preview / meta), one short project name per group, and an explicit Cancel / Forward button pair.
- **`listRunsLite` backend** — the forward dialog used to take several seconds with hundreds of past runs; now it's instant. (Reads only `meta.json`, skips the events scan.)
- **Dialog chrome cleanup** — removed all `elevation-3` / `shadow-lg` from dialogs, backdrop blur bumped from `2xl` to `3xl`, dialog titles get a proper `border-b` header bar (no more zero-padding top-left corner).

See [CHANGELOG.md](CHANGELOG.md) for the full list (1.0.5 → 1.0.7 included).

## Capabilities

### Chat

- Visual tool cards — every Claude Code tool call (Read, Edit, Bash, Grep, Write, WebFetch, …) rendered inline with syntax-highlighted diffs, structured output, one-click copy
- Rich content — markdown with syntax highlighting, thinking blocks, image attachments, file diffs, collapsible tool-burst groups
- Inline slash commands — `/model`, `/diff`, `/todos`, `/tasks`, `/doctor`, `/stats`, `/preview`, `/ralph`, … rendered natively
- Drag & drop — images, PDFs, directories, path references

### Sessions

- Run history & replay — browse every past session, full event replay, resume or fork from any point, soft-delete with recovery
- Workspace grouping — sessions grouped by project (cwd); full path shown once per group, not in every row
- Cross-session forward — pick a target session, send a message into it without leaving the current one
- Rewind — checkpoint and selectively revert file changes with dry-run preview
- CLI session import — discover and import existing Claude Code CLI sessions

### Multi-provider

- 15+ LLM providers (Anthropic official, DeepSeek, Kimi, Zhipu, Bailian, DouBao, MiniMax, Xiaomi MiMo, Tencent Hunyuan, SiliconFlow, …)
- 3 API gateways (Vercel AI Gateway, OpenRouter, AiHubMix, ZenMux)
- Local inference (Ollama, CC Switch, Claude Code Router) + any Anthropic-compatible endpoint
- Hot-swap between providers without restarting a session

### Remote & automation

- Mobile pairing — QR-code pair a phone or tablet as a remote terminal
- Web server access — embedded HTTP server with token auth, LAN or cloudflared/ngrok tunnel
- Scheduled tasks — cron-style recurring prompts
- Ralph loop — auto-iterate a prompt until a completion condition is met
- Hook manager — upstream CLI hooks for event-driven automation

### Workspace tooling

- File explorer — syntax highlighting, markdown preview, image preview, git diff
- Memory editor — CLAUDE.md (user + project scope) with live preview
- Agent editor — visual editor for custom agent definitions (.md) with form / source modes
- Permission rules — user + project level, with batch Allow/Deny
- MCP management — discover servers, view status, reconnect / toggle
- Usage analytics — per-model token breakdown, cost tracking, daily heatmap
- Team dashboard — read-only view of Claude Code multi-agent teams (task lists, status, message flow)
- Doctor diagnostics — system health for CLI, platform, SSH, proxy

### App shell

- 12 themes (Codex, Midnight, Ocean, Dracula, Nord, Morandi, Carbon Pink, Deep Sea Milk, Aurora Pomelo, Pomegranate Mist, Aurora Lime, Dev Preview) with full light / dark variants
- Light / dark / system mode with live OS follow
- Custom keybindings with chord support and conflict detection
- English / 简体中文 i18n
- System tray with native notifications
- In-app update checker

## Quick start

### Option A — Download (macOS)

Grab the latest `.dmg` from [Releases](https://github.com/Yhazrin/MiWarp/releases).

Universal binary (Apple Silicon + Intel). **Not code-signed** — first launch: right-click the app → Open → "Open" to bypass Gatekeeper.

> Linux and Windows builds are produced by CI but have not been tested on real machines. The recommended path for those is Option B / C below.

### Option B — Automated setup (macOS)

```bash
git clone https://github.com/Yhazrin/MiWarp.git
cd MiWarp
./scripts/setup.sh          # add --yes to skip prompts
npm run tauri dev
```

The setup script auto-detects missing deps (Xcode CLI Tools, Homebrew, Node.js, Rust) and installs them.

### Option C — Manual setup

**Prerequisites**

- [Node.js](https://nodejs.org/) ≥ 20
- [Rust](https://rustup.rs/) ≥ 1.75

**macOS**

```bash
xcode-select --install
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Linux (Debian / Ubuntu)**

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Windows**

Install Rust from <https://rustup.rs> and Node.js from <https://nodejs.org>.

**Then**

```bash
git clone https://github.com/Yhazrin/MiWarp.git
cd MiWarp
npm install
npm run tauri dev
```

### First launch

The setup wizard walks you through:

1. CLI detection — auto-detects Claude Code / Codex, offers install if missing
2. Authentication — OAuth or API key for your provider
3. Ready to chat

Re-run anytime from **Settings → Setup Wizard**.

## Supported providers

### LLM providers

| Provider                 | Endpoint                                       | Auth    |
| ------------------------ | ---------------------------------------------- | ------- |
| Anthropic                | Official API                                   | API Key |
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
| Xiaomi MiMo (小米)       | `api.xiaomimimo.com/anthropic`                 | Bearer  |
| Xiaomi MiMo (Token Plan) | `token-plan-cn.xiaomimimo.com/anthropic`       | Bearer  |
| Tencent Hunyuan (混元)   | `api.hunyuan.cloud.tencent.com/anthropic`      | Bearer  |
| SiliconFlow (硅基流动)   | `api.siliconflow.com/`                         | Bearer  |

### API gateways

| Platform          | Endpoint                  | Auth   |
| ----------------- | ------------------------- | ------ |
| Vercel AI Gateway | `ai-gateway.vercel.sh`    | Bearer |
| OpenRouter        | `openrouter.ai/api`       | Bearer |
| AiHubMix          | `aihubmix.com`            | Bearer |
| ZenMux            | `zenmux.ai/api/anthropic` | Bearer |

### Local

| Platform                                                               | Endpoint                          |
| ---------------------------------------------------------------------- | --------------------------------- |
| Ollama                                                                 | `localhost:11434`                 |
| [CC Switch](https://github.com/farion1231/cc-switch)                   | `localhost:15721`                 |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | `localhost:3456`                  |
| Custom                                                                 | Any Anthropic-compatible endpoint |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  MiWarp Desktop (Tauri v2)                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Frontend (Svelte 5 + SvelteKit static)         │   │
│  │  • chat UI · tool cards · settings · themes    │   │
│  └─────────────────────────────────────────────────┘   │
│                          │  IPC                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Backend (Rust)                                  │   │
│  │  • session_actor (per-run process lifecycle)    │   │
│  │  • turn_engine (phase / timeout)                 │   │
│  │  • storage (runs, events, settings, …)          │   │
│  │  • web server (mobile pairing)                   │   │
│  │  • scheduler · hook manager                      │   │
│  └─────────────────────────────────────────────────┘   │
│                          │  stream-JSON / PTY / pipe    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Claude Code CLI  /  Codex CLI                  │   │
│  │  (long-lived child processes)                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Tech stack**

| Layer     | Tech                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| Framework | [Tauri v2](https://v2.tauri.app/) (Rust + WebView)                              |
| Frontend  | [Svelte 5](https://svelte.dev/) + SvelteKit (adapter-static)                    |
| Styling   | [Tailwind CSS v3](https://tailwindcss.com/) + CSS variables                      |
| Terminal  | [xterm.js](https://xtermjs.com/)                                                |
| Markdown  | [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)     |
| Sanitize  | [DOMPurify](https://github.com/cure53/DOMPurify)                                |
| i18n      | Custom lightweight runtime (en + zh-CN)                                         |
| Testing   | [Vitest](https://vitest.dev/) + Rust unit tests                                 |

**Data storage** — everything at `~/.miwarp/`, no cloud:

```
~/.miwarp/
├── settings.json          # user settings
├── keybindings.json       # custom shortcuts
├── runs/                  # session history
│   └── {run-id}/
│       ├── meta.json      # run metadata
│       ├── events.jsonl   # event log
│       └── artifacts.json # summary
└── …
```

**Platform support** — actively developed and tested on **macOS**. Windows and Linux compile and run, but are not on the "thoroughly tested" list. Bug reports and platform-specific fixes are welcome.

## Development

```bash
npm install              # install dependencies
npm run tauri dev        # dev mode with hot reload
npm test                 # run vitest
npm run lint             # eslint
npm run format           # prettier
npm run check            # svelte-check (type)
npm run i18n:check       # i18n key alignment
npm run verify           # full CI gate (lint + format + check + i18n + test + build + rust)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code conventions, commit style, and PR guidelines.

## License

[Apache License 2.0](LICENSE)

Copyright 2025-2026 MiWarp Contributors.
