/**
 * Connector Interface
 *
 * 连接器接口标准化
 * 支持多种外部系统连接 (Slack, GitHub, Linear, Notion 等)
 */

/**
 * 连接器状态
 */
export type ConnectorStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "rate_limited";

/**
 * 连接器类型
 */
export type ConnectorType =
  | "slack"
  | "github"
  | "linear"
  | "notion"
  | "jira"
  | "feishu"
  | "discord"
  | "webhook"
  | "email"
  | "custom";

/**
 * 连接器配置
 */
export interface ConnectorConfig {
  type: ConnectorType;
  name: string;
  enabled: boolean;
  auth?: ConnectorAuthConfig;
  settings?: Record<string, unknown>;
}

/**
 * 认证配置
 */
export interface ConnectorAuthConfig {
  type: "api_key" | "oauth2" | "bearer" | "basic" | "webhook";
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  webhookSecret?: string;
}

/**
 * 连接器元数据
 */
export interface ConnectorMetadata {
  id: string;
  type: ConnectorType;
  name: string;
  version: string;
  description: string;
  icon?: string;
  capabilities: ConnectorCapability[];
  authMethods: ConnectorAuthConfig["type"][];
  requiredSettings: SettingDefinition[];
  events: string[]; // 支持的事件类型
}

/**
 * 连接器能力
 */
export interface ConnectorCapability {
  name: string;
  description: string;
  parameters?: SettingDefinition[];
}

/**
 * 设置定义
 */
export interface SettingDefinition {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "password" | "url";
  required: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helpText?: string;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
  };
}

/**
 * 连接器接口 (所有连接器必须实现)
 */
export interface IConnector {
  /** 唯一标识 */
  readonly id: string;
  /** 连接器类型 */
  readonly type: ConnectorType;
  /** 连接器版本 */
  readonly version: string;

  /**
   * 连接状态
   */
  getStatus(): ConnectorStatus;
  getLastError(): string | null;

