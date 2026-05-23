# 从 Claude Code 借鉴的设计模式 — MiWarp 落地报告

> 本报告基于对 MiWarp 代码库的深入分析，提出可从 Claude Code 设计理念中借鉴的设计改进。

---

## 一、当前 MiWarp 架构概览

### 1.1 核心架构特点

MiWarp 采用 **actor 模型** 管理 CLI 会话：

- **SessionActor** (`session_actor.rs`) — 单例拥有 CLI 进程 stdin/stdout 的生命周期
- **Turn Engine** (`turn_engine.rs`) — 管理 turn 的阶段和超时
- **事件流** — 前端通过 `invoke()` → Tauri IPC → Rust 命令处理器
- **状态管理** — Svelte 5 `$state`/`$derived` runes，单一 `SessionStore` 类集中管理状态

### 1.2 当前设计亮点（已值得保留）

| 设计 | 说明 |
|------|------|
| Actor Mailbox 模式 | 通过 bounded mpsc 保证顺序执行，无外部锁 |
| Quarantine 机制 | 超时后进入隔离状态，等待 CLI 输出 turn-boundary |
| Ralph Loop | 自动迭代执行相同提示直到满足完成条件 |
| 双协议支持 | Stream-JSON 和 Pipe/PTY 两种 CLI 通信模式 |
| Fork/Resume | 支持分叉和恢复会话 |
| 权限分层 | `acceptEdits`/`bypassPermissions`/`manual` 三级权限模式 |

---

## 二、可借鉴的设计改进

### 2.1 智能上下文管理

**Claude Code 特点：**
- 自动识别项目结构，智能选择相关上下文
- 基于文件变更动态调整上下文窗口
- 增量式上下文注入，而非全量重载

**MiWarp 现状：**
- `/context` 命令用于手动触发上下文收集
- Auto-context 功能当前被禁用（因 `/context` 在某些 API 代理下挂起）

**落地建议：**

```typescript
// 新增智能上下文管理器
// src/lib/chat/use-smart-context.svelte.ts

interface SmartContextConfig {
  maxTokens: number;         // 最大上下文 token 数
  priorityPatterns: RegExp[]; // 高优先级文件模式
  excludePatterns: RegExp[]; // 排除模式
  relevanceThreshold: number; // 相关性阈值
}

export function createSmartContext(config: SmartContextConfig) {
  // 1. 项目结构分析
  const analyzeProjectStructure = () => {
    // 分析 .gitignore, package.json, tsconfig.json 等推断项目类型
  };

  // 2. 增量上下文收集
  const collectIncrementalContext = async (
    changedFiles: string[],
    currentContext: string
  ) => {
    // 只收集变更文件及其依赖，而非全量扫描
  };

  // 3. 智能裁剪
  const smartTruncate = (context: string, maxTokens: number) => {
    // 保留文件开头、函数签名等高价值内容
  };

  return {
    analyzeProjectStructure,
    collectIncrementalContext,
    smartTruncate,
  };
}
```

---

### 2.2 改进的 Terminal/Composer 体验

**Claude Code 特点：**
- 键盘优先设计，所有操作可键盘完成
- 即时语法高亮和自动补全
- 命令预览（发送前显示完整命令）
- 多行编辑友好

**MiWarp 现状：**
- `PromptInput.svelte` 已有 slash command 菜单、文件附件、skill 选择等功能
- 支持多行输入和历史记录
- Git 分支显示

**落地建议 — Composer 增强：**

```typescript
// 1. 命令预览模式
// src/lib/components/ComposerPreview.svelte

interface ComposerPreviewProps {
  draft: string;
  attachments: Attachment[];
  onConfirm: () => void;
  onEdit: () => void;
}

// 在发送前显示完整消息预览，包含：
// - 格式化的 markdown 预览
// - 附件列表
// - 上下文注入预估
// - 相关文件预览
```

