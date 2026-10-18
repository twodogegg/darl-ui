// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { publicAgent, validateAgent, validateAgents } from '../examples/agent-chat/server/agents';

const agent = (id: string) => ({ id, name: id, instructions: `负责 ${id}`, providerId: 'darl', modelId: 'text' });

describe('server-managed Agent configuration', () => {
  it('normalizes lists and never exposes credentials', () => {
    const value = validateAgent({ ...agent('art'), avatar: '🎨', skillIds: ['one', 'one'] });
    expect(value).toMatchObject({ avatar: '🎨', skillIds: ['one'], enabled: true });
    expect(publicAgent(value)).not.toHaveProperty('apiKey');
    expect(publicAgent(value)).not.toHaveProperty('applicationIds');
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
});
