/**
 * 多 Agent 并行执行服务
 * 允许用户通过一条指令触发多个 Agent 并行工作
 */

export interface MultiAgentConfig {
  name: string;
  description: string;
  agents: AgentDefinition[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  priority?: number;
  dependsOn?: string[];
}

export interface MultiAgentResult {
  agentId: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  duration?: number;
  logs?: string[];
  progress?: number;
}

// ── Natural Language Parsing Types ──

interface ParsePattern {
  /** Regex pattern to match */
  regex: RegExp;
  /** Priority for matching (higher = first) */
  priority: number;
  /** Generate agents based on matched groups */
  generator: (match: RegExpMatchArray) => AgentDefinition[];
  /** Template name for display */
  templateName: string;
}

// ── Synonym Mapping ──

const SYNONYMS: Record<string, string[]> = {
  // Development
  开发: ["dev", "develop", "building", "创建", "制作"],
  前端: ["frontend", "front-end", "ui", "界面", "网页"],
  后端: ["backend", "back-end", "api", "服务"],
  数据库: ["database", "db", "数据", "存储"],
  全栈: ["fullstack", "full-stack", "全部", "整体"],

  // Review
  审查: ["review", "check", "audit", "检查", "审核"],
  安全: ["security", "safe", "secure", "漏洞"],
  性能: ["performance", "speed", "optimize", "优化", "效率"],
  风格: ["style", "lint", "format", "代码规范"],
  代码: ["code", "coding", "source", "代码"],

  // Testing
  测试: ["test", "testing", "spec", "测试用例"],
  单元: ["unit", "单个", "单一"],
  集成: ["integration", "集成", "组合"],
  E2E: ["e2e", "end-to-end", "端到端", "e2e", "e2e testing"],

  // Documentation
  文档: ["docs", "documentation", "文档", "说明"],
  API: ["api", "接口", "rest", "graphql"],
  README: ["readme", "说明", "简介"],
  CHANGELOG: ["changelog", "更新日志", "变更记录"],

  // Task-related
  实现: ["implement", "build", "create", "实现", "完成"],
  功能: ["feature", "function", "功能"],
  模块: ["module", "component", "模块", "组件"],
  任务: ["task", "job", "work", "任务", "工作"],
};

// ── Parse Patterns ──

const PARSE_PATTERNS: ParsePattern[] = [
  // Fullstack development
  {
    regex: /(?:全栈|fullstack|全部|整体).*(?:开发|build)/i,
    priority: 100,
    templateName: "全栈开发",
    generator: () => [
      { id: "frontend", name: "前端开发", prompt: "开发前端界面组件，使用 React/Vue/Svelte 实现 UI" },
      { id: "backend", name: "后端开发", prompt: "开发 REST API 和业务逻辑", dependsOn: ["frontend"] },
      { id: "database", name: "数据库设计", prompt: "设计数据库 schema 和 migrations" },
    ],
  },
  // Frontend + Backend
  {
    regex: /(?:前端|frontend).*(?:后端|backend|api)|(?:后端|backend|api).*(?:前端|frontend)/i,
    priority: 90,
    templateName: "前后端开发",
    generator: () => [
      { id: "frontend", name: "前端开发", prompt: "开发前端界面组件" },
      { id: "backend", name: "后端开发", prompt: "开发后端 API 和业务逻辑" },
    ],
  },
  // Review all
  {
    regex: /(?:审查|review|检查|审核).*(?:所有|全部|all)|(?:代码|pr).*审查/i,
    priority: 90,
    templateName: "代码审查",
    generator: () => [
      { id: "security", name: "安全审查", prompt: "检查安全漏洞：SQL注入、XSS、CSRF等" },
      { id: "performance", name: "性能审查", prompt: "检查性能问题：N+1查询、内存泄漏等" },
      { id: "style", name: "代码风格", prompt: "检查代码规范和最佳实践" },
    ],
  },
  // Testing all
  {
    regex: /(?:测试|test).*(?:所有|全部|all)|(?:单测|单元).*(?:集成|e2e)/i,
    priority: 90,
    templateName: "全面测试",
    generator: () => [
      { id: "unit", name: "单元测试", prompt: "编写单元测试用例，覆盖核心函数和模块" },
      { id: "integration", name: "集成测试", prompt: "编写集成测试用例，测试模块间协作" },
      { id: "e2e", name: "E2E测试", prompt: "编写端到端测试用例，测试完整用户流程" },
    ],
  },
  // Documentation
  {
    regex: /(?:文档|docs).*(?:生成|创建|写)|生成.*文档/i,
    priority: 80,
    templateName: "文档生成",
    generator: () => [
      { id: "api", name: "API 文档", prompt: "生成 API 文档，包含接口说明和参数" },
      { id: "readme", name: "README", prompt: "生成项目 README，包含安装和使用说明" },
      { id: "changelog", name: "CHANGELOG", prompt: "生成更新日志，记录版本变更" },
    ],
  },
  // Multiple features
  {
    regex: /(?:实现|开发|创建).*功能|[多第]个.*(?:模块|功能|任务)/i,
    priority: 70,
    generator: (match) => {
      // Extract number if present
      const numMatch = match[0].match(/[多第]?([0-9一二两三四五六七八九十]+|[0-9]+)/);
      const count = numMatch ? parseFeatureCount(numMatch[1]) : 3;
      return generateFeatures(count);
    },
    templateName: "多功能开发",
  },
];

// ── Helper Functions ──

function parseFeatureCount(text: string): number {
  const chineseToNum: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    两: 2, 多: 5,
  };
  if (/^[0-9]+$/.test(text)) return parseInt(text, 10);
  return chineseToNum[text] || 3;
}

