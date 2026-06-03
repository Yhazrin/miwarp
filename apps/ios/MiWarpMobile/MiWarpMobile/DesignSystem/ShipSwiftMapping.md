# ShipSwift → MiWarp 组件映射分析

## 概览

本分析评估 8 个 ShipSwift SwiftUI 组件，确定哪些适合引入 MiWarp iOS 设计系统。

---

## 1. Ring Chart → MWTaskProgressRing

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ✅ 是，但需简化 |
| **使用场景** | Live Activity 进度环、Session 同步状态、任务完成状态 |
| **依赖文件** | 仅 SwiftUI，无外部依赖 |
| **改造难度** | 低 — ShipSwift 实现已是自包含，可直接改造 |
| **风险** | 低 — 纯 SwiftUI，无副作用 |
| **MiWarp 命名** | `MWTaskProgressRing` |
| **关键改造点** | 单环而非多环、支持 completed/failed 状态、使用 MWColors 语义色 |

**决策**: 引入。Live Activity 已有 `MiWarpRingProgressView`，新组件作为通用版本。

---

## 2. Thinking Indicator → MWThinkingIndicator

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ✅ 是 |
| **使用场景** | Chat 消息流中 AI "thinking" 状态、Agent 运行中状态 |
| **依赖文件** | 仅 SwiftUI，无外部依赖 |
| **改造难度** | 很低 — ShipSwift 实现仅约 30 行 |
| **风险** | 极低 — 纯展示组件 |
| **MiWarp 命名** | `MWThinkingIndicator` |
| **关键改造点** | 支持 small/medium 尺寸、使用 `accessibilityReduceMotion` 尊重 Reduce Motion |

**决策**: 引入。Chat 界面当前使用简单 ProgressView，此组件更符合品牌调性。

---

## 3. Status Badge → MWStatusBadge / MWStatusDot

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ✅ 是 |
| **使用场景** | Session 列表状态、Connection 状态、Run 状态 |
| **依赖文件** | 仅 SwiftUI，无外部依赖 |
| **改造难度** | 低 — 现有 `MWStatusPill` 可参考 |
| **风险** | 低 — 纯展示组件 |
| **MiWarp 命名** | `MWStatusBadge`（胶囊） / `MWStatusDot`（圆点） |
| **关键改造点** | 状态枚举与 MiWarp 语义对齐（connected/disconnected/syncing/running 等） |

**决策**: 引入。替换/增强现有 `MWStatusPill`，提供 dot 和 badge 两种形式。

---

## 4. Alert Toast → MWToast

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ⚠️ 暂缓 |
| **使用场景** | 网络错误、连接状态变更、操作反馈 |
| **依赖文件** | 仅 SwiftUI，无外部依赖 |
| **改造难度** | 低 |
| **风险** | 中 — 全局 toast overlay 可能与现有 UX 模式冲突 |
| **MiWarp 命名** | `MWToastManager` |
| **关键改造点** | 需要评估是否与现有 banner/alert 模式冲突 |
| **暂缓原因** | MiWarp 已有 `MWReconnectBanner` 等临时反馈组件，暂不需要全局 toast |

**决策**: 暂缓。第一阶段不引入。

---

## 5. Search Bar → MWCapsuleSearchBar

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ❌ 暂不需要 |
| **使用场景** | 未来可能的搜索功能 |
| **依赖文件** | 仅 SwiftUI |
| **改造难度** | 无 |
| **风险** | 无 |
| **MiWarp 命名** | `MWCapsuleSearchBar` |
| **暂缓原因** | 当前无搜索 UI 需求，可后续按需引入 |

**决策**: 不引入（当前不需要）。

---

## 6. KPI Card → MWKPIStatCard

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ❌ 暂不需要 |
| **使用场景** | Dashboard / Analytics 展示 |
| **依赖文件** | 仅 SwiftUI |
| **改造难度** | 低 |
| **风险** | 无 |
| **MiWarp 命名** | `MWKPIStatCard` |
| **暂缓原因** | MiWarp 是 Agent 会话管理工具，非 Dashboard 应用，暂无 KPI 展示需求 |

**决策**: 不引入（当前不需要）。

---

## 7. Shimmer → MWShimmer

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ⚠️ 暂缓 |
| **使用场景** | 内容加载占位符 |
| **依赖文件** | 仅 SwiftUI |
| **改造难度** | 低 |
| **风险** | 低 — 纯展示效果 |
| **MiWarp 命名** | `MWShimmer` |
| **暂缓原因** | 暂缓，后续如有内容加载状态需求可引入 |

**决策**: 暂缓（未来可引入）。

---

## 8. Gradient Divider → MWGradientDivider

| 维度 | 评估 |
|------|------|
| **是否建议引入** | ⚠️ 谨慎引入 |
| **使用场景** | Section 分隔、Hero 区域装饰 |
| **依赖文件** | 仅 SwiftUI |
| **改造难度** | 极低 — 仅 20 行 |
| **风险** | 低 — 装饰性组件 |
| **MiWarp 命名** | `MWGradientDivider` |
| **关键改造点** | 颜色使用 MWColors.accentPrimary 而非硬编码 |
| **注意事项** | 避免在主流程中滥用，只用于 Hero 或特殊区域 |

**决策**: 可选引入，但优先级低。

---

## 总结：P0 引入清单

| 组件 | 优先级 | 状态 |
|------|--------|------|
| MWTaskProgressRing | P0 | ✅ 引入 |
| MWThinkingIndicator | P0 | ✅ 引入 |
| MWStatusBadge / MWStatusDot | P0 | ✅ 引入 |
| MWToast | P1 | ⚠️ 暂缓 |
| MWCapsuleSearchBar | P2 | ❌ 不引入 |
| MWKPIStatCard | P2 | ❌ 不引入 |
| MWShimmer | P2 | ⚠️ 暂缓 |
| MWGradientDivider | P3 | 可选 |

---

## 未复制但参考的 ShipSwift 组件

以下组件被评估但未复制：

- **Plasma / Liquid Chrome / Liquid Metal** — 炫技背景动画，不适合 MiWarp 主流程
- **Starfield / Water / Ink Smoke / Fractal Clouds** — 同上
- **Auth / Cognito** — 与 MiWarp 无关
- **Infra / CDK** — 与 MiWarp 无关
- **Paywall** — 与 MiWarp 无关
- **Full Chat Module** — MiWarp 有自己的 Chat 实现

---

## 参考来源

- ShipSwift MCP Server: `https://api.shipswift.app/mcp`
- GitHub: `https://github.com/signerlabs/ShipSwift`
