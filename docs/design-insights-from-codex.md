# MiWarp 学习心得：Codex/Claude Code 设计借鉴报告

## 一、项目现状分析

### 技术架构
MiWarp 是一个成熟的 Tauri v2 桌面应用，底层使用 Svelte 5 + Rust，构建了完整的 AI 编程 CLI 可视化界面。

### 现有核心功能
| 模块 | 描述 | 代码位置 |
|------|------|----------|
| 会话管理 | Session actor 模型管理 CLI 生命周期 | `src-tauri/src/agent/` |
| 协议解析 | 支持 Claude Stream-JSON 和 Codex NDJSON | `claude_protocol.rs`, `codex_parser.rs` |
| 工具卡片 | 三级渲染的 InlineToolCard 组件 | `src/lib/components/InlineToolCard.svelte` |
| 权限系统 | ExitPlanMode、AskUserQuestion 等完整权限流 | InlineToolCard 中实现 |
| 多 Agent | multi-agent 并行执行框架 | `src/routes/multi-agent/` |
| i18n | 中英双语支持 | `src/lib/i18n/` |

---

## 二、可借鉴的设计模式

### 2.1 工具渲染层 (Tool Rendering)

**当前实现：** InlineToolCard.svelte 已有三级渲染（Level 1/2/3），支持折叠展开、权限响应、延迟加载。

**可增强：**
1. **工具分类分组** - 将工具按功能分组（文件操作、搜索、代码生成），支持折叠整组
2. **工具执行时间线** - 添加甘特图式的时间线视图，直观显示并行/串行执行
3. **智能摘要算法** - 目前的 `toolSummary` 可以更智能，例如检测批量操作并合并显示

```typescript
// 建议：添加批量操作识别
function detectBatchOperation(tool: BusToolItem): boolean {
  const input = tool.input;
  return (
    (tool.tool_name === "Bash" && (input?.command as string)?.includes("&&")) ||
    (tool.tool_name === "Edit" && Array.isArray(input?.edits))
  );
}
```

### 2.2 消息与思考过程 (Thinking Display)

**当前实现：** ChatMessage.svelte 渲染消息内容，支持 thinking text（思考过程）。

**可增强：**
1. **分层思考展示** - Claude Code 的 thinking block 支持折叠/展开，可添加层级结构
2. **思考过程统计** - 显示思考 token 占比，帮助用户理解模型行为
3. **流式思考动画** - 正在思考时显示打字机效果的省略号动画

```svelte
<!-- 建议：增强思考显示 -->
{#if thinkingText && showThinking}
  <div class="thinking-block rounded-lg bg-muted/50 p-3 mt-2">
    <div class="flex items-center gap-2 text-xs text-muted-foreground mb-2">
      <svg class="h-3 w-3 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <span>{t('chat_thinking')}</span>
      {#if thinkingMs}
        <span class="ml-auto">{thinkingMs}ms</span>
      {/if}
    </div>
    <pre class="text-xs text-muted-foreground/80 whitespace-pre-wrap">{thinkingText}</pre>
  </div>
{/if}
```

### 2.3 命令面板 (Command Palette)

**当前实现：** CommandPalette.svelte 存在，支持快捷命令。

**可增强：**
1. **模糊搜索** - 使用 Levenshtein 距离或 Fuse.js 实现容错搜索
2. **命令分类** - 按类型分组（会话、文件、设置、工具）
3. **最近使用** - 记住最近使用的命令
4. **命令预览** - 输入参数时显示实时预览

```typescript
// 建议：添加命令缓存
const recentCommands = $state<string[]>([]);

function executeCommand(cmd: Command) {
  recentCommands = [cmd.id, ...recentCommands.filter(c => c !== cmd.id)].slice(0, 10);
  // 执行命令...
}
```

### 2.4 多 Agent 协作 (Multi-Agent)

**当前实现：** multi-agent/+page.svelte 有预设任务和自定义执行。

**可借鉴 Codex 的多会话设计：**
1. **任务池模式** - 主 agent 分解任务后放入池，子 agent 抢夺执行
2. **结果聚合** - 智能合并多个 agent 的输出，避免重复
3. **冲突检测** - 检测多个 agent 对同一文件的修改，提示用户决策
4. **通信协议** - Agent 间消息传递的标准化格式

