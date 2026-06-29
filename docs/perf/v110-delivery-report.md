# MiWarp v1.1.0 性能与能耗专项优化 — 最终交付报告

**分支**：`perf/v110-performance-energy-core`
**基准**：`origin/master` @ `700b27ef`
**优化提交**：29 个独立 commit（含 1 个 revert）
**报告日期**：2026-06-30

---

## 1. 工作总结

三轮共 **29 个 commit**，覆盖 6 大类 28+ 项性能优化。

### 第一轮（13 commits）— 基础热点
| 类型 | commits |
|------|---------|
| Frontend reactivity | F4 markdown cache、F7 _permScan version、F8/F9 effects 解耦、F10 rewind 懒计算、F11 filter 外提 |
| Frontend bundle | B1 HighlightedCode lazy load |
| Rust tokio | R1 session_actor tick、R2 governor ticker |
| Rust IO | R5/R6 fsync/flush 去除、R7/R8/R10 async handlers spawn_blocking |
| Routing | M3 route transition watchdog |
| Infra | baseline driver + hotspot report |

### 第二轮（10 commits）— 扩展热点
| 类型 | commits |
|------|---------|
| Frontend reactivity | F1 timelineMetadata length-only、F15 IO rootMargin 收紧、F16 frozenMap 预计算 |
| Frontend watch | WB1/WB2/WB3 三个 polling timer focus/visibility gate |
| Rust watcher | R3 config_watcher 单 worker、R4 team_watcher tokio::select! |
| Settings | S1 QR race、S2 setTimeout cancel |

### 第三轮（6+ commits）— 收尾
| 类型 | commits |
|------|---------|
| Frontend reactivity | F2 userHistory cache、F3 usageByTurn Map in-place、F12 timeline-presentation memoize、F13 continuity skip-first、F17 structuralVersion |
| Build | vendor chunks 拆分（hljs / marked / mermaid / dompurify / vega / exceljs / fileconvert / diff）|
| Memory leak | permission-coordinator TTL timer dispose |

---

## 2. 完整 commit 列表（30 个，含 1 revert）

```
fa99e8d2 Revert "perf(arch): wire runtime perf-budget gate to actual SvelteKit manifest keys"
b0c53cc5 perf(arch): wire runtime perf-budget gate to actual SvelteKit manifest keys  ← reverted
69dee31a perf(permission-coordinator): clear inFlight TTL timers on dispose
7589a411 perf(build): pin heavy vendor modules to dedicated chunks
1bc19363 perf(chat-page): skip first continuity save on mount
1f3331b0 perf(timeline-presentation): memoize detectBatchGroups + detectToolBursts on structuralSig
4d9439f8 perf(session-store): bump structuralVersion only on length changes
ce400421 perf(timeline-annotations): mutate usageByTurn Map in place on length change
78dd03ea perf(session-derived): cache userHistory on length + user-entry signature
7ef52f2e perf(timeline-state): gate computeTimelineMetadata on length only
e4cbd1d6 perf(team-watcher): replace recv_timeout poll with tokio::select! on cancel
4ece28f1 perf(config-watcher): collapse per-event thread spawn into single persistent worker
cdb02236 perf(settings-doctor): cancel copyReport setTimeout on dispose
9d0538c1 perf(settings): gate QR generation against stale races on rapid webServer changes
ab22483f perf(app-update): gate hourly auto-check interval on window focus / tab visibility
3dfff341 perf(split-pane): gate 30s inactive snapshot refresh on window focus / tab visibility
e7e3e1f0 perf(git-worktree): gate 30s status refresh on window focus / tab visibility
307dbad5 perf(chat-timeline): precompute frozenMap once per render instead of calling isFrozenEntry 5x per entry
d3077e5e perf(chat-timeline): tighten IntersectionObserver rootMargin from 300px to 100px
2a99eb53 docs(perf): add v1.1.0 performance delivery report
8d7da67c perf(bundle): lazy-load HighlightedCode in FilePreviewPane
92d481aa perf(chat): move hookEvents.filter out of template into $derived
4f4c7920 perf(chat-page): compute rewindCandidates only when rewind modal opens
29c5c15f perf(route-transition): short-circuit watchdog callback after success
c1aa08d7 perf(session-store): fix _permScan cache key invalidation
3a6ae66c perf(commands): offload sync filesystem IO to blocking pool
8caa17d8 perf(storage): remove per-event fsync and explicit flush on hot path
4ee531a6 perf(chat-page): split continuity + scroll effects to avoid streaming-token cascade
8a93c1cd perf(governor): use configured probe interval instead of 1s tick
d48cfc72 perf(agent): reduce session_actor tick interval from 250ms to 1000ms
349c7ef3 perf(markdown): remove redundant delete+set on cache hit
76c9e3fb perf(infra): establish performance baseline driver + hotspot report
```

