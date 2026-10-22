import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, DarlUIProvider, type AgentApplication, type AgentErrorInfo, type AgentSession, type AgentSkill } from '../src';

const apps: AgentApplication[] = [{ id: 'crm', name: '客户系统', description: '查询客户资料', status: 'connected', tools: [{ name: 'find_customer', title: '查询客户' }] }];
const skills: AgentSkill[] = [{ id: 'summary', name: '客户摘要', description: '整理客户信息' }];
const sessions: AgentSession[] = [{ id: 'one', title: '已有对话', updatedAt: '今天', messages: [{ id: 'assistant', role: 'assistant', content: '## 标题\n\n**加粗**\n\n```ts\nconst answer = true\n```' }] }];

describe('AgentSidebar', () => {
  it('embeds host-controlled drafts, references and result actions without losing remote updates', async () => {
    const send = vi.fn();
    const changed = vi.fn();
    const props = { open: true, embedded: true, onOpenChange: () => {}, sessions, activeSessionId: 'one', onSend: send, onDraftChange: changed };
    const { rerender, container } = render(<AgentSidebar {...props} draft="数据库草稿" composerHeader={<span>当前画布引用</span>} renderMessageActions={() => <button>定位成果</button>} />);
    expect(container.querySelector('.darl-agent-sidebar--embedded')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveTextContent('数据库草稿');
    expect(screen.getByRole('button', { name: '定位成果' })).toBeInTheDocument();
    rerender(<AgentSidebar {...props} draft="远端新版本" />);
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveTextContent('远端新版本');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: '远端新版本' })));
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveTextContent('远端新版本');
  });

  it('offers conversation-based Skill creation without losing the current draft', async () => {
    let created = 0;
    render(<AgentSidebar open onOpenChange={() => {}} sessions={sessions} activeSessionId="one" skills={skills} onSkillCreate={() => { created += 1; }} />);
    const input = screen.getByRole('textbox', { name: '输入消息' });
    input.textContent = '原来的草稿'; fireEvent.input(input);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 Skill/ }));
    fireEvent.click(screen.getByRole('button', { name: '通过对话创建' }));
    await waitFor(() => expect(created).toBe(1));
    expect(input).toHaveTextContent('原来的草稿');
    expect(screen.queryByRole('button', { name: '通过对话创建' })).not.toBeInTheDocument();
  });

  it('shows cancellation and refusal as neutral states while keeping real failures visible', () => {
    const cancelled: AgentErrorInfo = { code: 'REQUEST_CANCELLED', stage: 'cancellation', message: '生成已停止', retryable: false, suggestion: '' };
    const rejected: AgentErrorInfo = { ...cancelled, code: 'TOOL_REJECTED', message: '已拒绝此操作，未执行。' };
    const failed: AgentErrorInfo = { code: 'COMMAND_FAILED', stage: 'runtime', message: '命令退出码为 7', retryable: false, suggestion: '检查命令输出' };
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'one', title: '状态', messages: [{ id: 'answer', role: 'assistant', content: '', error: cancelled, toolCalls: [
      { id: 'stopped', appId: 'runtime', appName: '执行环境', toolName: 'run', status: 'cancelled' },
      { id: 'rejected', appId: 'runtime', appName: '执行环境', toolName: 'write', status: 'cancelled', errorInfo: rejected },
      { id: 'failed', appId: 'runtime', appName: '执行环境', toolName: 'run', status: 'error', errorInfo: failed },
    ] }] }]} activeSessionId="one" />);
    expect(screen.getByText('已停止')).toBeInTheDocument();
    expect(screen.getByText('生成已停止')).toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('命令退出码为 7');
    fireEvent.click(screen.getByRole('button', { name: /执行过程/ }));
    expect(screen.getByText('已拒绝')).toBeInTheDocument();
    expect(container.querySelectorAll('.darl-agent-execution-item--cancelled')).toHaveLength(2);
    expect(screen.queryByText('已取消失败')).not.toBeInTheDocument();
  });

  it('opens a viewport dialog and cancels catalog loading when Escape returns focus', async () => {
    let catalogSignal: AbortSignal | undefined;
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[]} voice={{
      enabled: false, voiceId: '', onEnabledChange: vi.fn(), onVoiceChange: vi.fn(),
      loadVoices: (_query, _page, signal) => { catalogSignal = signal; return new Promise(() => {}); },
      synthesize: async () => { throw new Error('No audio requested by this test'); },
    }} />);
    const trigger = screen.getByRole('button', { name: '选择音色' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '选择音色' });
    expect(dialog).toHaveClass('darl-agent-voice-dialog');
    expect(within(dialog).getByRole('textbox', { name: '搜索音色' })).toBeInTheDocument();
    await waitFor(() => expect(catalogSignal).toBeDefined());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择音色' })).not.toBeInTheDocument());
    expect(catalogSignal?.aborted).toBe(true);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('hides Fish controls in speech transcripts while preserving written brackets', () => {
    const history: AgentSession[] = [{ id: 'voice', title: '语音', messages: [
      { id: 'spoken', role: 'assistant', content: '', outputs: [{ output_type: 'speech', content: '[soft tone] 你好，我在这里。' }] },
      { id: 'both', role: 'assistant', content: '[文字注释] 保持可见。', outputs: [{ output_type: 'speech', content: '[warm and reassuring] 我们慢慢来。[break] 不用着急。' }] },
    ] }];
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={history} activeSessionId="voice" />);
    expect(screen.getByText('你好，我在这里。')).toBeInTheDocument();
    expect(container).toHaveTextContent('[文字注释] 保持可见。');
    expect(container).toHaveTextContent(/我们慢慢来。\s*不用着急。/);
    expect(container).not.toHaveTextContent('[soft tone]');
    expect(container).not.toHaveTextContent('[warm and reassuring]');
    expect(container).not.toHaveTextContent('[break]');
  });
  it('renders structured request errors with stage and trace identifiers', () => {
    const error: AgentErrorInfo = { code: 'MCP_CONNECTION_FAILED', stage: 'mcp-connection', message: '无法连接 MCP 应用', requestId: 'req-123', runId: 'run-456', retryable: true, suggestion: '检查应用地址后重试。' };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'error', title: '失败', messages: [{ id: 'answer', role: 'assistant', content: '', error }] }]} activeSessionId="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('MCP 连接失败');
    expect(screen.getByRole('alert')).toHaveTextContent('requestId：req-123');
    expect(screen.getByRole('alert')).toHaveTextContent('runId：run-456');
    expect(screen.getByRole('alert')).toHaveTextContent('检查应用地址后重试。');
  });

  it('普通工具记录默认折叠，展开操作后仍不展示原始参数和结果', () => {
    const history: AgentSession[] = [{ id: 'one', title: '查询', messages: [{ id: 'assistant', role: 'assistant', content: '已完成查询。', toolCalls: [{ id: 'read-call', appId: 'catalog', appName: '素材库', toolName: 'search', toolTitle: '搜索素材', status: 'success', input: { query: '不显示的参数' }, output: { text: '不显示的详细结果' } }] }] }];
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={history} activeSessionId="one" />);
    expect(screen.queryByText('搜索素材')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /执行过程/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /执行过程/ }));
    fireEvent.click(screen.getByText('文案 Agent 子任务').closest('summary')!);
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
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认执行工具' })).not.toBeInTheDocument());
  });

  it('媒体生成确认展示可读参数，像素尺寸映射为 1K/2K，并提供红色拒绝按钮', () => {
    const pending: AgentSession[] = [{ id: 'media', title: '生成图片', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [{ id: 'media-call', appId: 'builtin:media', appName: '媒体生成', toolName: 'generate_media', status: 'confirmation', input: { modelId: 'gpt-image-2', prompt: '雨夜的霓虹街道', options: { size: '1536x1024', aspectRatio: '16:9', count: 2 } } }] }] }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={pending} activeSessionId="media" onToolConfirm={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: '确认生成图片' });
    expect(dialog).toHaveTextContent('GPT Image 2');
    expect(dialog).toHaveTextContent('2K');
    expect(dialog).toHaveTextContent('16:9');
    expect(dialog).toHaveTextContent('2 张');
    expect(dialog).toHaveTextContent('雨夜的霓虹街道');
    expect(dialog).not.toHaveTextContent('1536x1024');
    expect(dialog).not.toHaveTextContent('"size"');
    expect(dialog.querySelector('dt')?.tagName).toBe('DT');
    const reject = screen.getByRole('button', { name: '拒绝' });
    expect(reject.className).toContain('darl-button--destructive');
  });

  it('1K 和 4K 尺寸标签保持原样', () => {
    const call = (size: string, id: string) => ({ id, appId: 'builtin:media', appName: '媒体生成', toolName: 'generate_media', status: 'confirmation' as const, input: { modelId: 'gpt-image-2', prompt: 'test', options: { size } } });
    const pending: AgentSession[] = [{ id: 'sizes', title: '尺寸', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [call('1024x1024', 'one')] }] }];
    const { unmount } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={pending} activeSessionId="sizes" onToolConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('1K');
    unmount();
    const large: AgentSession[] = [{ id: 'large', title: '尺寸', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [call('4096x4096', 'two')] }] }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={large} activeSessionId="large" onToolConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('4K');
  });

  it('工具确认的调用参数仍以 JSON 展示，拒绝按钮同样为红色', async () => {
    const onToolConfirm = vi.fn().mockResolvedValue(undefined);
    const pending: AgentSession[] = [{ id: 'tool', title: '工具确认', messages: [{ id: 'assistant', role: 'assistant', content: '', toolCalls: [{ id: 'write-call', appId: 'catalog', appName: '素材库', toolName: 'save', risk: 'write', status: 'confirmation', input: { name: '新素材' } }] }] }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={pending} activeSessionId="tool" onToolConfirm={onToolConfirm} />);
    expect(screen.getByText(/"name": "新素材"/)).toBeVisible();
    const reject = screen.getByRole('button', { name: '拒绝' });
    expect(reject.className).toContain('darl-button--destructive');
    fireEvent.click(reject);
    await waitFor(() => expect(onToolConfirm).toHaveBeenCalledWith('write-call', false));
  });

  it('@ 联系其他主 Agent 和子 Agent，保持当前身份并按 ID 提交引用', async () => {
    const onSend = vi.fn();
    const agents = [{ id: 'main', name: '当前助手' }, { id: 'peer', name: '协作伙伴', type: 'main_agent' as const }, { id: 'child', name: '校对专家', type: 'sub_agent' as const }, { id: 'off', name: '已停用', enabled: false }, { id: 'private', name: '不可调用', callable: false }];
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ ...sessions[0], agentId: 'main' }]} agents={agents} onSend={onSend} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    const node = document.createTextNode('@'); editor.append(node);
    const range = document.createRange(); range.setStart(node, 1); range.collapse(true);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); fireEvent.input(editor);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: /校对专家/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /当前助手|已停用|不可调用/ })).not.toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(editor.querySelector('.darl-agent-inline-reference--agent')).toHaveTextContent('@协作伙伴');
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main', content: '[协作伙伴](agent:peer)' })));
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
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSend={onSend} applications={apps} skills={skills} models={[{ id: 'model', name: '通用模型', reasoningEfforts: ['低', '高'], defaultReasoningEffort: '低' }]} />);
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

  it('只显示会话绑定的 Agent 头像，不提供切换入口，切换历史会话时保持身份', async () => {
    const onSend = vi.fn();
    const agents = [{ id: 'art', name: '美术 Agent', avatar: '/art.png' }, { id: 'writer', name: '文案 Agent', avatar: '✍️' }];
    const boundSessions = [{ ...sessions[0], agentId: 'art' }, { id: 'two', title: '文案对话', agentId: 'writer', messages: [] }];
    const props = { open: true, onOpenChange: vi.fn(), onSend, agents, sessions: boundSessions, selectedAgentId: 'writer', models: [{ id: 'model', name: '通用模型', reasoningEfforts: ['低', '高'] }] };
    const { rerender } = render(<AgentSidebar {...props} activeSessionId="one" />);
    expect(screen.getByAltText('美术 Agent头像')).toHaveAttribute('src', '/art.png');
    expect(screen.queryByRole('button', { name: /美术 Agent|选择 Agent/ })).not.toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '设计一个角色' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'art' })));
    rerender(<AgentSidebar {...props} activeSessionId="two" />);
    expect(screen.getByText('文案 Agent')).toBeInTheDocument();
    expect(screen.queryByAltText('美术 Agent头像')).not.toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '写一段文案' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'writer' })));
  });

  it('从同一个入口选择模型和思考等级，切换到无推理模型后不提交旧等级', async () => {
    const onSend = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onSend={onSend} models={[{ id: 'fast', name: '快速模型', reasoningEfforts: ['低'] }, { id: 'deep', name: '深入模型', reasoningEfforts: ['中', '高'] }, { id: 'plain', name: '普通模型' }]} />);
    expect(screen.queryByRole('button', { name: /思考：/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /快速模型/ }));
    const picker = screen.getByRole('dialog', { name: '模型与思考等级' });
    fireEvent.click(within(picker).getByRole('button', { name: /深入模型/ }));
    fireEvent.click(within(picker).getByRole('button', { name: '高' }));
    expect(screen.getByRole('button', { name: /深入模型 · 高/ })).toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '深入分析' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'deep', reasoningEffort: '高' })));
    fireEvent.click(screen.getByRole('button', { name: /深入模型/ }));
    fireEvent.click(screen.getByRole('button', { name: /普通模型 对话模型/ }));
    expect(screen.queryByRole('dialog', { name: '模型与思考等级' })).not.toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '直接回答' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'plain', reasoningEffort: undefined })));
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

  it('粘贴多张图片只添加一次，保留选中文字，移除后只发送剩余图片', async () => {
    const onSend = vi.fn();
    const onFileUpload = vi.fn();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${(file as File).name}`);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onSend={onSend} onFileUpload={onFileUpload} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    fireEvent.input(editor, { target: { textContent: '保留草稿' } });
    const range = document.createRange(); range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    const images = [new File(['first'], '截图.png', { type: 'image/png' }), new File(['second'], '参考.jpg', { type: 'image/jpeg' })];
    const getAsFile = vi.fn(() => images[0]);
    fireEvent.paste(editor, { clipboardData: { files: images, items: [{ kind: 'file', type: 'image/png', getAsFile }], getData: () => '' } });
    expect(editor).toHaveTextContent('保留草稿');
    expect(screen.getAllByRole('button', { name: /移除附件/ })).toHaveLength(2);
    expect(getAsFile).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(images[0]);
    await waitFor(() => expect(onFileUpload).toHaveBeenCalledExactlyOnceWith(images));
    fireEvent.click(screen.getByRole('button', { name: '移除附件 截图.png' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:截图.png');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ content: '保留草稿', files: [images[1]], attachments: [expect.objectContaining({ name: '参考.jpg', data: expect.stringMatching(/^data:image\/jpeg;base64,/) })] })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /移除附件/ })).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:参考.jpg');
  });

  it('从剪贴板 items 读取图片，同时在光标处粘贴纯文本', async () => {
    const onSend = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onSend={onSend} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    fireEvent.input(editor, { target: { textContent: '前后' } });
    const range = document.createRange(); range.setStart(editor.firstChild!, 1); range.collapse(true);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    const image = new File(['image'], 'image.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [], items: [
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ], getData: (type: string) => type === 'text/plain' ? '<图片说明>' : '<b>图片说明</b>' } });
    expect(editor.textContent).toBe('前<图片说明>后');
    expect(editor.querySelector('b')).toBeNull();
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ content: '前<图片说明>后', files: [image] })));
  });

  it('普通文字仍以纯文本粘贴，空剪贴板或非图片不会清除选中文字', () => {
    const onFileUpload = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onFileUpload={onFileUpload} />);
    const editor = screen.getByRole('textbox', { name: '输入消息' });
    fireEvent.input(editor, { target: { textContent: '替换我' } });
    const range = document.createRange(); range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    fireEvent.paste(editor, { clipboardData: { files: [new File(['doc'], 'notes.txt', { type: 'text/plain' })], getData: () => '' } });
    expect(editor.textContent).toBe('替换我');
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => type === 'text/plain' ? '第一行\n第二行' : '<b>富文本</b>' } });
    expect(editor.textContent).toBe('第一行\n第二行');
    expect(editor.children).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /移除附件/ })).not.toBeInTheDocument();
    expect(onFileUpload).not.toHaveBeenCalled();
  });

  it('粘贴图片复用宿主上传，失败可重试且不同会话的附件隔离', async () => {
    const onSend = vi.fn();
    const image = new File(['image'], 'pasted.png', { type: 'image/png' });
    const attachment = { name: image.name, type: image.type, fileId: 'pasted-file', url: '/api/files/pasted-file' };
    const uploadAttachment = vi.fn().mockRejectedValueOnce(new Error('图片上传失败')).mockResolvedValue(attachment);
    const props = { open: true, onOpenChange: vi.fn(), sessions: [...sessions, { id: 'two', title: '另一个会话', messages: [] }], onSend, uploadAttachment };
    const { rerender } = render(<AgentSidebar {...props} activeSessionId="one" />);
    fireEvent.paste(screen.getByRole('textbox', { name: '输入消息' }), { clipboardData: { files: [image], getData: () => '' } });
    expect(uploadAttachment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('图片上传失败');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '移除附件 pasted.png' })).toBeInTheDocument();
    rerender(<AgentSidebar {...props} activeSessionId="two" />);
    expect(screen.queryByRole('button', { name: /移除附件/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    rerender(<AgentSidebar {...props} activeSessionId="one" />);
    expect(screen.getByRole('button', { name: '移除附件 pasted.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'one', content: '', files: [image], uploadedAttachments: [attachment] })));
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenLastCalledWith(image, 0, [image]);
  });

  it('宿主接管上传后可发送普通文件，并将其展示为下载链接', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const attachment = { name: 'numbers.csv', type: 'text/csv', size: 8, fileId: 'csv-file', url: '/api/files/csv-file' };
    const uploadAttachment = vi.fn().mockResolvedValue(attachment);
    const { rerender } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} activeSessionId="one" onSend={onSend} uploadAttachment={uploadAttachment} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));
    const file = new File(['value\n1'], 'numbers.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ files: [file], uploadedAttachments: [attachment] })));
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={[{ id: 'one', title: '文件', messages: [{ id: 'file-message', role: 'user', content: '', attachments: [attachment] }] }]} activeSessionId="one" />);
    expect(screen.getByRole('link', { name: 'numbers.csv' })).toHaveAttribute('href', '/api/files/csv-file?download=1');
    expect(screen.queryByRole('img', { name: 'numbers.csv' })).not.toBeInTheDocument();
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

  it('受控推理参数无效时回落到模型默认等级，无默认值时不提交等级', async () => {
    const onSend = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), sessions, onSend, selectedReasoningEffort: '高' };
    const { rerender } = render(<AgentSidebar {...props} models={[{ id: 'fast', name: '快速模型', reasoningEfforts: ['低'], defaultReasoningEffort: '低' }]} />);
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: '低' })));
    rerender(<AgentSidebar {...props} models={[{ id: 'plain', name: '普通模型' }]} />);
    expect(screen.queryByRole('button', { name: /思考：/ })).toBeNull();
  });

  it('模型只有候选等级、没有默认等级时不臆造思考等级', async () => {
    const onSend = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onSend={onSend} models={[{ id: 'model', name: '通用模型', reasoningEfforts: ['low', 'high', 'max'] }]} />);
    expect(screen.getByRole('button', { name: /通用模型/ })).not.toHaveTextContent('·');
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: undefined })));
  });

  it('使用模型配置的默认思考等级，而不是候选列表第一项', async () => {
    const onSend = vi.fn();
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} onSend={onSend} models={[{ id: 'model', name: 'DeepSeek V4.1 Flash', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }]} />);
    expect(screen.getByRole('button', { name: /DeepSeek V4.1 Flash · high/ })).toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '输入消息' }), { target: { textContent: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'high' })));
  });

  it('聊天侧栏不再显示 Skill 管理入口', () => {
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} skills={skills} />);
    fireEvent.click(screen.getByRole('button', { name: '添加材料或能力' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 Skill/ }));
    expect(screen.queryByRole('button', { name: '管理 Skill' })).toBeNull();
    expect(screen.getByRole('button', { name: /上传/ })).toBeInTheDocument();
  });

});
