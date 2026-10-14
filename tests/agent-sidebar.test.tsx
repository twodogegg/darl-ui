import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, type AgentApplication, type AgentSession, type AgentSkill } from '../src';

const apps: AgentApplication[] = [{ id: 'crm', name: '客户系统', description: '查询客户资料', status: 'connected', tools: [{ name: 'find_customer', title: '查询客户' }] }];
const skills: AgentSkill[] = [{ id: 'summary', name: '客户摘要', description: '整理客户信息' }];
const sessions: AgentSession[] = [{ id: 'one', title: '已有对话', updatedAt: '今天', messages: [{ id: 'assistant', role: 'assistant', content: '## 标题\n\n**加粗**\n\n```ts\nconst answer = true\n```' }] }];

describe('AgentSidebar', () => {
  it('输入 @ 和 / 时显示对应建议并可插入不同颜色的引用', () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" applications={apps} skills={skills} onSend={vi.fn()} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    const type = (text: string) => { const node = document.createTextNode(text); editor.append(node); const range = document.createRange(); range.setStart(node, text.length); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); fireEvent.input(editor); fireEvent.keyUp(editor, { key: 'a' }); };
    type('@客');
    expect(screen.getByRole('listbox', { name: '应用建议' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /客户系统/ }));
    expect(editor.querySelector('.darl-agent-inline-reference--app')).toHaveTextContent('@客户系统');
    type('/客');
    expect(screen.getByRole('listbox', { name: 'Skill 建议' })).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(editor.querySelector('.darl-agent-inline-reference--skill')).toHaveTextContent('/客户摘要');
    type(' @没有匹配');
    expect(screen.getByText('没有匹配的可用应用')).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByRole('listbox', { name: '应用建议' })).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('根据动态应用和 Skill 数据选择能力并提交消息', async () => {
    const onSend = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSend={onSend} applications={apps} skills={skills} models={[{ id: 'model', name: '通用模型', reasoningEfforts: ['低', '高'] }]} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择应用/ }));
    fireEvent.click(screen.getByRole('button', { name: /客户系统/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 Skill/ }));
    fireEvent.click(screen.getByRole('button', { name: /客户摘要/ }));
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    editor.append(document.createTextNode('查一下客户')); fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('查一下客户'), applicationIds: ['crm'], skillIds: ['summary'], modelId: 'model', reasoningEffort: '低' })));
  });

  it('整条消息复制原始 Markdown，代码块单独复制代码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" />);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, '## 标题\n\n**加粗**\n\n```ts\nconst answer = true\n```'));
    expect(writeText).toHaveBeenNthCalledWith(2, 'const answer = true');
  });

  it('支持打开历史记录和创建新对话', () => {
    const onNewSession = vi.fn();
    const onSessionChange = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[...sessions, { id: 'two', title: '第二个对话', messages: [] }]} activeSessionId="one" onNewSession={onNewSession} onSessionChange={onSessionChange} />);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: /第二个对话/ }));
    expect(onSessionChange).toHaveBeenCalledWith('two');
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    expect(onNewSession).toHaveBeenCalled();
  });
  it('失败保留草稿，切换会话隔离草稿，输入法回车不提交', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('服务不可用'));
    const props = { open: true, onOpenChange: vi.fn(), sessions: [...sessions, { id: 'two', title: '另一个会话', messages: [] }], onSend };
    const { rerender } = render(<AgentSidebar {...props} activeSessionId="one" />);
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '保留草稿' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '输入消息' }), { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('服务不可用');
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveTextContent('保留草稿');
    rerender(<AgentSidebar {...props} activeSessionId="two" />);
    expect(screen.getByRole('textbox', { name: '输入消息' })).toBeEmptyDOMElement();
    rerender(<AgentSidebar {...props} activeSessionId="one" />);
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveTextContent('保留草稿');
  });

  it('受控推理参数无效时提交模型支持值，无推理模型隐藏选择', async () => {
    const onSend = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), sessions, onSend, selectedReasoningEffort: '高' };
    const { rerender } = render(<AgentSidebar {...props} models={[{ id: 'fast', name: '快速模型', reasoningEfforts: ['低'] }]} />);
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: '低' })));
    rerender(<AgentSidebar {...props} models={[{ id: 'plain', name: '普通模型' }]} />);
    expect(screen.queryByRole('button', { name: /思考：/ })).toBeNull();
  });

  it('Skill 保存失败保留原列表并显示错误', async () => {
    const onSkillSave = vi.fn().mockRejectedValue(new Error('存储不可用'));
    const existing = { ...skills[0], instructions: '原有指令', version: '1.0' };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} skills={[existing]} onSkillSave={onSkillSave} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 Skill/ }));
    fireEvent.click(screen.getByRole('button', { name: '管理 Skill' }));
    expect(screen.getByRole('dialog', { name: '管理 Skill' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '失败的更改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByText('存储不可用');
    expect(screen.getByRole('button', { name: /客户摘要 整理客户信息/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /失败的更改 整理客户信息/ })).toBeNull();
  });

});
