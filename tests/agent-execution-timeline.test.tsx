import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, type AgentExecutionEvent, type AgentSession, type AgentToolCall } from '../src';

const event = (value: Partial<AgentExecutionEvent> & Pick<AgentExecutionEvent, 'id' | 'status' | 'source' | 'name'>): AgentExecutionEvent => ({ timestamp: '2026-10-17T00:00:00.000Z', ...value });
const tool = (id: string, overrides: Partial<AgentToolCall> = {}): AgentToolCall => ({ id, appId: 'catalog', appName: '素材库', toolName: 'search', toolTitle: '搜索素材', status: 'success', ...overrides });
const sessionWith = (message: Partial<AgentSession['messages'][number]>): AgentSession[] => [{ id: 'one', title: '工具调用', messages: [{ id: 'answer', role: 'assistant', content: '处理结果已保存。', ...message }] }];

describe('Agent execution timeline', () => {
  it('places one collapsed record before the answer and keeps attachments accessible', () => {
    const sessions = sessionWith({ toolCalls: [tool('one'), tool('two'), tool('three')], attachments: [{ name: '分镜表.csv', type: 'text/csv', fileId: 'result' }] });
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} />);
    const toggle = screen.getByRole('button', { name: /执行过程/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('3 次调用');
    expect(screen.queryByText('搜索素材')).not.toBeInTheDocument();
    expect(screen.getByText('处理结果已保存。')).toBeVisible();
    expect(screen.getByRole('link', { name: '分镜表.csv' })).toHaveAttribute('href', '/api/files/result?download=1');
    expect(container.querySelector('.darl-agent-message-body')?.firstElementChild).toHaveClass('darl-agent-execution');
    expect(container.querySelector('.darl-agent-execution-duration')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByText('搜索素材')).toHaveLength(3);
    expect(container.querySelector('.darl-agent-execution-group')).toBeNull();
    expect(container.querySelector('.darl-agent-execution > ol')?.children).toHaveLength(3);
  });

  it('interleaves actual process notes and tool calls without another grouping layer', () => {
    const at = (second: number) => `2026-10-17T00:00:0${second}.000Z`;
    const timeline = [
      event({ id: 'root-start', source: 'agent', status: 'running', name: '主控', runId: 'root' }),
      event({ id: 'tool-one', source: 'tool', status: 'success', name: '搜索素材', toolCallId: 'one', startedAt: at(2), timestamp: at(3) }),
      event({ id: 'note-one', source: 'commentary', status: 'success', name: '过程说明', summary: '我先查询已有素材。', runId: 'root', timestamp: at(1) }),
      event({ id: 'note-two', source: 'commentary', status: 'success', name: '过程说明', summary: '已找到素材，接下来保存。', runId: 'root', timestamp: at(4) }),
      event({ id: 'tool-two', source: 'tool', status: 'success', name: '保存素材', toolCallId: 'two', startedAt: at(5), timestamp: at(6) }),
      event({ id: 'root-done', source: 'agent', status: 'success', name: '主控', runId: 'root', timestamp: at(7), durationMs: 7000 }),
    ];
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ timeline })} />);
    const toggle = screen.getByRole('button', { name: /执行过程/ });
    expect(toggle).toHaveTextContent('2 次调用');
    expect(toggle).toHaveTextContent('处理完成');
    expect(screen.queryByText('过程说明')).toBeNull();
    fireEvent.click(toggle);
    const rows = container.querySelectorAll('.darl-agent-execution > ol > li > details > summary');
    expect(Array.from(rows, (row) => row.querySelector('strong')?.textContent)).toEqual(['过程说明', '搜索素材', '过程说明', '保存素材']);
    fireEvent.click(rows[0]);
    expect(screen.getByText('我先查询已有素材。')).toBeVisible();
    expect(container.querySelector('.darl-agent-markdown')?.closest('.darl-agent-execution-commentary')).toBeInTheDocument();
    expect(screen.getByText('处理结果已保存。')).toBeVisible();
  });

  it('shows current work, then preserves a user-opened record through completion', () => {
    const { rerender } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ streaming: true, content: '', toolCalls: [tool('one'), tool('two', { toolName: 'save', toolTitle: '保存素材', status: 'running' })] })} />);
    const toggle = screen.getByRole('button', { name: /执行过程：执行中 · 保存素材/ });
    expect(toggle).toHaveTextContent('2 次调用');
    expect(screen.queryByText('正在生成…')).toBeNull();
    fireEvent.click(toggle);
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ streaming: true, content: '', toolCalls: [tool('one'), tool('two', { toolName: 'save', toolTitle: '保存素材' })] })} />);
    expect(toggle).toHaveTextContent('处理中');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ toolCalls: [tool('one'), tool('two', { toolName: 'save', toolTitle: '保存素材' })] })} />);
    expect(toggle).toHaveTextContent('处理完成');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('处理结果已保存。')).toBeVisible();
  });

  it('keeps failed calls visible without expanding and clears recovered errors', () => {
    const error = { code: 'MCP_TOOL_FAILED', stage: 'mcp-tool' as const, message: '素材服务暂时不可用', retryable: true, suggestion: '稍后重试。' };
    const failed = tool('one', { status: 'error', errorInfo: error, input: { secret: 'private-input' }, output: 'private-output' });
    const { rerender, container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ toolCalls: [failed] })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent('素材服务暂时不可用');
    expect(container).not.toHaveTextContent('private-input');
    expect(container).not.toHaveTextContent('private-output');
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({
      timeline: [event({ id: 'failed-event', source: 'tool', status: 'error', name: '搜索素材', toolCallId: 'one', error })],
      toolCalls: [tool('one', { attempt: 2 })],
    })} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('处理完成');
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('1 次调用');
  });

  it('uses final task duration and stops ticking after completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T00:00:02.000Z'));
    try {
      const started = event({ id: 'root-start', source: 'agent', status: 'running', name: '主控', runId: 'root' });
      const sessions = sessionWith({ streaming: true, timeline: [started], toolCalls: [tool('one', { status: 'running' })] });
      const { rerender, unmount } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessions} />);
      expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('2s');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('3s');
      const done = event({ id: 'root-done', source: 'agent', status: 'success', name: '主控', runId: 'root', timestamp: '2026-10-17T00:00:03.000Z', durationMs: 3000 });
      rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ timeline: [started, done], toolCalls: [tool('one')] })} />);
      act(() => { vi.advanceTimersByTime(60000); });
      expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('3s');
      expect(screen.getByRole('button', { name: /执行过程/ })).not.toHaveTextContent('1m');
      unmount();
    } finally { vi.useRealTimers(); }
  });

  it('keeps stopped and timed-out runs distinct from completed runs', () => {
    const error = { code: 'TOOL_TIMEOUT', stage: 'timeout' as const, message: '工具执行超时', retryable: true, suggestion: '可重新发起。' };
    const { rerender } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ toolCalls: [tool('one', { status: 'cancelled' })] })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('已停止');
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ error, toolCalls: [tool('one', { status: 'error', errorInfo: error })] })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('处理失败');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('工具执行超时');
  });

  it('uses the overall task outcome even when individual calls were cancelled', () => {
    const terminal = (status: 'success' | 'error') => event({ id: 'root', source: 'agent', status, name: '主控', runId: 'root', durationMs: 1000 });
    const toolCalls = [tool('one', { status: 'cancelled' }), tool('two')];
    const { rerender } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ timeline: [terminal('success')], toolCalls })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('处理完成');
    rerender(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ timeline: [terminal('error')], toolCalls })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('处理失败');
  });

  it('keeps tool events without call IDs separate from their parent and omits unknown durations', () => {
    const timeline = [
      event({ id: 'root', source: 'agent', status: 'success', name: '主控', runId: 'root' }),
      event({ id: 'tool', source: 'tool', status: 'success', name: '查询素材', runId: 'root' }),
    ];
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={sessionWith({ timeline })} />);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveTextContent('1 次调用');
    expect(container.querySelector('.darl-agent-execution-duration')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /执行过程/ }));
    expect(screen.getByText('查询素材')).toBeVisible();
    expect(container.querySelector('.darl-agent-execution-details')).not.toHaveTextContent('耗时');
  });

  it('keeps ordered parent and child activity compact and hides tool payloads', () => {
    const timeline: AgentExecutionEvent[] = [
      event({ id: 'root-start', source: 'agent', status: 'started', name: '主控' , runId: 'root' }),
      event({ id: 'child-start', source: 'agent', status: 'running', name: '文案助手', agentId: 'writer', runId: 'child', parentRunId: 'root', summary: '根据素材整理摘要' }),
      event({ id: 'tool-retry', source: 'tool', status: 'retrying', name: '搜索素材', runId: 'child', parentRunId: 'child', toolCallId: 'call-1', attempt: 2 }),
      event({ id: 'child-done', source: 'agent', status: 'success', name: '文案助手', agentId: 'writer', runId: 'child', parentRunId: 'root', durationMs: 1200 }),
      event({ id: 'root-done', source: 'agent', status: 'success', name: '主控', runId: 'root', durationMs: 1800 }),
    ];
    const session: AgentSession = { id: 'timeline', title: '时间线', messages: [{ id: 'answer', role: 'assistant', content: '', timeline, toolCalls: [{ id: 'call-1', appId: 'catalog', appName: '素材库', toolName: 'search', status: 'retrying', input: { secret: 'hidden' }, output: { secret: 'hidden' } }] }] };
    const { container } = render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[session]} activeSessionId="timeline" />);
    const toggle = screen.getByRole('button', { name: /执行过程/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container).not.toHaveTextContent('hidden');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const timelineView = screen.getByRole('list');
    expect(within(timelineView).getAllByText('文案助手').length).toBeGreaterThan(0);
    expect(within(timelineView).getByText('重试 1')).toBeInTheDocument();
    expect(within(timelineView).getAllByText('已完成').length).toBeGreaterThan(0);
    expect(container.querySelector('.darl-agent-execution-item--running')).toBeNull();
    expect(toggle).toHaveTextContent('处理完成');
    expect(toggle).toHaveTextContent('1 次调用');
    expect(toggle).toHaveTextContent('1s');
    expect(container).not.toHaveTextContent('hidden');
  });

  it('keeps tool approval accessible while the execution record is collapsed', () => {
    const onToolConfirm = vi.fn().mockResolvedValue(undefined);
    const timeline: AgentExecutionEvent[] = [event({ id: 'confirmation', source: 'tool', status: 'confirmation', name: '保存素材', runId: 'root', toolCallId: 'write-1' })];
    const session: AgentSession = { id: 'confirmation', title: '确认', messages: [{ id: 'answer', role: 'assistant', content: '', timeline, toolCalls: [{ id: 'write-1', appId: 'catalog', appName: '素材库', toolName: 'save', status: 'confirmation', input: { name: '新素材' } }] }] };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[session]} activeSessionId="confirmation" onToolConfirm={onToolConfirm} />);
    expect(screen.getByText(/"name": "新素材"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '允许执行' }));
    expect(onToolConfirm).toHaveBeenCalledWith('write-1', true);
    expect(screen.getByRole('button', { name: /执行过程/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps cancellation and timeout as terminal states instead of success', () => {
    const timeline: AgentExecutionEvent[] = [
      event({ id: 'root', source: 'agent', status: 'started', name: '主控', runId: 'root' }),
      event({ id: 'cancelled', source: 'agent', status: 'cancelled', name: '主控', runId: 'root', durationMs: 320, error: { code: 'REQUEST_CANCELLED', stage: 'cancellation', message: '生成已停止', retryable: true, suggestion: '可以重新生成。' } }),
    ];
    const session: AgentSession = { id: 'cancelled', title: '取消', messages: [{ id: 'answer', role: 'assistant', content: '', timeline }] };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[session]} activeSessionId="cancelled" />);
    expect(screen.queryByRole('button', { name: /执行过程/ })).toBeNull();
  });
});
