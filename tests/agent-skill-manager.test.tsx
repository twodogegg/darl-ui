import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillManager, type AgentSkill } from '../src';

const markdownFile = (content: string, name = 'SKILL.md') => ({ name, type: 'text/markdown', size: new TextEncoder().encode(content).byteLength, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File;
const importedMarkdown = '---\nname: 审查\ndescription: 检查代码\n---\n\n逐项检查。';

describe('SkillManager', () => {
  const documentSkill: AgentSkill = {
    id: 'documents', name: '文档技能', description: '阅读和编辑技能资源', scope: 'custom',
    instructions: '# 使用说明\n\n[阅读指南](references/guide.md)\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))',
    resources: [
      { path: 'references/guide.md', content: '# 资源指南\n\n| 参数 | 说明 |\n| --- | --- |\n| name | 名称 |\n\n```sh\nnode run.js\n```\n\n![示例](../assets/example.png)' },
      { path: 'scripts/run.js', content: 'console.log("run");' },
      { path: 'assets/example.png', content: 'aGVsbG8=', encoding: 'base64' },
      { path: 'references/nested/guide.md', content: '嵌套指南' },
    ],
  };

  it('shows the original Skill name and preserves it when editing the display name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SkillManager open skills={[{ ...documentSkill, slug: 'document-tools' }]} onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    expect(screen.getByLabelText('Skill 原名')).toHaveValue('document-tools');
    expect(screen.getByLabelText('Skill 原名')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('显示名称')).toHaveValue('文档技能');
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '文档助手' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'documents', slug: 'document-tools', name: '文档助手' })));
  });

  it('searches by original or display name without matching descriptions', () => {
    render(<SkillManager open skills={[{ ...documentSkill, slug: 'document-tools' }]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    const search = screen.getByRole('textbox', { name: '搜索 Skill' });
    const list = document.querySelector('.darl-agent-skill-list')!;
    for (const value of ['DOCUMENT-TOOLS', '文档技能']) {
      fireEvent.change(search, { target: { value } });
      expect(list).toHaveTextContent('文档技能');
    }
    fireEvent.change(search, { target: { value: '阅读和编辑' } });
    expect(list).toHaveTextContent('没有匹配的 Skill');
  });

  it('previews Markdown safely and opens relative resource links with tables, code and packaged images', () => {
    render(<SkillManager open skills={[documentSkill]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '使用说明' })).toBeInTheDocument();
    expect(document.querySelector('.darl-agent-skill-markdown script')).toBeNull();
    expect(screen.getByText('危险链接').closest('a')).not.toHaveAttribute('href', expect.stringContaining('javascript:'));
    fireEvent.click(screen.getByRole('link', { name: '阅读指南' }));
    expect(screen.getByRole('heading', { name: '资源指南' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('name');
    expect(screen.getByText('node run.js').tagName).toBe('CODE');
    expect(screen.getByRole('img', { name: '示例' })).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=');
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
  });

  it('groups files into nested folders and retains full paths for duplicate basenames', () => {
    render(<SkillManager open skills={[documentSkill]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    const files = screen.getByRole('navigation', { name: 'Skill 文件' });
    expect(within(files).getAllByRole('button', { name: 'guide.md' })).toHaveLength(2);
    const nested = files.querySelector('summary[title="references/nested"]')!;
    expect(nested.closest('details')).toHaveAttribute('open');
    expect(files.querySelector('button[title="references/nested/guide.md"]')).toHaveTextContent('guide.md');
    fireEvent.click(files.querySelector('button[title="references/nested/guide.md"]')!);
    expect(screen.getByText('嵌套指南')).toBeInTheDocument();
    expect(files.querySelector('button[aria-current="page"]')).toHaveAttribute('title', 'references/nested/guide.md');
  });

  it('keeps edits when switching between preview and source and saves the resource path and content', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SkillManager open skills={[documentSkill]} onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('link', { name: '阅读指南' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('references/guide.md 内容'), { target: { value: '# 修改后的指南' } });
    fireEvent.change(screen.getByLabelText('资源路径'), { target: { value: 'references/updated.md' } });
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(screen.getByRole('heading', { name: '修改后的指南' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText('references/updated.md 内容')).toHaveValue('# 修改后的指南');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ resources: expect.arrayContaining([{ path: 'references/updated.md', content: '# 修改后的指南' }]) })));
  });

  it('shows empty files and binary resources and keeps built-in source read-only', () => {
    const builtin: AgentSkill = { ...documentSkill, scope: 'builtin', instructions: '' };
    render(<SkillManager open skills={[builtin]} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} onFavoriteChange={vi.fn()} />);
    expect(screen.getByText('暂无内容')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.getByLabelText('SKILL.md 内容')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'example.png' }));
    expect(screen.getByText('二进制资源无法在此编辑')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除资源' })).not.toBeInTheDocument();
  });

  it('replaces the folder entry with host conversation creation and reports failures', async () => {
    render(<SkillManager open skills={[]} onClose={() => {}} onSave={() => {}} onDelete={() => {}} onImport={() => {}} onFavoriteChange={() => {}} onCreateViaChat={() => { throw new Error('请先配置文本模型'); }} />);
    expect(screen.queryByRole('button', { name: '文件夹' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通过对话创建' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('请先配置文本模型'));
  });

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
