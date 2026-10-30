// @vitest-environment node
import { expect, it } from 'vitest';
import { defaultWorkflowAgents, validateWorkflowAgents } from '../examples/agent-chat/server/workflow-agents';

it('keeps three independent workflow agents and removes fixed JSON output from their default instructions', () => {
  const agents = defaultWorkflowAgents();
  expect(agents.map(agent => agent.kind)).toEqual(['analyze', 'extract-assets', 'video-prompts']);
  expect(agents.every(agent => !agent.instructions.includes('只输出 JSON 对象'))).toBe(true);
  agents[0].toolNames.push('builtin_read_studio');
  expect(validateWorkflowAgents(agents)[0].toolNames).toEqual(['builtin_read_studio']);
  expect(agents[1].toolNames).toEqual([]);
});

it('rejects missing stages, duplicate tools and empty instructions', () => {
  const agents = defaultWorkflowAgents();
  expect(() => validateWorkflowAgents(agents.slice(1))).toThrow();
  expect(() => validateWorkflowAgents(agents.map((item, index) => index ? item : { ...item, instructions: '' }))).toThrow();
  expect(() => validateWorkflowAgents(agents.map((item, index) => index ? item : { ...item, toolNames: ['a', 'a'] }))).toThrow();
});
