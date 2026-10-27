import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InteractiveConfirmDialog, type ConfirmQuestion } from '../src/components/interactive-confirm-dialog/InteractiveConfirmDialog';
import { DarlUIProvider } from '../src/theme/DarlUIProvider';

const questions: ConfirmQuestion[] = [
  { id: 'choice', label: '选择方向', type: 'single', required: true, defaultValue: 'a', options: [{ value: 'a', label: '忠实原著' }, { value: 'b', label: '戏剧化' }] },
  { id: 'tags', label: '保留内容', type: 'multiple', required: true, options: [{ value: 'dialogue', label: '对白' }, { value: 'events', label: '事件' }] },
  { id: 'name', label: '名称', type: 'text' },
  { id: 'notes', label: '备注', type: 'textarea' },
];

describe('InteractiveConfirmDialog', () => {
  it('preserves host colors inside the portal instead of replacing them with dark defaults', () => {
    render(<DarlUIProvider theme={{ mode: 'dark' }}><InteractiveConfirmDialog open onOpenChange={vi.fn()} title="主题" questions={[]} onConfirm={vi.fn()}
      style={{ '--darl-confirm-bg': '#101113', '--darl-confirm-text': '#e7e8eb', '--darl-confirm-border': '#2d3036' } as React.CSSProperties} /></DarlUIProvider>);
    expect(screen.getByRole('dialog', { name: '主题' })).toHaveStyle({ '--darl-confirm-bg': '#101113', '--darl-confirm-text': '#e7e8eb', '--darl-confirm-border': '#2d3036' });
  });
  it('validates required questions and returns ids and values rather than labels', async () => {
    const onConfirm = vi.fn();
    render(<InteractiveConfirmDialog open onOpenChange={vi.fn()} title="改编确认" questions={questions} onConfirm={onConfirm} confirmText="开始写作" />);
    expect(screen.getByRole('dialog', { name: '改编确认' })).toBeInTheDocument();
    expect(screen.getByLabelText('忠实原著')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /开始写作/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('请完成所有必填问题');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('事件'));
    fireEvent.click(screen.getByLabelText('戏剧化'));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '萧炎' } });
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '保留对白' } });
    fireEvent.click(screen.getByRole('button', { name: /开始写作/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ choice: 'b', tags: ['events'], name: '萧炎', notes: '保留对白' }));
  });
  it('cancel and escape never submit', () => {
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(<InteractiveConfirmDialog open onOpenChange={onOpenChange} onCancel={onCancel} showCancel title="确认" questions={questions} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('shows only the confirmation action by default', () => {
    render(<InteractiveConfirmDialog open onOpenChange={vi.fn()} title="确认" questions={[]} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /确认/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });
  it('keeps selections after rejected callback and prevents duplicate pending submissions', async () => {
    let reject!: (error: Error) => void;
    const onConfirm = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<InteractiveConfirmDialog open onOpenChange={vi.fn()} title="确认" questions={questions} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByLabelText('对白'));
    const submit = screen.getByRole('button', { name: /确认/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    reject(new Error('网络错误'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('网络错误'));
    expect(screen.getByLabelText('对白')).toBeChecked();
  });
  it('resets draft when dialog closes and reopens', () => {
    const props = { onOpenChange: vi.fn(), title: '确认', questions, onConfirm: vi.fn() };
    const { rerender } = render(<InteractiveConfirmDialog {...props} open />);
    fireEvent.click(screen.getByLabelText('戏剧化'));
    rerender(<InteractiveConfirmDialog {...props} open={false} />);
    rerender(<InteractiveConfirmDialog {...props} open />);
    expect(screen.getByLabelText('忠实原著')).toBeChecked();
  });
  it('supports empty question list as a simple confirmation', async () => {
    const onConfirm = vi.fn();
    render(<InteractiveConfirmDialog open onOpenChange={vi.fn()} title="继续吗" questions={[]} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({}));
  });
  it('uses the semantic theme classes instead of hard-coded inline colors', () => {
    render(<InteractiveConfirmDialog open onOpenChange={vi.fn()} title="确认" questions={[]} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: '确认' });
    // 没有 Provider 时不写死背景色：交给 CSS 变量与 color-scheme，深色宿主不会退回纯白。
    expect(dialog.style.getPropertyValue('--darl-confirm-bg')).toBe('');
    expect(dialog).not.toHaveClass('darl-confirm-dark');
    expect(dialog).not.toHaveAttribute('data-darl-theme');
  });
  it('follows the DarlUIProvider dark theme', () => {
    render(<DarlUIProvider theme={{ mode: 'dark', primaryColor: '#8ba4c5' }}><InteractiveConfirmDialog open onOpenChange={vi.fn()} title="确认" questions={[]} onConfirm={vi.fn()} /></DarlUIProvider>);
    const dialog = screen.getByRole('dialog', { name: '确认' });
    expect(dialog).toHaveClass('darl-confirm-dark');
    expect(dialog).toHaveAttribute('data-darl-theme', 'dark');
    expect(dialog.style.getPropertyValue('--darl-confirm-accent')).toBe('#8ba4c5');
  });
  it('lets an explicit theme override the provider', () => {
    render(<DarlUIProvider theme={{ mode: 'light' }}><InteractiveConfirmDialog open onOpenChange={vi.fn()} title="确认" questions={[]} onConfirm={vi.fn()} theme="dark" /></DarlUIProvider>);
    expect(screen.getByRole('dialog', { name: '确认' })).toHaveClass('darl-confirm-dark');
  });
});
