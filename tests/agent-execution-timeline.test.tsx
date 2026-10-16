import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, type AgentExecutionEvent, type AgentSession } from '../src';

const event = (value: Partial<AgentExecutionEvent> & Pick<AgentExecutionEvent, 'id' | 'status' | 'source' | 'name'>): AgentExecutionEvent => ({ timestamp: '2026-10-17T00:00:00.000Z', ...value });

describe('Agent execution timeline', () => {
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
    const toggle = screen.getByRole('button', { name: /执行时间线/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container).not.toHaveTextContent('hidden');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const timelineView = screen.getByRole('list');
    expect(within(timelineView).getAllByText('文案助手').length).toBeGreaterThan(0);
    expect(within(timelineView).getByText('重试 1')).toBeInTheDocument();
    expect(within(timelineView).getAllByText('已完成').length).toBeGreaterThan(0);
    expect(container.querySelector('.darl-agent-execution-item--running')).toBeNull();
    expect(container).not.toHaveTextContent('hidden');
  });

  it('keeps ordinary tool confirmation as a tool card without adding a main-agent timeline', () => {
    const onToolConfirm = vi.fn().mockResolvedValue(undefined);
    const timeline: AgentExecutionEvent[] = [event({ id: 'confirmation', source: 'tool', status: 'confirmation', name: '保存素材', runId: 'root', toolCallId: 'write-1' })];
    const session: AgentSession = { id: 'confirmation', title: '确认', messages: [{ id: 'answer', role: 'assistant', content: '', timeline, toolCalls: [{ id: 'write-1', appId: 'catalog', appName: '素材库', toolName: 'save', status: 'confirmation', input: { name: '新素材' } }] }] };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[session]} activeSessionId="confirmation" onToolConfirm={onToolConfirm} />);
    expect(screen.getByText(/"name": "新素材"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '允许执行' }));
    expect(onToolConfirm).toHaveBeenCalledWith('write-1', true);
    expect(screen.queryByRole('button', { name: /执行时间线/ })).toBeNull();
  });

  it('keeps cancellation and timeout as terminal states instead of success', () => {
    const timeline: AgentExecutionEvent[] = [
      event({ id: 'root', source: 'agent', status: 'started', name: '主控', runId: 'root' }),
      event({ id: 'cancelled', source: 'agent', status: 'cancelled', name: '主控', runId: 'root', durationMs: 320, error: { code: 'REQUEST_CANCELLED', stage: 'cancellation', message: '生成已停止', retryable: true, suggestion: '可以重新生成。' } }),
    ];
    const session: AgentSession = { id: 'cancelled', title: '取消', messages: [{ id: 'answer', role: 'assistant', content: '', timeline }] };
    render(<AgentSidebar open onOpenChange={vi.fn()} sessions={[session]} activeSessionId="cancelled" />);
    expect(screen.queryByRole('button', { name: /执行时间线/ })).toBeNull();
  });
});