function generateFeatures(count: number): AgentDefinition[] {
  const features: AgentDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    features.push({
      id: `feature${i}`,
      name: `功能 ${i}`,
      prompt: `实现第 ${i} 个功能模块`,
      priority: i,
    });
  }
  return features;
}

function expandSynonyms(text: string): string[] {
  const variants = [text.toLowerCase()];
  for (const [, syns] of Object.entries(SYNONYMS)) {
    for (const syn of syns) {
      if (text.includes(syn)) {
        variants.push(syn.toLowerCase());
      }
    }
  }
  return variants;
}

class MultiAgentService {
  /** 预设的多 Agent 任务配置 */
  private presets: Map<string, MultiAgentConfig> = new Map();

  constructor() {
    this.initPresets();
  }

  /** 初始化预设配置 */
  private initPresets() {
    // 全栈开发预设
    this.presets.set("fullstack", {
      name: "multiAgent_preset_fullstack",
      description: "multiAgent_desc_fullstack",
      agents: [
        {
          id: "frontend",
          name: "前端开发",
          prompt: "开发前端界面组件，使用 React/Vue/Svelte",
          priority: 1,
        },
        {
          id: "backend",
          name: "后端开发",
          prompt: "开发 REST API 和业务逻辑",
          priority: 2,
          dependsOn: ["frontend"],
        },
        {
          id: "database",
          name: "数据库设计",
          prompt: "设计数据库 schema 和 migrations",
          priority: 2,
        },
      ],
    });

    // 代码审查预设
    this.presets.set("review", {
      name: "multiAgent_preset_review",
      description: "multiAgent_desc_review",
      agents: [
        {
          id: "security",
          name: "安全审查",
          prompt: "检查安全漏洞：SQL注入、XSS、CSRF等",
        },
        {
          id: "performance",
          name: "性能审查",
          prompt: "检查性能问题：N+1查询、内存泄漏等",
        },
        {
          id: "style",
          name: "代码风格",
          prompt: "检查代码规范和最佳实践",
        },
      ],
    });

    // 大升级预设
    this.presets.set("upgrade", {
      name: "multiAgent_preset_upgrade",
      description: "multiAgent_desc_upgrade",
      agents: [
        {
          id: "feature1",
          name: "模块 1",
          prompt: "实现第一个功能模块",
        },
        {
          id: "feature2",
          name: "模块 2",
          prompt: "实现第二个功能模块",
        },
        {
          id: "feature3",
          name: "模块 3",
          prompt: "实现第三个功能模块",
        },
        {
          id: "feature4",
          name: "模块 4",
          prompt: "实现第四个功能模块",
        },
        {
          id: "feature5",
          name: "模块 5",
          prompt: "实现第五个功能模块",
        },
      ],
    });

    // 测试预设
    this.presets.set("test", {
      name: "multiAgent_preset_test",
      description: "multiAgent_desc_test",
      agents: [
        {
          id: "unit",
          name: "单元测试",
          prompt: "编写单元测试用例",
        },
        {
          id: "integration",
          name: "集成测试",
          prompt: "编写集成测试用例",
        },
        {
          id: "e2e",
          name: "E2E测试",
          prompt: "编写端到端测试用例",
        },
      ],
    });

    // 文档预设
    this.presets.set("docs", {
      name: "multiAgent_preset_docs",
      description: "multiAgent_desc_docs",
      agents: [
        {
          id: "api",
          name: "API 文档",
          prompt: "生成 API 文档",
        },
        {
          id: "readme",
          name: "README",
          prompt: "生成项目 README",
        },
        {
          id: "changelog",
          name: "CHANGELOG",
          prompt: "生成更新日志",
        },
      ],
    });
  }

