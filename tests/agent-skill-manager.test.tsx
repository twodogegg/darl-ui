import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillManager, type AgentSkill } from '../src';

describe('SkillManager', () => {
  it('allows disabling automatic invocation while keeping manual @ references', async () => {
    const skill: AgentSkill = { id: 'summary', name: '客户摘要', description: '整理客户信息', instructions: '整理输入。', scope: 'custom', allowImplicitInvocation: true };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SkillManager open skills={[skill]} onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);

    const toggle = screen.getByRole('switch', { name: '允许自动调用' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'summary', allowImplicitInvocation: false })));
  });
});
