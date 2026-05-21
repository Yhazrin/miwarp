# 从 Claude Cowork / Codex 学习的设计模式落地建议

## 背景

本报告分析 Claude Cowork 模式中值得借鉴的设计，并提出在 MiWarp 项目中落地的具体建议。MiWarp 是一个 Tauri v2 桌面应用，封装 AI 编码 CLI（Claude Code、Codex），提供可视化聊天界面、会话管理和活动监控。

---

## 一、Cowork 核心能力概览

### 1.1 交互式问答工具 (AskUserQuestion)
Cowork 实现了交互式问答机制，用于在执行复杂任务前收集用户输入。用户通过选择题界面提供答案，系统据此调整执行计划。

**MiWarp 现状:**
- 目前前端通过 UI Modal 组件收集用户输入
- 缺少统一的交互式问答抽象层

**落地建议:**
```typescript
// src/lib/components/AskQuestion.svelte
// 参考 Cowork 的多选题交互模式

interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

interface QuestionSpec {
  question: string;
  options: QuestionOption[];
  defaultIndex?: number;
}

// 在 SkillStore 或新模块中实现
async function askUserQuestion(spec: QuestionSpec): Promise<string | null> {
  // 展示交互式卡片
  // 等待用户选择
  // 返回选中的 value
}
```

### 1.2 文件呈现卡片 (present_files)
Cowork 的 `mcp__cowork__present_files` 将文件以交互卡片形式展示，用户可以直接在聊天中查看、下载或执行操作。

**MiWarp 现状:**
- 文件通过链接形式分享（`computer://` 协议）
- 缺少富媒体卡片展示

**落地建议:**
```svelte
<!-- src/lib/components/FileCard.svelte -->
<script lang="ts">
  interface Props {
    file: FileMetadata;
    showActions?: boolean;
  }
  
  // 支持文件类型渲染:
  // - 图片: 缩略图预览
  // - 代码: 语法高亮
  // - 文档: 摘要提取
  // - PDF: 页面预览
</script>

<!-- 交互式卡片设计:
  - 文件图标 + 文件名
  - 文件大小 + 修改时间
  - 快速操作按钮: 打开/复制/删除
  - 支持拖拽
-->
```

### 1.3 技能系统 (Skill System)
Cowork 使用 `.skill` 文件（zip 格式的 SKILL.md）存储技能定义，支持安装、分享和执行。

**MiWarp 现状:**
- 已有 `SkillStore` 和内置技能（schedule, consolidate-memory, setup-cowork）
- 技能内容以字符串形式内联在代码中
- 缺少技能文件导入/导出机制

**落地建议:**
```typescript
// 1. 定义 .skill 文件格式
interface SkillFile {
  "name": string;
  "description": string;
  "trigger": string[];        // 如 ["/schedule", "every day"]
  "category": string;
  "icon": string;
  "content": string;           // Markdown 格式的技能说明
  "author": string;
  "version": string;
}

// 2. 技能服务扩展
class SkillService {
  async importSkill(file: File): Promise<Skill>;
  async exportSkill(skillId: string): Promise<Blob>; // 导出 .skill 文件
  async searchMarketplace(query: string): Promise<Skill[]>;
}

// 3. 支持从文件导入技能
// 在 SkillStore.createSkill 中支持导入 .skill 文件
```

### 1.4 定时任务系统 (Scheduled Tasks)
Cowork 的定时任务基于 cron 表达式，支持一次性触发和周期性执行，任务失败时通知用户。

**MiWarp 现状:**
- 已有完整的 `ScheduledTasksStore` 和 Rust 后端 scheduler
- 支持 cron 表达式和一次性触发
- 有 `runTaskNow` 手动执行

**落地建议 - 增强功能:**
```typescript
// 1. 任务依赖链
interface ScheduledTaskPatch {
  dependsOn?: string[];           // 依赖的其他任务 ID
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

// 2. 任务通知偏好
interface ScheduledTaskInput {
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  webhookUrl?: string;            // Webhook 回调
}

// 3. 任务执行日志搜索
async searchTaskRuns(taskId: string, query: string): Promise<LogEntry[]>;
```