  /** 获取所有预设 */
  getPresets(): { id: string; name: string; description: string; agentCount: number }[] {
    return Array.from(this.presets.entries()).map(([id, config]) => ({
      id,
      name: config.name,
      description: config.description,
      agentCount: config.agents.length,
    }));
  }

  /** 获取预设配置 */
  getPreset(id: string): MultiAgentConfig | undefined {
    return this.presets.get(id);
  }

  /** 添加自定义预设 */
  addPreset(id: string, config: MultiAgentConfig) {
    this.presets.set(id, config);
  }

  /** 执行多 Agent 任务 */
  async execute(
    config: MultiAgentConfig,
    context: { cwd: string; projectPath: string },
    onProgress?: (agentId: string, status: string, progress?: number) => void,
  ): Promise<MultiAgentResult[]> {
    const results: MultiAgentResult[] = [];
    const runningAgents = new Map<string, Promise<MultiAgentResult>>();

    for (const agent of config.agents) {
      const result: MultiAgentResult = {
        agentId: agent.id,
        status: "pending",
        logs: [],
        progress: 0,
      };

      // 检查依赖
      if (agent.dependsOn && agent.dependsOn.length > 0) {
        const depsMet = agent.dependsOn.every((depId) => {
          const dep = results.find((r) => r.agentId === depId);
          return dep?.status === "completed";
        });

        if (!depsMet) {
          result.status = "pending";
          result.error = "Dependencies not met";
          results.push(result);
          continue;
        }
      }

      // 启动 Agent
      const startTime = Date.now();
      result.status = "running";
      result.logs?.push(`[${agent.name}] 启动于 ${new Date().toLocaleTimeString()}`);
      onProgress?.(agent.id, "started", 0);

      const task = this.executeAgent(agent, context, (status, progress) => {
        result.logs?.push(`[${agent.name}] ${status}`);
        result.progress = progress;
        onProgress?.(agent.id, status, progress);
      });

      runningAgents.set(
        agent.id,
        task
          .then((r) => {
            result.status = "completed";
            result.result = r;
            result.duration = Date.now() - startTime;
            result.progress = 100;
            result.logs?.push(`[${agent.name}] 完成于 ${new Date().toLocaleTimeString()}`);
            return result;
          })
          .catch((e) => {
            result.status = "failed";
            result.error = String(e);
            result.duration = Date.now() - startTime;
            result.logs?.push(`[${agent.name}] 失败: ${e}`);
            return result;
          }),
      );
    }

    // 等待所有 Agent 完成
    const settled = await Promise.all(runningAgents.values());
    results.push(
      ...settled.filter((r) => !results.find((existing) => existing.agentId === r.agentId)),
    );

    return results;
  }

  /** 执行单个 Agent */
  private async executeAgent(
    agent: AgentDefinition,
    context: { cwd: string; projectPath: string },
    onStatus?: (status: string, progress?: number) => void,
  ): Promise<string> {
    // 模拟分阶段执行
    onStatus?.("初始化中...", 10);
    await this.delay(100);

    onStatus?.("执行任务...", 30);
    await this.delay(200);

    onStatus?.("处理中...", 60);
    await this.delay(150);

    onStatus?.("完成中...", 90);
    await this.delay(100);

    onStatus?.("完成", 100);
    return `[${agent.name}] 任务完成`;
  }

