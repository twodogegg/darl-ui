import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, DarlUIProvider, type AgentApplication, type AgentErrorInfo, type AgentSession, type AgentSkill } from '../src';

const apps: AgentApplication[] = [{ id: 'crm', name: '客户系统', description: '查询客户资料', status: 'connected', tools: [{ name: 'find_customer', title: '查询客户' }] }];
const skills: AgentSkill[] = [{ id: 'summary', name: '客户摘要', description: '整理客户信息' }];
const sessions: AgentSession[] = [{ id: 'one', title: '已有对话', updatedAt: '今天', messages: [{ id: 'assistant', role: 'assistant', content: '## 标题\n\n**加粗**\n\n```ts\nconst answer = true\n```' }] }];

describe('AgentSidebar', () => {
  it('renders structured request errors with stage and trace identifiers', () => {
    const error: AgentErrorInfo = { code: 'MCP_CONNECTION_FAILED', stage: 'mcp-connection', message: '无法连接 MCP 应用', requestId: 'req-123', runId: 'run-456', retryable: true, suggestion: '检查应用地址后重试。' };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'error', title: '失败', messages: [{ id: 'answer', role: 'assistant', content: '', error }] }]} activeSessionId="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('MCP 连接失败');
    expect(screen.getByRole('alert')).toHaveTextContent('requestId：req-123');
    expect(screen.getByRole('alert')).toHaveTextContent('runId：run-456');
    expect(screen.getByRole('alert')).toHaveTextContent('检查应用地址后重试。');
  });

  it('普通工具记录只显示名称和状态，不提供参数或结果展开入口', () => {
    const history: AgentSession[] = [{ id: 'one', title: '查询', messages: [{ id: 'assistant', role: 'assistant', content: '已完成查询。', toolCalls: [{ id: 'read-call', appId: 'catalog', appName: '素材库', toolName: 'search', toolTitle: '搜索素材', status: 'success', input: { query: '不显示的参数' }, output: { text: '不显示的详细结果' } }] }] }];
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={history} activeSessionId="one" />);
    expect(screen.getByText('素材库')).toBeInTheDocument();
    expect(screen.getByText('搜索素材')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('参数')).toBeNull();
    expect(screen.queryByText('结果')).toBeNull();
    expect(container.querySelector('.darl-agent-tool-summary button, button.darl-agent-tool-summary, .darl-agent-tool-detail')).toBeNull();
    expect(container).not.toHaveTextContent('不显示的参数');
    expect(container).not.toHaveTextContent('不显示的详细结果');
  });

  it('显示主 Agent 委派给子 Agent 的任务内容', () => {
    const history: AgentSession[] = [{ id: 'one', title: '委派', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [{ id: 'delegation', appId: 'agent:writer', appName: '文案 Agent', toolName: 'ask_writer', toolTitle: '文案 Agent 子任务', status: 'success', agentId: 'writer', input: { task: '请根据素材中心的结果写一段产品介绍。' } }] }] }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={history} activeSessionId="one" />);
    expect(screen.getByText('委派任务')).toBeInTheDocument();
    expect(screen.getByText('请根据素材中心的结果写一段产品介绍。')).toBeInTheDocument();
  });

  it('确认工具时展示参数，宿主失败可重试并可拒绝', async () => {
    const onToolConfirm = vi.fn().mockRejectedValueOnce(new Error('确认请求失败')).mockResolvedValue(undefined);
    const pending: AgentSession[] = [{ id: 'one', title: '工具确认', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [{ id: 'write-call', appId: 'catalog', appName: '素材库', toolName: 'save', risk: 'write', status: 'confirmation', input: { name: '新素材' } }] }] }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={pending} activeSessionId="one" onToolConfirm={onToolConfirm} />);
    expect(screen.getByText(/"name": "新素材"/)).toBeVisible();
    expect(screen.getByText('写操作')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '允许执行' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('确认请求失败');
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(onToolConfirm).toHaveBeenLastCalledWith('write-call', false));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认执行 MCP 工具' })).not.toBeInTheDocument());
  });

  it('输入 @ 时显示能力建议并可插入引用', () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" applications={apps} skills={skills} onSend={vi.fn()} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    const type = (text: string) => { const node = document.createTextNode(text); editor.append(node); const range = document.createRange(); range.setStart(node, text.length); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); fireEvent.input(editor); fireEvent.keyUp(editor, { key: 'a' }); };
    type('@客');
    expect(screen.getByRole('listbox', { name: '能力建议' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /客户系统/ }));
    expect(editor.querySelector('.darl-agent-inline-reference--app')).toHaveTextContent('@客户系统');
    type('@客');
    expect(screen.getByRole('listbox', { name: '能力建议' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /客户摘要/ }));
    expect(editor.querySelector('.darl-agent-inline-reference--skill')).toHaveTextContent('@客户摘要');
    type(' /没有匹配');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Backspace 和 Delete 可以整块删除 MCP / Skill 引用并同步状态', () => {
    const appChanges = vi.fn();
    const skillChanges = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one"
      applications={apps} skills={skills} onSelectedApplicationIdsChange={appChanges} onSelectedSkillIdsChange={skillChanges} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    const setCaret = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(node, offset); range.collapse(true);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    };
    const add = (text: string) => {
      const node = document.createTextNode(text); editor.append(node);
      setCaret(node, text.length); fireEvent.input(editor);
    };
    add('@客');
    fireEvent.click(screen.getByRole('option', { name: /客户系统/ }));
    expect(appChanges).toHaveBeenLastCalledWith(['crm']);
    const appToken = editor.querySelector('[data-reference]')!;
    setCaret(appToken.parentNode!, Array.prototype.indexOf.call(appToken.parentNode!.childNodes, appToken) + 1);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(editor.querySelector('.darl-agent-inline-reference--app')).toBeNull();
    expect(appChanges).toHaveBeenLastCalledWith([]);
    add('@客');
    fireEvent.click(screen.getByRole('option', { name: /客户摘要/ }));
    expect(skillChanges).toHaveBeenLastCalledWith(['summary']);
    const skillToken = editor.querySelector('[data-reference]')!;
    setCaret(skillToken.parentNode!, Array.prototype.indexOf.call(skillToken.parentNode!.childNodes, skillToken));
    fireEvent.keyDown(editor, { key: 'Delete' });
    expect(editor.querySelector('.darl-agent-inline-reference--skill')).toBeNull();
    expect(skillChanges).toHaveBeenLastCalledWith([]);
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

  it('以角色卡选择并切换主 Agent，不显示额外的主 Agent 占位项', async () => {
    const onSend = vi.fn();
    const agents = [{ id: 'art', name: '美术 Agent', description: '处理美术任务' }, { id: 'writer', name: '文案 Agent', description: '处理文案任务' }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSend={onSend} agents={agents} models={[{ id: 'model', name: '通用模型', reasoningEfforts: ['低', '高'] }]} />);
    fireEvent.click(screen.getByRole('button', { name: '选择 Agent' }));
    expect(screen.queryByRole('button', { name: /主 Agent/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /美术 Agent/ }));
    expect(screen.getByRole('button', { name: /通用模型/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /思考：/ })).toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '设计一个角色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'art' })));
    fireEvent.click(screen.getByRole('button', { name: /美术 Agent/ }));
    fireEvent.click(screen.getByRole('button', { name: /文案 Agent/ }));
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '写一段文案' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'writer' })));
  });

  it('可以只发送图片并把图片编码交给宿主', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /上传图片/ }));
    const createObjectURL = vi.fn(() => 'blob:agent-image-preview');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const image = new File(['image-bytes'], '参考图.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [image] } });
    await waitFor(() => expect(screen.queryByText('参考图.png')).not.toBeInTheDocument());
    expect(createObjectURL).toHaveBeenCalledWith(image);
    expect(screen.getByRole('button', { name: '移除附件 参考图.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ content: '', files: [image], attachments: [expect.objectContaining({ name: '参考图.png', type: 'image/png', data: expect.stringMatching(/^data:image\/png;base64,/) })] })));
  });

  it('渲染 Agent 返回的图片附件', () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'image', title: '图片', messages: [{ id: 'answer', role: 'assistant', content: '看这里。', attachments: [{ name: '结果.png', type: 'image/png', url: 'data:image/png;base64,aGVsbG8=' }] }] }]} activeSessionId="image" />);
    expect(screen.getByRole('img', { name: '结果.png' })).toBeInTheDocument();
  });

  it('Markdown 正文图片套用统一容器，点击在当前页面放大而非打开新标签页', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const content = '![预览](https://example.com/thumb.png)\n\n- 下载原图：[点击查看/下载原图](https://example.com/original.png)\n\n![人物](data:image/png;base64,aGVsbG8=)';
    const props = { onOpenChange: vi.fn(), sessions: [{ id: 'md-img', title: '图片', messages: [{ id: 'answer', role: 'assistant' as const, content }] }], activeSessionId: 'md-img' };
    render(<AgentSidebar open {...props} />);
    const preview = screen.getByRole('img', { name: '预览' });
    expect(preview).toHaveAttribute('src', 'https://example.com/thumb.png');
    expect(preview).toHaveAttribute('loading', 'lazy');
    expect(preview.closest('.darl-agent-markdown-image')).toBeInTheDocument();
    fireEvent.click(preview.closest('button')!);
    expect(open).not.toHaveBeenCalled();
    const lightbox = await screen.findByRole('dialog', { name: '预览' });
    expect(within(lightbox).getByRole('img', { name: '预览' })).toHaveAttribute('src', 'https://example.com/original.png');
    fireEvent.click(within(lightbox).getByRole('img', { name: '预览' }));
    expect(screen.getByRole('dialog', { name: '预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('关闭侧栏时清理图片预览状态', async () => {
    const props = { onOpenChange: vi.fn(), sessions: [{ id: 'md-img', title: '图片', messages: [{ id: 'answer', role: 'assistant' as const, content: '![预览](https://example.com/a.png)' }] }], activeSessionId: 'md-img' };
    const { rerender } = render(<AgentSidebar open {...props} />);
    fireEvent.click(screen.getByRole('img', { name: '预览' }));
    await screen.findByRole('dialog', { name: '预览' });
    rerender(<AgentSidebar open={false} {...props} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    rerender(<AgentSidebar open {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('点击 Agent 图片附件也在当前页面放大预览', async () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'image', title: '图片', messages: [{ id: 'answer', role: 'assistant', content: '看这里。', attachments: [{ name: '结果.png', type: 'image/png', url: 'data:image/png;base64,aGVsbG8=' }] }] }]} activeSessionId="image" />);
    fireEvent.click(screen.getByRole('button', { name: /结果\.png/ }));
    const lightbox = await screen.findByRole('dialog', { name: '结果.png' });
    expect(within(lightbox).getByRole('img', { name: '结果.png' })).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=');
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

  it('删除会话需要二次确认，取消不会删除', async () => {
    const onSessionDelete = vi.fn().mockResolvedValue(undefined);
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[...sessions, { id: 'two', title: '第二个对话', messages: [] }]} activeSessionId="one" onSessionDelete={onSessionDelete} />);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 第二个对话' }));
    const dialog = await screen.findByRole('dialog', { name: '删除对话' });
    expect(dialog).toHaveTextContent('确定删除「第二个对话」');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除对话' })).not.toBeInTheDocument());
    expect(onSessionDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除 第二个对话' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '删除对话' })).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(onSessionDelete).toHaveBeenCalledWith('two'));
  });

  it('删除失败时保留确认弹窗并提示错误', async () => {
    const onSessionDelete = vi.fn().mockRejectedValue(new Error('删除失败：会话正在生成'));
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSessionDelete={onSessionDelete} />);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 已有对话' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '删除对话' })).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败：会话正在生成');
    expect(screen.getByRole('dialog', { name: '删除对话' })).toBeInTheDocument();
  });

  it('删除确认弹窗继承侧栏主题变量', async () => {
    const onSessionDelete = vi.fn().mockResolvedValue(undefined);
    render(<DarlUIProvider theme={{ mode: 'dark' }}><AgentSidebar open onOpenChange={vi.fn()} sessions={[...sessions, { id: 'two', title: '第二个对话', messages: [] }]} activeSessionId="one" onSessionDelete={onSessionDelete} /></DarlUIProvider>);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 第二个对话' }));
    const dialog = await screen.findByRole('dialog', { name: '删除对话' });
    expect(dialog.getAttribute('style')).toContain('--darl-agent-bg');
    expect(dialog.getAttribute('style')).toContain('--darl-text');
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

  it('聊天侧栏不再显示 Skill 管理入口', () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} skills={skills} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 Skill/ }));
    expect(screen.queryByRole('button', { name: '管理 Skill' })).toBeNull();
    expect(screen.getByRole('button', { name: /上传/ })).toBeInTheDocument();
  });

});
