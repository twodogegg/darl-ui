import type { ModelProvider, AgentModelConfig } from '../../../src/index';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { dynamicTool, jsonSchema, stepCountIs, streamText, ToolLoopAgent, type LanguageModel, type ModelMessage } from 'ai';
import { failure } from './errors';
import { sourceBoundMessage, structuredAgentResult, type StructuredAgentResult } from './context';

export interface StoredProvider extends ModelProvider { apiKey: string }
export interface ChatImage { type: 'image'; name: string; mimeType: string; data: string; size?: number; fileId?: string }
export type ChatContent = string | Array<{ type: 'text'; text: string } | ChatImage>;
export interface ChatMessage { role: 'user' | 'assistant'; content: ChatContent }

export function validateProvider(value: ModelProvider): ModelProvider {
  if (!value || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || !value.name?.trim()) throw new Error('提供方 ID 仅支持字母、数字、下划线和短横线');
  const url = new URL(value.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写有效的 HTTP(S) API 地址');
  if (!['openai-completions', 'openai-responses'].includes(value.protocol)) throw new Error('不支持的 API 协议');
  if (!Array.isArray(value.models) || value.models.length > 2000) throw new Error('模型目录无效');
  const ids = new Set<string>();
  const models: AgentModelConfig[] = value.models.map((model) => {
    if (!model.id?.trim() || !model.name?.trim() || ids.has(model.id) || !['text', 'image', 'video', 'audio'].includes(model.type)) throw new Error('模型 ID 重复或模型配置无效');
    ids.add(model.id);
    if (model.reasoningEfforts && (!Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.some((effort) => !['minimal', 'low', 'medium', 'high', 'xhigh', '低', '中', '高'].includes(effort)))) throw new Error('请填写模型支持的推理强度，如 low, medium, high');
    return { id: model.id, name: model.name, type: model.type, providerId: value.id, enabled: model.enabled !== false, reasoningEfforts: model.reasoningEfforts, capabilities: model.capabilities };
  });
  return { id: value.id, name: value.name.trim(), baseUrl: url.toString().replace(/\/$/, ''), protocol: value.protocol, status: 'unknown', models };
}

export function publicProvider({ apiKey, ...provider }: StoredProvider): ModelProvider {
  return { ...provider, hasApiKey: Boolean(apiKey) };
}

export function safeError(reason: unknown, key = '') {
  let message = reason instanceof Error ? reason.message : '请求失败';
  if (key) message = message.split(key).join('[已隐藏]');
  message = message.replace(/(?:sk|ahk)_[\w-]+|sk-[\w-]+/g, '[已隐藏]');
  if (/network error|failed to fetch|fetch failed|econnreset|etimedout|enotfound|socket hang up/i.test(message)) {
    return '无法连接模型服务，请检查 API 地址、网络或代理设置后重试';
  }
  return message.slice(0, 400);
}

async function upstream(provider: StoredProvider, path: string, signal: AbortSignal, body?: unknown) {
  if (!provider.apiKey) throw new Error('请先在设置中保存 API Key');
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/${path}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: { Authorization: `Bearer ${provider.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(safeError(new Error(`模型接口 HTTP ${response.status}：${payload?.error?.message || '请求失败，请检查模型和提供方设置'}`), provider.apiKey));
  }
  return response;
}

export async function listModels(provider: StoredProvider, signal: AbortSignal): Promise<AgentModelConfig[]> {
  const data = await (await upstream(provider, 'models', signal)).json();
  if (!Array.isArray(data.data)) throw new Error('接口没有返回模型列表');
  return data.data.map((item: { id: string }) => {
    if (typeof item.id !== 'string' || !item.id) throw new Error('模型列表格式无效');
    return provider.models.find((model) => model.id === item.id) ?? { id: item.id, name: item.id, providerId: provider.id, type: 'text', enabled: false };
  });
}

export interface FunctionTool { name: string; description?: string; parameters: Record<string, unknown> }
export interface FunctionCall { id: string; name: string; arguments: string }
export interface ToolExecution {
  tools: FunctionTool[];
  maxSteps?: number;
  execute: (call: FunctionCall, signal?: AbortSignal) => Promise<string>;
}

export interface AgentDelegation {
  name: string;
  /** Explicit mentions must be attempted before the main Agent can finish. */
  required?: boolean;
  description: string;
  execute: (task: string, context: Array<Record<string, unknown>>, signal: AbortSignal) => Promise<StructuredAgentResult>;
}

/** Hold only a possible protocol prefix, so split markers never reach the UI. */
export async function* checkedText(chunks: AsyncIterable<string>) {
  const markers = ['<budget:token_budget', '<｜｜DSML｜｜'];
  let prefix = '';
  let accepted = false;
  for await (const chunk of chunks) {
    if (accepted) { yield chunk; continue; }
    prefix += chunk;
    const start = prefix.trimStart();
    if (markers.some((marker) => start.startsWith(marker))) throw new Error('模型接口返回了内部协议标记，请重新生成；若反复出现，请检查提供方或更换模型');
    if (markers.some((marker) => marker.startsWith(start))) continue;
    accepted = true;
    yield prefix;
    prefix = '';
  }
  if (prefix) yield prefix;
}

function reasoningValue(effort: string | undefined) {
  return effort && ({ 低: 'low', 中: 'medium', 高: 'high' }[effort] || effort);
}

export function languageModel(provider: StoredProvider, model: AgentModelConfig): LanguageModel {
  if (!provider.apiKey) throw new Error('请先在设置中保存 API Key');
  if (provider.protocol === 'openai-responses') {
    return createOpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey, name: provider.id }).responses(model.id);
  }
  return createOpenAICompatible({ baseURL: provider.baseUrl, apiKey: provider.apiKey, name: provider.id, includeUsage: true }).chatModel(model.id);
}

export function modelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : message.content.map((item) => item.type === 'text'
      ? { type: 'text' as const, text: item.text }
      : { type: 'image' as const, image: `data:${item.mimeType};base64,${item.data}`, mediaType: item.mimeType }),
  })) as ModelMessage[];
}

const mcpSchemaValidator = new AjvJsonSchemaValidator();

export function aiTools(execution: ToolExecution | undefined, signal: AbortSignal) {
  if (!execution) return undefined;
  return Object.fromEntries(execution.tools.map((tool) => [tool.name, dynamicTool({
    description: tool.description || '',
    inputSchema: jsonSchema(tool.parameters as Parameters<typeof jsonSchema>[0], {
      validate: (input) => {
        const result = mcpSchemaValidator.getValidator(tool.parameters as Parameters<typeof jsonSchema>[0])(input);
        return result.valid ? { success: true, value: result.data } : { success: false, error: failure('tool-validation', 'TOOL_ARGUMENT_INVALID', '工具参数不符合要求', false) };
      },
    }),
    execute: async (input, options) => {
      const callSignal = options.abortSignal ? AbortSignal.any([signal, options.abortSignal]) : signal;
      callSignal.throwIfAborted();
      const result = await execution.execute({ id: options.toolCallId, name: tool.name, arguments: JSON.stringify(input) }, callSignal);
      callSignal.throwIfAborted();
      return result;
    },
  })]));
}

export async function* generate(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution) {
  signal.throwIfAborted();
  if (!messages.length) throw new Error('对话消息不能为空');
  const reasoning = reasoningValue(effort);
  const providerOptionsName = provider.protocol === 'openai-responses' ? 'openai' : provider.id;
  const result = streamText({
    model: languageModel(provider, model),
    system: instructions,
    messages: modelMessages(messages.map(sourceBoundMessage)),
    tools: model.capabilities?.tools === false ? undefined : aiTools(execution, signal),
    stopWhen: stepCountIs(execution?.maxSteps ?? 8),
    toolCallConcurrency: 1,
    maxRetries: 2,
    abortSignal: signal,
    ...(reasoning ? { providerOptions: { [providerOptionsName]: { reasoningEffort: reasoning } } } : {}),
  });
  let hasText = false;
  for await (const text of checkedText(result.textStream)) {
    hasText = true;
    yield text;
  }
  signal.throwIfAborted();
  const finishReason = await result.finishReason;
  if (finishReason === 'length') throw new Error('已达到模型输出长度限制');
  if (finishReason === 'tool-calls') throw failure('runtime', 'TOOL_STEP_LIMIT', '已达到本轮工具调用上限，任务尚未结束。工作区文件已保留，可继续对话。', false);
  if (!hasText) throw new Error('模型没有返回文本内容');
}

function loopTools(execution: ToolExecution | undefined, delegations: AgentDelegation[] | undefined, signal: AbortSignal) {
  const tools: Record<string, unknown> = { ...(aiTools(execution, signal) || {}) };
  for (const delegation of delegations || []) {
    tools[delegation.name] = dynamicTool({
      description: delegation.description,
      inputSchema: jsonSchema({ type: 'object', properties: { task: { type: 'string', description: '只包含完成任务所需的说明，不要复制主 Agent 的完整历史' }, context: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: true }, description: '仅在明确需要时传递的结构化资料引用' } }, required: ['task'], additionalProperties: false }),
      execute: async (input, options) => {
        const task = (input as { task?: unknown })?.task;
        if (typeof task !== 'string' || !task.trim()) throw new Error('子任务说明不能为空');
        const context = (input as { context?: unknown }).context;
        return delegation.execute(task, Array.isArray(context) ? context as Array<Record<string, unknown>> : [], options.abortSignal ? AbortSignal.any([signal, options.abortSignal]) : signal);
      },
    });
  }
  return tools;
}

function createToolLoopAgent(provider: StoredProvider, model: AgentModelConfig, instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution, delegations?: AgentDelegation[]) {
  const reasoning = reasoningValue(effort);
  const providerOptionsName = provider.protocol === 'openai-responses' ? 'openai' : provider.id;
  const pending = new Set(delegations?.filter(item => item.required).map(item => item.name));
  const tracked = delegations?.map(item => ({ ...item, execute: (...args: Parameters<AgentDelegation['execute']>) => { pending.delete(item.name); return item.execute(...args); } }));
  return new ToolLoopAgent({
    model: languageModel(provider, model),
    instructions,
    tools: model.capabilities?.tools === false ? {} : loopTools(execution, tracked, signal),
    prepareStep: () => {
      const name = pending.values().next().value;
      return name ? { activeTools: [name], toolChoice: { type: 'tool' as const, toolName: name } } : {};
    },
    stopWhen: stepCountIs(Math.max(execution?.maxSteps ?? 8, pending.size + 1)),
    toolCallConcurrency: 1,
    maxRetries: 2,
    ...(reasoning ? { providerOptions: { [providerOptionsName]: { reasoningEffort: reasoning } } } : {}),
  } as never);
}

/** Stream a configured Agent. Each call receives only the messages passed by the host. */
export async function* generateWithToolLoop(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution, delegations?: AgentDelegation[]) {
  signal.throwIfAborted();
  if (!messages.length) throw new Error('对话消息不能为空');
  const agent = createToolLoopAgent(provider, model, instructions, effort, signal, execution, delegations);
  const result = await agent.stream({ messages: modelMessages(messages.map(sourceBoundMessage)), abortSignal: signal });
  let hasText = false;
  for await (const text of checkedText(result.textStream)) { hasText = true; yield text; }
  signal.throwIfAborted();
  const finishReason = await result.finishReason;
  if (finishReason === 'length') throw new Error('已达到模型输出长度限制');
  if (finishReason === 'tool-calls') throw failure('runtime', 'TOOL_STEP_LIMIT', '已达到本轮工具调用上限，任务尚未结束。工作区文件已保留，可继续对话。', false);
  if (!hasText) throw new Error('模型没有返回文本内容');
}

/** Execute one isolated child context and return only its final text. */
export async function runToolLoopAgent(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution) {
  signal.throwIfAborted();
  const agent = createToolLoopAgent(provider, model, instructions, effort, signal, execution);
  if (!messages.length) throw new Error('子 Agent 对话不能为空');
  const result = await agent.generate({ messages: modelMessages(messages.map(sourceBoundMessage)), abortSignal: signal });
  signal.throwIfAborted();
  if (result.finishReason === 'tool-calls') throw failure('runtime', 'TOOL_STEP_LIMIT', '子 Agent 已达到本轮工具调用上限，任务尚未结束。', false);
  return structuredAgentResult(result.text);
}
