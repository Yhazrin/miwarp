/**
 * User Role System
 *
 * 用户角色权限系统
 * 支持多用户、权限组、审计日志
 */

/**
 * 角色类型
 */
export type UserRole = "owner" | "admin" | "developer" | "viewer" | "guest";

/**
 * 权限类型
 */
export type Permission =
  // 会话相关
  | "session:create"
  | "session:read"
  | "session:write"
  | "session:delete"
  | "session:share"
  | "session:fork"
  | "session:export"

  // 技能相关
  | "skill:create"
  | "skill:read"
  | "skill:write"
  | "skill:delete"
  | "skill:execute"
  | "skill:install"

  // 工作流相关
  | "workflow:create"
  | "workflow:read"
  | "workflow:write"
  | "workflow:delete"
  | "workflow:execute"

  // 定时任务相关
  | "task:create"
  | "task:read"
  | "task:write"
  | "task:delete"
  | "task:execute"
  | "task:cancel"

  // 插件相关
  | "plugin:create"
  | "plugin:read"
  | "plugin:write"
  | "plugin:delete"
  | "plugin:install"
  | "plugin:configure"

  // MCP 相关
  | "mcp:create"
  | "mcp:read"
  | "mcp:write"
  | "mcp:delete"
  | "mcp:configure"

  // 系统相关
  | "settings:read"
  | "settings:write"
  | "settings:admin"
  | "user:manage"
  | "audit:read"
  | "billing:read"
  | "billing:write";

/**
 * 角色权限配置
 */
export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
  inherits?: UserRole; // 继承的角色
  restrictions?: PermissionRestriction[];
}

/**
 * 权限限制
 */
export interface PermissionRestriction {
  permission: Permission;
  conditions: PermissionCondition[];
}

/**
 * 权限条件
 */
export interface PermissionCondition {
  type: "resource" | "scope" | "time" | "count" | "value";
  operator: "equals" | "contains" | "in" | "not_in" | "gt" | "lt" | "between";
  value: unknown;
}

/**
 * 用户信息
 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 用户会话
 */
export interface UserSession {
  userId: string;
  sessionId: string;
  startedAt: string;
  expiresAt?: string;
  permissions: Permission[];
}

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource?: string;
  resourceId?: string;
  permission: Permission;
  result: "success" | "denied" | "error";
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * 角色权限映射
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    // 全部权限
    "session:create",
    "session:read",
    "session:write",
    "session:delete",
    "session:share",
    "session:fork",
    "session:export",
    "skill:create",
    "skill:read",
    "skill:write",
    "skill:delete",
    "skill:execute",
    "skill:install",
    "workflow:create",
    "workflow:read",
    "workflow:write",
    "workflow:delete",
    "workflow:execute",
    "task:create",
    "task:read",
    "task:write",
    "task:delete",
    "task:execute",
    "task:cancel",
    "plugin:create",
    "plugin:read",
    "plugin:write",
    "plugin:delete",
    "plugin:install",
    "plugin:configure",
    "mcp:create",
    "mcp:read",
    "mcp:write",
    "mcp:delete",
    "mcp:configure",
    "settings:read",
    "settings:write",
    "settings:admin",
    "user:manage",
    "audit:read",
    "billing:read",
    "billing:write",
  ],
  admin: [
    "session:create",
    "session:read",
    "session:write",
    "session:delete",
    "session:share",
    "session:fork",
    "session:export",
    "skill:create",
    "skill:read",
    "skill:write",
    "skill:delete",
    "skill:execute",
    "skill:install",
    "workflow:create",
    "workflow:read",
    "workflow:write",
    "workflow:delete",
    "workflow:execute",
    "task:create",
    "task:read",
    "task:write",
    "task:delete",
    "task:execute",
    "task:cancel",
    "plugin:create",
    "plugin:read",
    "plugin:write",
    "plugin:delete",
    "plugin:install",
    "plugin:configure",
    "mcp:create",
    "mcp:read",
    "mcp:write",
    "mcp:delete",
    "mcp:configure",
    "settings:read",
    "settings:write",
    "audit:read",
    "billing:read",
  ],
  developer: [
    "session:create",
    "session:read",
    "session:write",
    "session:fork",
    "session:export",
    "skill:read",
    "skill:write",
    "skill:execute",
    "workflow:read",
    "workflow:write",
    "workflow:execute",
    "task:create",
    "task:read",
    "task:write",
    "task:execute",
    "task:cancel",
    "plugin:read",
    "plugin:write",
    "mcp:read",
    "mcp:write",
    "settings:read",
  ],
  viewer: [
    "session:read",
    "skill:read",
    "workflow:read",
    "task:read",
    "plugin:read",
    "mcp:read",
    "settings:read",
  ],
  guest: ["session:read", "skill:read", "workflow:read", "task:read"],
};

