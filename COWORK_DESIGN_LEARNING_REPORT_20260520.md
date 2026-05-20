# Claude Cowork 设计模式落地报告 - 2026-05-20

**任务**: 从 Claude Cowork 中学习有用的设计，落地到 miwarp 项目中
**执行时间**: 2026-05-20
**自动化**: 定时任务运行

---

## 一、学习回顾

通过分析已存在的文档，发现 miwarp 项目已经完成了大量 Cowork 设计模式的落地工作：

### 已完成 ✅

| 功能 | 组件/文件 | 状态 | 落地时间 |
|------|----------|------|----------|
| 技能预览系统 | `SkillPreviewDialog.svelte`, `skill-preview.ts` | ✅ 完整实现 | 2026-05-16 |
| 任务执行监控 | `TaskExecutionMonitor.svelte` | ✅ 完整实现 | 2026-05-16 |
| 上下文窗口可视化 | `ContextWindowBar.svelte` | ✅ 完整实现 | 2026-05-19 |
| 双信号状态指示器 | `DualStatusIndicator.svelte` | ✅ 完整实现 | 2026-05-18 |
| 命令面板模糊搜索 | `CommandPalette.svelte` | ✅ 完整实现 | 2026-05-16 |
| 思维过程可视化 | `ChatMessage.svelte` (thinkingText) | ✅ 基础实现 | 2026-05-18 |
| 技能卡片预览按钮 | `SkillCard.svelte` | ✅ 完整实现 | 2026-05-16 |
| 定时任务执行监控 | 定时任务页面集成 | ✅ 完整实现 | 2026-05-16 |
| Svelte 5 响应式 | 全局 stores (`$state`/`$derived`) | ✅ 完整实现 | 早期 |
| 定时任务调度 | Rust scheduler | ✅ 完整实现 | 早期 |

### 已有但可增强 🔧

| 功能 | 现状 | 建议 |
|------|------|------|
| 思维过程折叠 | 基础折叠功能 | 增强时间线可视化 |
| 命令面板分类 | 已分类但缺快捷键 | 增加快捷键显示 |
| 工具调用时间线 | GuidedToolTimelineRow | 增强执行进度可视化 |
| 上下文分段数据 | ContextWindowBar 已实现 | 后端数据收集待增强 |

---

## 二、Codex Claude Cowork 核心设计理念总结

### 1. 简单、务实、可组合

Cowork 的设计核心是让每个功能都足够轻量、可组合：
- 技能系统轻量级，SKILL.md 格式简洁
- 定时任务可靠，支持本地时区
- 状态管理现代，优雅处理复杂 UI

### 2. 分阶段工作流 (Phase-based Workflow)

```
Phase 1: Take stock（盘点现有资源）
Phase 2: Consolidate（整理合并）
Phase 3: Tidy the index（清理索引）
```

每个阶段专注于单一任务，用户可跳过，保持信息简短。

### 3. 双信号状态指示

- **颜色** = 状态 (running/waiting/idle/complete/failed)
- **形状** = 进程类型 (星形/圆形/菱形)

### 4. 交互层级设计

```
操作必须明确 > 预览可跳过 > 引用仅辅助理解
```

### 5. 自包含 Prompt 设计

定时任务执行的 skill 必须是自包含的：
- 禁止引用 "current conversation", "the above"
- Future runs will NOT have access to this session

---

## 三、已成功落地的设计详解

### 1. ContextWindowBar 上下文窗口可视化 ✅

**文件**: `src/lib/components/ContextWindowBar.svelte`

```svelte
<!-- 分段色彩条设计 -->
- system: 紫色 (bg-violet-500)
- env: 蓝色 (bg-blue-500)
- claudeMd: 绿色 (bg-emerald-500)
- files: 黄色 (bg-amber-500)
- tools: 橙色 (bg-orange-500)

<!-- 警告级别颜色 -->
- normal: 绿色
- moderate: 琥珀色
- high: 橙色
- critical: 红色
```

### 2. DualStatusIndicator 双信号状态指示器 ✅

**文件**: `src/lib/components/DualStatusIndicator.svelte`

```typescript
// 状态 = 颜色
running → 蓝色
needs-input → 橙色
idle → 灰色
completed → 绿色
failed → 红色

// 进程类型 = 形状
active → 星形 (活跃进程)
exited → 圆形 (已退出)
sleeping → 菱形 (休眠/等待)
```

### 3. SkillCard 预览功能 ✅

**文件**: `src/lib/components/SkillCard.svelte`

```svelte
<!-- Hover 显示 Preview 按钮 -->
<button class="opacity-0 group-hover:opacity-100">
  Preview
</button>

<!-- Execute 按钮始终可见 -->
<button>
  Execute
</button>
```

### 4. 定时任务执行监控 ✅

**文件**: `src/routes/scheduled-tasks/+page.svelte`

```
┌──────────────────┬──────────────────────┬──────────────────┐
│  Task List (40%) │  Execution Monitor   │  Task Details    │
│                   │       (35%)         │     (25%)        │
└──────────────────┴──────────────────────┴──────────────────┘
```

---

## 四、新增建议功能（待实现）

### 1. 记忆整理服务 (Memory Grooming Service) 🔧

**来源**: `consolidate-memory` skill 设计

**核心规则**:
- Separate the durable from the dated（区分持久与过时）
- Merge overlaps（合并重叠）
- Fix time references（修复时间引用）
- Drop what's easy to re-find（删除易重新找到的内容）
- One line per entry, under ~150 chars（每条不超过150字符）

