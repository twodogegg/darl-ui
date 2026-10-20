import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: '时长' })).toHaveTextContent('8秒');
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
    expect(screen.getByRole('button', { name: '时长' })).toHaveTextContent('8秒');
    switchInput('参考素材');
    fireEvent.change(screen.getByLabelText('选择参考素材'), { target: { files: [file('v.mp4', 'video/mp4'), file('a.mp3', 'audio/mpeg')] } });
    switchInput('首尾帧');
    fireEvent.click(screen.getByRole('button', { name: '添加首帧' }));
    fireEvent.change(screen.getByLabelText('选择帧图片'), { target: { files: [file('first.png')] } });
    switchType('图片');
    expect(screen.queryByRole('switch', { name: '生成声音' })).toBeNull();
    expect(screen.queryByRole('button', { name: '时长' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加首帧' })).toBeNull();
    expect(screen.getByRole('button', { name: '移除参考视频 v.mp4' })).toBeInTheDocument();
    prompt(); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).not.toHaveProperty('references');
    expect(onGenerate.mock.calls[0][0].options).toEqual({ aspectRatio: '16:9', resolution: '2K', count: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeEnabled());
    switchType('视频');
    submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate.mock.calls[1][0].references).toEqual({ firstFrame: expect.any(File) });
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeEnabled());
    switchInput('参考素材'); submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(3));
    expect(onGenerate.mock.calls[2][0].references).toEqual({ videos: [expect.any(File)], audios: [expect.any(File)] });
  });
  it('复用历史模型、参数、提示词和参考素材，宿主重渲染不重置参数', async () => {
    const history: MediaTask[] = [{ ...tasks[0], batches: [{ id: 'old', modelId: 'video', type: 'video', prompt: '旧提示词', options: { count: 2, duration: 6, generateAudio: false }, references: { images: [{ id: 'ref', url: '/ref.png' }] }, results: [] }] }];
    const onGenerate = vi.fn();
    const { rerender } = render(<MediaWorkspace models={models} tasks={history} onGenerate={onGenerate}/>);
    fireEvent.click(screen.getByRole('button', { name: '复用参数' }));
    expect(screen.getByRole('textbox', { name: '生成提示词' })).toHaveValue('旧提示词');
    expect(screen.getByRole('button', { name: '时长' })).toHaveTextContent('6秒');
    rerender(<MediaWorkspace models={models.map((model) => ({ ...model }))} tasks={history} onGenerate={onGenerate}/>);
    submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ modelId: 'video', prompt: '旧提示词', options: { count: 2, duration: 6, generateAudio: false }, references: { images: [{ id: 'ref', url: '/ref.png' }] } });
  });
  it('宿主控制任务、混合批次、重试、取消、重新生成和收藏', () => {
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除任务 测试任务' })); expect(onDeleteTask).toHaveBeenCalledWith('t1');
    confirm.mockRestore();
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
    await waitFor(() => expect(screen.getByRole('button', { name: '✧ 生成' })).toBeEnabled());
    switchInput('参考素材');
    expect(screen.getByAltText('reference.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加首帧' })).toBeNull();
    submit(); await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
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