### 1.5 浏览器自动化 (Browser Automation)
Cowork 通过 Chrome MCP 实现完整的浏览器自动化能力。

**MiWarp 现状:**
- 有 `preview.rs`, `screenshot.rs` 基础功能
- 有 `remote_fs.rs` 远程文件系统访问
- 缺少完整的浏览器自动化套件

**落地建议 - Phase 1 (基础能力):**
```rust
// src-tauri/src/commands/browser.rs
#[tauri::command]
pub async fn browser_navigate(
    tab_id: u32,
    url: String,
    options: NavigateOptions,
) -> Result<()>;

// 需要的命令:
- browser_navigate: 导航到 URL
- browser_click: 点击元素
- browser_type: 输入文本
- browser_screenshot: 截屏
- browser_evaluate_js: 执行 JavaScript
- browser_read_dom: 读取 DOM 内容
```

### 1.6 插件系统 (Plugin System)
Cowork 的插件系统将 MCP 工具打包为可安装的插件bundle。

**MiWarp 现状:**
- 已有 `plugin-store.svelte.ts` 和 `plugins.rs`
- 支持 MCP 服务器注册

**落地建议:**
```typescript
// 1. 插件包定义
interface PluginBundle {
  id: string;
  name: string;
  description: string;
  version: string;
  skills: Skill[];
  mcpServers?: MCPServerConfig[];
  commands?: PluginCommand[];
  icon: string;
}

// 2. 插件市场搜索
async searchPlugins(query: string, filters: PluginFilters): Promise<PluginBundle[]>;

// 3. 插件安装向导
// 集成到 SetupWizard 中，引导用户安装相关插件
```

---

## 二、架构层面的借鉴

### 2.1 传输层抽象
Cowork 使用传输层抽象（Tauri IPC vs WebSocket），MiWarp 已有类似设计（`getTransport()`）。

**评估:** MiWarp 传输层设计已成熟，无需大幅修改。

### 2.2 事件驱动架构
Cowork 的事件系统基于 Tauri 的 `app.emit()` 和 WebSocket 中继。

**MiWarp 现状:**
- 已有 `BroadcastEmitter` 和事件 middleware
- `event-middleware.ts` 路由协议事件到 store

**可以借鉴的模式:**
```typescript
// 事件命名规范（参考 ocv: 前缀）
interface CoworkEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

// 事件类型枚举
const EventTypes = {
  SESSION_START: "session:start",
  SESSION_END: "session:end",
  TASK_UPDATE: "task:update",
  FILE_CHANGE: "file:change",
  NOTIFICATION: "notification:show",
} as const;
```

### 2.3 状态管理模式
Cowork 使用 Svelte 5  runes（`$state`, `$derived`），MiWarp 同样采用。

**评估:** 架构一致，无需修改。

---

## 三、具体实现建议

### 3.1 高优先级改进

#### P0: 交互式问答卡片
在 `src/lib/components/` 创建 `AskQuestion.svelte`，统一处理需要用户确认的场景：
- 确认删除操作
- 选择操作选项
- 批量操作预览

#### P0: 文件卡片组件
创建 `FileCard.svelte`，提升文件分享体验：
- 根据文件类型显示预览
- 支持右键菜单操作
- 拖拽排序

#### P1: 技能文件格式
定义 `.skill` 文件标准，支持导入/导出：
- 创建 `src/lib/types/skill-file.ts` 类型定义
- 在 SkillStore 添加 `importSkill()` 和 `exportSkill()` 方法

### 3.2 中期改进

#### P2: 浏览器自动化
逐步完善 `browser.rs` 命令：
1. 基础：截图、DOM 读取
2. 进阶：表单填写、元素交互
3. 完整：录制回放、工作流自动化

#### P2: 插件市场集成
完善插件发现和安装流程：
1. 实现 `searchPlugins()` API
2. 创建插件卡片展示组件
3. 集成到 SetupWizard

### 3.3 长期改进

#### P3: 多 Agent 协作
参考 Cowork 的多 Agent 模式，增强 Team 功能：
- Agent 间消息传递
- 任务委派和追踪
- 共享上下文管理

---

## 四、实施路径

