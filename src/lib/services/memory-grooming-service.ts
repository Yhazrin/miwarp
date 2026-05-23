/**
 * Memory Grooming Service
 *
 * 自动化记忆整理服务
 * 支持去重、压缩、过期清理、语义优化
 */

import type { MemoryEntry, MemoryScope } from "$lib/stores/memory-store.svelte";

/**
 * 记忆整理配置
 */
export interface MemoryGroomingConfig {
  // 去重配置
  enableDeduplication: boolean;
  similarityThreshold: number; // 0-1，越高越严格

  // 压缩配置
  enableCompression: boolean;
  maxEntryLength: number; // 最大条目长度
  compressThreshold: number; // 超过此长度才压缩

  // 过期清理配置
  enableExpiryCleanup: boolean;
  defaultTtlDays: number; // 默认 TTL (天)
  staleThresholdDays: number; // 多久不访问视为过期

  // 语义优化配置
  enableSemanticCleanup: boolean;
  mergeRelatedEntries: boolean;

  // 其他
  dryRun: boolean; // 只报告不实际执行
}

/**
 * 记忆整理结果
 */
export interface MemoryGroomingResult {
  deduplicated: number;
  compressed: number;
  expired: number;
  merged: number;
  pruned: number;
  totalEntries: number;
  remainingEntries: number;
  actions: GroomingAction[];
}

/**
 * 整理操作
 */
export interface GroomingAction {
  type: "deduplicate" | "compress" | "expire" | "merge" | "prune";
  entryId: string;
  entryTitle: string;
  reason: string;
  before?: string;
  after?: string;
  savings?: number; // 节省的字符数
}

/**
 * 相似条目
 */
export interface SimilarEntry {
  entry1: string;
  entry2: string;
  similarity: number;
}

/**
 * 默认配置
 */
export const DEFAULT_GROOMING_CONFIG: MemoryGroomingConfig = {
  enableDeduplication: true,
  similarityThreshold: 0.85,
  enableCompression: true,
  maxEntryLength: 10000,
  compressThreshold: 5000,
  enableExpiryCleanup: true,
  defaultTtlDays: 90,
  staleThresholdDays: 30,
  enableSemanticCleanup: true,
  mergeRelatedEntries: true,
  dryRun: false,
};

/**
 * 记忆整理服务
 */
export class MemoryGroomingService {
  private config: MemoryGroomingConfig;

  constructor(config: Partial<MemoryGroomingConfig> = {}) {
    this.config = { ...DEFAULT_GROOMING_CONFIG, ...config };
  }

  /**
   * 执行记忆整理
   */
  async groom(memory: MemoryEntry[]): Promise<MemoryGroomingResult> {
    const actions: GroomingAction[] = [];
    let entries = [...memory];

    // 1. 过期清理
    if (this.config.enableExpiryCleanup) {
      const expiredActions = this.findExpiredEntries(entries);
      if (!this.config.dryRun) {
        entries = entries.filter((e) => !expiredActions.some((a) => a.entryId === e.id));
      }
      actions.push(...expiredActions);
    }

    // 2. 去重
    if (this.config.enableDeduplication) {
      const dedupActions = this.findDuplicates(entries);
      if (!this.config.dryRun) {
        entries = this.removeDuplicates(entries, dedupActions);
      }
      actions.push(...dedupActions);
    }

    // 3. 压缩
    if (this.config.enableCompression) {
      const compressActions = this.findCompressibleEntries(entries);
      if (!this.config.dryRun) {
        entries = this.compressEntries(entries, compressActions);
      }
      actions.push(...compressActions);
    }

    // 4. 语义合并
    if (this.config.enableSemanticCleanup && this.config.mergeRelatedEntries) {
      const mergeActions = this.findMergeableEntries(entries);
      if (!this.config.dryRun) {
        entries = this.mergeEntries(entries, mergeActions);
      }
      actions.push(...mergeActions);
    }

    return {
      deduplicated: actions.filter((a) => a.type === "deduplicate").length,
      compressed: actions.filter((a) => a.type === "compress").length,
      expired: actions.filter((a) => a.type === "expire").length,
      merged: actions.filter((a) => a.type === "merge").length,
      pruned: actions.filter((a) => a.type === "prune").length,
      totalEntries: memory.length,
      remainingEntries: entries.length,
      actions,
    };
  }

  /**
   * 查找过期条目
   */
  private findExpiredEntries(memory: MemoryEntry[]): GroomingAction[] {
    const actions: GroomingAction[] = [];
    const now = Date.now();
    const staleThreshold = this.config.staleThresholdDays * 24 * 60 * 60 * 1000;

    for (const entry of memory) {
      const lastAccessed = entry.lastAccessedAt
        ? new Date(entry.lastAccessedAt).getTime()
        : new Date(entry.createdAt).getTime();

      if (now - lastAccessed > staleThreshold) {
        actions.push({
          type: "expire",
          entryId: entry.id,
          entryTitle: entry.title,
          reason: `超过 ${this.config.staleThresholdDays} 天未访问`,
        });
      }

      // 检查 TTL
      if (entry.expiresAt) {
        const expiresAt = new Date(entry.expiresAt).getTime();
        if (now > expiresAt) {
          actions.push({
            type: "expire",
            entryId: entry.id,
            entryTitle: entry.title,
            reason: "已超过 TTL",
          });
        }
      }
    }

    return actions;
  }

