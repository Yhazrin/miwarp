# MiWarp v1.1.0 性能与能耗专项优化 — 最终交付报告

**分支**：`perf/v110-performance-energy-core`（已 push origin）
**基准**：`origin/master` @ `700b27ef`
**优化提交**：40 个独立 commit（30 perf + 8 cleanup/bugfix + 2 docs，含 1 个 revert）
**报告日期**：2026-06-30

---

## 1. 工作总结

三轮共 **40 个 commit**，覆盖 6 大类 35+ 项性能 / 稳定性 / 内存修复优化。

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

### 第四轮（10 commits）— 内存泄漏清理 + 卡死修复
| 类型 | commits |
|------|---------|
| Memory leak cleanup | 610a1e16 bootstrap attention unsubscribe、092ad436 fleet reconnect dedupe、9b925415 scheduler monitor cancel、aec7165e respawn backoff cancel |
| Frontend bug fix | **f693462a workbench click-hang**（svelte 5 effect 误捕 cache.runs 读，async IIFE 同步 prelude 内被 effect tracker 捕获，导致 runsSidebarStore 更新级联 refresh）|
| Regression test | **bb336790 workbench effect 回归测试**（mount 后修改 runsSidebarStore 不再触发额外 refresh）|
| Docs | 74be2c02、bf7b1eba delivery report 增量更新 |

---

## 2. 完整 commit 列表（40 个，含 1 revert）

```
bb336790 test(workbench): add regression test for effect re-fire prevention
f693462a perf(workbench): fix project desk click-hang by untracking cache.runs reads
aec7165e perf(recovery,bootstrap-test): cancel respawn backoff; cover dispose path
9b925415 perf(scheduler): cancel monitor on app shutdown
092ad436 perf(fleet-store): track and dedupe WS reconnect timer
610a1e16 perf(bootstrap): unsubscribe attention queue on dispose
bf7b1eba docs(perf): update delivery report for 30 commits across 3 rounds
fa99e8d2 Revert "perf(arch): wire runtime perf-budget gate to actual SvelteKit manifest keys"
b0c53cc5 perf(arch): wire runtime perf-budget gate to actual SvelteKit manifest keys  ← reverted
69dee31a perf(permission-coordinator): clear inFlight TTL timers on dispose
7589a411 perf(build): pin heavy vendor modules to dedicated chunks
1bc19363 perf(chat-page): skip first continuity save on mount
1f3331b0 perf(timeline-presentation): memoize detectBatchGroups + detectToolBursts on structuralSig
4d9439f8 perf(session-store): bump structuralVersion only on length changes
ce400421 perf(timeline-annotations): mutate usageByTurn Map in place on length change
78dd03ea perf(session-derived): cache userHistory on length + user-entry signature
74be2c02 docs(perf): update delivery report with 22 optimization commits
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

### 内存泄漏修复（5 项）
- permission-coordinator dispose 不清 TTL timer（69dee31a）
- bootstrap attention queue dispose 时未退订（610a1e16）
- fleet-store WS reconnect setTimeout 没 dedupe，rapid reconnect 会堆叠（092ad436）
- scheduler monitor 在 app shutdown 后还在跑（9b925415）
- recovery respawn backoff setTimeout 无 cancel 路径（aec7165e）

### UI Bug 修复（1 项）
- **f693462a workbench 项目台卡死**：async IIFE 同步 prelude 内读 `cache.runs` getter，触发 effect 重跑级联 refresh；改 `onMount` 一次性挂载

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
ahead of origin/master: 42 commits (含 doc + 测试挪动)
working tree: clean (artifacts/ untracked, gitignored)
pushed to origin/perf/v110-performance-energy-core
```

## 9. 构建产物（macOS aarch64）

```
pnpm tauri build  →  exit 0  (前端 build 通过 + Rust release 编译 0 warning)

src-tauri/target/release/bundle/macos/MiWarp.app                    33 MiB  (arm64 thin)
src-tauri/target/release/bundle/dmg/MiWarp_1.1.0-rc.1_aarch64.dmg  19 MiB  (zlib UDIF)
src-tauri/target/release/bundle/macos/MiWarp.app.tar.gz             19 MiB  (updater)

DMG SHA256: 38386307ba27d5ca25ecf0760393f392ef096329418762fec2c73ae85301ee16
签名:        adhoc (signingIdentity: "-" — 无 Apple Developer ID)
二进制:      Mach-O 64-bit arm64, Mach-O thin (arm64 only)
CFBundleVersion / CFBundleShortVersionString: 1.1.0-rc.1
Bundle Identifier: com.miwarp.desktop
```

> ⚠️ **Gatekeeper**：adhoc 签名下首次打开需要"右键 → 打开"，或 `xattr -dr com.apple.quarantine /Applications/MiWarp.app`。要分发公网需 Apple Developer ID 签名 + notarization。

---

按用户要求：✅ 已 push 到 origin/perf/v110-performance-energy-core；✅ dmg 已构筑；版本号仍为 `1.1.0-rc.1`（与 origin/master 一致）；未 merge master；未打 Tag。