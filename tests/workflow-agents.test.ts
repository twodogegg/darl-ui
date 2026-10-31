// @vitest-environment node
import { expect, it } from 'vitest';
import { defaultWorkflowAgents, validateWorkflowAgents } from '../examples/agent-chat/server/workflow-agents';

it('keeps five independent workflow agents and removes fixed JSON output from their default instructions', () => {
  const agents = defaultWorkflowAgents();
  expect(agents.map(agent => agent.kind)).toEqual(['analyze', 'write-script', 'extract-assets', 'storyboard', 'video-prompts']);
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

it('adds the script stage to existing settings without replacing configured stages', async () => {
  const { loadWorkflowAgents } = await import('../examples/agent-chat/server/workflow-agents');
  const old = defaultWorkflowAgents().filter(agent => agent.kind !== 'write-script' && agent.kind !== 'storyboard');
  old[0].model = 'existing-model';
  old[0].instructions = 'existing instructions';
  const migrated = loadWorkflowAgents({ getConfig: () => old } as never);
  expect(migrated.find(agent => agent.kind === 'analyze')).toMatchObject({ model: 'existing-model', instructions: 'existing instructions' });
  expect(migrated.find(agent => agent.kind === 'write-script')?.formatterModel).toBeTruthy();
  expect(migrated.find(agent => agent.kind === 'storyboard')?.formatterModel).toBeTruthy();
  const four = defaultWorkflowAgents().filter(agent => agent.kind !== 'storyboard');
  four[1].instructions = '已有剧本设置';
  const upgraded = loadWorkflowAgents({ getConfig: () => four } as never);
  expect(upgraded.find(agent => agent.kind === 'write-script')?.instructions).toBe('已有剧本设置');
  expect(upgraded.find(agent => agent.kind === 'storyboard')).toBeTruthy();
});
