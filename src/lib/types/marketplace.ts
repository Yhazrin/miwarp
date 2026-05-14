/**
 * Marketplace Types
 *
 * 技能市场相关的类型定义
 */

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  author: string;
  authorAvatar?: string;
  tags: string[];
  icon: string;
  downloadCount: number;
  rating: number;
  version: string;
  minAppVersion: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  changelog?: string;
}

export interface MarketplaceCategory {
  id: string;
  name: string;
  nameZh: string;
  icon: string;
  count: number;
}

export interface MarketplaceSearchResult {
  skills: MarketplaceSkill[];
  total: number;
  page: number;
  pageSize: number;
  categories: MarketplaceCategory[];
}

export interface MarketplaceReview {
  id: string;
  author: string;
  authorAvatar?: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface SkillInstallResult {
  success: boolean;
  skill?: MarketplaceSkill;
  error?: string;
  warnings?: string[];
}

export interface SkillUpdateResult {
  success: boolean;
  oldVersion: string;
  newVersion: string;
  changelog: string;
}

export type InstallSource = "marketplace" | "url" | "file";
export type InstallScope = "user" | "project" | "local";
