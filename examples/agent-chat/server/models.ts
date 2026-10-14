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
  return message.replace(/sk-[\w-]+/g, '[已隐藏]').slice(0, 400);
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

export async function* generate(provider: StoredProvider, model: AgentModelConfig, messages: ChatMessage[], instructions: string, effort: string | undefined, signal: AbortSignal) {
  const reasoning = effort && ({ 低: 'low', 中: 'medium', 高: 'high' }[effort] || effort);
  const responses = provider.protocol === 'openai-responses';
  const body = responses
    ? { model: model.id, input: messages, instructions, stream: true, store: false, ...(reasoning ? { reasoning: { effort: reasoning } } : {}) }
    : { model: model.id, messages: [{ role: 'system', content: instructions }, ...messages], stream: true, ...(reasoning ? { reasoning_effort: reasoning } : {}) };
  const response = await upstream(provider, responses ? 'responses' : 'chat/completions', signal, body);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('模型没有返回流式响应');
  let completed = false;
  let hasText = false;
  for await (const data of events(response.body)) {
    if (data === '[DONE]') { completed = true; break; }
    const event = JSON.parse(data);
    if (event.error || event.type === 'response.failed' || event.type === 'error') throw new Error(safeError(new Error(event.error?.message || event.response?.error?.message || event.message || '模型生成失败'), provider.apiKey));
    if (event.type === 'response.incomplete') throw new Error('模型输出未完成，请重新生成');
    if (event.type === 'response.completed') { completed = true; break; }
    const choice = event.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('已达到模型输出长度限制');
    if (choice?.finish_reason === 'content_filter') throw new Error('模型未能输出此内容');
    if (choice?.finish_reason) completed = true;
    const delta = responses ? (event.type === 'response.output_text.delta' ? event.delta : '') : choice?.delta?.content;
    if (typeof delta === 'string' && delta) { hasText = true; yield delta; }
  }
  if (!completed) throw new Error('模型连接中断，请重新生成');
  if (!hasText) throw new Error('模型没有返回文本内容');
}