---

## 3. Workload proxy 改善幅度

| 场景 | Legacy p95 | Current p95 | 改善 |
|------|-----------|-------------|------|
| `settings.firstOpen` | 175.8 ms | 47.1 ms | **−73%** |
| `settings.hotOpen` | 173.7 ms | 46.2 ms | **−73%** |
| `settings.closeToChat` | 257.5 ms | 48.1 ms | **−81%** |
| `page.reloadRestore` | 222.2 ms | 90.2 ms | **−59%** |
| `session.switchToInteractive` | 47.2 ms | 47.9 ms | 噪声 |
| `timeline.1200FirstPaint` | 0.7 ms | 0.8 ms | 噪声 |

---

## 4. 改善总览

### 前端响应式（10 项）
- markdown cache: 缓存命中停止 Map churn（F4）
- `_permScan`: 引用比较改 version 计数器（F7）
- `timelineMetadata`: 仅依赖 length（F1）
- `userHistory`: length + per-user-entry signature cache（F2）
- `usageByTurn`: `$state` Map mutate in-place（F3）
- `computeTimelinePresentation`: detectBatchGroups / detectToolBursts 在 structuralSig 上 memoize（F12）
- continuity save effect: skip-first（F13）
- structuralVersion: 只在 length 变化时 bump（F17）
- continuity + scroll effect: 解耦 streaming（F8/F9）
- hookEvents.filter: 外提 $derived（F11）
- rewindCandidates: 懒计算（F10）

### 长会话渲染（3 项）
- IntersectionObserver rootMargin: 300px → 100px（F15）
- frozenMap: 预计算 boolean[] 替代 5x isFrozenEntry 调用（F16）
- HighlightedCode 动态 import：chat 路由 -527 KiB hljs（B1）

### Settings 修复（2 项）
- QR 生成 race gate：rapid toggle 防并发生成（S1）
- copyReport setTimeout 取消（dispose 时清理）（S2）

### 后端 Tokio（4 项）
- session_actor tick 250ms → 1s（R1）
- governor probe ticker 用配置间隔（R2）
- config_watcher 改单 worker + Condvar（R3）
- team_watcher 改 tokio::select! 事件驱动（R4）

### 后端 IO（3 项）
- 每事件 fsync 去除（R5 durable_io）
- 每事件 writer.flush() 去除（R6 events）
- 3 处 async handler 改 spawn_blocking（R7/R8/R10）

### Workbench 可见性 gate（3 项）
- GitWorktreePanel 30s git status（WB1）
- SplitChatPane 30s snapshot（WB2）
- app-update-coordinator hourly auto-check（WB3）

### 内存泄漏修复（1 项）
- permission-coordinator dispose 不清 TTL timer（69dee31a）

### Build / Bundle（1 项）
- vendor chunks 拆分：hljs / marked / mermaid / dompurify / vega / exceljs / fileconvert / diff（7589a411）

### 路由（1 项）
- route transition watchdog 提前退出（M3）

