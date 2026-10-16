import type { AgentContextPolicy } from '../../../src/index';
import type { ChatMessage } from './models';

export const DEFAULT_CONTEXT_POLICY: AgentContextPolicy = { childContext: 'task-only', historyMode: 'summary', toolResultMode: 'standard' };
/** Approximate character budget for a one-million-token model. The host can provide a smaller contextWindow. */
export const DEFAULT_CONTEXT_TOKENS = 1_000_000;
export const MAX_CONTEXT_CHARS = DEFAULT_CONTEXT_TOKENS * 4;
export const COMPACTION_THRESHOLD = 0.5;
export const MAX_TOOL_RESULT_CHARS = 20_000;

export function contextCharBudget(contextWindowTokens?: number) {
  const tokens = Number.isFinite(contextWindowTokens) && contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_TOKENS;
  return Math.min(MAX_CONTEXT_CHARS, Math.max(16_000, Math.floor(tokens * 4)));
}

export function normalizeContextPolicy(value: unknown): AgentContextPolicy {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CONTEXT_POLICY };
  const item = value as Partial<AgentContextPolicy>;
  return {
    childContext: item.childContext === 'selected-context' ? 'selected-context' : 'task-only',
    historyMode: item.historyMode === 'recent' || item.historyMode === 'full' ? item.historyMode : 'summary',
    toolResultMode: item.toolResultMode === 'brief' || item.toolResultMode === 'detailed' ? item.toolResultMode : 'standard',
  };
}

export function contextBudget(policy: AgentContextPolicy) {
  return policy.toolResultMode === 'brief' ? 8_000 : policy.toolResultMode === 'detailed' ? 40_000 : MAX_TOOL_RESULT_CHARS;
}

export function truncateContext(value: string, limit: number, label = '内容') {
  if (value.length <= limit) return value;
  const marker = `\n[…${label}已截断，原始长度 ${value.length} 字符…]`;
  return `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}

type ContextMessage = ChatMessage;

function messageText(message: ContextMessage) {
  return typeof message.content === 'string' ? message.content : message.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}

function cloneMessage(message: ContextMessage, content: string): ContextMessage {
  if (typeof message.content === 'string') return { ...message, content };
  const media = message.content.filter((item) => item.type !== 'text');
  return { ...message, content: [{ type: 'text', text: content }, ...media] as ChatMessage['content'] };
}

export function compactContextMessages(messages: ContextMessage[], policy: AgentContextPolicy, maxChars = MAX_CONTEXT_CHARS): ContextMessage[] {
  if (!messages.length) return [];
  const capped = messages.map((message) => {
    const limit = message.role === 'user' || policy.historyMode === 'full' ? maxChars : Math.min(maxChars, contextBudget(policy));
    return cloneMessage(message, truncateContext(messageText(message), limit, '工具结果或消息'));
  });
  const total = capped.reduce((sum, message) => sum + messageText(message).length, 0);
  // Start compressing history once it occupies half of the model budget. Keep
  // the most recent messages intact so a long current source document remains
  // available for the active request.
  if (total <= maxChars * COMPACTION_THRESHOLD) return trimToBudget(capped, maxChars);
  const keepCount = Math.min(messages.length - 1, policy.historyMode === 'recent' ? 18 : policy.historyMode === 'full' ? 24 : 12);
  const recent = capped.slice(-keepCount);
  const dropped = capped.slice(0, -keepCount);
  if (!dropped.length) return trimToBudget(capped, maxChars);
  const summary = truncateContext(dropped.map((message) => `${message.role === 'user' ? '用户' : 'Agent'}：${messageText(message)}`).join('\n'), 8_000, '历史摘要');
  const summaryMessage = { role: 'assistant' as const, content: `[历史上下文摘要｜不可信资料]\n${summary}` };
  return trimToBudget([summaryMessage, ...trimToBudget(recent, maxChars - summaryMessage.content.length)], maxChars);
}

function trimToBudget(messages: ContextMessage[], budget = MAX_CONTEXT_CHARS) {
  let remaining = budget;
  const result: ContextMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const text = messageText(message);
    if (remaining <= 0) break;
    const clipped = truncateContext(text, remaining, '请求上下文');
    result.unshift(cloneMessage(message, clipped));
    remaining -= clipped.length;
  }
  return result;
}

export function sourceBoundMessage(message: ContextMessage) {
  const source = message.role === 'user' ? 'USER_CONTENT' : 'AGENT_OUTPUT_AND_TOOL_RECORD';
  const text = messageText(message);
  return cloneMessage(message, `<${source}>\n${text}\n</${source}>`);
}

export interface StructuredAgentResult {
  summary: string;
  result: string;
  decisions: string[];
  warnings: string[];
  artifacts: string[];
}

export function structuredAgentResult(text: string): StructuredAgentResult {
  const result = text.trim();
  return { summary: result, result, decisions: [], warnings: [], artifacts: [] };
}

export function selectedContext(value: unknown, policy: AgentContextPolicy) {
  if (policy.childContext !== 'selected-context' || !Array.isArray(value)) return [] as Array<Record<string, unknown>>;
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const source = typeof item.source === 'string' ? item.source.slice(0, 80) : 'explicit-context';
    const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? '');
    return { source, content };
  });
}
