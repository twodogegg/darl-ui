import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillManager, type AgentSkill } from '../src';

const markdownFile = (content: string, name = 'SKILL.md') => ({ name, type: 'text/markdown', size: new TextEncoder().encode(content).byteLength, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File;
const importedMarkdown = '---\nname: 审查\ndescription: 检查代码\n---\n\n逐项检查。';

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

  it('imports directly when the skill name is available', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<SkillManager open skills={[]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={onImport} onFavoriteChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('导入 Skill 文件'), { target: { files: [markdownFile(importedMarkdown)] } });

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ name: '审查', description: '检查代码' })));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('导入预览')).not.toBeInTheDocument();
  });

  it('asks for overwrite confirmation when importing a skill with an existing name', async () => {
    const existing: AgentSkill = { id: 'existing', name: '审查', description: '旧描述', instructions: '旧指令', scope: 'custom', favorite: true };
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<SkillManager open skills={[existing]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={onImport} onFavoriteChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('导入 Skill 文件'), { target: { files: [markdownFile(importedMarkdown)] } });

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('已存在同名 Skill');
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '取消导入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /导入 1/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '覆盖' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing', name: '审查', description: '检查代码', favorite: true })));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels the whole import when a same-name conflict is declined', async () => {
    const existing: AgentSkill = { id: 'existing', name: '审查', description: '旧描述', instructions: '旧指令', scope: 'custom' };
    const onImport = vi.fn();
    render(<SkillManager open skills={[existing]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={onImport} onFavoriteChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('导入 Skill 文件'), { target: { files: [markdownFile(importedMarkdown)] } });
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: '取消导入' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onImport).not.toHaveBeenCalled();
  });
});