/**
 * 角色描述
 */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: "项目所有者，拥有所有权限",
  admin: "管理员，拥有管理功能",
  developer: "开发者，可以执行技能和工作流",
  viewer: "查看者，只读权限",
  guest: "访客，限制性只读权限",
};

/**
 * 权限描述
 */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  // 会话相关
  "session:create": "创建新会话",
  "session:read": "查看会话",
  "session:write": "发送消息到会话",
  "session:delete": "删除会话",
  "session:share": "分享会话",
  "session:fork": "分叉会话",
  "session:export": "导出会话",
  // 技能相关
  "skill:create": "创建技能",
  "skill:read": "查看技能",
  "skill:write": "编辑技能",
  "skill:delete": "删除技能",
  "skill:execute": "执行技能",
  "skill:install": "安装技能",
  // 工作流相关
  "workflow:create": "创建工作流",
  "workflow:read": "查看工作流",
  "workflow:write": "编辑工作流",
  "workflow:delete": "删除工作流",
  "workflow:execute": "执行工作流",
  // 定时任务相关
  "task:create": "创建定时任务",
  "task:read": "查看定时任务",
  "task:write": "编辑定时任务",
  "task:delete": "删除定时任务",
  "task:execute": "执行定时任务",
  "task:cancel": "取消定时任务",
  // 插件相关
  "plugin:create": "创建插件",
  "plugin:read": "查看插件",
  "plugin:write": "编辑插件",
  "plugin:delete": "删除插件",
  "plugin:install": "安装插件",
  "plugin:configure": "配置插件",
  // MCP 相关
  "mcp:create": "创建 MCP 配置",
  "mcp:read": "查看 MCP 配置",
  "mcp:write": "编辑 MCP 配置",
  "mcp:delete": "删除 MCP 配置",
  "mcp:configure": "配置 MCP",
  // 系统相关
  "settings:read": "查看设置",
  "settings:write": "修改设置",
  "settings:admin": "管理员设置",
  "user:manage": "管理用户",
  "audit:read": "查看审计日志",
  "billing:read": "查看账单",
  "billing:write": "修改账单",
};

/**
 * 权限组
 */
export const PERMISSION_GROUPS: Record<string, Permission[]> = {
  session: [
    "session:create",
    "session:read",
    "session:write",
    "session:delete",
    "session:share",
    "session:fork",
    "session:export",
  ],
  skill: [
    "skill:create",
    "skill:read",
    "skill:write",
    "skill:delete",
    "skill:execute",
    "skill:install",
  ],
  workflow: [
    "workflow:create",
    "workflow:read",
    "workflow:write",
    "workflow:delete",
    "workflow:execute",
  ],
  task: ["task:create", "task:read", "task:write", "task:delete", "task:execute", "task:cancel"],
  plugin: [
    "plugin:create",
    "plugin:read",
    "plugin:write",
    "plugin:delete",
    "plugin:install",
    "plugin:configure",
  ],
  mcp: ["mcp:create", "mcp:read", "mcp:write", "mcp:delete", "mcp:configure"],
  system: [
    "settings:read",
    "settings:write",
    "settings:admin",
    "user:manage",
    "audit:read",
    "billing:read",
    "billing:write",
  ],
};

/**
 * 权限检查器
 */
export class PermissionChecker {
  private userPermissions: Set<Permission>;
  private restrictions: PermissionRestriction[] = [];

