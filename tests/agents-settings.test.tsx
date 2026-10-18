import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentsSettingsCard } from '../src';

describe('AgentsSettingsCard', () => {
  it('opens the selected existing Agent system prompt directly', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentsSettingsCard initialEditingAgentId="director"
      agents={[{ id: 'director', name: '拆镜导演', instructions: '用户定义的原始拆镜规则', providerId: 'gateway', modelId: 'text', enabled: true }]}
      models={[{ id: 'text', name: '文本模型', providerId: 'gateway', type: 'text' }]} onSave={onSave} />);
    const prompt = screen.getByRole('textbox', { name: '系统提示词' });
    expect(prompt).toHaveValue('用户定义的原始拆镜规则');
    fireEvent.change(prompt, { target: { value: '更新后的镜头规则' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'director', instructions: '更新后的镜头规则',
    })));
  });

  it('creates an Agent with an isolated model and prompt', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentsSettingsCard agents={[]} models={[{ id: 'text', name: '文本模型', providerId: 'gateway', type: 'text', reasoningEfforts: ['low'] }]} skills={[{ id: 'skill', name: 'Skill' }]} applications={[{ id: 'app', name: '应用', tools: [{ name: 'read', title: '读取' }] }]} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '添加 Agent' }));
    expect(screen.queryByText('允许使用的 Skills')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '应用' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '读取' })).toBeChecked();
    expect(screen.queryByRole('combobox', { name: '模型' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '推理强度' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent ID' }), { target: { value: 'art' } });
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '美术 Agent' } });
    fireEvent.change(screen.getByRole('textbox', { name: '系统提示词' }), { target: { value: '只负责美术任务' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'art', providerId: 'gateway', modelId: 'text', instructions: '只负责美术任务' })));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('skillIds');
  });
});
