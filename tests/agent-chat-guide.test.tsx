import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Guide } from '../examples/agent-chat/client/Guide';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('agent chat development guide', () => {
  it('copies the original example and keeps feedback visible after repeated copies', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { unmount } = render(<Guide onBack={() => {}} />);
    const copy = screen.getAllByRole('button', { name: '复制' }).find((button) => button.closest('.guide-code')?.textContent?.includes('onSend={sendMessage}'))!;
    const code = within(copy.closest('.guide-code')!);
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('onSend={sendMessage}'));
    expect(code.getByRole('status')).toHaveTextContent('已复制');
    act(() => { vi.advanceTimersByTime(800); });
    await act(async () => { fireEvent.click(copy); });
    act(() => { vi.advanceTimersByTime(800); });
    expect(code.getByRole('status')).toHaveTextContent('已复制');
    act(() => { vi.advanceTimersByTime(400); });
    expect(code.getByRole('status')).toHaveTextContent('example');
    await act(async () => { fireEvent.click(copy); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a useful error when clipboard access fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<Guide onBack={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0]);
    expect(await screen.findByText('复制失败，请手动选择文本复制')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();
  });

  it('documents model routing, long-context compaction, and H3 media rules', () => {
    render(<Guide onBack={() => {}} />);
    expect(screen.getByRole('button', { name: '模型配置与长文本' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '模型配置、长文本与路由' })).toBeInTheDocument();
    expect(screen.getByText(/1M token 上下文预算/)).toBeInTheDocument();
    expect(screen.getByText(/H3 Flash 视频模型/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制' }).some((button) => button.closest('.guide-code')?.textContent?.includes('toAgentModels'))).toBe(true);
  });
});
