import type { ModelProvider, AgentModelConfig } from '../../../src/index';
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Model } from '@earendil-works/pi-ai';
import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses';

export interface StoredProvider extends ModelProvider { apiKey: string }
export interface ChatImage { type: 'image'; name: string; mimeType: string; data: string; size?: number }
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
    if (model.reasoningEfforts && (!Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.some((effort) => !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', '低', '中', '高'].includes(effort)))) throw new Error('请填写模型支持的推理强度，如 low, medium, high');
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
  execute: (call: FunctionCall, signal?: AbortSignal) => Promise<string>;
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

export async function* generate(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution) {
  yield* checkedText(generateRaw(provider, model, messages, instructions, effort, signal, execution));
}

export function piModel(provider: StoredProvider, model: AgentModelConfig): Model<'openai-completions' | 'openai-responses'> {
  return {
    id: model.id, name: model.name, api: provider.protocol, provider: provider.id, baseUrl: provider.baseUrl,
    reasoning: Boolean(model.reasoningEfforts?.length), input: model.capabilities?.vision === false ? ['text'] : ['text', 'image'],
    // Metadata is unknown for user-configured models; native streams do not send token limits.
    contextWindow: model.capabilities?.contextWindow ?? 0, maxTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, supportsStrictMode: false },
  };
}

export function piHistory(messages: ChatMessage[], model: Model<'openai-completions' | 'openai-responses'>): AgentMessage[] {
  const textOf = (content: ChatContent) => typeof content === 'string' ? content : content.filter((item): item is { type: 'text'; text: string } => item.type === 'text').map((item) => item.text).join('\n');
  return messages.map<AgentMessage>((message) => message.role === 'user'
    ? { role: 'user', content: typeof message.content === 'string' ? message.content : message.content.map((item) => item.type === 'text' ? { type: 'text', text: item.text } : { type: 'image', data: item.data, mimeType: item.mimeType }), timestamp: Date.now() }
    : { role: 'assistant', content: [{ type: 'text', text: textOf(message.content) }], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
}

export function piTools(execution: ToolExecution | undefined, signal: AbortSignal): AgentTool[] {
  return execution?.tools.map((tool) => ({
    name: tool.name, label: tool.name, description: tool.description || '', parameters: Type.Unsafe<Record<string, unknown>>(tool.parameters),
    execute: async (id, params, toolSignal) => {
      const callSignal = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
      callSignal.throwIfAborted();
      const text = await execution.execute({ id, name: tool.name, arguments: JSON.stringify(params) }, callSignal);
      callSignal.throwIfAborted();
      let isError = false;
      try { isError = JSON.parse(text)?.isError === true; } catch { /* Plain text tool results remain valid. */ }
      return { content: [{ type: 'text', text }], details: undefined, isError };
    },
  })) ?? [];
}

async function* generateRaw(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution) {
  signal.throwIfAborted();
  if (!provider.apiKey) throw new Error('请先在设置中保存 API Key');
  if (!messages.length) throw new Error('对话消息不能为空');
  const reasoning = effort && ({ 低: 'low', 中: 'medium', 高: 'high' }[effort] || effort);
  const channel = new TransformStream<string, string>();
  const writer = channel.writable.getWriter();
  const reader = channel.readable.getReader();
  let rounds = 0;
  let turnHasText = false;
  let failure: Error | undefined;
  const selectedModel = piModel(provider, model);
  const agent = new Agent({
    initialState: { model: selectedModel, systemPrompt: instructions, messages: piHistory(messages, selectedModel), tools: piTools(execution, signal) },
    toolExecution: 'sequential',
    prepareRequest: async () => {
      signal.throwIfAborted();
      if (++rounds > 8) throw new Error('已达到 8 轮工具调用上限，请缩小任务范围后继续');
    },
    streamFn: (selected, context, options) => {
      const request = { ...options, apiKey: provider.apiKey, signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]), maxRetries: 0,
        onPayload: (payload: unknown) => {
          // Preserve the host's explicitly configured effort, including "none"; no inferred defaults.
          const body = payload as Record<string, unknown>;
          if (provider.protocol === 'openai-responses') {
            if (reasoning) { body.reasoning = { effort: reasoning }; body.include = ['reasoning.encrypted_content']; }
            else { delete body.reasoning; delete body.include; }
          } else {
            if (reasoning) body.reasoning_effort = reasoning;
            else delete body.reasoning_effort;
          }
          if (Array.isArray(body.tools) && body.tools.length) body.parallel_tool_calls = false;
        } };
      return provider.protocol === 'openai-responses'
        ? streamResponses(selected as Model<'openai-responses'>, context, request)
        : streamCompletions(selected as Model<'openai-completions'>, context, request);
    },
  });
  const unsubscribe = agent.subscribe(async (event) => {
    if (event.type === 'turn_start') {
      if (turnHasText) await writer.write('\n\n');
      turnHasText = false;
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      turnHasText = true;
      await writer.write(event.assistantMessageEvent.delta);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message;
      const calls = message.content.filter((block) => block.type === 'toolCall');
      if (message.stopReason === 'error') failure ??= new Error(message.errorMessage || '模型生成失败');
      if (message.stopReason === 'length') failure ??= new Error('已达到模型输出长度限制');
      if (message.stopReason === 'aborted') failure ??= new Error('模型生成已停止');
      if (calls.length > 16 || calls.some((call) => !call.id || !call.name || JSON.stringify(call.arguments).length > 100_000) || new Set(calls.map((call) => call.id)).size !== calls.length) failure ??= new Error('模型工具调用数量或格式无效');
      if (rounds === 8 && calls.length) failure ??= new Error('已达到 8 轮工具调用上限，请缩小任务范围后继续');
      if (failure) agent.abort();
    }
  });
  const abort = () => agent.abort();
  signal.addEventListener('abort', abort, { once: true });
  const run = (async () => {
    try {
      await agent.continue();
      signal.throwIfAborted();
      if (failure || agent.state.errorMessage) throw failure || new Error(agent.state.errorMessage);
      if (!turnHasText) throw new Error('模型没有返回文本内容');
      await writer.close();
    } catch (reason) { await writer.abort(new Error(safeError(reason, provider.apiKey))).catch(() => {}); }
  })();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    agent.abort();
    await reader.cancel().catch(() => {});
    await run;
    unsubscribe();
    signal.removeEventListener('abort', abort);
    reader.releaseLock(); writer.releaseLock();
  }
}