  /** 辅助：延迟函数 */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 从自然语言生成多 Agent 任务 */
  parseNaturalLanguage(input: string): MultiAgentConfig | null {
    const normalized = input.trim().toLowerCase();

    // Try each pattern in priority order
    const matches = PARSE_PATTERNS
      .map((pattern) => {
        const match = normalized.match(pattern.regex);
        return match ? { pattern, match } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b!.pattern.priority ?? 0) - (a!.pattern.priority ?? 0));

    if (matches.length > 0) {
      const { pattern, match } = matches[0]!;
      const agents = pattern.generator(match!);
      return {
        name: pattern.templateName,
        description: input,
        agents,
      };
    }

    // Fallback: try synonym-based matching
    const synonymMatch = this.matchBySynonyms(normalized);
    if (synonymMatch) {
      return synonymMatch;
    }

    return null;
  }

  /**
   * Match input using synonym-based rules
   */
  private matchBySynonyms(input: string): MultiAgentConfig | null {
    const expanded = expandSynonyms(input);

    // Check for development keywords
    if (expanded.some((e) => e.includes("前端") || e.includes("frontend") || e.includes("ui"))) {
      if (expanded.some((e) => e.includes("后端") || e.includes("backend") || e.includes("api"))) {
        return {
          name: "前后端开发",
          description: input,
          agents: [
            { id: "frontend", name: "前端开发", prompt: "开发前端界面组件" },
            { id: "backend", name: "后端开发", prompt: "开发后端 API 和业务逻辑" },
          ],
        };
      }
    }

    // Check for review keywords
    if (expanded.some((e) => e.includes("审查") || e.includes("review") || e.includes("检查"))) {
      return {
        name: "代码审查",
        description: input,
        agents: [
          { id: "security", name: "安全审查", prompt: "检查安全漏洞" },
          { id: "performance", name: "性能审查", prompt: "检查性能问题" },
          { id: "style", name: "代码风格", prompt: "检查代码规范" },
        ],
      };
    }

    // Check for testing keywords
    if (expanded.some((e) => e.includes("测试") || e.includes("test"))) {
      return {
        name: "测试覆盖",
        description: input,
        agents: [
          { id: "unit", name: "单元测试", prompt: "编写单元测试用例" },
          { id: "integration", name: "集成测试", prompt: "编写集成测试用例" },
        ],
      };
    }

    // Check for documentation keywords
    if (expanded.some((e) => e.includes("文档") || e.includes("docs"))) {
      return {
        name: "文档生成",
        description: input,
        agents: [
          { id: "api", name: "API 文档", prompt: "生成 API 文档" },
          { id: "readme", name: "README", prompt: "生成 README" },
        ],
      };
    }

    return null;
  }

  /**
   * Parse input and return confidence score
   */
  parseNaturalLanguageWithConfidence(input: string): {
    config: MultiAgentConfig | null;
    confidence: number;
    matchedKeywords: string[];
  } {
    const normalized = input.trim().toLowerCase();
    const matchedKeywords: string[] = [];

    // Check for synonym matches
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      for (const syn of syns) {
        if (normalized.includes(syn)) {
          matchedKeywords.push(key);
        }
      }
    }

    // Calculate confidence based on keyword matches
    let confidence = 0;
    if (matchedKeywords.length >= 3) confidence = 0.9;
    else if (matchedKeywords.length >= 2) confidence = 0.7;
    else if (matchedKeywords.length >= 1) confidence = 0.5;

    // Check for pattern matches
    for (const pattern of PARSE_PATTERNS) {
      if (pattern.regex.test(normalized)) {
        confidence = Math.max(confidence, pattern.priority / 100);
      }
    }

    return {
      config: this.parseNaturalLanguage(input),
      confidence,
      matchedKeywords: [...new Set(matchedKeywords)],
    };
  }

  /**
   * Get suggested prompts based on current context
   */
  getSuggestedPrompts(context?: { hasGitChanges: boolean; hasTests: boolean; hasDocs: boolean }): string[] {
    const suggestions: string[] = [];

    if (context?.hasGitChanges) {
      suggestions.push("审查我的代码变更");
      suggestions.push("测试变更的代码");
    }

    suggestions.push("全栈开发新功能");
    suggestions.push("生成项目文档");

    return suggestions;
  }
}

export const multiAgentService = new MultiAgentService();
