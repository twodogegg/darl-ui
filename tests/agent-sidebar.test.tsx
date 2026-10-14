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
    expect(screen.getByRole('status')).toHaveTextContent('已复制');
  });

  it('把 markdown 代码块渲染为内容，同时复制原始 Markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const rendered: AgentSession = { id: 'markdown', title: 'Markdown', messages: [{ id: 'md', role: 'assistant', content: '```markdown\n# 片段标题\n\n- 第一项\n- **第二项**\n```' }] };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[rendered]} activeSessionId="markdown" />);
    expect(screen.getByRole('heading', { name: '片段标题' })).toBeInTheDocument();
    expect(screen.getByText('第一项')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# 片段标题\n\n- 第一项\n- **第二项**'));
  });

  it.each([false, true])('行内代码留在段落和列表内，Markdown 预览没有 pre 包裹（围栏：%s）', async (fenced) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const source = '# MiniMax H3 Prompt Writing\n\n**频道说明**：若当前为 `MiniMax-H3-Local`，本模式为唯一可选模式。\n\n### subject_definitions\n\n- `<Picture 1>`：成年男性，约 28 岁，短发。\n- `<Video 1>`：夜间城市天桥的场景参考。';
    const content = fenced ? `\`\`\`markdown\n${source}\n\`\`\`` : source;
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'h3', title: 'H3', messages: [{ id: 'h3-md', role: 'assistant', content }] }]} />);
    expect(screen.getByText('MiniMax-H3-Local').tagName).toBe('CODE');
    expect(screen.getByText('MiniMax-H3-Local').parentElement?.tagName).toBe('P');
    expect(screen.getByText('<Picture 1>').parentElement?.tagName).toBe('LI');
    expect(screen.getByText('<Video 1>').parentElement?.tagName).toBe('LI');
    expect(container.querySelectorAll('pre, p div, li .darl-agent-code')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '复制代码' })).toBeNull();
    if (fenced) {
      fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(source));
    }
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(content));
  });

  it('有语言、无语言和缩进代码块只各渲染一个 pre，原始代码不会再次解析', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const content = '行内 `value` 保持同行。\n\n```ts\nconst value = `<Picture 1>`;\n```\n\n```\n# 这里是代码\n```\n\n    # 缩进代码';
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'code', title: '代码', messages: [{ id: 'blocks', role: 'assistant', content }] }]} />);
    expect(container.querySelectorAll('pre')).toHaveLength(3);
    expect(container.querySelector('pre pre, pre div, p div')).toBeNull();
    expect(screen.queryByRole('heading', { name: '这里是代码' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '复制代码' })[0]);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('const value = `<Picture 1>`;'));
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

  it('可以在历史记录中重命名会话，并展开为居中对话窗口', async () => {
    const onSessionRename = vi.fn().mockResolvedValue(undefined);
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSessionRename={onSessionRename} />);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名 已有对话' }));
    fireEvent.change(screen.getByRole('textbox', { name: '会话名称' }), { target: { value: '提示词对话' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSessionRename).toHaveBeenCalledWith('one', '提示词对话'));
    fireEvent.click(screen.getByRole('button', { name: '返回当前对话' }));
    fireEvent.click(screen.getByRole('button', { name: '展开对话' }));
    expect(screen.getByRole('dialog', { name: 'Agent 辅助侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '滚动到顶部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '滚动到底部' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起对话' }));
    expect(screen.getByRole('complementary', { name: 'Agent 辅助侧栏' })).toBeInTheDocument();
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