```typescript
// 建议：任务池接口
interface TaskPool {
  addTask(task: Task): void;
  claimTask(agentId: string): Task | null;
  completeTask(taskId: string, result: Result): void;
  getStatus(): PoolStatus;
}
```

### 2.5 上下文管理 (Context Management)

**当前实现：** 有 contextWindow 和 token 统计。

**可增强：**
1. **上下文使用可视化** - 饼图或进度条显示 context 使用情况
2. **智能上下文裁剪** - 自动建议可以移除的上下文（如旧对话）
3. **文件重要性评分** - 根据修改频率和引用次数评分

```typescript
// 建议：上下文评分
interface ContextItem {
  id: string;
  type: 'file' | 'message' | 'artifact';
  importance: number; // 0-100
  tokenCount: number;
}

function calculateImportance(item: ContextItem): number {
  // 基于访问时间、引用次数、文件类型等计算
}
```

### 2.6 MCP (Model Context Protocol)

**当前实现：** McpConfiguredPanel.svelte, McpDiscoverPanel.svelte。

**可增强：**
1. **MCP 工具热力图** - 显示哪些 MCP 工具使用频率最高
2. **自动补全** - 在 prompt 输入时根据 MCP 工具自动补全
3. **MCP 沙箱** - 安全测试新 MCP 工具的隔离环境

### 2.7 对话导出与分享

**当前实现：** 有 export 命令。

**可增强：**
1. **Markdown 导出** - 带语法高亮的完整对话导出
2. **HTML 模板** - 漂亮的可分享 HTML 页面
3. **截图导出** - 直接导出为图片
4. **代码块导出** - 单独导出对话中的代码片段

### 2.8 性能优化

**可借鉴 Claude Code 的实现：**
1. **虚拟列表优化** - VirtualList.svelte 已存在，可进一步优化大数据量场景
2. **增量渲染** - 对长对话使用虚拟滚动，只渲染可见区域
3. **Web Worker** - 将协议解析移到 Worker 线程
4. **懒加载** - 非关键组件按需加载

```typescript
// 建议：Worker 协议解析
// worker/protocol-parser.worker.ts
self.onmessage = (e: MessageEvent) => {
  const { type, data } = e.data;
  const result = parseProtocol(type, data);
  self.postMessage({ type: 'parsed', result });
};
```

---

## 三、具体可落地的改进

### 高优先级

| 改进项 | 描述 | 预估工时 |
|--------|------|----------|
| 命令面板模糊搜索 | 使用 Fuse.js 实现容错搜索 | 1-2 天 |
| 思考过程折叠 | 支持层级折叠和统计 | 1 天 |
| 上下文进度条 | 可视化 context 使用 | 0.5 天 |
| 工具批量操作识别 | 合并显示批量操作 | 1 天 |

### 中优先级

| 改进项 | 描述 | 预估工时 |
|--------|------|----------|
| 任务池多 Agent | 实现任务抢夺和结果聚合 | 3-5 天 |
| Diff 可视化增强 | 更直观的文件变更展示 | 2-3 天 |
| MCP 工具热力图 | 使用统计可视化 | 2 天 |

### 低优先级

| 改进项 | 描述 | 预估工时 |
|--------|------|----------|
| 对话导出美化 | Markdown/HTML 模板 | 2 天 |
| 虚拟列表优化 | 大数据量场景优化 | 2-3 天 |
| Web Worker 解析 | Worker 线程协议解析 | 2 天 |

---

## 四、总结

MiWarp 已经是一个功能完善的 AI 编程 CLI 包装器，代码质量高，架构清晰。主要的提升空间在于：

1. **交互体验** - 命令面板、思考展示、工具渲染的细节打磨
2. **多 Agent 协作** - 任务池模式是 Codex/Claude Code 的强项
3. **性能优化** - 虚拟列表、Worker 线程等大规模场景优化
4. **可视化增强** - 上下文使用、工具执行时间线等

建议从高优先级的改进开始，逐步迭代。