  constructor(role: UserRole, customPermissions?: Permission[]) {
    this.userPermissions = new Set(customPermissions || ROLE_PERMISSIONS[role] || []);
  }

  /**
   * 检查是否拥有权限
   */
  hasPermission(permission: Permission): boolean {
    return this.userPermissions.has(permission);
  }

  /**
   * 检查是否拥有多个权限 (全部需要)
   */
  hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(p));
  }

  /**
   * 检查是否拥有任一权限
   */
  hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(p));
  }

  /**
   * 获取用户权限列表
   */
  getPermissions(): Permission[] {
    return Array.from(this.userPermissions);
  }

  /**
   * 获取权限组
   */
  getPermissionGroups(): string[] {
    return PERMISSION_GROUPS ? Object.keys(PERMISSION_GROUPS) : [];
  }

  /**
   * 检查权限组是否完整
   */
  hasGroup(groupName: string): boolean {
    const group = PERMISSION_GROUPS[groupName];
    if (!group) return false;
    return this.hasAllPermissions(group);
  }

  /**
   * 检查权限限制
   */
  checkRestriction(permission: Permission, context: Record<string, unknown>): boolean {
    const restriction = this.restrictions.find((r) => r.permission === permission);
    if (!restriction) return true;

    for (const condition of restriction.conditions) {
      if (!this.evaluateCondition(condition, context)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(
    condition: PermissionCondition,
    context: Record<string, unknown>,
  ): boolean {
    const value = context[condition.type];
    if (value === undefined) return true;

    switch (condition.operator) {
      case "equals":
        return value === condition.value;
      case "contains":
        return String(value).includes(String(condition.value));
      case "in":
        return (condition.value as unknown[]).includes(value);
      case "not_in":
        return !(condition.value as unknown[]).includes(value);
      case "gt":
        return Number(value) > Number(condition.value);
      case "lt":
        return Number(value) < Number(condition.value);
      case "between": {
        const [min, max] = condition.value as [number, number];
        return Number(value) >= min && Number(value) <= max;
      }
      default:
        return true;
    }
  }
}

/**
 * 审计日志服务
 */
export class AuditLogService {
  private logs: AuditLogEntry[] = [];
  private maxLogs: number = 10000;

  /**
   * 记录操作
   */
  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.logs.unshift(fullEntry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
  }

  /**
   * 查询日志
   */
  query(filter?: {
    userId?: string;
    action?: string;
    permission?: Permission;
    result?: AuditLogEntry["result"];
    from?: string;
    to?: string;
    limit?: number;
  }): AuditLogEntry[] {
    let results = [...this.logs];

    if (filter?.userId) {
      results = results.filter((l) => l.userId === filter.userId);
    }
    if (filter?.action) {
      results = results.filter((l) => l.action.includes(filter.action!));
    }
    if (filter?.permission) {
      results = results.filter((l) => l.permission === filter.permission);
    }
    if (filter?.result) {
      results = results.filter((l) => l.result === filter.result);
    }
    if (filter?.from) {
      const from = new Date(filter.from).getTime();
      results = results.filter((l) => new Date(l.timestamp).getTime() >= from);
    }
    if (filter?.to) {
      const to = new Date(filter.to).getTime();
      results = results.filter((l) => new Date(l.timestamp).getTime() <= to);
    }

    return results.slice(0, filter?.limit || 100);
  }

  /**
   * 获取用户操作历史
   */
  getUserHistory(userId: string, limit?: number): AuditLogEntry[] {
    return this.query({ userId, limit });
  }

  /**
   * 获取最近的失败操作
   */
  getRecentFailures(limit?: number): AuditLogEntry[] {
    return this.query({ result: "denied", limit });
  }

  /**
   * 清除日志
   */
  clear(): void {
    this.logs = [];
  }
}

/**
 * 创建权限检查器
 */
export function createPermissionChecker(role: UserRole): PermissionChecker {
  return new PermissionChecker(role);
}

/**
 * 创建审计日志服务
 */
export function createAuditLogService(): AuditLogService {
  return new AuditLogService();
}
