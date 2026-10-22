import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentsSettingsCard } from '../src';

describe('AgentsSettingsCard', () => {
  it('saves Agent instructions and selected skills while model choice remains in chat', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentsSettingsCard agents={[]} skills={[{ id: 'skill', name: 'Skill' }]} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '添加 Agent' }));
    expect(screen.queryByText('允许使用的 Skills')).toBeNull();
    expect(screen.queryByText('允许使用的 MCP 应用')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skill' }));
    expect(screen.queryByRole('combobox', { name: '模型' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '推理强度' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent ID' }), { target: { value: 'art' } });
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '美术 Agent' } });
    fireEvent.change(screen.getByRole('textbox', { name: '系统提示词' }), { target: { value: '只负责美术任务' } });
    fireEvent.change(screen.getByRole('textbox', { name: '网站专用系统提示词' }), { target: { value: '只修改当前项目，保存以接口结果为准。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'art', instructions: '只负责美术任务' })));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('providerId');
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('modelId');
    expect(onSave.mock.calls[0][0].skillIds).toEqual(['skill']);
    expect(onSave.mock.calls[0][0].websiteInstructions).toBe('只修改当前项目，保存以接口结果为准。');
  });
});