  /**
   * 查找重复条目
   */
  private findDuplicates(memory: MemoryEntry[]): GroomingAction[] {
    const actions: GroomingAction[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memory.length; i++) {
      for (let j = i + 1; j < memory.length; j++) {
        const entry1 = memory[i];
        const entry2 = memory[j];

        if (processed.has(entry2.id)) continue;

        const similarity = this.calculateSimilarity(entry1.content, entry2.content);
        if (similarity >= this.config.similarityThreshold) {
          actions.push({
            type: "deduplicate",
            entryId: entry2.id,
            entryTitle: entry2.title,
            reason: `与 "${entry1.title}" 相似度 ${(similarity * 100).toFixed(1)}%`,
            before: entry2.content.substring(0, 100),
          });
          processed.add(entry2.id);
        }
      }
    }

    return actions;
  }

  /**
   * 移除重复条目
   */
  private removeDuplicates(memory: MemoryEntry[], actions: GroomingAction[]): MemoryEntry[] {
    const duplicateIds = new Set(actions.map((a) => a.entryId));
    return memory.filter((e) => !duplicateIds.has(e.id));
  }

  /**
   * 计算相似度 (简单实现，使用 TF-IDF 类算法)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // 简化的相似度计算
    // 实际可以使用更复杂的算法如余弦相似度、编辑距离等
    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    let intersection = 0;
    for (const word of set1) {
      if (set2.has(word)) intersection++;
    }

    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  /**
   * 查找可压缩条目
   */
  private findCompressibleEntries(memory: MemoryEntry[]): GroomingAction[] {
    const actions: GroomingAction[] = [];

    for (const entry of memory) {
      if (entry.content.length > this.config.compressThreshold) {
        const compressed = this.compressText(entry.content);
        const savings = entry.content.length - compressed.length;
        if (savings > 500) {
          // 节省超过 500 字符才值得压缩
          actions.push({
            type: "compress",
            entryId: entry.id,
            entryTitle: entry.title,
            reason: `可节省 ${savings} 字符`,
            before: entry.content.substring(0, 100),
            after: compressed.substring(0, 100),
            savings,
          });
        }
      }
    }

    return actions;
  }

  /**
   * 压缩文本
   */
  private compressText(text: string): string {
    // 简单的压缩实现
    // 移除多余的空白字符、合并行等
    return text
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ +/g, " ")
      .replace(/\t+/g, "\t")
      .trim();
  }

  /**
   * 压缩条目
   */
  private compressEntries(memory: MemoryEntry[], actions: GroomingAction[]): MemoryEntry[] {
    const compressIds = new Set(actions.map((a) => a.entryId));
    return memory.map((e) => {
      if (compressIds.has(e.id)) {
        return {
          ...e,
          content: this.compressText(e.content),
          updatedAt: new Date().toISOString(),
        };
      }
      return e;
    });
  }

  /**
   * 查找可合并条目
   */
  private findMergeableEntries(memory: MemoryEntry[]): GroomingAction[] {
    const actions: GroomingAction[] = [];
    const groups = this.groupByTopic(memory);

    for (const group of groups) {
      if (group.entries.length > 1) {
        const mainEntry = group.entries[0];
        for (let i = 1; i < group.entries.length; i++) {
          const entry = group.entries[i];
          actions.push({
            type: "merge",
            entryId: entry.id,
            entryTitle: entry.title,
            reason: `可合并到主题 "${group.topic}"`,
          });
        }
      }
    }

    return actions;
  }

  /**
   * 按主题分组
   */
  private groupByTopic(memory: MemoryEntry[]): Array<{ topic: string; entries: MemoryEntry[] }> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const entry of memory) {
      // 从标题或标签提取主题
      const topic = this.extractTopic(entry);
      const list = groups.get(topic) || [];
      list.push(entry);
      groups.set(topic, list);
    }

    return Array.from(groups.entries()).map(([topic, entries]) => ({ topic, entries }));
  }

  /**
   * 提取主题
   */
  private extractTopic(entry: MemoryEntry): string {
    // 从标签提取
    if (entry.tags && entry.tags.length > 0) {
      return entry.tags[0];
    }

    // 从标题提取关键词
    const words = entry.title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    return words.slice(0, 2).join(" ");
  }

  /**
   * 合并条目
   */
  private mergeEntries(memory: MemoryEntry[], actions: GroomingAction[]): MemoryEntry[] {
    // 实际实现可能需要更复杂的合并逻辑
    const mergeIds = new Set(actions.map((a) => a.entryId));
    return memory.filter((e) => !mergeIds.has(e.id));
  }

  /**
   * 获取整理建议
   */
  async getSuggestions(memory: MemoryEntry[]): Promise<string[]> {
    const suggestions: string[] = [];
    const result = await this.groom(memory);

    if (result.expired > 0) {
      suggestions.push(`有 ${result.expired} 条记忆已过期，建议清理`);
    }
    if (result.deduplicated > 0) {
      suggestions.push(`发现 ${result.deduplicated} 条重复记忆，建议去重`);
    }
    if (result.compressed > 0) {
      suggestions.push(`有 ${result.compressed} 条长记忆可压缩`);
    }
    if (result.merged > 0) {
      suggestions.push(`可合并 ${result.merged} 条相关记忆`);
    }

    return suggestions;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryGroomingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): MemoryGroomingConfig {
    return { ...this.config };
  }
}

/**
 * 创建记忆整理服务实例
 */
export function createMemoryGroomingService(
  config?: Partial<MemoryGroomingConfig>,
): MemoryGroomingService {
  return new MemoryGroomingService(config);
}

/**
 * 快速整理
 */
export async function quickGroom(memory: MemoryEntry[]): Promise<MemoryGroomingResult> {
  const service = createMemoryGroomingService({ dryRun: true });
  return service.groom(memory);
}
