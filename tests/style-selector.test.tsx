import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleSelector, type StyleOption, type StyleLoadMoreRequest } from '../src';

const styles: StyleOption[] = [
  { id: 'one', name: '电影感', category: '真人风格', description: '自然肤色', favorite: true },
  { id: 'two', name: '科幻机甲', category: '3D风格', description: '硬表面' },
];
afterEach(() => vi.unstubAllGlobals());

function observeBottom() {
  let callback: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(next: IntersectionObserverCallback) { callback = next; }
    observe() {}
    disconnect = disconnect;
  });
  return { enter: () => act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)), disconnect };
}

describe('StyleSelector', () => {
  it('renders as a modal and closes through the callback', () => {
    const onOpenChange = vi.fn();
    render(<StyleSelector open styles={styles} onOpenChange={onOpenChange} />);
    expect(screen.getByRole('dialog', { name: '风格选择器' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭风格选择' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('filters styles and reports favorite changes', () => {
    const onFavoriteChange = vi.fn();
    render(<StyleSelector open styles={styles} onFavoriteChange={onFavoriteChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '3D风格' }));
    expect(screen.getByRole('button', { name: '预览科幻机甲' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览电影感' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收藏科幻机甲' }));
    expect(onFavoriteChange).toHaveBeenCalledWith(styles[1], true);
  });

  it('keeps owned styles out of the market collection', () => {
    const owned = { ...styles[0], id: 'owned', name: '我的风格', isOwned: true };
    const { unmount } = render(<StyleSelector open styles={[styles[0], owned]} />);
    expect(screen.getByRole('button', { name: '预览电影感' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览我的风格' })).toBeNull();
    unmount();
    render(<StyleSelector open styles={[owned]} defaultCollection="mine" />);
    expect(screen.getByRole('button', { name: '预览我的风格' })).toBeInTheDocument();
  });

  it('exposes edit controls for owned styles and submits updates', async () => {
    const owned = { ...styles[0], isOwned: true, image: '/api/workspace/storage/styles/8' };
    const onEdit = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<StyleSelector open styles={[owned]} defaultCollection="mine" onEdit={onEdit} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑电影感' }));
    expect(onEdit).toHaveBeenCalledWith(owned);
    rerender(<StyleSelector open styles={[owned]} defaultCollection="mine" editingStyle={owned} onUpdate={onUpdate} />);
    expect(screen.getByRole('textbox', { name: /风格名称/ })).toHaveValue('电影感');
    expect(screen.getByRole('button', { name: '更换参考图片' }).querySelector('img')).toHaveAttribute('src', owned.image);
    fireEvent.change(screen.getByRole('textbox', { name: /风格描述词/ }), { target: { value: '更新后的描述' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(owned, { name: '电影感', description: '更新后的描述' }));
  });

  it('validates creation and sends the confirmed request', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<StyleSelector open styles={styles} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '创建风格' }));
    fireEvent.change(screen.getByLabelText(/风格名称/), { target: { value: '新风格' } });
    fireEvent.change(screen.getByLabelText(/风格描述词/), { target: { value: '柔和电影光' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('heading', { name: '新风格' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建风格' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: '新风格', description: '柔和电影光' }));
  });

  it('reveals local pages at the bottom and preserves pending selection until confirmation', () => {
    const bottom = observeBottom();
    const onChange = vi.fn();
    render(<StyleSelector open styles={styles} pageSize={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '预览电影感' }));
    expect(screen.queryByRole('button', { name: '预览科幻机甲' })).toBeNull();
    bottom.enter();
    expect(screen.getByRole('button', { name: '预览科幻机甲' })).toBeInTheDocument();
    expect(screen.queryByText('已加载全部风格')).toBeNull();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    expect(onChange).toHaveBeenCalledWith(styles[0]);
  });

  it('deduplicates remote requests, retains the list on failure and retries', async () => {
    const bottom = observeBottom();
    let reject!: (reason: Error) => void;
    const onLoadMore = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const { rerender } = render(<StyleSelector open styles={[styles[0]]} hasMore onLoadMore={onLoadMore} />);
    bottom.enter(); bottom.enter();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载');
    await act(async () => reject(new Error('网络中断')));
    expect(screen.getByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByRole('button', { name: '预览电影感' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(2));
    rerender(<StyleSelector open styles={styles} hasMore={false} onLoadMore={onLoadMore} />);
    expect(screen.getByRole('button', { name: '预览科幻机甲' })).toBeInTheDocument();
    expect(screen.queryByText('已加载全部风格')).toBeNull();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('passes filters and aborts a previous request when searching or closing', () => {
    const bottom = observeBottom();
    const onLoadMore = vi.fn((_request: StyleLoadMoreRequest) => new Promise<void>(() => {}));
    const onFilterChange = vi.fn();
    const { rerender } = render(<StyleSelector open styles={styles} hasMore onLoadMore={onLoadMore} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '3D风格' }));
    bottom.enter();
    const first = onLoadMore.mock.calls[0][0] as unknown as { category: string; signal: AbortSignal };
    expect(first.category).toBe('3D风格');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索风格名称' }), { target: { value: '机甲' } });
    expect(first.signal.aborted).toBe(true);
    expect(onFilterChange).toHaveBeenLastCalledWith({ collection: 'market', category: '3D风格', query: '机甲' });
    bottom.enter();
    expect(onLoadMore).toHaveBeenLastCalledWith(expect.objectContaining({ collection: 'market', category: '3D风格', query: '机甲' }));
    const next = onLoadMore.mock.calls[1][0] as unknown as { signal: AbortSignal };
    rerender(<StyleSelector open={false} styles={styles} hasMore onLoadMore={onLoadMore} />);
    expect(next.signal.aborted).toBe(true);
    expect(bottom.disconnect).toHaveBeenCalled();
  });
});
