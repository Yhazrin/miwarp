# MiWarp v1.1.0 性能与能耗热点报告

**Branch**: `perf/v110-performance-energy-core`
**Commit**: 700b27ef (origin/master)
**Date**: 2026-06-30

## 1. 基线（Baseline）

通过 `scripts/__tests__/perf-baseline.test.ts` 运行既有 6 个 workload-proxy 场景各 30 次。

| 场景                          | Legacy p50/p95   | Current p50/p95 | Δ p95                | 失败率 |
| ----------------------------- | ---------------- | --------------- | -------------------- | ------ |
| `settings.firstOpen`          | 164.8 / 175.8 ms | 41.1 / 49.1 ms  | **−73%**             | 0%     |
| `settings.hotOpen`            | 163.1 / 173.7 ms | 42.2 / 48.2 ms  | **−73%**             | 0%     |
| `settings.closeToChat`        | 245.3 / 257.5 ms | 42.1 / 48.1 ms  | **−81%**             | 0%     |
| `session.switchToInteractive` | 40.1 / 47.2 ms   | 39.4 / 48.1 ms  | −2%（噪声）          | 0%     |
| `page.reloadRestore`          | 207.4 / 222.2 ms | 84.6 / 93.0 ms  | **−58%**             | 0%     |
| `timeline.1200FirstPaint`     | 0.38 / 0.70 ms   | 0.40 / 1.66 ms  | +137%（< 1 ms 噪声） | 0%     |

> ⚠️ 既有 perf harness 是 **workload proxy**（合成 CPU + 假 IPC 延迟），不是真实 WebView paint/IPC 测量。它能反映**算法/结构**改善，无法替代真实运行时测量。所有后续优化都必须补**真实场景**对比。

## 2. 静态 perf budget 违规（已存在）

```
✗ static:preview-stat-text-file: FilePreviewPane.svelte 仍调用 statTextFile
✗ static:preview-base64-ipc: FilePreviewPane.svelte 仍调用 readFileBase64
```

> 这两个是 v1.1.0 之前遗留的违规。`statTextFile` / `readFileBase64` 走双 IPC，性能显著低于统一的 `readFilePreview(FilePreviewDescriptor)`。

## 3. Bundle 大小（gzipped，运行时）

| Chunk                                 | Gz            | 内容                |
| ------------------------------------- | ------------- | ------------------- |
| `_app/immutable/chunks/DBbvMRsE.js`   | **526.9 KiB** | CodeMirror + 依赖   |
| `_app/immutable/chunks/B6eZCeOw.js`   | **263.4 KiB** | markdown / messages |
| `_app/immutable/chunks/CJa1hza8.js`   | 158.8 KiB     | markdown            |
| `_app/immutable/chunks/BcJaxjyO.js`   | 143.7 KiB     | markdown + i18n     |
| `_app/immutable/chunks/OyMbaexL.js`   | 138.4 KiB     | 第三方              |
| `_app/immutable/nodes/6.BPI4TJvD.js`  | 131.3 KiB     | layout 节点         |
| `_app/immutable/nodes/16.Dh9tIsFt.js` | 48.2 KiB      | chat 页节点         |

**关键发现**：

- **DBbvMRsE.js (527 KiB)** 包含 CodeMirror，被 chat 路由**静态 import** 进 FilePreviewPane，意味着打开 Chat 就拉 527 KiB。
- 整页 gzipped 大块总 ≈ **1.5 MB**（232 个 chunk），其中 top-10 ≈ 1.4 MB。

## 4. 客户端 Timer / Listener / 资源清单

### 4.1 setInterval（持续后台）

| 文件                                                  | 用途           | 节流/可见性？            |
| ----------------------------------------------------- | -------------- | ------------------------ |
| `src/lib/layout/team-subscription.svelte.ts:94`       | team 状态轮询  | ❌ 无可见性 gate         |
| `src/lib/layout/runs-sidebar-store.svelte.ts:135`     | runs 60 s 轮询 | ✅ 仅 visibility=visible |
| `src/lib/chat/use-fork-overlay.svelte.ts:24`          | fork 倒计时    | ✅ 用完即停              |
| `src/lib/chat/use-thinking-timer.svelte.ts:75`        | thinking 计时  | ✅ 用完即停              |
| `src/lib/components/split/SplitChatPane.svelte:96`    | split 轮询     | ❌ 待查                  |
| `src/lib/transport/chunk-assembler.ts:50`             | chunk cleanup  | ✅ 可配置                |
| `src/lib/components/PromptInput.svelte:343`           | 输入防抖       | ✅ 用完即停              |
| `src/lib/stores/app-update-coordinator.svelte.ts:104` | 更新检查       | ❌ 待查                  |
| `src/lib/components/GitWorktreePanel.svelte:81`       | git refresh    | ❌ 待查                  |

