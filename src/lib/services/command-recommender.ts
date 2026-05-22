/**
 * Command Recommender - 命令推荐引擎
 *
 * 基于语义相似度和上下文的智能命令推荐
 */

export interface CommandDef {
  id: string;
  name: string;
  description: string;
  shortcut?: string;
  category: string;
  semanticIntent?: string[]; // 语义意图标签
  examples?: string[]; // 用例示例
  aliases?: string[]; // 别名
  recentlyUsed?: number; // 最近使用时间戳
  useCount?: number; // 使用次数
}

export interface RecommendContext {
  currentAgent?: string;
  sessionState?: "idle" | "running" | "waiting_input";
  projectPath?: string;
  recentCommands?: string[];
}

interface ScoredCommand {
  command: CommandDef;
  score: number;
  matchReasons: string[];
}

/**
 * 命令推荐服务
 */
export class CommandRecommender {
  private commands: CommandDef[] = [];
  private recentlyUsed: Map<string, number> = new Map();

  constructor() {
    this.initDefaultCommands();
  }

  /**
   * 初始化默认命令
   */
  private initDefaultCommands() {
    this.commands = [
      // 文件操作
      {
        id: "file:read",
        name: "读取文件",
        description: "读取文件内容",
        category: "file",
        semanticIntent: ["read", "view", "show", "open", "cat"],
        examples: ["查看配置", "显示文件内容", "打开代码"],
        aliases: ["cat", "read", "view", "show"],
      },
      {
        id: "file:edit",
        name: "编辑文件",
        description: "编辑现有文件",
        category: "file",
        semanticIntent: ["edit", "modify", "change", "update", "write"],
        examples: ["修改配置", "更新代码", "编辑文件"],
        aliases: ["edit", "modify", "change"],
      },
      {
        id: "file:create",
        name: "创建文件",
        description: "创建新文件",
        category: "file",
        semanticIntent: ["create", "new", "add", "make", "generate"],
        examples: ["新建文件", "创建组件", "添加文件"],
        aliases: ["create", "new", "add", "make"],
      },
      // Git 操作
      {
        id: "git:commit",
        name: "提交更改",
        description: "提交当前更改",
        category: "git",
        semanticIntent: ["commit", "save", "submit", "push local"],
        examples: ["提交代码", "保存更改"],
        aliases: ["commit", "save"],
      },
      {
        id: "git:branch",
        name: "创建分支",
        description: "创建新分支",
        category: "git",
        semanticIntent: ["branch", "new branch", "create branch", "fork"],
        examples: ["创建分支", "新建特性分支"],
        aliases: ["branch", "new-branch"],
      },
      // Agent 控制
      {
        id: "agent:pause",
        name: "暂停 Agent",
        description: "暂停当前运行的 Agent",
        category: "agent",
        semanticIntent: ["pause", "stop", "halt", "interrupt", "wait"],
        examples: ["暂停执行", "停止 agent"],
        aliases: ["pause", "stop"],
      },
      {
        id: "agent:resume",
        name: "恢复 Agent",
        description: "恢复暂停的 Agent",
        category: "agent",
        semanticIntent: ["resume", "continue", "restart", "go on"],
        examples: ["继续执行", "恢复任务"],
        aliases: ["resume", "continue"],
      },
      {
        id: "agent:abort",
        name: "终止 Agent",
        description: "完全终止 Agent 会话",
        category: "agent",
        semanticIntent: ["abort", "kill", "terminate", "end", "cancel"],
        examples: ["终止任务", "取消执行"],
        aliases: ["abort", "kill", "terminate"],
      },
      // 搜索
      {
        id: "search:code",
        name: "搜索代码",
        description: "在项目中搜索代码",
        category: "search",
        semanticIntent: ["search", "find", "grep", "locate", "look for"],
        examples: ["搜索代码", "查找函数", "定位文件"],
        aliases: ["search", "find", "grep"],
      },
      {
        id: "search:replace",
        name: "搜索替换",
        description: "批量搜索和替换",
        category: "search",
        semanticIntent: ["replace", "swap", "substitute", "change all", "bulk edit"],
        examples: ["批量替换", "全部修改"],
        aliases: ["replace", "substitute"],
      },
      // 调试
      {
        id: "debug:terminal",
        name: "打开终端",
        description: "打开集成终端",
        category: "debug",
        semanticIntent: ["terminal", "console", "shell", "bash", "command line"],
        examples: ["打开终端", "启动命令行"],
        aliases: ["terminal", "console"],
      },
      {
        id: "debug:logs",
        name: "查看日志",
        description: "查看应用日志",
        category: "debug",
        semanticIntent: ["logs", "log", "output", "console", "errors"],
        examples: ["查看日志", "显示输出", "查看错误"],
        aliases: ["logs", "output"],
      },
    ];
  }

