# MiWarp x Codex Claude Cowork 设计学习报告

**生成日期**: 2026-05-21
**分析目标**: 从 Codex Claude Cowork 的设计模式中提取有价值的设计，落地到 MiWarp 项目

---

## 一、代码库现状分析

### 1.1 核心架构

MiWarp 是一个基于 Tauri v2 的桌面应用，采用前后分离架构：

| 层级 | 技术栈 |
|------|--------|
| 框架 | Tauri v2 (Rust 后端 + WebView) |
| 前端 | Svelte 5 + SvelteKit |
| 终端 | xterm.js |
| 测试 | Vitest |

### 1.2 已实现的核心功能

- **会话管理**: `session_actor.rs` 管理 CLI 生命周期
- **协议解析**: `claude_protocol.rs` / `codex_parser.rs` 处理流式 JSON
- **命令面板**: `CommandPalette.svelte` 带模糊搜索和历史记录
- **多 Agent**: `multi-agent-service.ts` 支持并行执行预设任务
- **工作流**: `workflow-store.svelte.ts` 预置开发/审查/自动化模板
- **Fork 机制**: `use-fork-lifecycle.ts` 支持会话分支和重试

---

## 二、Codex Claude Cowork 设计模式分析

### 2.1 流式协议设计

**Codex v0.98+ 的 NDJSON 格式**:

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"type":"command_execution","command":"ls","output":"..."}}
{"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N}}
```

**MiWarp 已实现**:
- `codex_parser.rs` 已支持 `item.completed` 类型的解析
- 支持 `agent_message` 和 `command_execution` 两种类型

**改进建议**:
1. 增加 `thinking` 类型的渲染 (Claude Code 的思考过程)
2. 添加 `context_block` 类型的展示 (上下文块信息)
3. 支持 `tool_use` 类型的细粒度解析

### 2.2 命令面板增强

**当前实现**:
- 模糊搜索 + 使用频率排序
- 按类别分组 (chat/tools/navigation/settings/diagnostics)
- 最近使用命令优先

**Codex 风格增强方向**:
1. **自然语言理解**: 支持中文描述匹配，如输入"帮我审查代码"匹配 review 命令
2. **智能补全**: Tab 键预览命令效果，结合 AI 意图识别
3. **快捷操作栏**: 参考 Command Palette 的快速操作按钮 (工作流/技能/历史)

### 2.3 多 Agent 并行执行

**当前实现**:
- `multi-agent-service.ts` 支持预设配置
- 支持 agent 间的 `dependsOn` 依赖关系
- 进度实时反馈

**可借鉴的设计**:
1. **动态任务分解**: 输入自然语言任务，自动拆分为多个子任务
2. **结果汇总**: 多个 agent 结果自动合并，减少重复内容
3. **冲突检测**: 检测并提示多个 agent 操作的冲突文件

### 2.4 工作流模板

**当前实现**:
- 预置 10+ 工作流模板 (code-review, bug-fix, refactor 等)
- 支持自定义工作流创建
- 使用频率和最近使用排序

**可借鉴的设计**:
1. **工作流市场**: 社区工作流分享和评分系统
2. **变量插值**: 工作流步骤中支持 `{cwd}`, `{selected_file}` 等变量
3. **条件分支**: 根据执行结果决定下一步骤

---

## 三、落地建议

### 3.1 高优先级 (P0)

| 特性 | 当前状态 | 改进方案 | 工作量 |
|------|----------|----------|--------|
| 命令面板语义搜索 | 基础模糊匹配 | 集成 embedding 模型做语义匹配 | 中 |
| 思考过程可视化 | 无 | 新增 `thinking` 类型的 timeline 渲染 | 小 |
| 多 Agent 自然语言输入 | 需手动配置 | 实现 `/multi "帮我做XXX"` 语法 | 中 |

### 3.2 中优先级 (P1)

| 特性 | 当前状态 | 改进方案 | 工作量 |
|------|----------|----------|--------|
| 工作流变量 | 固定模板 | 支持 `{context}` 变量插值 | 中 |
| 结果冲突检测 | 无 | 多 agent 执行时检测文件修改冲突 | 中 |
| 上下文窗口可视化 | 基础数据 | 实时图表展示 context 使用情况 | 小 |

### 3.3 低优先级 (P2)

| 特性 | 当前状态 | 改进方案 | 工作量 |
|------|----------|----------|--------|
| 社区工作流市场 | 静态数据 | 接入后端 API 获取社区工作流 | 大 |
| 工作流条件分支 | 线性执行 | 支持 If-Else 条件逻辑 | 中 |
| Agent 角色定义 | 固定预设 | 支持自定义 agent 角色配置 | 中 |

---

## 四、具体实现示例

### 4.1 增强命令面板语义搜索

```typescript
// src/lib/commands.ts 新增
export interface SemanticCommand {
  id: string;
  name: string;
  description: string;
  embedding?: number[]; // 语义向量
  exampleQueries: string[]; // 示例查询
}

// 语义搜索增强
export async function semanticFilterCommands(
  query: string,
  agent?: string
): Promise<CommandDef[]> {
  const { embeddings } = await import("$lib/services/embedding-service");
  const queryEmbedding = await embeddings.embed(query);
  
  return commands
    .filter(cmd => !agent || cmd.agent === agent || cmd.agent === "both")
    .map(cmd => ({
      cmd,
      score: cosineSimilarity(queryEmbedding, cmd.embedding || cmd.exampleEmbeddings)
    }))
    .filter(r => r.score > 0.7)
    .sort((a, b) => b.score - a.score)
    .map(r => r.cmd);
}
```

### 4.2 思考过程渲染组件

```svelte
<!-- src/lib/components/ThinkingBlock.svelte -->
<script lang="ts">
  let { thinking, elapsed }: { thinking: string; elapsed: number } = $props();
</script>

<div class="thinking-block">
  <div class="thinking-header">
    <span class="animate-pulse">🤔 思考中...</span>
    <span class="elapsed">{elapsed}s</span>
  </div>
  <div class="thinking-content">
    {#each thinking.split('\n') as line}
      <p>{line}</p>
    {/each}
  </div>
</div>

<style>
.thinking-block {
  background: linear-gradient(135deg, hsl(var(--primary)/0.1), hsl(var(--accent)/0.1));
  border-left: 3px solid hsl(var(--primary));
  padding: 1rem;
  border-radius: 0.5rem;
}
</style>
```

### 4.3 多 Agent 自然语言解析

```typescript
// src/lib/services/multi-agent-service.ts 新增
public parseNaturalLanguage(input: string): MultiAgentConfig | null {
  // 使用 AI 解析自然语言为 agent 配置
  const prompt = `将以下自然语言任务分解为多个 agent 子任务:
任务: ${input}
输出 JSON 格式:
{
  "name": "任务名称",
  "description": "任务描述", 
  "agents": [
    { "id": "agent1", "name": "角色名", "prompt": "具体指令", "dependsOn": [] }
  ]
}`;

  // 调用 AI 解析或使用规则匹配
  return this.applyRuleBasedParsing(input);
}
```

---

## 五、总结

MiWarp 已经具备扎实的基础架构，从 Codex Claude Cowork 可以学习的主要方向:

1. **用户体验**: 命令面板语义搜索、智能补全
2. **可视化**: 思考过程渲染、上下文窗口图表
3. **智能化**: 多 Agent 自然语言输入、工作流变量插值
4. **协作**: 社区工作流市场、结果冲突检测

建议从 P0 级别的命令面板语义搜索和思考过程可视化开始实施，这两个特性投入产出比最高。
