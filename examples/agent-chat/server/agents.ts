import { referenceIds } from '../../../src/components/agent-sidebar/references';
import type { AgentConfig, AgentContextStrategy, AgentSource, AgentType } from '../../../src/index';
import type { LocalStorage } from './storage';

export type StoredAgent = AgentConfig;

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const defaultContextPolicy = { childContext: 'task-only' as const, historyMode: 'summary' as const, toolResultMode: 'standard' as const };
const defaultContextStrategy: AgentContextStrategy = 'inherit_filtered';
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
  const skillIds = list(item.skillIds, 'Skill');
  const applicationIds = list(item.applicationIds, '应用', 20);
  if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error('Agent 启用状态无效');
  if (item.isDefault !== undefined && typeof item.isDefault !== 'boolean') throw new Error('Agent 默认状态无效');
  if (item.builtIn !== undefined && typeof item.builtIn !== 'boolean') throw new Error('Agent 内置状态无效');
  const type: AgentType = item.type === 'sub_agent' ? 'sub_agent' : 'main_agent';
  if (item.type !== undefined && item.type !== 'main_agent' && item.type !== 'sub_agent') throw new Error('Agent 类型无效');
  if (item.selectable !== undefined && typeof item.selectable !== 'boolean') throw new Error('Agent 选择权限无效');
  if (item.callable !== undefined && typeof item.callable !== 'boolean') throw new Error('Agent 调用权限无效');
  const source: AgentSource = item.source === 'system_default' ? 'system_default' : item.source === 'imported' ? 'imported' : 'user_created';
  if (item.source !== undefined && !['system_default', 'user_created', 'imported'].includes(item.source)) throw new Error('Agent 来源无效');
  const rawContextStrategy = item.contextStrategy ?? (value as Record<string, unknown>).context_strategy;
  const hasSnakeContextStrategy = (value as Record<string, unknown>).context_strategy !== undefined;
  const contextStrategy = rawContextStrategy === 'isolated' || rawContextStrategy === 'inherit_full' ? rawContextStrategy : defaultContextStrategy;
  if (rawContextStrategy !== undefined && !['isolated', 'inherit_filtered', 'inherit_full'].includes(String(rawContextStrategy))) throw new Error('Agent 上下文策略无效');
  if (item.id === 'default' && (type !== 'main_agent' || item.selectable === false || (item.source !== undefined && source !== 'system_default') || item.builtIn === false)) throw new Error('系统默认 Agent 不能改为 Sub Agent 或取消选择权限');
  if (item.builtIn === true && item.id !== 'default') throw new Error('只有网站默认 Agent 可以是内置 Agent');
  const contextPolicy = item.contextPolicy === undefined ? defaultContextPolicy : item.contextPolicy;
  if (!contextPolicy || !['task-only', 'selected-context'].includes(contextPolicy.childContext || '') || !['recent', 'summary', 'full'].includes(contextPolicy.historyMode || '') || !['brief', 'standard', 'detailed'].includes(contextPolicy.toolResultMode || '')) throw new Error('上下文策略无效');
  if (existing.some((agent) => agent.id === item.id)) throw new Error('Agent ID 已存在');
  return {
    id: item.id,
    name: item.name.trim(),
    type,
    source: item.id === 'default' ? 'system_default' : source,
    selectable: type === 'main_agent',
    callable: type === 'sub_agent' ? true : item.callable !== false,
    contextStrategy: type === 'sub_agent' ? defaultContextStrategy : contextStrategy,
    ...(hasSnakeContextStrategy ? { context_strategy: type === 'sub_agent' ? defaultContextStrategy : contextStrategy } : {}),
    builtIn: item.id === 'default' ? true : item.builtIn === true,
    avatar: typeof item.avatar === 'string' ? item.avatar.trim() || undefined : undefined,
    description: typeof item.description === 'string' ? item.description.trim().slice(0, 500) : undefined,
    instructions: item.instructions,
    skillIds,
    ...(applicationIds.length ? { applicationIds } : {}),
    contextPolicy: { ...contextPolicy },
    enabled: item.enabled !== false,
    isDefault: item.id === 'default' ? true : type === 'sub_agent' ? false : item.isDefault === true,
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
  // Keep the built-in website assistant marked as default for compatibility;
  // at most one user Agent may additionally be marked as the preferred Agent.
  if (agents.filter((agent) => agent.isDefault && !agent.builtIn).length > 1) throw new Error('默认 Agent 只能有一个');
  return agents;
}

export function loadAgents(store: LocalStorage): StoredAgent[] {
  const value = store.getConfig<StoredAgent[]>('agents');
  return value ? validateAgents(value) : [];
}

export function publicAgent(agent: StoredAgent): AgentConfig { return { ...agent, skillIds: [...(agent.skillIds || [])] }; }

/** Only the latest user turn can request a contact; labels are never used as identity. */
export function mentionedAgents(text: string, agents: StoredAgent[], currentAgentId?: string): StoredAgent[] {
  const ids = referenceIds(text, 'agent');
  if (ids.length > 8) throw new Error('一次最多联系 8 个 Agent');
  return ids.map(id => {
    if (id === currentAgentId) throw new Error('当前主 Agent 无需联系自己，请选择其他 Agent');
    const agent = agents.find(agent => agent.id === id && agent.enabled !== false && agent.callable !== false);
    if (!agent) throw new Error('提及的 Agent 不存在、已停用或不允许调用，请重新选择');
    return agent;
  });
}