```typescript
// 2. 增量搜索增强
// src/lib/utils/enhanced-search.ts

interface SearchEnhancement {
  // 正则搜索支持
  regexSearch: (pattern: string, files: string[]) => SearchResult[];
  
  // 语义搜索（基于嵌入向量）
  semanticSearch: (query: string, files: string[]) => Promise<SearchResult[]>;
  
  // 搜索历史学习
  searchHistoryLearner: {
    recordSearch: (query: string, clickedFile: string) => void;
    suggestNextSearch: (context: string) => string[];
  };
}
```

---

### 2.3 更好的工具可视化

**Claude Code 特点：**
- 工具执行进度条
- 工具间依赖关系可视化
- 流式输出增强

**MiWarp 现状：**
- `ToolBurstCollapse` — 工具批量折叠
- `ToolDetailView` — 工具详情视图
- `PhaseIndicator` — 阶段指示器

**落地建议：**

```typescript
// 新增工具时间线和依赖可视化
// src/lib/components/ToolDependencyGraph.svelte

interface ToolNode {
  id: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  dependencies: string[];
  progress?: number; // 0-100 进度百分比
}

interface ToolTimelineProps {
  tools: ToolNode[];
  onExpandTool: (toolId: string) => void;
  onCancelTool: (toolId: string) => void;
}

// 可视化特性：
// 1. 甘特图风格的时间线
// 2. 依赖关系箭头
// 3. 并行执行可视化
// 4. 预估剩余时间
```

---

### 2.4 智能建议和自动完成

**Claude Code 特点：**
- 上下文感知的命令建议
- 基于历史的智能补全
- 代码片段生成

**MiWarp 现状：**
- `SlashMenu` — slash 命令菜单
- `AtMentionMenu` — @ 提及菜单（文件/项目）

**落地建议：**

```typescript
// 1. 增强的上下文感知建议
// src/lib/chat/use-context-aware-suggestions.svelte.ts

export function createContextAwareSuggestions({
  store,
  timeline,
  cwd,
}: {
  store: SessionStore;
  timeline: TimelineEntry[];
  cwd: string;
}) {
  // 分析最近对话推断下一步意图
  const inferNextIntent = () => {
    const recentTools = timeline
      .filter(e => e.kind === "tool")
      .map(e => e.tool.tool_name);
    
    // 基于工具序列推荐下一个可能需要的操作
    return suggestNextActions(recentTools);
  };

  // 代码片段生成
  const generateCodeSnippet = async (intent: string) => {
    // 调用 AI 生成代码片段
  };

  return {
    inferNextIntent,
    generateCodeSnippet,
  };
}
```

---

### 2.5 工作流程自动化

**Claude Code 特点：**
- 复杂任务分解为子任务
- 自动规划执行路径
- 进度追踪和恢复

**MiWarp 现状：**
- `RalphLoop` — 自动迭代机制
- `ScheduledTask` — 定时任务
- `TeamDispatch` — 团队调度

**落地建议 — 增强的任务分解器：**

```typescript
// src/lib/chat/use-task-decomposer.svelte.ts

interface DecomposedTask {
  id: string;
  description: string;
  estimatedSteps: number;
  completedSteps: number;
  dependencies: string[];
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export function createTaskDecomposer() {
  // 1. 任务分析
  const analyzeTask = async (userPrompt: string): Promise<DecomposedTask[]> => {
    // 调用 AI 将复杂任务分解为可执行的子任务
  };

  // 2. 执行调度
  const executeTask = async (task: DecomposedTask, context: ExecutionContext) => {
    // 逐步执行任务，保持上下文
  };

  // 3. 进度持久化
  const persistProgress = (taskId: string, completedSteps: number) => {
    // 保存进度到本地存储
  };

  return { analyzeTask, executeTask, persistProgress };
}
```

---

### 2.6 错误恢复和优雅降级

**Claude Code 特点：**
- 智能重试策略
- 部分成功处理
- 上下文保留的恢复

**MiWarp 现状：**
- Quarantine 机制处理超时
- Fork 支持从特定点恢复
- 错误消息收集和展示