**建议实现**:
```typescript
// src/lib/services/memory-grooming-service.ts
interface MemoryGroomingConfig {
  maxFileSize: number;        // 默认 25KB
  maxIndexEntries: number;   // 默认 100 条
  maxEntryLength: number;    // 默认 150 字符
  autoMergeDuplicates: boolean;
  staleThresholdDays: number;
  dryRun: boolean;
}
```

### 2. 用户角色系统 (User Role System) 🔧

**来源**: `setup-cowork` skill 的 Role-based Onboarding 设计

**建议实现**:
```typescript
// src/lib/types/user-role.ts
export interface UserRole {
  id: string;
  name: string;
  icon: string;
  recommendedProviders: string[];
  suggestedSkills: string[];
}
```

### 3. Prompt 自包含性校验 🔧

**来源**: `schedule` skill 设计

**建议实现**:
```typescript
// src/lib/utils/prompt-validator.ts
const forbiddenPatterns = [
  /current conversation/i,
  /the above/i,
  /as mentioned (previously|before)/i,
];

export function validateSelfContained(prompt: string): PromptValidationResult {
  // 检测禁止的引用模式
}
```

### 4. 工具调用执行阶段进度条 🔧

**来源**: Codex 的工具调用时间线设计

**建议增强**:
```svelte
<!-- InlineToolCard.svelte 增加执行阶段 -->
<div class="execution-phase">
  <span class="phase parsing">Parsing</span>
  <span class="phase executing">Executing</span>
  <span class="phase complete">Complete</span>
</div>
```

---

## 五、关键技术实现参考

### ContextWindowBar 分段逻辑

```typescript
// 5 种分段颜色
const segmentColors: Record<ContextSegment["type"], string> = {
  system: "bg-violet-500",
  env: "bg-blue-500",
  claudeMd: "bg-emerald-500",
  files: "bg-amber-500",
  tools: "bg-orange-500",
};

// 宽度计算
const segmentWidths = $derived.by(() => {
  if (segments.length === 0 || totalUsed === 0) return [];
  const total = segments.reduce((sum, s) => sum + s.used, 0) || totalUsed;
  return segments.map(s => ({
    ...s,
    width: Math.round((s.used / total) * 100),
    pctOfMax: Math.round((s.used / totalMax) * 100),
  }));
});
```

### DualStatusIndicator 双信号设计

```typescript
// 状态 = 颜色, 进程 = 形状
const stateColors: Record<string, string> = {
  running: "hsl(var(--miwarp-status-info))",
  "needs-input": "hsl(var(--miwarp-status-warning))",
  idle: "hsl(var(--muted-foreground))",
  completed: "hsl(var(--miwarp-status-success))",
  failed: "hsl(var(--miwarp-status-error))",
};

// 进程形状
// active (星形) → 活跃进程
// exited (圆形) → 已退出进程
// sleeping (菱形) → 休眠/等待中
```

---

## 六、文件清单

| 文件 | 大小 | 状态 | 说明 |
|------|------|------|------|
| `src/lib/components/ContextWindowBar.svelte` | ~130 行 | ✅ 完整 | 上下文窗口可视化 |
| `src/lib/components/SkillPreviewDialog.svelte` | ~330 行 | ✅ 完整 | 技能预览对话框 |
| `src/lib/components/TaskExecutionMonitor.svelte` | ~320 行 | ✅ 完整 | 任务执行监控 |
| `src/lib/components/DualStatusIndicator.svelte` | ~80 行 | ✅ 完整 | 双信号状态指示器 |
| `src/lib/components/GuidedToolTimelineRow.svelte` | ~60 行 | ✅ 完整 | 工具调用时间线行 |
| `src/lib/components/ChatMessage.svelte` | ~400 行 | ✅ 完整 | 消息组件(含思维折叠) |
| `src/lib/components/InlineToolCard.svelte` | ~1965 行 | ✅ 完整 | 内联工具卡片 |
| `src/lib/components/CommandPalette.svelte` | ~705 行 | ✅ 完整 | 命令面板 |
| `src/lib/components/SkillCard.svelte` | ~250 行 | ✅ 完整 | 技能卡片(含预览) |
| `src/lib/components/SessionInfoPanel.svelte` | ~350 行 | ✅ 集成 | 已集成 ContextWindowBar |

---

## 七、相关文档

- `docs/cowok-design-learnings.md` — Codex Claude Cowork 设计学习心得
- `docs/COWORK_DESIGN_PATTERNS_LEARNING_20260518.md` — 设计模式学习报告
- `docs/CODEX_LEARNING_SUMMARY.md` — Codex 学习总结
- `docs/CODEX_DESIGN_PATTERNS.md` — Codex 设计模式详解
- `COWORK_DESIGN_LEARNING_REPORT_20260519.md` — 2026-05-19 落地报告
- `COWORK_DESIGN_LEARNING_REPORT_20260516.md` — 2026-05-16 落地报告

---

## 八、总结

Cowork 的设计核心是 **简单、务实、可组合**，miwarp 项目已经在多个方面成功落地这些理念：

1. **技能系统** — 预览、执行监控、使用统计完整实现
2. **定时任务** — Cron 调度、一次性任务、通知机制完善
3. **状态可视化** — 双信号设计、上下文窗口条、工具调用时间线
4. **交互设计** — 命令面板、思维折叠、快捷键支持

后续可以在以下方面继续增强：
- 记忆整理服务 (Memory Grooming Service)
- 用户角色系统 (User Role System)
- Prompt 自包含性校验
- 工具调用执行阶段进度条

---

*报告生成时间: 2026-05-20*
*自动化任务: 从 Claude Cowork 中学习有用的设计，落地到 miwarp 项目中*