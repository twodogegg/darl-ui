// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mentionedAgents, publicAgent, validateAgent, validateAgents } from '../examples/agent-chat/server/agents';

const agent = (id: string) => ({ id, name: id, instructions: `负责 ${id}` });

describe('server-managed Agent configuration', () => {
  it('preserves optional website instructions, supports clearing, and rejects invalid values', () => {
    expect(validateAgent(agent('old')).websiteInstructions).toBeUndefined();
    expect(validateAgent({ ...agent('site'), websiteInstructions: '网站规则\n保留换行' }).websiteInstructions).toBe('网站规则\n保留换行');
    expect(validateAgent({ ...agent('site'), websiteInstructions: '' }).websiteInstructions).toBe('');
    expect(() => validateAgent({ ...agent('site'), websiteInstructions: 12 })).toThrow('网站专用');
  });
  it('resolves explicit contacts by stable ID, including callable main Agents', () => {
    const entries = [validateAgent(agent('main')), validateAgent(agent('peer')), validateAgent({ ...agent('child'), type: 'sub_agent' })];
    expect(mentionedAgents('[任意名称](agent:peer) [重复](agent:peer) [专家](agent:child)', entries, 'main').map(item => item.id)).toEqual(['peer', 'child']);
    expect(mentionedAgents('@peer [应用](app:peer) [技能](skill:peer)', entries, 'main')).toEqual([]);
    expect(() => mentionedAgents('[自己](agent:main)', entries, 'main')).toThrow('自己');
    expect(() => mentionedAgents('[未知](agent:missing)', entries, 'main')).toThrow('不存在');
    expect(() => mentionedAgents('[停用](agent:off)', [validateAgent({ ...agent('off'), enabled: false })], 'main')).toThrow('停用');
    expect(() => mentionedAgents('[禁止](agent:private)', [validateAgent({ ...agent('private'), callable: false })], 'main')).toThrow('不允许');
    expect(() => mentionedAgents(Array.from({ length: 9 }, (_, i) => `[Agent](agent:a${i})`).join(' '), [], 'main')).toThrow('最多联系 8');
  });

  it('normalizes lists and never exposes credentials', () => {
    const value = validateAgent({ ...agent('art'), avatar: '🎨', skillIds: ['one', 'one'] });
    expect(value).toMatchObject({ avatar: '🎨', skillIds: ['one'], enabled: true });
    expect(publicAgent(value)).not.toHaveProperty('apiKey');
    expect(publicAgent(value)).not.toHaveProperty('applicationIds');
    expect(publicAgent(value)).not.toHaveProperty('providerId');
    expect(publicAgent(value)).not.toHaveProperty('modelId');
  });

  it('accepts multiple enabled Agents without a delegation allow-list', () => {
    expect(validateAgents([agent('main'), agent('child')])).toHaveLength(2);
  });

  it('applies safe default context policies and rejects unknown policy values', () => {
    expect(validateAgent(agent('context'))).toMatchObject({ contextPolicy: { childContext: 'task-only', historyMode: 'summary', toolResultMode: 'standard' } });
    expect(validateAgent({ ...agent('context-selected'), contextPolicy: { childContext: 'selected-context', historyMode: 'recent', toolResultMode: 'brief' } })).toMatchObject({ contextPolicy: { childContext: 'selected-context', historyMode: 'recent', toolResultMode: 'brief' } });
    expect(() => validateAgent({ ...agent('invalid-context'), contextPolicy: { childContext: 'full-history' } })).toThrow('上下文策略');
  });

  it('rejects duplicate defaults and duplicate ids', () => {
    expect(() => validateAgents([{ ...agent('a'), isDefault: true }, { ...agent('b'), isDefault: true }])).toThrow('默认 Agent');
    expect(() => validateAgents([agent('a'), agent('a')])).toThrow('重复');
  });

  it('forces Sub Agent permissions and protects the built-in assistant', () => {
    expect(validateAgent({ ...agent('child'), type: 'sub_agent', selectable: true, callable: false })).toMatchObject({ type: 'sub_agent', selectable: false, callable: true, contextStrategy: 'inherit_filtered' });
    expect(() => validateAgent({ ...agent('default'), builtIn: true, type: 'sub_agent' })).toThrow('系统默认 Agent');
  });
});