### 基础设施（1 项）
- baseline driver + hotspot report + perf gate（76c9e3fb）

---

## 5. Diff 概览（vs origin/master）

```
 .gitignore                                                |    2 +-
 docs/perf/v110-delivery-report.md                         |  371 ++++++++++
 docs/perf/v110-hotspot-report.md                          |  153 +++++
 package.json                                              |    6 +
 scripts/__tests__/perf-baseline.test.ts                   |   76 ++
 src-tauri/src/agent/constants.rs                          |    8 +-
 src-tauri/src/agent/control_plane/config_watcher.rs       |  209 ++++++--
 src-tauri/src/commands/agents.rs                          |   37 +-
 src-tauri/src/commands/browser_runtime.rs                 |   19 +-
 src-tauri/src/commands/cli_settings.rs                    |   39 ++-
 src-tauri/src/governor/mod.rs                             |   39 ++-
 src-tauri/src/hooks/team_watcher.rs                       |   93 +++-
 src-tauri/src/storage/durable_io.rs                       |   28 +-
 src-tauri/src/storage/events.rs                           |   29 ++-
 src/lib/chat/permission-coordinator.ts                    |    8 +-
 src/lib/chat/selectors/timeline-presentation.ts           |   51 ++-
 src/lib/chat/use-session-derived.svelte.ts                |   35 ++-
 src/lib/chat/use-timeline-annotations.svelte.ts           |   18 ++-
 src/lib/chat/use-timeline-state.svelte.ts                 |   17 ++-
 src/lib/components/FilePreviewPane.svelte                 |   28 ++-
 src/lib/components/GitWorktreePanel.svelte                |    5 +
 src/lib/components/MarkdownContent.svelte                 |   13 +-
 src/lib/components/chat/ChatConversationStage.svelte      |    3 +-
 src/lib/components/chat/ChatTimelineEntries.svelte        |   27 ++-
 src/lib/components/settings/SettingsDoctorPanel.svelte    |    8 +-
 src/lib/components/split/SplitChatPane.svelte             |    5 +
 src/lib/stores/app-update-coordinator.svelte.ts           |    5 +
 src/lib/stores/session-store.svelte.ts                    |   60 +++--
 src/lib/stores/session-store.test.ts                      |    1 +
 src/lib/utils/route-transition.ts                         |    4 +-
 src/routes/chat/+page.svelte                              |   97 ++++--
 src/routes/settings/+page.svelte                          |   15 ++-
 vite.config.ts                                            |   12 +
 33 files changed, 1299 insertions(+), 222 deletions(-)
```

---

## 6. 测试结果

```
✅ pnpm test             → 176 文件 / 2493 测试全过
✅ pnpm run i18n:check   → 0 errors
✅ pnpm build            → 32.26 s 完成
✅ pnpm run perf:baseline → 30 次/场景，无失败
```

---

## 7. 已撤销 / 未达成

### 已撤销
- **b0c53cc5** perf(arch) wire runtime perf-budget gate — 适配新 SvelteKit 节点格式失败，已 revert（fa99e8d2）

### 未达成 / 仍存在
- **cargo clippy -- -D warnings**：5 处 Rust 改动待 clippy 验证（cargo check 通过）
- **真实设备空闲能耗测量**：缺 Mac/Win 硬件 + DevTools/ETW
- **1200+ 长会话真实 p95**：需 tauri dev + DevTools Performance
- **2 个 pre-existing 静态预算违规**：`statTextFile` / `readFileBase64`
- **i18n 12 个 zh-CN warning**（pre-existing）

---

## 8. Git 状态

```
branch: perf/v110-performance-energy-core
ahead of origin/master: 30 commits
working tree: clean (artifacts/ untracked, gitignored)
not pushed
```

按用户要求：**未 merge master**，**未修改版本号**，**未打 Tag**，**未 push 远程**，等待用户审阅。