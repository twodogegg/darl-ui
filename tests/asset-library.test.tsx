import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetLibrary, type AssetFilter, type AssetItem, type AssetScope, type AssetSection, type AssetTag } from '../src';

const tags: AssetTag[] = [
  { id: 'all', label: '全部' }, { id: 'character', label: '角色' }, { id: 'scene', label: '场景' },
];
const assets: AssetItem[] = [
  { id: 'a1', name: '角色三视图', kind: 'image', section: 'generated', tags: ['character'], thumbnail: '/a.png', favorite: true },
  { id: 'a2', name: '雨夜长街', kind: 'image', section: 'generated', tags: ['scene'] },
  { id: 'a3', name: '夜雨环境音', kind: 'audio', section: 'uploaded', tags: [], duration: 42 },
  { id: 'a4', name: '庭院参考', kind: 'video', section: 'saved', tags: ['scene'], duration: 65, url: '/c.mp4' },
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('AssetLibrary', () => {
  it('renders the generated section by default and switches sections', () => {
    render(<AssetLibrary assets={assets} tags={tags} />);
    expect(screen.getByRole('heading', { name: '生成历史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览角色三视图' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览庭院参考' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /我保存的/ }));
    expect(screen.getByRole('button', { name: '预览庭院参考' })).toBeInTheDocument();
  });

  it('filters by tag and search query, and shows the empty state', () => {
    render(<AssetLibrary assets={assets} tags={tags} defaultSection="saved" />);
    // Radix Tabs 在 mousedown 时激活，真实点击会同时触发两者。
    const sceneTab = screen.getByRole('tab', { name: '场景' });
    fireEvent.mouseDown(sceneTab, { button: 0 });
    fireEvent.click(sceneTab);
    expect(screen.getByRole('button', { name: '预览庭院参考' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览夜雨环境音' })).toBeNull();
    fireEvent.change(screen.getByLabelText('搜索资产名称'), { target: { value: '不存在的资产' } });
    expect(screen.getByText('没有找到匹配的资产')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(screen.getByRole('button', { name: '预览庭院参考' })).toBeInTheDocument();
  });

  it('shows the generated toolbar with scope switch and kind counts, filtering by both', () => {
    const onScopeChange = vi.fn();
    render(<AssetLibrary assets={assets} tags={tags} onScopeChange={onScopeChange} />);
    expect(screen.getByRole('tab', { name: /^全部\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^图片\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^视频\s*0$/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '场景' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建标签' })).toBeNull();
    // 没有生成的音频，切到音频后为空。
    const audioTab = screen.getByRole('tab', { name: /^音频\s*\d$/ });
    fireEvent.mouseDown(audioTab, { button: 0 });
    fireEvent.click(audioTab);
    expect(screen.getByText('当前暂无资产')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览角色三视图' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '全部项目' }));
    expect(onScopeChange).toHaveBeenCalledWith('all');
  });

  it('reports selection and favorite changes', () => {
    const onSelect = vi.fn();
    const onFavoriteChange = vi.fn();
    render(<AssetLibrary assets={assets} tags={tags} onSelect={onSelect} onFavoriteChange={onFavoriteChange} value="a1" insertIndex={2} />);
    fireEvent.click(screen.getByRole('button', { name: '收藏雨夜长街' }));
    expect(onFavoriteChange).toHaveBeenCalledWith(assets[1], true);
    expect(screen.getByRole('button', { name: '取消收藏角色三视图' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '预览雨夜长街' }));
    expect(onSelect).toHaveBeenCalledWith({ asset: assets[1], index: 2 });
    expect(document.querySelector('.darl-asset-index')).toHaveTextContent('2');
  });

  it('renames through the host callback and keeps the draft on failure', async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error('名称重复')).mockResolvedValueOnce(undefined);
    render(<AssetLibrary assets={assets} tags={tags} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: '重命名角色三视图' }));
    const input = screen.getByLabelText('资产名称');
    fireEvent.change(input, { target: { value: '角色三视图 v2' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(onRename).toHaveBeenCalledWith({ asset: assets[0], name: '角色三视图 v2' });
    expect(await screen.findByRole('alert')).toHaveTextContent('名称重复');
    expect(screen.getByLabelText('资产名称')).toHaveValue('角色三视图 v2');
    await act(async () => { fireEvent.submit(screen.getByLabelText('资产名称').closest('form')!); });
    await waitFor(() => expect(screen.queryByLabelText('资产名称')).toBeNull());
  });

  it('deletes only after confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AssetLibrary assets={assets} tags={tags} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: '删除角色三视图' }));
    expect(onDelete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除角色三视图' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(assets[0]));
  });

  it('rejects uploads that fail validation and keeps per-file failures independent', async () => {
    const upload = vi.fn(async ({ file, onProgress }: { file: File; onProgress: (value: number) => void }) => {
      onProgress(50);
      if (file.name.includes('bad')) throw new Error('网络中断');
      return { id: file.name, name: file.name, kind: 'video' as const, section: 'generated' as const };
    });
    render(<AssetLibrary assets={[]} tags={tags} upload={upload} accept={['video/*']} maxFileSize={1024} />);
    const input = screen.getByLabelText('选择要上传的资产文件') as HTMLInputElement;
    const tooLarge = new File(['x'.repeat(2048)], 'huge.mp4', { type: 'video/mp4' });
    const wrongType = new File(['x'], 'text.txt', { type: 'text/plain' });
    await act(async () => { fireEvent.change(input, { target: { files: [tooLarge, wrongType] } }); });
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('huge.mp4：超过 1.0 KB');
    expect(screen.getByRole('alert')).toHaveTextContent('text.txt：不支持的格式');

    const ok = new File(['x'], 'ok.mp4', { type: 'video/mp4' });
    await act(async () => { fireEvent.change(input, { target: { files: [ok] } }); });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    const bad = new File(['x'], 'bad.mp4', { type: 'video/mp4' });
    await act(async () => { fireEvent.change(input, { target: { files: [bad] } }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
  });

  it('reports drag-and-drop files to the upload adapter', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'x', name: 'drop.mp4', kind: 'video', section: 'generated' });
    render(<AssetLibrary assets={[]} tags={tags} upload={upload} accept={['video/*']} />);
    const panel = screen.getByText('当前暂无资产').closest('.darl-asset-panel')!;
    const file = new File(['x'], 'drop.mp4', { type: 'video/mp4' });
    await act(async () => { fireEvent.drop(panel, { dataTransfer: { files: [file] } }); });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file, section: 'generated' })));
  });

  it('creates tags and clamps pages of local assets', () => {
    const onCreateTag = vi.fn((label: string) => ({ id: `tag-${label}`, label, removable: true }));
    const many = Array.from({ length: 9 }, (_, index): AssetItem => ({ id: `m${index}`, name: `资产 ${index}`, kind: 'image', section: 'saved' }));
    render(<AssetLibrary assets={many} tags={tags} onCreateTag={onCreateTag} pageSize={4} defaultSection="saved" />);
    expect(screen.getAllByRole('button', { name: /^预览资产/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /加载更多/ }));
    expect(screen.getAllByRole('button', { name: /^预览资产/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: '新建标签' }));
    fireEvent.change(screen.getByLabelText('新标签名称'), { target: { value: '道具' } });
    fireEvent.submit(screen.getByLabelText('新标签名称').closest('form')!);
    expect(onCreateTag).toHaveBeenCalledWith('道具');
  });

  it('shows loading and honours the controlled section', () => {
    const onSectionChange = vi.fn();
    const { rerender } = render(<AssetLibrary assets={assets} tags={tags} loading section="saved" onSectionChange={onSectionChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载资产');
    fireEvent.click(screen.getByRole('button', { name: /我上传的/ }));
    expect(onSectionChange).toHaveBeenCalledWith('uploaded');
    rerender(<AssetLibrary assets={[]} tags={tags} section="uploaded" disabled />);
    expect(screen.getByText('当前暂无资产')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上传资产' })).toBeNull();
  });

  it('renders as a modal dialog and closes through the overlay or close button', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<AssetLibrary open assets={assets} tags={tags} onOpenChange={onOpenChange} />);
    expect(screen.getByRole('dialog', { name: '资产库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭资产库' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭资产库' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AssetLibrary open={false} assets={assets} tags={tags} onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays embedded when no open prop is provided', () => {
    render(<AssetLibrary assets={assets} tags={tags} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭资产库' })).toBeNull();
    expect(screen.getByRole('region', { name: '资产库' })).toBeInTheDocument();
  });

  it('opens through defaultOpen together with onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(<AssetLibrary defaultOpen onOpenChange={onOpenChange} assets={assets} tags={tags} />);
    expect(screen.getByRole('dialog', { name: '资产库' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭资产库' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the modal for a controlled open prop only', () => {
    render(<AssetLibrary open assets={assets} tags={tags} />);
    expect(screen.getByRole('dialog', { name: '资产库' })).toBeInTheDocument();
  });

  it('shows a confirm footer once an asset is selected and closes after success', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('资产已被删除'));
    const onOpenChange = vi.fn();
    const { rerender } = render(<AssetLibrary open assets={assets} tags={tags} value="a2" onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByText(/已选择：雨夜长街/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认' })); });
    expect(onConfirm).toHaveBeenCalledWith(assets[1]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    rerender(<AssetLibrary open assets={assets} tags={tags} value="a2" onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('资产已被删除');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it('hides the confirm footer without a selection or without onConfirm', () => {
    const { rerender } = render(<AssetLibrary open assets={assets} tags={tags} onConfirm={vi.fn()} />);
    expect(screen.queryByText(/已选择/)).toBeNull();
    rerender(<AssetLibrary open assets={assets} tags={tags} value="a1" />);
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('clears the selection when switching section, scope, or kind', () => {
    const onSelectionChange = vi.fn();
    const onConfirm = vi.fn();
    render(<AssetLibrary open assets={assets} tags={tags} value="a2" onSelectionChange={onSelectionChange} onConfirm={onConfirm} />);
    expect(screen.getByText(/已选择：雨夜长街/)).toBeInTheDocument();
    // 切换类型筛选（生成历史内）
    const imageTab = screen.getByRole('tab', { name: /^图片\s*\d$/ });
    fireEvent.mouseDown(imageTab, { button: 0 });
    fireEvent.click(imageTab);
    expect(onSelectionChange).toHaveBeenCalledWith(null);
    expect(screen.queryByText(/已选择/)).toBeNull();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('keeps host-controlled selection in sync through onSelectionChange', () => {
    const onSelectionChange = vi.fn();
    render(<AssetLibrary open assets={assets} tags={tags} onSelectionChange={onSelectionChange} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '预览雨夜长街' }));
    expect(onSelectionChange).toHaveBeenCalledWith(assets[1]);
    expect(screen.getByText(/已选择：雨夜长街/)).toBeInTheDocument();
  });

  it('keeps the kind filter when the host pipes onFilterChange back into props', () => {
    function Demo() {
      const [filter, setFilter] = useState<AssetFilter>({ section: 'generated', tag: '', query: '', scope: 'project', kind: 'all' });
      return <AssetLibrary
        assets={assets}
        section={filter.section}
        onSectionChange={(section: AssetSection) => setFilter((current: AssetFilter) => ({ ...current, section, tag: '' }))}
        tag={filter.tag || 'all'}
        onTagChange={(tag: string) => setFilter((current: AssetFilter) => ({ ...current, tag: tag === 'all' ? '' : tag }))}
        onFilterChange={setFilter}
        scope={filter.scope}
        onScopeChange={(scope: AssetScope) => setFilter((current: AssetFilter) => ({ ...current, scope }))}
      />;
    }
    render(<Demo />);
    expect(screen.getAllByRole('button', { name: /^预览/ })).toHaveLength(2);
    const imageTab = screen.getByRole('tab', { name: /^图片\s*\d$/ });
    fireEvent.mouseDown(imageTab, { button: 0 });
    fireEvent.click(imageTab);
    // 往返接法下筛选保持，不闪回「全部」。
    expect(screen.getAllByRole('button', { name: /^预览/ })).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /^图片\s*\d$/ })).toHaveAttribute('data-state', 'active');
  });

  it('opens the file picker from the new button when upload exists, and uploads the chosen files', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'x', name: 'picked.png', kind: 'image', section: 'saved' });
    const create = vi.fn();
    const { rerender } = render(<AssetLibrary open assets={[]} tags={tags} onCreate={create} defaultSection="saved" />);
    // 没有 upload 适配器时走 onCreate。
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(create).toHaveBeenCalledWith({ section: 'saved', tag: '', query: '' });
    rerender(<AssetLibrary open assets={[]} tags={tags} upload={upload} defaultSection="saved" />);
    // 有 upload 时，新建等价于打开系统选择器：选择文件后进入上传流程。
    const picker = screen.getAllByLabelText('选择要上传的资产文件')[0] as HTMLInputElement;
    const file = new File(['x'], 'picked.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(picker, { target: { files: [file] } }); });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file, section: 'saved' })));
  });
});
