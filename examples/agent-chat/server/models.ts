import type { ModelProvider, AgentModelConfig } from '../../../src/index';
import { events } from '../stream';

export interface StoredProvider extends ModelProvider { apiKey: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

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
  return message.replace(/(?:sk|ahk)_[\w-]+|sk-[\w-]+/g, '[已隐藏]').slice(0, 400);
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
  execute: (call: FunctionCall) => Promise<string>;
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

async function* generateRaw(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal, execution?: ToolExecution) {
  const reasoning = effort && ({ 低: 'low', 中: 'medium', 高: 'high' }[effort] || effort);
  const responses = provider.protocol === 'openai-responses';
  const history: unknown[] = responses ? [...messages] : [{ role: 'system', content: instructions }, ...messages];
  const tools = execution?.tools.map((tool) => responses
    ? { type: 'function', ...tool, strict: false }
    : { type: 'function', function: tool });
  for (let round = 0; round < 8; round++) {
    signal.throwIfAborted();
    const body = responses
      ? { model: model.id, input: history, instructions, stream: true, store: false, ...(reasoning ? { reasoning: { effort: reasoning }, include: ['reasoning.encrypted_content'] } : {}) }
      : { model: model.id, messages: history, stream: true, ...(reasoning ? { reasoning_effort: reasoning } : {}) };
    const response = await upstream(provider, responses ? 'responses' : 'chat/completions', signal, { ...body, ...(tools?.length ? { tools, parallel_tool_calls: false } : {}) });
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('模型没有返回流式响应');
    let completed = false;
    let text = '';
    const calls = new Map<number, FunctionCall>();
    const output: Record<string, unknown>[] = [];
    for await (const data of events(response.body)) {
      if (data === '[DONE]') { completed = true; break; }
      const event = JSON.parse(data);
      if (event.error || event.type === 'response.failed' || event.type === 'error') throw new Error(safeError(new Error(event.error?.message || event.response?.error?.message || event.message || '模型生成失败'), provider.apiKey));
      if (event.type === 'response.incomplete') throw new Error('模型输出未完成，请重新生成');
      if (event.type === 'response.output_item.done') output[event.output_index] = event.item;
      if (event.type === 'response.completed') {
        if (Array.isArray(event.response?.output)) output.splice(0, output.length, ...event.response.output);
        completed = true;
        break;
      }
      const choice = event.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('已达到模型输出长度限制');
      if (choice?.finish_reason === 'content_filter') throw new Error('模型未能输出此内容');
      if (choice?.finish_reason) completed = true;
      for (const delta of choice?.delta?.tool_calls || []) {
        if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index > 15) throw new Error('模型工具调用数量或索引无效');
        const call = calls.get(delta.index) || { id: '', name: '', arguments: '' };
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.name += delta.function.name;
        if (delta.function?.arguments) call.arguments += delta.function.arguments;
        if (call.arguments.length > 100_000) throw new Error('工具参数过长');
        calls.set(delta.index, call);
      }
      const delta = responses ? (event.type === 'response.output_text.delta' ? event.delta : '') : choice?.delta?.content;
      if (typeof delta === 'string' && delta) { text += delta; yield delta; }
    }
    if (!completed) throw new Error('模型连接中断，请重新生成');
    if (responses) {
      for (const item of output) {
        if (item?.type === 'function_call') calls.set(calls.size, { id: String(item.call_id || ''), name: String(item.name || ''), arguments: String(item.arguments || '') });
      }
    }
    if (!calls.size) {
      if (!text) throw new Error('模型没有返回文本内容');
      return;
    }
    if (!execution || calls.size > 16) throw new Error('模型请求了不可用的工具');
    const requested = [...calls.values()];
    if (requested.some((call) => !call.id || !call.name || call.arguments.length > 100_000) || new Set(requested.map((call) => call.id)).size !== requested.length) throw new Error('模型工具调用格式无效');
    if (round === 7) throw new Error('已达到 8 轮工具调用上限，请缩小任务范围后继续');
    if (responses) history.push(...output);
    else history.push({ role: 'assistant', content: text || null, tool_calls: requested.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });
    for (const call of requested) {
      signal.throwIfAborted();
      const result = await execution.execute(call);
      if (responses) history.push({ type: 'function_call_output', call_id: call.id, output: result });
      else history.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    if (text) yield '\n\n';
  }
}