### 4.2 app-visibility 单例

```ts
// src/lib/stores/app-visibility.svelte.ts:26
document.addEventListener("visibilitychange", onVisibility);
window.addEventListener("focus", onFocus);
window.addEventListener("blur", onBlur);
```

✅ 单例、生命周期=app 生命周期、正确。
❌ 但只有 **notification-service** 使用 `appVisibility.isAppFocused` 来抑制通知。其他位置（runs-sidebar、team-subscription、chat 渲染）都没有基于 `isAppFocused` 抑制。

## 5. Svelte 5 响应式热点（前端 P0/P1）

| #   | 文件:行                                                    | 问题                                                                                                                           | 严重度 |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| F1  | `src/lib/chat/use-timeline-state.svelte.ts:100`            | `timelineMetadata = $derived(computeTimelineMetadata(store.timeline))` 每次 timeline 变更全扫一遍；streaming 每个 token 都触发 | **P0** |
| F2  | `src/lib/chat/use-session-derived.svelte.ts:99-109`        | `userHistory` 反向遍历整个 timeline                                                                                            | **P0** |
| F3  | `src/lib/chat/use-timeline-annotations.svelte.ts:38`       | `usageByTurn = $derived(new Map(store.turnUsages.map(...)))` 每次 push 重建整 Map                                              | **P0** |
| F4  | `src/lib/components/MarkdownContent.svelte:14-36`          | `cachedRenderMarkdown` 用整字符串作 key，streaming 每个累积前缀都是新 key → 全 miss → 每 token 整段 markdown 重解析            | **P0** |
| F5  | `src/lib/components/MarkdownContent.svelte:22-26`          | cache hit 时 `delete` + `set` 也会 Map churn                                                                                   | **P0** |
| F6  | `src/lib/components/MarkdownContent.svelte:17-19`          | 长文（>32K）绕过 cache，每帧重 parse                                                                                           | **P0** |
| F7  | `src/lib/stores/session-store.svelte.ts:429`               | `_permScan.timelineRef === this.timeline` 因 timeline 每次 push 都 spread 替换引用，检查必失败 → 每次事件都重扫权限            | **P0** |
| F8  | `src/routes/chat/+page.svelte:767-798`                     | `continuityController` `$effect` 直接读 `store.timeline`，每个 token 都触发                                                    | **P0** |
| F9  | `src/routes/chat/+page.svelte:1108-1126`                   | auto-scroll `$effect` 同时追踪 `timeline.length` + `streamingText.length`，streaming 每 token 触发                             | P1     |
| F10 | `src/routes/chat/+page.svelte:387-409`                     | `rewindCandidates = $derived(...4 步变换整个 timeline...)`                                                                     | P1     |
| F11 | `src/lib/components/chat/ChatConversationStage.svelte:484` | `{#each store.hookEvents.filter(...)}` 模板内 filter，每次渲染新建数组                                                         | P1     |
| F12 | `src/lib/chat/selectors/timeline-presentation.ts:158-198`  | `detectBatchGroups` / `detectToolBursts` 每次 visible timeline 变化都重算                                                      | P1     |
| F13 | `src/routes/chat/+page.svelte:806-819`                     | continuity save `$effect` 依赖多，mount 即 schedule save                                                                       | P1     |
| F14 | `src/lib/chat/selectors/timeline-presentation.ts:47-53`    | `sliceVisibleTimeline` 每次 renderLimit 变化新建数组引用（key 复用已 OK，但要验证）                                            | P1     |
| F15 | `src/lib/components/MarkdownContent.svelte:106`            | IntersectionObserver rootMargin=300px 提前触发 markdown parse                                                                  | P1     |
| F16 | `src/lib/components/chat/ChatTimelineEntries.svelte`       | `isFrozenEntry(i)` 模板内调用 5 次/条目                                                                                        | P2     |
| F17 | `src/lib/stores/session-store.svelte.ts:634`               | `this.timeline = [...this.timeline, entry]` 每次 push 都新建数组                                                               | P1     |

## 6. Rust 后端热点（P1）