**落地建议 — 增强的错误处理：**

```typescript
// src/lib/utils/resilient-error-handler.ts

interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  retryableErrors: string[];
}

interface ErrorRecoveryStrategy {
  // 自动分类错误
  classifyError: (error: Error) => "retryable" | "fatal" | "partial";
  
  // 智能重试
  smartRetry: (operation: () => Promise<T>, config: RetryConfig) => Promise<T>;
  
  // 部分成功处理
  handlePartialSuccess: (
    results: PartialResult[],
    userIntent: string
  ) => RecoveryAction;
  
  // 上下文保留恢复
  preserveContextAndRetry: (failedOp: Operation, context: Context) => Promise<Result>;
}
```

---

### 2.7 性能优化

**Claude Code 特点：**
- 虚拟化长列表
- 增量渲染
- 智能预取

**MiWarp 现状：**
- `VirtualList.svelte` — 虚拟列表
- `timeline` 分页加载
- `toolResultCache` — 工具结果缓存

**落地建议：**

```typescript
// 1. 增强的虚拟滚动
// src/lib/components/EnhancedVirtualList.svelte

interface VirtualListConfig {
  itemHeight: number | ((index: number) => number);
  overscan: number;  // 预渲染项数
  infiniteLoader: (offset: number) => Promise<Items[]>;
  initialLoadCount: number;
}
```

```typescript
// 2. 增量加载策略
// src/lib/chat/use-incremental-load.svelte.ts

export function createIncrementalLoad({
  store,
}: { store: SessionStore }) {
  // 根据视口动态调整加载量
  const adaptiveLoadCount = () => {
    const viewportHeight = window.innerHeight;
    // 在移动设备或低性能模式下减少预加载
  };
  
  // 预取下一页
  const prefetchNextPage = () => {
    // 当用户接近列表底部时预取下一页
  };
}
```

---

### 2.8 多模态增强

**Claude Code 特点：**
- 图片直接理解和编辑建议
- 设计稿自动转代码
- 截图分析

**MiWarp 现状：**
- 已支持多模态附件（图片、PDF）
- `AttachmentData` 处理 base64 编码的附件
- 文件大小限制和类型验证

**落地建议：**

```typescript
// 增强的多模态处理
// src/lib/chat/use-multimodal-processor.svelte.ts

interface MultimodalProcessor {
  // 图片智能标注
  annotateImage: (
    imageData: string,
    instruction: string
  ) => Promise<AnnotatedImage>;
  
  // UI 设计稿分析
  analyzeDesignScreenshot: (
    screenshot: string,
    platform: "web" | "ios" | "android"
  ) => Promise<UIAnalysis>;
  
  // 图表转代码
  chartToCode: (
    imageData: string,
    targetFormat: "html" | "react" | "vue"
  ) => Promise<string>;
}
```

---

## 三、实施路线图

### Phase 1: 基础增强（1-2 周）
1. Composer 预览模式
2. 增强的上下文感知建议
3. 工具依赖可视化

### Phase 2: 智能化（2-3 周）
1. 智能上下文管理器
2. 任务分解器
3. 错误恢复策略

### Phase 3: 高级特性（3-4 周）
1. 多模态增强
2. 性能优化
3. 工作流程自动化

---

## 四、风险和注意事项

1. **性能平衡** — 过于复杂的上下文管理可能影响响应速度
2. **API 兼容性** — 确保新功能不破坏现有 CLI 协议
3. **用户隐私** — 上下文分析涉及文件内容，需注意数据安全
4. **向后兼容** — 保持与现有功能的兼容性

---

## 五、总结

MiWarp 已经具备坚实的技术基础，借鉴 Claude Code 的设计理念可以进一步提升用户体验和功能性。重点改进方向：

1. **智能上下文管理** — 减少用户手动干预
2. **工具可视化** — 更清晰的操作反馈
3. **错误恢复** — 更健壮的执行流程
4. **性能优化** — 更流畅的交互体验

建议从 Phase 1 开始实施，逐步迭代完善。