### Phase 1: 用户体验增强（1-2 周）
1. 实现 `AskQuestion.svelte` 组件
2. 实现 `FileCard.svelte` 组件
3. 集成到现有 UI 中

### Phase 2: 技能系统完善（2-3 周）
1. 定义 `.skill` 文件格式
2. 实现技能导入/导出
3. 添加技能市场浏览功能

### Phase 3: 自动化能力（持续迭代）
1. 浏览器自动化基础命令
2. 插件系统增强
3. 多 Agent 协作

---

## 五、代码示例

### 5.1 AskQuestion 组件
```svelte
<!-- src/lib/components/AskQuestion.svelte -->
<script lang="ts">
  interface Option {
    label: string;
    value: string;
    description?: string;
    icon?: string;
  }
  
  interface Props {
    question: string;
    options: Option[];
    onAnswer: (value: string) => void;
    onCancel?: () => void;
    defaultIndex?: number;
  }
  
  let { question, options, onAnswer, onCancel, defaultIndex = 0 }: Props = $props();
  let selectedIndex = $state(defaultIndex);
</script>

<div class="ask-question">
  <p class="question-text">{question}</p>
  
  <div class="options-list">
    {#each options as option, i}
      <button
        class="option-button"
        class:selected={selectedIndex === i}
        onclick={() => onAnswer(option.value)}
      >
        <span class="option-icon">{option.icon || '○'}</span>
        <span class="option-label">{option.label}</span>
        {#if option.description}
          <span class="option-desc">{option.description}</span>
        {/if}
      </button>
    {/each}
  </div>
  
  {#if onCancel}
    <button class="cancel-btn" onclick={onCancel}>取消</button>
  {/if}
</div>

<style>
  .ask-question {
    padding: 1rem;
    max-width: 400px;
  }
  
  .question-text {
    font-weight: 500;
    margin-bottom: 1rem;
  }
  
  .options-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .option-button {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }
  
  .option-button:hover {
    border-color: var(--primary);
  }
  
  .option-button.selected {
    border-color: var(--primary);
    background: var(--primary-alpha);
  }
  
  .option-icon {
    font-size: 1.25rem;
  }
  
  .option-label {
    font-weight: 500;
  }
  
  .option-desc {
    display: block;
    font-size: 0.875rem;
    color: var(--muted);
  }
</style>
```

### 5.2 FileCard 组件
```svelte
<!-- src/lib/components/FileCard.svelte -->
<script lang="ts">
  interface Props {
    file: {
      name: string;
      path: string;
      size?: number;
      modifiedAt?: string;
      type: 'image' | 'document' | 'code' | 'other';
    };
    onOpen?: () => void;
    onDelete?: () => void;
    onCopy?: () => void;
  }
  
  let { file, onOpen, onDelete, onCopy }: Props = $props();
  
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  
  const iconMap = {
    image: '🖼️',
    document: '📄',
    code: '💻',
    other: '📁',
  };
</script>

<div class="file-card">
  <button class="file-icon" onclick={onOpen}>
    {iconMap[file.type]}
  </button>
  
  <div class="file-info">
    <span class="file-name">{file.name}</span>
    <span class="file-meta">
      {#if file.size}
        {formatSize(file.size)}
      {/if}
      {#if file.modifiedAt}
        · {new Date(file.modifiedAt).toLocaleDateString()}
      {/if}
    </span>
  </div>
  
  <div class="file-actions">
    <button onclick={onOpen} title="打开">打开</button>
    <button onclick={onCopy} title="复制路径">复制</button>
    <button onclick={onDelete} title="删除">删除</button>
  </div>
</div>
```

---

## 六、总结

Cowork/Codex 的设计模式中有许多值得 MiWarp 借鉴之处：

1. **交互式问答** - 提升用户体验，统一用户输入模式
2. **文件卡片** - 现代化的文件展示和操作
3. **技能文件格式** - 便于技能分享和导入
4. **插件系统** - 扩展生态系统的可维护性

建议按优先级逐步落地，Phase 1 聚焦用户体验改进，Phase 2 完善技能系统，Phase 3 发展自动化能力。

---

*报告生成时间: 2026/05/21*
*分析基于: MiWarp 代码库结构和 Claude Cowork 能力描述*