| #   | 文件:行                                                   | 问题                                                            | 严重度 |
| --- | --------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| R1  | `src-tauri/src/agent/session_actor.rs:526`                | `tokio::time::interval(250ms)` 每个 session 4 次/秒唤醒         | **P1** |
| R2  | `src-tauri/src/governor/mod.rs:355`                       | 1s ticker 当 probe_interval=15s+ 时 14/15 次 tick 都是空转      | **P1** |
| R3  | `src-tauri/src/agent/control_plane/config_watcher.rs:228` | 每次文件事件 `std::thread::spawn` debounce thread（高频下无界） | **P1** |
| R4  | `src-tauri/src/hooks/team_watcher.rs:56`                  | `rx.recv_timeout(100ms)` 100ms 轮询而非 event-driven            | **P1** |
| R5  | `src-tauri/src/storage/durable_io.rs:129-131`             | 每次 journal write 都 `sync_data()` + `sync_directory()`        | **P1** |
| R6  | `src-tauri/src/storage/events.rs:213-214`                 | 每个 BusEvent 都 `writer.flush()`                               | **P1** |
| R7  | `src-tauri/src/commands/agents.rs:247,266`                | async handler 内 `std::fs::read_dir/read_to_string` 阻塞        | **P1** |
| R8  | `src-tauri/src/commands/cli_settings.rs:29,56`            | async handler 内同步 `canonicalize/read_to_string`              | **P1** |
| R9  | `src-tauri/src/storage/attention_queue.rs:55-78`          | 全局 QUEUE_LOCK 串行所有 attention queue 操作                   | **P1** |
| R10 | `src-tauri/src/commands/browser_runtime.rs:153`           | async handler 内同步 `create_dir_all`                           | P2     |

## 7. 动画/动效热点（P1/P2）

| #   | 文件:行                                               | 问题                                                                              | 严重度 |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| M1  | `SkeletonBlock.svelte:26`, `SkeletonCircle.svelte:16` | Tailwind `animate-pulse` **不受** `prefers-reduced-motion: reduce` 影响，无限脉冲 | **P1** |
| M2  | `StreamingSkeleton.svelte:56`                         | shimmer `animation: shimmer-slide 2s ... infinite` 即使 streaming 完成也不停      | **P1** |
| M3  | `route-transition.ts:21-24`                           | watchdog 1200ms setTimeout 即便导航成功也在 JS heap 持有 ~1.2s 闭包               | P2     |
| M4  | `StreamingSkeleton.svelte:36`                         | fade-in 动画的 reduced-motion 抑制依赖 per-component override，容易漏             | P2     |

## 8. 优化优先级（影响×风险）

按收益/风险比排：

1. **M1+M2** 动画 reduced-motion 修复（5 行 CSS）→ 立即低风险
2. **F4+F5+F6** markdown cache key 改为 prefix / sliding window → 中风险高收益（streaming 不再每 token 重 parse）
3. **F7** `_permScan.timelineRef` 改为 version 计数器 → 低风险
4. **R5+R6** 去掉每次事件/写入的 fsync/flush → 中风险高收益（高频 streaming 路径）
5. **R1** session_actor tick 250ms → 1000ms（hard timeout 60s 够用） → 低风险
6. **R2** governor ticker 动态 interval → 低风险
7. **R4** team_watcher 100ms 轮询改 event-driven → 中风险
8. **R7+R8** async handler 内同步 IO 改 spawn_blocking → 低风险高收益
9. **F1+F2** timelineMetadata / userHistory 改成依赖 length/version → 中风险
10. **F3** usageByTurn Map 改 in-place mutation → 低风险
11. **R3** config_watcher debounce 改 tokio::task::spawn_blocking 池化 → 中风险
12. **R9** attention_queue 改 partition-by-key 锁 → 高风险（业务层影响），留到最后
13. **CodeMirror lazy load**（chat 路由）→ 高收益但需要 FilePreviewPane 改造
14. **i18n message JSON lazy**（如果还没做）→ 中收益
15. **rAF 节流/批处理** streaming token batch → 中风险

## 9. 待确认/留待下阶段

- `app-visibility` 是否要在非 chat/history/workbench 路由下暂停 runs-sidebar polling？当前仅按 `visibilityState` gate。
- `team-subscription.svelte.ts:94` 的 100ms 间隔是不是必要的？
- `SplitChatPane.svelte:96` pollTimer 是否需要？
- `app-update-coordinator.svelte.ts:104` 更新检查间隔是多少？

## 10. 已记录的工件

- `artifacts/performance/baseline.json` — 现状（current）
- `artifacts/performance/baseline-legacy.json` — legacy 模式（对照）
- `artifacts/performance/current.json` — 优化后用于 perf:gate