  /**
   * 连接管理
   */
  connect(config: ConnectorConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  reconnect(): Promise<boolean>;
  test(): Promise<ConnectorTestResult>;

  /**
   * 事件处理
   */
  subscribe(event: string, handler: EventHandler): Promise<() => void>;
  unsubscribe(event: string, handler: EventHandler): void;

  /**
   * 消息发送
   */
  send(message: ConnectorMessage): Promise<ConnectorResponse>;
  sendBatch(messages: ConnectorMessage[]): Promise<ConnectorResponse[]>;

  /**
   * 数据查询
   */
  query(query: ConnectorQuery): Promise<ConnectorQueryResult>;

  /**
   * 生命周期
   */
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * 事件处理器
 */
export type EventHandler = (event: ConnectorEvent) => void | Promise<void>;

/**
 * 连接器事件
 */
export interface ConnectorEvent {
  type: string;
  source: string;
  timestamp: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * 连接器消息
 */
export interface ConnectorMessage {
  id?: string;
  channel?: string;
  recipient?: string;
  subject?: string;
  content: string;
  attachments?: ConnectorAttachment[];
  metadata?: Record<string, unknown>;
}

/**
 * 消息附件
 */
export interface ConnectorAttachment {
  name: string;
  type: string;
  url?: string;
  content?: string;
}

/**
 * 连接器响应
 */
export interface ConnectorResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  data?: unknown;
}

/**
 * 连接器查询
 */
export interface ConnectorQuery {
  type: "list" | "search" | "get" | "aggregate";
  entity: string;
  filter?: Record<string, unknown>;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  pagination?: { offset: number; limit: number };
  aggregation?: {
    field: string;
    operation: "count" | "sum" | "avg" | "min" | "max";
  };
}

/**
 * 查询结果
 */
export interface ConnectorQueryResult {
  items: unknown[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * 连接测试结果
 */
export interface ConnectorTestResult {
  success: boolean;
  latency?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * 连接器工厂
 */
export interface ConnectorFactory {
  createConnector(config: ConnectorConfig): IConnector;
  getMetadata(): ConnectorMetadata;
}

/**
 * 连接器注册表
 */
export class ConnectorRegistry {
  private connectors = new Map<ConnectorType, ConnectorFactory>();
  private instances = new Map<string, IConnector>();

  /**
   * 注册连接器工厂
   */
  register(type: ConnectorType, factory: ConnectorFactory): void {
    this.connectors.set(type, factory);
  }

  /**
   * 获取连接器工厂
   */
  getFactory(type: ConnectorType): ConnectorFactory | undefined {
    return this.connectors.get(type);
  }

  /**
   * 创建连接器实例
   */
  createInstance(id: string, config: ConnectorConfig): IConnector | undefined {
    const factory = this.connectors.get(config.type);
    if (!factory) return undefined;

    const connector = factory.createConnector(config);
    this.instances.set(id, connector);
    return connector;
  }

  /**
   * 获取连接器实例
   */
  getInstance(id: string): IConnector | undefined {
    return this.instances.get(id);
  }

  /**
   * 销毁连接器实例
   */
  async destroyInstance(id: string): Promise<void> {
    const connector = this.instances.get(id);
    if (connector) {
      await connector.destroy();
      this.instances.delete(id);
    }
  }

  /**
   * 获取所有已注册的连接器类型
   */
  getRegisteredTypes(): ConnectorType[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * 获取支持的连接器元数据
   */
  getAllMetadata(): ConnectorMetadata[] {
    const metadata: ConnectorMetadata[] = [];
    for (const factory of this.connectors.values()) {
      metadata.push(factory.getMetadata());
    }
    return metadata;
  }
}

/**
 * 全局连接器注册表实例
 */
export const globalConnectorRegistry = new ConnectorRegistry();

/**
 * 创建连接器实例的便捷函数
 */
export function createConnector(
  type: ConnectorType,
  config: ConnectorConfig,
): IConnector | undefined {
  const factory = globalConnectorRegistry.getFactory(type);
  if (!factory) return undefined;
  return factory.createConnector(config);
}

/**
 * 内置连接器类型定义
 */
export const BUILTIN_CONNECTOR_METADATA: Record<ConnectorType, ConnectorMetadata> = {
  slack: {
    id: "slack",
    type: "slack",
    name: "Slack",
    version: "1.0.0",
    description: "发送消息到 Slack 频道",
    capabilities: [
      { name: "send_message", description: "发送消息到频道" },
      { name: "list_channels", description: "列出所有频道" },
    ],
    authMethods: ["api_key", "oauth2"],
    requiredSettings: [
      { key: "token", label: "Bot Token", type: "password", required: true },
      { key: "default_channel", label: "默认频道", type: "string", required: false },
    ],
    events: ["message", "reaction", "thread_reply"],
  },
  github: {
    id: "github",
    type: "github",
    name: "GitHub",
    version: "1.0.0",
    description: "与 GitHub 集成",
    capabilities: [
      { name: "create_issue", description: "创建 Issue" },
      { name: "list_repos", description: "列出仓库" },
    ],
    authMethods: ["api_key", "oauth2"],
    requiredSettings: [
      { key: "token", label: "Personal Access Token", type: "password", required: true },
    ],
    events: ["push", "pull_request", "issue", "comment"],
  },
  linear: {
    id: "linear",
    type: "linear",
    name: "Linear",
    version: "1.0.0",
    description: "与 Linear 项目管理集成",
    capabilities: [
      { name: "create_issue", description: "创建 Issue" },
      { name: "list_teams", description: "列出团队" },
    ],
    authMethods: ["api_key"],
    requiredSettings: [{ key: "api_key", label: "API Key", type: "password", required: true }],
    events: ["issue_created", "issue_updated", "comment"],
  },
  notion: {
    id: "notion",
    type: "notion",
    name: "Notion",
    version: "1.0.0",
    description: "与 Notion 笔记集成",
    capabilities: [
      { name: "create_page", description: "创建页面" },
      { name: "query_database", description: "查询数据库" },
    ],
    authMethods: ["api_key"],
    requiredSettings: [
      { key: "api_key", label: "Integration Token", type: "password", required: true },
    ],
    events: ["page_created", "page_updated", "comment"],
  },
  jira: {
    id: "jira",
    type: "jira",
    name: "Jira",
    version: "1.0.0",
    description: "与 Jira 项目管理集成",
    capabilities: [
      { name: "create_issue", description: "创建 Issue" },
      { name: "list_projects", description: "列出项目" },
    ],
    authMethods: ["basic", "api_key", "oauth2"],
    requiredSettings: [
      { key: "url", label: "Jira URL", type: "url", required: true },
      { key: "email", label: "Email", type: "string", required: true },
      { key: "api_key", label: "API Key", type: "password", required: true },
    ],
    events: ["issue_created", "issue_updated", "sprint_started"],
  },
  feishu: {
    id: "feishu",
    type: "feishu",
    name: "飞书",
    version: "1.0.0",
    description: "与飞书集成",
    capabilities: [
      { name: "send_message", description: "发送消息" },
      { name: "create_task", description: "创建任务" },
    ],
    authMethods: ["api_key"],
    requiredSettings: [
      { key: "app_id", label: "App ID", type: "string", required: true },
      { key: "app_secret", label: "App Secret", type: "password", required: true },
    ],
    events: ["message", "bot_mention", "card_action"],
  },
  discord: {
    id: "discord",
    type: "discord",
    name: "Discord",
    version: "1.0.0",
    description: "发送消息到 Discord",
    capabilities: [{ name: "send_message", description: "发送消息到频道" }],
    authMethods: ["api_key"],
    requiredSettings: [{ key: "webhook_url", label: "Webhook URL", type: "url", required: true }],
    events: ["message"],
  },
  webhook: {
    id: "webhook",
    type: "webhook",
    name: "通用 Webhook",
    version: "1.0.0",
    description: "发送 HTTP POST 请求",
    capabilities: [{ name: "send", description: "发送 HTTP 请求" }],
    authMethods: ["bearer", "basic", "api_key"],
    requiredSettings: [{ key: "url", label: "Webhook URL", type: "url", required: true }],
    events: [],
  },
  email: {
    id: "email",
    type: "email",
    name: "Email",
    version: "1.0.0",
    description: "发送电子邮件",
    capabilities: [{ name: "send", description: "发送邮件" }],
    authMethods: ["basic"],
    requiredSettings: [
      { key: "smtp_host", label: "SMTP 主机", type: "string", required: true },
      { key: "smtp_port", label: "SMTP 端口", type: "number", required: true },
      { key: "username", label: "用户名", type: "string", required: true },
      { key: "password", label: "密码", type: "password", required: true },
    ],
    events: [],
  },
  custom: {
    id: "custom",
    type: "custom",
    name: "自定义连接器",
    version: "1.0.0",
    description: "创建自定义连接器",
    capabilities: [],
    authMethods: ["api_key", "bearer", "basic", "webhook"],
    requiredSettings: [{ key: "url", label: "API URL", type: "url", required: true }],
    events: [],
  },
};