  /**
   * 注册新命令
   */
  registerCommand(command: CommandDef) {
    const existing = this.commands.findIndex((c) => c.id === command.id);
    if (existing >= 0) {
      this.commands[existing] = command;
    } else {
      this.commands.push(command);
    }
  }

  /**
   * 记录命令使用
   */
  recordUsage(commandId: string) {
    this.recentlyUsed.set(commandId, Date.now());
  }

  /**
   * 计算语义相似度
   */
  private calculateSemanticSimilarity(query: string, command: CommandDef): number {
    const queryWords = query.toLowerCase().split(/\s+/);
    let score = 0;
    const matchReasons: string[] = [];

    // 1. 检查别名匹配
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (queryWords.some((w) => alias.includes(w) || w.includes(alias))) {
          score += 0.8;
          matchReasons.push(`匹配别名: ${alias}`);
          break;
        }
      }
    }

    // 2. 检查语义意图匹配
    if (command.semanticIntent) {
      for (const intent of command.semanticIntent) {
        if (queryWords.some((w) => intent.includes(w) || w.includes(intent))) {
          score += 0.6;
          matchReasons.push(`匹配意图: ${intent}`);
          break;
        }
      }
    }

    // 3. 检查示例匹配
    if (command.examples) {
      for (const example of command.examples) {
        const exampleWords = example.toLowerCase().split(/\s+/);
        const intersection = queryWords.filter((w) =>
          exampleWords.some((ew) => ew.includes(w) || w.includes(ew)),
        );
        if (intersection.length > 0) {
          score += 0.4 * (intersection.length / queryWords.length);
          matchReasons.push(`匹配示例: ${example}`);
        }
      }
    }

    // 4. 名称匹配
    const nameWords = command.name.toLowerCase().split(/\s+/);
    for (const word of queryWords) {
      if (nameWords.some((nw) => nw.includes(word) || word.includes(nw))) {
        score += 0.5;
        matchReasons.push(`匹配名称: ${command.name}`);
        break;
      }
    }

    return score;
  }

  /**
   * 计算最近使用衰减
   */
  private calculateRecencyScore(commandId: string): number {
    const lastUsed = this.recentlyUsed.get(commandId);
    if (!lastUsed) return 0;

    const hoursAgo = (Date.now() - lastUsed) / (1000 * 60 * 60);
    // 24小时内使用 = 1.0分，每24小时衰减一半
    return Math.max(0, 1 - hoursAgo / 48);
  }

  /**
   * 推荐命令
   */
  recommend(query: string, context?: RecommendContext, limit: number = 8): CommandDef[] {
    if (!query.trim()) {
      // 无查询时返回最近使用的命令
      return this.commands
        .filter((c) => this.recentlyUsed.has(c.id))
        .sort((a, b) => (this.recentlyUsed.get(b.id) || 0) - (this.recentlyUsed.get(a.id) || 0))
        .slice(0, limit);
    }

    const scored: ScoredCommand[] = this.commands.map((command) => {
      const semanticScore = this.calculateSemanticSimilarity(query, command);
      const recencyScore = this.calculateRecencyScore(command.id);
      const categoryBonus = context?.currentAgent ? 0.1 : 0;

      const score = semanticScore + recencyScore + categoryBonus;
      const matchReasons: string[] = [];

      return {
        command,
        score,
        matchReasons,
      };
    });

    // 排序并返回
    return scored
      .filter((s) => s.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.command);
  }

  /**
   * 按类别分组推荐
   */
  recommendByCategory(query: string, context?: RecommendContext): Map<string, CommandDef[]> {
    const recommendations = this.recommend(query, context, 20);
    const grouped = new Map<string, CommandDef[]>();

    for (const command of recommendations) {
      const category = command.category;
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(command);
    }

    return grouped;
  }
}

// 单例导出
export const commandRecommender = new CommandRecommender();
