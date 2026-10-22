import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaWorkspace, type MediaModel, type MediaTask } from '../src';
import { durations, filterReferences, normalizeOptions, selectedGenerationMode } from '../src/components/media-workspace/model';

const models: MediaModel[] = [
  { id: 'image', name: '图片 A', type: 'image', capabilities: { images: 3, aspectRatios: ['1:1', '16:9'], resolutions: ['1K', '2K'], maxOutputs: 4 }, defaults: { aspectRatio: '16:9', resolution: '2K', count: 2 } },
  { id: 'small', name: '图片 B', type: 'image', capabilities: { images: 1, maxOutputs: 1 } },
  { id: 'video', name: '视频 A', type: 'video', capabilities: { images: 5, videos: 2, audios: 1, firstLastFrame: true, durations: { min: 4, max: 10 }, generateAudio: true, maxOutputs: 3 }, defaults: { duration: 8, generateAudio: true } },
  { id: 'simple', name: '视频 B', type: 'video', capabilities: { images: 2, durations: [4, 8], maxOutputs: 1 }, defaults: { duration: 4 } }
];
const tasks: MediaTask[] = [{ id: 't1', title: '测试任务', batches: [] }];
const file = (name: string, type = 'image/png') => new File(['fixture'], name, { type });
const switchModel = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
  fireEvent.click(screen.getByRole('button', { name }));
};
const switchType = (value: '图片' | '视频') => fireEvent.click(screen.getByRole('radio', { name: `生成${value}` }));
const switchInput = (value: '首尾帧' | '参考素材') => {
  fireEvent.click(screen.getByRole('button', { name: '素材方式' }));
  fireEvent.click(screen.getByRole('radio', { name: value }));
};
const prompt = () => fireEvent.change(screen.getByRole('textbox', { name: '生成提示词' }), { target: { value: '生成测试画面' } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '✧ 生成' }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:${Math.random()}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

describe('模型能力', () => {
  it('仅使用支持的参数，校正无效默认值', () => {
    expect(normalizeOptions(models[0])).toEqual({ aspectRatio: '16:9', resolution: '2K', count: 2 });
    expect(normalizeOptions(models[0], { aspectRatio: 'bad', resolution: 'bad', count: 10, duration: 99, generateAudio: true } as never)).toEqual({ aspectRatio: '1:1', resolution: '1K', count: 4 });
    expect(normalizeOptions(models[2])).toEqual({ count: 1, duration: 8, generateAudio: true });
    expect(normalizeOptions(models[3], { count: 3, duration: 99, generateAudio: true } as never)).toEqual({ count: 1, duration: 4 });
    expect(durations(models[2])).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(normalizeOptions({ id: 'none', name: '无参数', type: 'video', capabilities: { images: 0, generateAudio: false } })).toEqual({ count: 1 });
    const refs = { images: [file('image.png')], videos: [file('video.mp4', 'video/mp4')], audios: [file('audio.mp3', 'audio/mpeg')], firstFrame: file('first.png') };
    expect(filterReferences(models[0], refs)).toEqual({ images: refs.images });
    expect(filterReferences(models[2], refs)).toEqual({ firstFrame: refs.firstFrame });
    expect(filterReferences(models[2], refs, 'references')).toEqual({ images: refs.images, videos: refs.videos, audios: refs.audios });
  });
});
describe('MediaWorkspace', () => {
  it('opens a host asset picker, preserves references on cancel, and enforces model limits on applied files', async () => {
    const onGenerate = vi.fn();
    const images = [1, 2].map(index => ({ id: `asset-${index}`, fileId: `file-${index}`, url: `/api/files/file-${index}` }));
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate} renderReferencePicker={({ kinds, references, onApply, onClose }) => <div role="dialog" aria-label="资产选择">
      <span>支持 {kinds.join(',')}，已选 {references.images?.length || 0}</span>
      <button onClick={() => onApply({ images })}>应用资产</button><button onClick={onClose}>取消资产选择</button>
    </div>} />);
    expect(screen.queryByRole('dialog', { name: '资产选择' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加参考素材' }));
    expect(screen.getByText('支持 images，已选 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消资产选择' }));
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0][0].references).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '添加参考素材' }));
    fireEvent.click(screen.getByRole('button', { name: '应用资产' }));
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate.mock.calls[1][0].references.images).toEqual(images);
    fireEvent.click(screen.getByRole('button', { name: '添加参考素材' }));
    expect(screen.getByText('支持 images，已选 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消资产选择' }));
    switchModel('图片 B'); prompt();
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeDisabled();
  });
  it('展开完整批次提示词，并显示宿主的真实生成进度', () => {
    const longPrompt = '完整的长提示词和换行。\n'.repeat(12);
    render(<MediaWorkspace models={models} tasks={[{ id: 't', title: '生成', batches: [{ id: 'b', modelId: 'video', type: 'video', prompt: longPrompt, options: { count: 1 }, results: [{ id: 'r', status: 'running', progress: 35 }] }] }]} onGenerate={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: '展开提示词' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '收起提示词' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.darl-mw-batch-header h3')).toHaveClass('is-expanded');
    expect(document.querySelector('.darl-mw-batch-header h3')?.textContent).toBe(longPrompt);
    expect(screen.getByRole('progressbar', { name: '生成进度' })).toHaveAttribute('value', '35');
    expect(screen.getByText('生成中 · 35%')).toBeInTheDocument();
  });
  it('优化发送当前模型和参数，失败保持原文，成功回填', async () => {
    const onOptimizePrompt = vi.fn().mockRejectedValueOnce(new Error('优化服务失败')).mockResolvedValueOnce('优化后的画面');
    const image: MediaModel = { ...models[0], capabilities: { ...models[0].capabilities, generationModes: ['text-to-image', 'reference-edit'] } };
    render(<MediaWorkspace models={[image]} tasks={tasks} onGenerate={vi.fn()} onOptimizePrompt={onOptimizePrompt} />);
    expect(screen.getByRole('button', { name: '✧ 提示词优化' })).toBeDisabled();
    prompt();
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('优化服务失败'));
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('生成测试画面');
    expect(onOptimizePrompt).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'general', modelId: 'image', model: image, mode: 'text-to-image', generationCount: 1, options: { aspectRatio: '16:9', resolution: '2K', count: 2 } }), { signal: expect.any(AbortSignal) });
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('优化后的画面'));
  });
  it('H3 优化需要选择方式，传递时长和声音参数', async () => {
    const onOptimizePrompt = vi.fn().mockResolvedValue('H3 镜头描述');
    render(<MediaWorkspace models={[{ ...models[2], id: 'minimax-h3-flash', upstreamModelId: 'minimax-h3-flash', capabilities: { ...models[2].capabilities, generationModes: ['first-last-frame', 'text-to-video'] } }]} tasks={tasks} onGenerate={vi.fn()} onOptimizePrompt={onOptimizePrompt} />);
    prompt();
    fireEvent.click(screen.getByRole('button', { name: '提示词优化' }));
    expect(onOptimizePrompt).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '普通优化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'H3 提示优化' }));
    await waitFor(() => expect(onOptimizePrompt).toHaveBeenCalledWith(expect.objectContaining({ optimization: 'h3', mode: 'first-last-frame', options: { count: 1, duration: 8, generateAudio: true } }), expect.anything()));
  });
  it('参考素材上传未完成时不发送缺失素材的优化请求', async () => {
    const onOptimizePrompt = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={vi.fn()} onOptimizePrompt={onOptimizePrompt} onUploadReference={() => new Promise(() => {})} />);
    fireEvent.change(screen.getByLabelText('选择参考素材'), { target: { files: [file('reference.png')] } });
    prompt();
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请先完成参考素材上传');
    expect(onOptimizePrompt).not.toHaveBeenCalled();
  });
  it('展示最近一次优化对比，关闭保持结果，还原保留原文空白', async () => {
    const onOptimizePrompt = vi.fn().mockResolvedValueOnce('第一次优化').mockResolvedValueOnce('第二次优化').mockResolvedValueOnce('第三次优化');
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={vi.fn()} onOptimizePrompt={onOptimizePrompt} />);
    const editor = screen.getByRole('textbox', { name: '生成提示词' });
    fireEvent.change(editor, { target: { value: '  原始提示词\n' } });
    expect(screen.queryByRole('button', { name: '优化对比' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    await waitFor(() => expect(editor).toHaveValue('第一次优化'));
    fireEvent.click(screen.getByRole('button', { name: '优化对比' }));
    const comparison = screen.getByRole('dialog', { name: '提示词优化对比' });
    expect(within(comparison).getByRole('textbox', { name: '优化前' })).toHaveValue('  原始提示词\n');
    expect(within(comparison).getByRole('textbox', { name: '优化后' })).toHaveValue('第一次优化');
    fireEvent.click(within(comparison).getByRole('button', { name: '关闭对比' }));
    expect(editor).toHaveValue('第一次优化');
    fireEvent.click(screen.getByRole('button', { name: '还原优化' }));
    expect(editor).toHaveValue('  原始提示词\n');
    expect(screen.queryByRole('button', { name: '优化对比' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    await waitFor(() => expect(editor).toHaveValue('第二次优化'));
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    await waitFor(() => expect(editor).toHaveValue('第三次优化'));
    fireEvent.click(screen.getByRole('button', { name: '优化对比' }));
    expect(screen.getByRole('textbox', { name: '优化前' })).toHaveValue('第二次优化');
    expect(screen.getByRole('textbox', { name: '优化后' })).toHaveValue('第三次优化');
    fireEvent.click(within(screen.getByRole('dialog', { name: '提示词优化对比' })).getByRole('button', { name: '还原优化' }));
    expect(editor).toHaveValue('第二次优化');
    expect(screen.queryByRole('dialog', { name: '提示词优化对比' })).not.toBeInTheDocument();
  });
  it('取消或修改参数后，旧优化结果不会覆盖输入', async () => {
    let finish!: (text: string) => void;
    let signal!: AbortSignal;
    const onOptimizePrompt = vi.fn((_request, context) => { signal = context.signal; return new Promise<string>(resolve => { finish = resolve; }); });
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={vi.fn()} onOptimizePrompt={onOptimizePrompt} />);
    prompt();
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消优化' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish('已取消的结果'));
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('生成测试画面');
    fireEvent.click(screen.getByRole('button', { name: '✧ 提示词优化' }));
    switchModel('图片 B');
    expect(signal.aborted).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '生成提示词' }), { target: { value: '新输入' } });
    await act(async () => finish('过期结果'));
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('新输入');
  });
  it('媒体页直接编辑我的风格并提交修改', async () => {
    const onUpdateStyle = vi.fn().mockResolvedValue(undefined);
    render(<MediaWorkspace models={models} tasks={tasks} styles={[{ id: 's', name: '短剧感', description: '原始描述', isOwned: true }]} onGenerate={vi.fn()} onUpdateStyle={onUpdateStyle} />);
    fireEvent.click(screen.getByRole('button', { name: '选择风格' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: '我的风格' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('button', { name: '编辑短剧感' }));
    fireEvent.change(screen.getByLabelText(/风格描述词/), { target: { value: '修改后的短剧描述' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onUpdateStyle).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }), { name: '短剧感', description: '修改后的短剧描述' }));

  });
  it('采用模型默认值，提交请求且拒绝空提示词', async () => {
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '时长' })).toBeNull();
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({ taskId: 't1', modelId: 'image', prompt: '生成测试画面', options: { aspectRatio: '16:9', resolution: '2K', count: 2 } }));
  });
  it('提交逻辑模型、绑定和规范化生成模式', async () => {
    const routedVideo: MediaModel = {
      ...models[2], logicalModelId: 'h3-flash', bindingId: 'h3-binding', providerId: 'darl', upstreamModelId: 'minimax-h3-flash', protocolKey: 'darl-runninghub-h3-flash',
      capabilities: { ...models[2].capabilities, generationModes: ['text-to-video', 'first-last-frame', 'reference'] },
    };
    expect(selectedGenerationMode(routedVideo, 'frames', {})).toBe('first-last-frame');
    expect(selectedGenerationMode(routedVideo, 'references', { images: [file('reference.png')] })).toBe('reference');
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={[models[0], routedVideo]} tasks={tasks} onGenerate={onGenerate}/>);
    switchType('视频');
    expect(screen.getByLabelText('生成方式：首尾帧')).toBeInTheDocument();
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'video', logicalModelId: 'h3-flash', bindingId: 'h3-binding', providerId: 'darl', upstreamModelId: 'minimax-h3-flash', protocolKey: 'darl-runninghub-h3-flash', mode: 'first-last-frame', route: { strategy: 'selected-binding', bindingId: 'h3-binding', providerId: 'darl' },
    })));
  });
  it('默认生成图片，类型切换后模型列表只保留同类模型', () => {
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={vi.fn()}/>);
    expect(screen.getByRole('radio', { name: '生成图片' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('图片 A');
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
    expect(screen.getByRole('button', { name: '图片 B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视频 A' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '图片 B' }));
    switchType('视频');
    expect(screen.getByRole('radio', { name: '生成视频' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '生成图片' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('视频 A');
    expect(screen.getByRole('button', { name: '生成参数' })).toHaveTextContent('8秒');
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
    expect(screen.getByRole('button', { name: '视频 B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '图片 B' })).toBeNull();
  });
  it('宿主只提供单一类型时不显示类型切换', () => {
    render(<MediaWorkspace models={models.filter((model) => model.type === 'video')} tasks={tasks} onGenerate={vi.fn()}/>);
    expect(screen.queryByRole('radio', { name: '生成图片' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '生成视频' })).toBeNull();
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('视频 A');
  });
  it('切换模型保留素材，超限阻止提交，移除与卸载释放 URL', async () => {
    const onGenerate = vi.fn();
    const { unmount } = render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    fireEvent.change(screen.getByLabelText('选择参考素材'), { target: { files: [file('one.png'), file('two.png')] } });
    prompt(); switchModel('图片 B');
    expect(screen.getByRole('alert')).toHaveTextContent('参考图片超过上限 1');
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeDisabled();
    expect(screen.getByAltText('two.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除参考图片 two.png' }));
    submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0].references.images).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('视频切图片隐藏专属控件，请求不传视频、音频、首尾帧和声音', async () => {
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    switchType('视频');
    expect(screen.getByRole('switch', { name: '生成声音' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '生成参数' })).toHaveTextContent('8秒');
    switchInput('参考素材');
    fireEvent.change(screen.getByLabelText('选择参考素材'), { target: { files: [file('v.mp4', 'video/mp4'), file('a.mp3', 'audio/mpeg')] } });
    switchInput('首尾帧');
    fireEvent.click(screen.getByRole('button', { name: '添加首帧' }));
    fireEvent.change(screen.getByLabelText('选择帧图片'), { target: { files: [file('first.png')] } });
    switchType('图片');
    expect(screen.queryByRole('switch', { name: '生成声音' })).toBeNull();
    expect(screen.getByRole('button', { name: '生成参数' })).not.toHaveTextContent('秒');
    expect(screen.queryByRole('button', { name: '添加首帧' })).toBeNull();
    expect(screen.getByRole('button', { name: '移除参考视频 v.mp4' })).toBeInTheDocument();
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).not.toHaveProperty('references');
    expect(onGenerate.mock.calls[0][0].options).toEqual({ aspectRatio: '16:9', resolution: '2K', count: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeInTheDocument());
    switchType('视频');
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate.mock.calls[1][0].references).toEqual({ firstFrame: expect.any(File) });
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeInTheDocument());
    switchInput('参考素材'); prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(3));
    expect(onGenerate.mock.calls[2][0].references).toEqual({ videos: [expect.any(File)], audios: [expect.any(File)] });
  });
  it('复用历史模型、参数、提示词和参考素材，宿主重渲染不重置参数', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [{ id: 'old', modelId: 'video', type: 'video', prompt: '旧提示词', options: { count: 2, duration: 6, generateAudio: false }, references: { images: [{ id: 'ref', url: '/ref.png' }] }, results: [] }] }];
    const onGenerate = vi.fn();
    const { rerender } = render(<MediaWorkspace models={models} tasks={history} onGenerate={onGenerate}/>);
    fireEvent.click(screen.getByRole('button', { name: '复用参数' }));
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('旧提示词');
    expect(screen.getByRole('button', { name: '生成参数' })).toHaveTextContent('6秒');
    rerender(<MediaWorkspace models={models.map((model) => ({ ...model }))} tasks={history} onGenerate={onGenerate}/>);
    submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ modelId: 'video', prompt: '旧提示词', options: { count: 2, duration: 6, generateAudio: false }, references: { images: [{ id: 'ref', url: '/ref.png' }] } });
  });
  it('宿主控制任务、混合批次、重试、取消、重新生成和收藏', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [
      { id: 'b1', modelId: 'image', prompt: '图片批次', options: { count: 2 }, results: [{ id: 'done', status: 'completed', url: '/done.png' }, { id: 'bad', status: 'failed', error: '失败信息' }] },
      { id: 'b2', modelId: 'video', prompt: '视频批次', options: { count: 2 }, results: [{ id: 'running', status: 'running' }, { id: 'cancelled', status: 'cancelled' }] }
    ] }, { id: 't2', title: '第二任务', batches: [] }];
    const onDeleteTask = vi.fn();
    const callbacks = { onRetry: vi.fn(), onCancel: vi.fn(), onRegenerate: vi.fn(), onFavoriteChange: vi.fn(), onTaskChange: vi.fn(), onCreateTask: vi.fn(), onRenameTask: vi.fn(), onDeleteTask };
    const { rerender } = render(<MediaWorkspace models={models} tasks={history} activeTaskId="t1" onGenerate={vi.fn()} {...callbacks}/>);
    fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(callbacks.onRetry).toHaveBeenCalledWith('b1', 'bad');
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(callbacks.onCancel).toHaveBeenCalledWith('b2', 'running');
    expect(screen.queryByRole('button', { name: /选用/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新生成结果 done' })); expect(callbacks.onRegenerate).toHaveBeenCalledWith('b1', 'done');
    fireEvent.click(screen.getByRole('button', { name: '收藏结果 done' })); expect(callbacks.onFavoriteChange).toHaveBeenCalledWith('b1', 'done', true);
    expect(screen.getByRole('button', { name: '收藏结果 done' })).toHaveAttribute('aria-pressed', 'false');
    const favorited = history.map((task) => ({ ...task, batches: task.batches.map((batch) => ({ ...batch, results: batch.results.map((result) => ({ ...result, favorited: result.id === 'done' })) })) }));
    rerender(<MediaWorkspace models={models} tasks={favorited} activeTaskId="t1" onGenerate={vi.fn()} {...callbacks}/>);
    fireEvent.click(screen.getByRole('button', { name: '取消收藏结果 done' })); expect(callbacks.onFavoriteChange).toHaveBeenLastCalledWith('b1', 'done', false);
    expect(screen.queryByRole('button', { name: '继续编辑' })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览' })).toBeNull();
    expect(screen.queryByText('2 个结果')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^▧ 第二任务/ })); expect(callbacks.onTaskChange).toHaveBeenCalledWith('t2');
    expect(screen.getByRole('heading', { name: '测试任务' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建任务' })); expect(callbacks.onCreateTask).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除任务 测试任务' }));
    expect(onDeleteTask).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDeleteTask).toHaveBeenCalledWith('t1'));
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const rename = screen.getByRole('textbox', { name: '任务名称' });
    fireEvent.change(rename, { target: { value: '临时标题' } });
    fireEvent.keyDown(rename, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '任务名称' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const reopened = screen.getByRole('textbox', { name: '任务名称' });
    fireEvent.change(reopened, { target: { value: '新标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(callbacks.onRenameTask).toHaveBeenCalledWith('t1', '新标题');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('图片卡片使用缩略图，详情才使用原图；视频点击前不创建 src', () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [
      { id: 'image-batch', createdAt: '2026-10-21T00:00:02.000Z', modelId: 'image', type: 'image', prompt: '图片', options: { count: 1 }, references: { images: [{ id: 'ref-image', url: '/ref.png' }], firstFrame: { id: 'frame', url: '/frame.png' } }, results: [{ id: 'image-result', status: 'completed', url: '/original.png', thumbnailUrl: '/thumb.webp' }] },
      { id: 'video-batch', createdAt: '2026-10-21T00:00:01.000Z', modelId: 'video', type: 'video', prompt: '视频', options: { count: 1 }, results: [{ id: 'video-result', status: 'completed', url: '/video.mp4' }] },
    ] }];
    render(<MediaWorkspace models={models} tasks={history} onGenerate={vi.fn()} onDeleteBatch={vi.fn()}/>);
    expect(screen.getByAltText('图片')).toHaveAttribute('src', '/thumb.webp');
    expect(screen.getByAltText('参考图片 1')).toHaveAttribute('src', '/ref.png');
    expect(screen.getByAltText('首帧 2')).toHaveAttribute('src', '/frame.png');
    expect(screen.getAllByRole('region', { name: /批次/ }).map((item) => item.getAttribute('aria-label'))).toEqual(['批次 1', '批次 2']);
    expect(screen.getByRole('region', { name: '批次 1' })).toHaveTextContent('视频');
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放视频 video-result' }));
    expect(document.querySelector('video')).toHaveAttribute('src', '/video.mp4');
    fireEvent.click(screen.getByRole('button', { name: '预览图片 image-result' }));
    expect(document.querySelector('.darl-mw-preview img')).toHaveAttribute('src', '/original.png');
  });
  it('记录超出滚动区域时显示顶部和底部跳转按钮', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
    const history: MediaTask[] = [{ ...tasks[0], batches: Array.from({ length: 8 }, (_, index) => ({ id: `batch-${index}`, createdAt: new Date(2026, 9, 21, 0, 0, index).toISOString(), modelId: 'image', type: 'image' as const, prompt: `批次 ${index}`, options: { count: 1 }, results: [{ id: `result-${index}`, status: 'completed' as const, url: `/image-${index}.png` }] })) }];
    render(<MediaWorkspace models={models} tasks={history} onGenerate={vi.fn()}/>);
    const scroll = document.querySelector('.darl-mw-scroll') as HTMLElement;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 });
    fireEvent.scroll(scroll);
    expect(screen.queryByRole('button', { name: '滚动到顶部' })).toBeNull();
    expect(screen.getByRole('button', { name: '滚动到底部' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '滚动到底部' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' });
    scroll.scrollTop = 900;
    fireEvent.scroll(scroll);
    expect(screen.getByRole('button', { name: '滚动到顶部' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '滚动到底部' })).toBeNull();
  });
  it('图片和视频都可用作参考，且不带回源批次提示词或参数', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [
      { id: 'image-batch', modelId: 'image', type: 'image', prompt: '图片源提示词', options: { aspectRatio: '1:1', resolution: '1K', count: 4 }, results: [{ id: 'image-result', status: 'completed', url: '/image.png' }] },
      { id: 'video-batch', modelId: 'video', type: 'video', prompt: '视频源提示词', options: { duration: 10, count: 3, generateAudio: true }, results: [{ id: 'video-result', status: 'completed', url: '/video.mp4' }] }
    ] }];
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={history} onGenerate={onGenerate}/>);
    prompt();
    const referenceButtons = screen.getAllByRole('button', { name: '用作参考' });
    expect(referenceButtons).toHaveLength(2);
    fireEvent.click(referenceButtons[0]);
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('生成测试画面');
    expect(screen.getByAltText('image-result')).toHaveAttribute('src', '/image.png');
    fireEvent.click(referenceButtons[1]);
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('生成测试画面');
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('视频 A');
    submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ prompt: '生成测试画面', references: { images: [{ id: 'image-result', url: '/image.png' }], videos: [{ id: 'video-result', url: '/video.mp4' }] } });
    expect(onGenerate.mock.calls[0][0].options).toEqual({ count: 1, duration: 8, generateAudio: true });
  });
  it('图片和视频结果都可以加入统一对比并在面板中移除', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const history: MediaTask[] = [{ ...tasks[0], batches: [
      { id: 'compare-image', modelId: 'image', type: 'image', prompt: '图片', options: { count: 1 }, results: [{ id: 'compare-image-result', status: 'completed', url: '/image.png' }] },
      { id: 'compare-video', modelId: 'video', type: 'video', prompt: '视频', options: { count: 1 }, results: [{ id: 'compare-video-result', status: 'completed', url: '/video.mp4' }] },
    ] }];
    render(<MediaWorkspace models={models} tasks={history} onGenerate={vi.fn()}/>);
    fireEvent.click(screen.getAllByRole('button', { name: '加入对比' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '加入对比' })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('媒体对比');
    expect(screen.getByRole('img', { name: '图片 1' })).toBeInTheDocument();
    expect(document.querySelector('.darl-compare-media-stage video')).toHaveAttribute('src', '/video.mp4');
    fireEvent.click(screen.getAllByRole('button', { name: '选为最佳' })[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByRole('article').find((article) => article.textContent?.includes('最佳'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: '移出对比' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '加入对比' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '加入对比' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '移除 图片 1' }));
    expect(screen.queryByRole('img', { name: '图片 1' })).toBeNull();
  });
  it('用作参考时提交统一文件存储的真实 fileId 而非结果卡片展示 ID', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [
      { id: 'image-batch', modelId: 'image', type: 'image', prompt: '图片源提示词', options: { count: 1 }, results: [{ id: 'job-1-0', fileId: 'file-1', status: 'completed', url: '/api/media-generation/jobs/job-1/file', thumbnailUrl: '/api/files/file-1?width=320' }] },
    ] }];
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={history} onGenerate={onGenerate}/>);
    prompt();
    fireEvent.click(screen.getByRole('button', { name: '用作参考' }));
    // The reference chip carries the stable file ID, while the result card keeps its display key.
    expect(screen.getByAltText('file-1')).toHaveAttribute('src', '/api/files/file-1?width=320');
    submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ references: { images: [{ id: 'file-1', fileId: 'file-1', url: '/api/media-generation/jobs/job-1/file', thumbnailUrl: '/api/files/file-1?width=320' }] } });
  });
  it('视频生成时点击图片结果用作参考，保持视频模型并加入参考图', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [{ id: 'image-batch', modelId: 'image', type: 'image', prompt: '图片源', options: { count: 1 }, results: [{ id: 'image-result', status: 'completed', url: '/image.png' }] }] }];
    const onGenerate = vi.fn();
    const referenceVideo: MediaModel = { ...models[2], capabilities: { ...models[2].capabilities, generationModes: ['text-to-video', 'reference'] } };
    render(<MediaWorkspace models={[models[0], referenceVideo]} tasks={history} onGenerate={onGenerate}/>);
    switchType('视频');
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('视频 A');
    fireEvent.click(screen.getByRole('button', { name: '用作参考' }));
    expect(screen.getByRole('radio', { name: '生成视频' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('视频 A');
    expect(screen.getByAltText('image-result')).toBeInTheDocument();
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ modelId: 'video', mode: 'reference', references: { images: [{ id: 'image-result', url: '/image.png' }] } });
  });
  it('首尾帧只显示两个位置，普通参考素材与首尾帧互斥并分别保留', async () => {
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    fireEvent.change(screen.getByLabelText('选择参考素材'), { target: { files: [file('reference.png')] } });
    switchType('视频');
    expect(screen.queryByAltText('reference.png')).toBeNull();
    expect(screen.queryByRole('button', { name: '添加参考素材' })).toBeNull();
    expect(screen.getByRole('button', { name: '添加首帧' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加尾帧' })).toBeInTheDocument();
    const first = file('first.png'), last = file('last.png');
    fireEvent.click(screen.getByRole('button', { name: '添加首帧' }));
    fireEvent.change(screen.getByLabelText('选择帧图片'), { target: { files: [first] } });
    fireEvent.click(screen.getByRole('button', { name: '添加尾帧' }));
    fireEvent.change(screen.getByLabelText('选择帧图片'), { target: { files: [last] } });
    const firstUrl = screen.getByAltText('首帧').getAttribute('src');
    fireEvent.drop(screen.getByRole('textbox', { name: '生成提示词' }), { dataTransfer: { files: [file('third.png')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('首尾帧最多两张');
    expect(screen.queryByAltText('third.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加首帧' }));
    fireEvent.change(screen.getByLabelText('选择帧图片'), { target: { files: [file('invalid.mp4', 'video/mp4')] } });
    expect(screen.getByAltText('首帧')).toHaveAttribute('src', firstUrl);
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0].references).toEqual({ firstFrame: first, lastFrame: last });
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeInTheDocument());
    switchInput('参考素材');
    expect(screen.getByAltText('reference.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加首帧' })).toBeNull();
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate.mock.calls[1][0].references).toEqual({ images: [expect.any(File)] });
    switchInput('首尾帧');
    expect(screen.getByAltText('首帧')).toHaveAttribute('src', firstUrl);
  });
  it('复用首帧历史批次时图片归属首帧，移除后重新请求不携带旧首帧', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [{ id: 'frame-batch', modelId: 'video', prompt: '从首帧开始', options: { count: 1 }, references: { firstFrame: { id: 'first', url: '/first.png' } }, results: [] }] }];
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={history} onGenerate={onGenerate}/>);
    fireEvent.click(screen.getByRole('button', { name: '复用参数' }));
    expect(screen.getByAltText('首帧')).toHaveAttribute('src', '/first.png');
    expect(screen.queryByRole('button', { name: '移除参考图片 first' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '移除首帧' }));
    submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).not.toHaveProperty('references');
  });
  it('异步提交期间防止重复请求，并展示提交失败', async () => {
    let reject!: (reason: Error) => void;
    const onGenerate = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    prompt(); submit();
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '生成提示词' }), { key: 'Enter' });
    expect(onGenerate).toHaveBeenCalledTimes(1);
    reject(new Error('接口不可用'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('接口不可用'));
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeEnabled();
  });
  it('参数面板统一设置清晰度、画幅、数量和视频时长，并同步摘要', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    const trigger = screen.getByRole('button', { name: '生成参数' });
    expect(trigger).toHaveTextContent('2K');
    expect(trigger).toHaveTextContent('16:9');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('radio', { name: '清晰度 1K' }));
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }));
    fireEvent.click(screen.getByRole('radio', { name: '单次输出 4张' }));
    expect(screen.getByRole('button', { name: '生成参数' })).toHaveTextContent('1K · 1:1');
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ options: { aspectRatio: '1:1', resolution: '1K', count: 4 } })));
    switchType('视频');
    if (!screen.queryByRole('radio', { name: '时长 4秒' })) fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
    fireEvent.click(screen.getByRole('radio', { name: '时长 4秒' }));
    expect(screen.getByRole('button', { name: '生成参数' })).toHaveTextContent('4秒');
  });
  it('提交成功后清空提示词，生成数量作为独立调用参数而不是供应商 count', async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
    fireEvent.click(screen.getByRole('radio', { name: '生成数量 3张' }));
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'image', generationCount: 3, options: { aspectRatio: '16:9', resolution: '2K', count: 2 } })));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue(''));
  });
  it('拖入混合文件时分别校验，拒绝文件不影响正常素材和生成', async () => {
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} onGenerate={onGenerate}/>);
    const image = file('drop.png');
    fireEvent.drop(screen.getByRole('textbox', { name: '生成提示词' }), { dataTransfer: { files: [image, file('bad.txt', 'text/plain')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('部分文件类型不受当前模型支持');
    expect(screen.getByAltText('drop.png')).toBeInTheDocument();
    fireEvent.drop(screen.getByRole('textbox', { name: '生成提示词' }), { dataTransfer: { files: [image] } });
    expect(screen.getByRole('alert')).toHaveTextContent('已添加相同文件');
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0].references.images).toEqual([image]);
  });
  it('风格只有传入 isOwned 时进入我的风格，并可创建新风格', async () => {
    const styles = [
      { id: 'market', name: '电影感', category: '真人风格', description: '自然肤色' },
      { id: 'owned', name: '我的短剧感', category: '我的风格', description: '柔和逆光', isOwned: true },
    ];
    const onCreateStyle = vi.fn().mockResolvedValue(undefined);
    const onGenerate = vi.fn();
    render(<MediaWorkspace models={models} tasks={tasks} styles={styles} onCreateStyle={onCreateStyle} onGenerate={onGenerate}/>);
    fireEvent.click(screen.getByRole('button', { name: '选择风格' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: '我的风格' }));
    expect(screen.getByRole('button', { name: '预览我的短剧感' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览电影感' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建风格' }));
    fireEvent.change(screen.getByLabelText(/风格名称/), { target: { value: '新风格' } });
    fireEvent.change(screen.getByLabelText(/风格描述词/), { target: { value: '冷色霓虹' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '创建风格' }));
    await waitFor(() => expect(onCreateStyle).toHaveBeenCalledWith({ name: '新风格', description: '冷色霓虹' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: '风格广场' }));
    fireEvent.click(screen.getByRole('button', { name: '预览电影感' }));
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    prompt(); submit();
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ style: styles[0] })));
  });
  it('普通文本粘贴不拦截，图片粘贴复用素材队列；无模型或任务不可提交', () => {
    const { rerender } = render(<MediaWorkspace models={models} tasks={tasks} onGenerate={vi.fn()}/>);
    const textEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(textEvent, 'clipboardData', { value: { items: [{ kind: 'string', type: 'text/plain' }] } });
    fireEvent(screen.getByRole('textbox', { name: '生成提示词' }), textEvent);
    expect(textEvent.defaultPrevented).toBe(false);
    fireEvent.paste(screen.getByRole('textbox', { name: '生成提示词' }), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file('paste.png') }] } });
    expect(screen.getByAltText('paste.png')).toBeInTheDocument();
    rerender(<MediaWorkspace models={[]} tasks={[]} onGenerate={vi.fn()}/>);
    expect(screen.getByRole('button', { name: '✧ 生成' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('暂无可用模型');
  });
});
