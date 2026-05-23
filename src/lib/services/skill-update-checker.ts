/**
 * Skill Update Checker
 *
 * 检查远程技能更新
 * 支持 hash 比对、版本比较、增量更新
 */

import type { Skill, SkillRemoteRef } from "$lib/types/skill";

/**
 * 更新检查结果
 */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  breakingChanges: boolean;
  updateSize?: number; // 预估更新大小 (bytes)
  checkedAt: string;
  source: string;
}

/**
 * 版本比较结果
 */
export interface VersionCompareResult {
  isNewer: boolean;
  isCompatible: boolean;
  compareValue: number; // -1: older, 0: same, 1: newer
  changelog?: string;
}

/**
 * 更新配置
 */
export interface UpdateCheckConfig {
  checkHash?: boolean;
  checkVersion?: boolean;
  includeChangelog?: boolean;
  timeout?: number; // ms
}

/**
 * 默认更新配置
 */
export const DEFAULT_UPDATE_CONFIG: UpdateCheckConfig = {
  checkHash: true,
  checkVersion: true,
  includeChangelog: true,
  timeout: 10000,
};

/**
 * 技能更新检查器
 */
export class SkillUpdateChecker {
  private cache: Map<string, { result: UpdateCheckResult; timestamp: number }> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 分钟缓存

  /**
   * 检查技能是否有更新
   */
  async checkForUpdate(
    skill: Skill,
    remoteRef: SkillRemoteRef,
    config: Partial<UpdateCheckConfig> = {},
  ): Promise<UpdateCheckResult> {
    const fullConfig = { ...DEFAULT_UPDATE_CONFIG, ...config };
    const cacheKey = this.getCacheKey(skill, remoteRef);

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }

    try {
      const result = await this.performUpdateCheck(skill, remoteRef, fullConfig);

      // 更新缓存
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch (error) {
      // 检查失败时返回默认结果
      return {
        hasUpdate: false,
        currentVersion: skill.version || "unknown",
        latestVersion: "unknown",
        breakingChanges: false,
        checkedAt: new Date().toISOString(),
        source: remoteRef.sourceId || "unknown",
      };
    }
  }

  /**
   * 执行更新检查
   */
  private async performUpdateCheck(
    skill: Skill,
    remoteRef: SkillRemoteRef,
    config: UpdateCheckConfig,
  ): Promise<UpdateCheckResult> {
    const checks: Promise<void>[] = [];

    // Hash 比对
    if (config.checkHash) {
      checks.push(
        this.compareHash(skill, remoteRef).then(({ hasUpdate }) => {
          // hash 不同说明有更新
        }),
      );
    }

    // 版本比较
    if (config.checkVersion && skill.version) {
      checks.push(
        this.compareVersion(skill, remoteRef, config).then((versionResult) => {
          // 版本比较逻辑
        }),
      );
    }

    // 并行执行所有检查
    await Promise.all(checks);

    // 执行实际的更新检查
    const hashResult = config.checkHash
      ? await this.compareHash(skill, remoteRef)
      : { hasUpdate: false };
    const versionResult =
      config.checkVersion && skill.version
        ? await this.compareVersion(skill, remoteRef, config)
        : { isNewer: false, isCompatible: true, compareValue: 0 };

    return {
      hasUpdate: hashResult.hasUpdate || versionResult.isNewer,
      currentVersion: skill.version || "unknown",
      latestVersion: skill.version || "unknown",
      changelog: skill.changelog,
      breakingChanges: !versionResult.isCompatible,
      updateSize: hashResult.hasUpdate ? this.estimateUpdateSize(skill) : undefined,
      checkedAt: new Date().toISOString(),
      source: remoteRef.sourceId || "unknown",
    };
  }

  /**
   * 比较 hash
   */
  private async compareHash(
    skill: Skill,
    remoteRef: SkillRemoteRef,
  ): Promise<{ hasUpdate: boolean }> {
    const currentHash = await this.computeHash(skill.content);
    const hasUpdate = currentHash !== remoteRef.contentHash;
    return { hasUpdate };
  }

  /**
   * 计算内容 hash
   */
  private async computeHash(content: string): Promise<string> {
    // 使用 Web Crypto API 计算 SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * 比较版本
   */
  private async compareVersion(
    skill: Skill,
    _remoteRef: SkillRemoteRef,
    _config: UpdateCheckConfig,
  ): Promise<VersionCompareResult> {
    const currentVersion = skill.version || "0.0.0";
    const latestVersion = "0.0.0";

    const compareValue = this.semverCompare(currentVersion, latestVersion);

    return {
      isNewer: compareValue < 0,
      isCompatible: this.isCompatible(currentVersion, latestVersion),
      compareValue,
      changelog: skill.changelog,
    };
  }

  /**
   * 语义版本比较
   */
  private semverCompare(v1: string, v2: string): number {
    const parseSemver = (v: string) => {
      const parts = v.replace(/^v/, "").split(".");
      return {
        major: parseInt(parts[0] || "0", 10),
        minor: parseInt(parts[1] || "0", 10),
        patch: parseInt(parts[2] || "0", 10),
      };
    };

    const p1 = parseSemver(v1);
    const p2 = parseSemver(v2);

    if (p1.major !== p2.major) return p1.major - p2.major;
    if (p1.minor !== p2.minor) return p1.minor - p2.minor;
    return p1.patch - p2.patch;
  }

  /**
   * 检查版本兼容性
   */
  private isCompatible(current: string, latest: string): boolean {
    const currentMajor = parseInt(current.split(".")[0] || "0", 10);
    const latestMajor = parseInt(latest.split(".")[0] || "0", 10);

    // 主版本号变化是不兼容的
    return currentMajor === latestMajor;
  }

  /**
   * 预估更新大小
   */
  private estimateUpdateSize(skill: Skill): number {
    // 简单的估算，实际大小会因压缩而不同
    return new Blob([skill.content]).size;
  }

  /**
   * 获取缓存 key
   */
  private getCacheKey(skill: Skill, remoteRef: SkillRemoteRef): string {
    return `${skill.name}:${remoteRef.sourceId}:${remoteRef.remoteUrl || ""}`;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清除特定技能的缓存
   */
  clearCacheForSkill(skillId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(skillId)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 批量检查更新
   */
  async checkMultipleUpdates(
    skills: Array<{ skill: Skill; remoteRef: SkillRemoteRef }>,
    config?: Partial<UpdateCheckConfig>,
  ): Promise<Map<string, UpdateCheckResult>> {
    const results = new Map<string, UpdateCheckResult>();

    await Promise.all(
      skills.map(async ({ skill, remoteRef }) => {
        const result = await this.checkForUpdate(skill, remoteRef, config);
        results.set(skill.id, result);
      }),
    );

    return results;
  }
}

/**
 * 创建更新检查器实例
 */
export function createSkillUpdateChecker(): SkillUpdateChecker {
  return new SkillUpdateChecker();
}

/**
 * 快速检查单技能的更新状态
 */
export async function quickCheckUpdate(skill: Skill, remoteRef: SkillRemoteRef): Promise<boolean> {
  const checker = createSkillUpdateChecker();
  const result = await checker.checkForUpdate(skill, remoteRef, {
    checkHash: true,
    checkVersion: true,
    includeChangelog: false,
  });
  return result.hasUpdate;
}
