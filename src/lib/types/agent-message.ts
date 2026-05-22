/**
 * Agent Message Types - Agent 消息协议
 *
 * 定义 Agent 之间通信的标准消息格式
 */

export type MessagePriority = "low" | "normal" | "high" | "urgent";
export type MessageType = "request" | "response" | "broadcast" | "delegate";

/**
 * Agent 消息结构
 */
export interface AgentMessage {
  id: string;
  source: string; // 源 Agent ID
  target?: string; // 单播时可指定目标，undefined 表示广播
  type: MessageType;
  action: string; // 操作类型
  payload: unknown; // 消息内容
  conversationRef?: string; // 对话引用（用于追踪相关消息）
  priority: MessagePriority; // 优先级
  deadline?: string; // ISO 时间戳，表示期望完成时间
  correlationId?: string; // 用于追踪请求-响应对
  timestamp: string; // 发送时间
  retryCount?: number; // 已重试次数
}

/**
 * Agent 消息处理器接口
 */
export interface AgentMessageHandler {
  canHandle(message: AgentMessage): boolean;
  handle(message: AgentMessage): Promise<AgentMessage | void>;
}

/**
 * 死信消息（无法投递的消息）
 */
export interface DeadLetter {
  message: AgentMessage;
  reason: string;
  failedAt: string;
  originalError?: string;
}

/**
 * 消息订阅关系
 */
export interface MessageSubscription {
  agentId: string;
  eventTypes: string[];
  filter?: (message: AgentMessage) => boolean;
}

/**
 * 创建标准 Agent 消息
 */
export function createAgentMessage(
  source: string,
  type: MessageType,
  action: string,
  payload: unknown,
  options?: Partial<Pick<AgentMessage, "target" | "priority" | "deadline" | "correlationId">>,
): AgentMessage {
  return {
    id: crypto.randomUUID(),
    source,
    type,
    action,
    payload,
    priority: options?.priority ?? "normal",
    target: options?.target,
    deadline: options?.deadline,
    correlationId: options?.correlationId,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  };
}

/**
 * 创建响应消息
 */
export function createResponseMessage(request: AgentMessage, payload: unknown): AgentMessage {
  return createAgentMessage(request.target || "system", "response", request.action, payload, {
    correlationId: request.id,
    priority: request.priority,
  });
}

/**
 * 创建委托消息
 */
export function createDelegateMessage(
  source: string,
  target: string,
  originalMessage: AgentMessage,
): AgentMessage {
  return createAgentMessage(source, "delegate", originalMessage.action, originalMessage.payload, {
    target,
    priority: originalMessage.priority,
    correlationId: originalMessage.correlationId,
  });
}
