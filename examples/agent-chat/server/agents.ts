import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentConfig } from '../../../src/index';

export type StoredAgent = AgentConfig;

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const defaultContextPolicy = { childContext: 'task-only' as const, historyMode: 'summary' as const, toolResultMode: 'standard' as const };
const list = (value: unknown, label: string, max = 50) => {
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} 配置无效`);
  return [...new Set(value.map((item) => item.trim()))];
};

export function validateAgent(value: unknown, existing: StoredAgent[] = []): StoredAgent {
  if (!value || typeof value !== 'object') throw new Error('Agent 配置无效');
  const item = value as Partial<AgentConfig>;
  if (typeof item.id !== 'string' || !idPattern.test(item.id) || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Agent ID 或名称无效');
  if (item.avatar !== undefined && (typeof item.avatar !== 'string' || /[\u0000-\u001f\u007f]/.test(item.avatar) || (item.avatar.startsWith('data:image/') ? item.avatar.length > 12_000_000 || !/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(item.avatar) : item.avatar.length > 1000))) throw new Error('Agent 头像格式无效');
  if (typeof item.instructions !== 'string' || !item.instructions.trim()) throw new Error('Agent 系统提示词不能为空');
  if (typeof item.providerId !== 'string' || !item.providerId.trim() || typeof item.modelId !== 'string' || !item.modelId.trim()) throw new Error('Agent 必须选择模型');
  const skillIds = list(item.skillIds, 'Skill');
  const applicationIds = list(item.applicationIds, 'MCP 应用', 20);
  const applicationTools: Record<string, string[]> = {};
  if (item.applicationTools !== undefined) {
    if (!item.applicationTools || typeof item.applicationTools !== 'object' || Array.isArray(item.applicationTools)) throw new Error('MCP 工具权限配置无效');
    for (const [appId, tools] of Object.entries(item.applicationTools)) applicationTools[appId] = list(tools, 'MCP 工具', 128);
  }
  if (item.reasoningEfforts !== undefined && (!Array.isArray(item.reasoningEfforts) || item.reasoningEfforts.some((effort) => typeof effort !== 'string' || effort.length > 40))) throw new Error('推理强度配置无效');
  if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error('Agent 启用状态无效');
  if (item.isDefault !== undefined && typeof item.isDefault !== 'boolean') throw new Error('Agent 默认状态无效');
  if (item.builtIn !== undefined && typeof item.builtIn !== 'boolean') throw new Error('Agent 内置状态无效');
  const contextPolicy = item.contextPolicy === undefined ? defaultContextPolicy : item.contextPolicy;
  if (!contextPolicy || !['task-only', 'selected-context'].includes(contextPolicy.childContext || '') || !['recent', 'summary', 'full'].includes(contextPolicy.historyMode || '') || !['brief', 'standard', 'detailed'].includes(contextPolicy.toolResultMode || '')) throw new Error('上下文策略无效');
  if (existing.some((agent) => agent.id === item.id)) throw new Error('Agent ID 已存在');
  return {
    id: item.id,
    name: item.name.trim(),
    builtIn: item.builtIn === true,
    avatar: typeof item.avatar === 'string' ? item.avatar.trim() || undefined : undefined,
    description: typeof item.description === 'string' ? item.description.trim().slice(0, 500) : undefined,
    instructions: item.instructions,
    providerId: item.providerId.trim(),
    modelId: item.modelId.trim(),
    reasoningEfforts: [...(item.reasoningEfforts || [])],
    skillIds,
    applicationIds,
    applicationTools,
    contextPolicy: { ...contextPolicy },
    enabled: item.enabled !== false,
    isDefault: item.isDefault === true,
  };
}

export function validateAgents(value: unknown): StoredAgent[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Agents 配置无效');
  const ids = new Set<string>();
  const agents = value.map((item) => {
    const agent = validateAgent(item);
    if (ids.has(agent.id)) throw new Error('Agent ID 重复');
    ids.add(agent.id);
    return agent;
  });
  if (agents.filter((agent) => agent.isDefault).length > 1) throw new Error('默认 Agent 只能有一个');
  return agents;
}

export async function loadAgents(directory: string): Promise<StoredAgent[]> {
  try { return validateAgents(JSON.parse(await readFile(resolve(directory, 'agents.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export function publicAgent(agent: StoredAgent): AgentConfig { return { ...agent, skillIds: [...(agent.skillIds || [])], applicationIds: [...(agent.applicationIds || [])], applicationTools: Object.fromEntries(Object.entries(agent.applicationTools || {}).map(([key, value]) => [key, [...value]])) }; }
