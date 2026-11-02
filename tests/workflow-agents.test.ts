// @vitest-environment node
import { expect, it } from 'vitest';
import { defaultWorkflowAgents, validateWorkflowAgents, workflowModelOptions } from '../examples/agent-chat/server/workflow-agents';
import { workflowInstructions, workflowSkillResources } from '../examples/agent-chat/server/workflow-runtime';

it('includes referenced Skill Markdown in workflow input without injecting unrelated files', () => {
  const skill = { id: 'skill', name: '导演技能', instructions: '先读 [流程](references/workflow.md) 与 [格式](references/output-format.md)。', resources: [
    { path: 'references/workflow.md', content: '流程约束' }, { path: 'references/output-format.md', content: '格式约束' }, { path: 'references/unrelated.md', content: '不应发送' },
  ] };
  const result = workflowInstructions(defaultWorkflowAgents()[0], [skill]);
  expect(result).toContain('流程约束');
  expect(result).toContain('格式约束');
  expect(result).not.toContain('不应发送');
  expect(workflowSkillResources(skill).map(file => file.path)).toEqual(['references/workflow.md', 'references/output-format.md']);
  expect(() => workflowSkillResources({ ...skill, resources: [] })).toThrow('缺少引用文件');
});

it('lists logical text ids and video analysis upstream ids from the matching endpoint', () => {
  const config = {
    protocols: [{ key: 'openai-completions', types: ['text'] }],
    models: [
      { id: 'logical', displayName: '文本模型', type: 'text', bindings: [{ providerId: 'same', upstreamModelId: 'upstream-name', protocolKey: 'openai-completions' }] },
      { id: 'disabled', displayName: '停用', type: 'text', enabled: false, bindings: [{ providerId: 'same', upstreamModelId: 'disabled-upstream', protocolKey: 'openai-completions' }] },
      { id: 'other', displayName: '其他接口', type: 'text', bindings: [{ providerId: 'other', upstreamModelId: 'other-upstream', protocolKey: 'openai-completions' }] },
    ],
  };
  const providers = [
    { id: 'same', baseUrl: 'https://example.test/v1/', apiKey: 'configured', models: [{ id: 'catalog-only', name: '目录模型', type: 'text' }] },
    { id: 'other', baseUrl: 'https://other.test/v1', apiKey: 'configured', models: [] },
  ];
  const options = workflowModelOptions(config as never, providers as never, 'https://example.test/v1');
  expect(options.text.map(item => item.id)).toEqual(['logical', 'other']);
  expect(options.videoAnalysis.map(item => item.id)).toEqual(['upstream-name', 'catalog-only']);
  expect(workflowModelOptions(config as never, providers as never).videoAnalysis).toEqual([]);
});

it('keeps an independent novel script agent with its own defaults', () => {
  const agents = defaultWorkflowAgents();
  expect(agents.map(agent => agent.kind)).toEqual(['analyze', 'write-script', 'extract-assets', 'storyboard', 'video-prompts', 'novel-outline', 'novel-script', 'script-assets', 'script-storyboard']);
  expect(agents.slice(0, 5).every(agent => agent.instructions === '')).toBe(true);
  expect(agents[5].instructions).toContain('小说');
  agents[0].toolNames.push('builtin_read_studio');
  expect(validateWorkflowAgents(agents)[0].toolNames).toEqual(['builtin_read_studio']);
  expect(agents[1].toolNames).toEqual([]);
});

it('adds the outline agent to existing eight-stage settings without changing their instructions', async () => {
  const { loadWorkflowAgents } = await import('../examples/agent-chat/server/workflow-agents');
  const old = defaultWorkflowAgents().filter(agent => agent.kind !== 'novel-outline');
  old.find(agent => agent.kind === 'script-storyboard')!.instructions = '用户已有的分镜规则';
  const migrated = loadWorkflowAgents({ getConfig: () => old } as never);
  expect(migrated.find(agent => agent.kind === 'novel-outline')?.instructions).toContain('大纲');
  expect(migrated.find(agent => agent.kind === 'script-storyboard')?.instructions).toBe('用户已有的分镜规则');
});

it('rejects missing stages and duplicate tools while allowing unconfigured stages to be saved', () => {
  const agents = defaultWorkflowAgents();
  expect(() => validateWorkflowAgents(agents.slice(1))).toThrow();
  expect(validateWorkflowAgents(agents)[0].instructions).toBe('');
  expect(() => validateWorkflowAgents(agents.map((item, index) => index ? item : { ...item, toolNames: ['a', 'a'] }))).toThrow();
});

it('adds the script stage to existing settings without replacing configured stages', async () => {
  const { loadWorkflowAgents } = await import('../examples/agent-chat/server/workflow-agents');
  const old = defaultWorkflowAgents().filter(agent => !['write-script', 'storyboard', 'novel-script', 'script-assets', 'script-storyboard'].includes(agent.kind));
  old[0].model = 'existing-model';
  old[0].instructions = 'existing instructions';
  const migrated = loadWorkflowAgents({ getConfig: () => old } as never);
  expect(migrated.find(agent => agent.kind === 'analyze')).toMatchObject({ model: 'existing-model', instructions: 'existing instructions' });
  expect(migrated.find(agent => agent.kind === 'write-script')?.formatterModel).toBeTruthy();
  expect(migrated.find(agent => agent.kind === 'storyboard')?.formatterModel).toBeTruthy();
  expect(migrated.find(agent => agent.kind === 'write-script')?.instructions).toBe('');
  const four = defaultWorkflowAgents().filter(agent => !['storyboard', 'novel-script', 'script-assets', 'script-storyboard'].includes(agent.kind));
  four[1].instructions = '已有剧本设置';
  const upgraded = loadWorkflowAgents({ getConfig: () => four } as never);
  expect(upgraded.find(agent => agent.kind === 'write-script')?.instructions).toBe('已有剧本设置');
  expect(upgraded.find(agent => agent.kind === 'storyboard')).toBeTruthy();
  const five = defaultWorkflowAgents().filter(agent => !['novel-script', 'script-assets', 'script-storyboard'].includes(agent.kind));
  five[1].instructions = '转绘剧本专用设置';
  const migratedFive = loadWorkflowAgents({ getConfig: () => five } as never);
  expect(migratedFive.find(agent => agent.kind === 'write-script')?.instructions).toBe('转绘剧本专用设置');
  expect(migratedFive.find(agent => agent.kind === 'novel-script')?.instructions).toContain('小说');
  const six = defaultWorkflowAgents().filter(agent => !['script-assets', 'script-storyboard'].includes(agent.kind));
  expect(loadWorkflowAgents({ getConfig: () => six } as never).find(agent => agent.kind === 'script-assets')?.instructions).toContain('大纲');
});

it('migrates existing settings to an independent script storyboard agent', async () => {
  const { loadWorkflowAgents } = await import('../examples/agent-chat/server/workflow-agents');
  const old = defaultWorkflowAgents().filter(agent => agent.kind !== 'script-storyboard');
  old[3].instructions = '保留转绘分镜设置';
  const migrated = loadWorkflowAgents({ getConfig: () => old } as never);
  expect(migrated.find(agent => agent.kind === 'storyboard')?.instructions).toBe('保留转绘分镜设置');
  expect(migrated.find(agent => agent.kind === 'script-storyboard')?.instructions).toContain('大纲');
});
