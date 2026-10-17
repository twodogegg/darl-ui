import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DefaultModelSelector, normalizeDefaultModels, modelOptions, type DefaultModelOption } from '../src/components/default-model-selector/DefaultModelSelector';

const models: DefaultModelOption[] = [
  { id: 'text-a', name: '文本 A', type: 'text' },
  { id: 'image-a', name: '图片 A', type: 'image', capabilities: { resolutions: ['1K', '2K', '4K'] } },
  { id: 'audio-a', name: '音频 A', type: 'audio' },
  { id: 'video-a', name: '视频 A', type: 'video', capabilities: { resolutions: ['480P', '720P', '1080P'] } },
  { id: 'video-b', name: '视频 B', type: 'video', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '768P' } },
];

const next = () => fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

describe('DefaultModelSelector', () => {
  it('correctly normalizes defaults for all four types', () => {
    const value = normalizeDefaultModels(models);
    expect(value.text).toEqual({ modelId: 'text-a' });
    expect(value.image).toEqual({ modelId: 'image-a', resolution: '2K', aspectRatio: '9:16' });
    expect(value.audio).toEqual({ modelId: 'audio-a' });
    expect(value.video).toEqual({ modelId: 'video-a', resolution: '720P', aspectRatio: '9:16' });
  });
  it('only permits the supported aspect ratios and accepts custom resolution', () => {
    expect(modelOptions({ id: 'v', name: '视频', type: 'video', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['1:1', '9:16'] } }, 'resolutions')).toEqual(['480P', '768P']);
    expect(modelOptions({ id: 'v', name: '视频', type: 'video', capabilities: { aspectRatios: ['1:1', '9:16'] } }, 'aspectRatios')).toEqual(['9:16']);
  });
  it('switching models applies the new model defaults', () => {
    const result = normalizeDefaultModels(models, { video: { modelId: 'video-b', resolution: '720P', aspectRatio: '9:16' } });
    expect(result.video).toEqual({ modelId: 'video-b', resolution: '768P', aspectRatio: '9:16' });
  });
  it('navigates in four steps and returns configured values', async () => {
    const onComplete = vi.fn();
    render(<DefaultModelSelector models={models} onComplete={onComplete} />);
    expect(screen.queryByRole('button', { name: /上一步/ })).not.toBeInTheDocument();
    next();
    fireEvent.change(screen.getByRole('combobox', { name: '选择图片模型' }), { target: { value: 'image-a' } });
    fireEvent.click(screen.getByLabelText('4K'));
    next();
    next();
    fireEvent.change(screen.getByRole('combobox', { name: '选择视频模型' }), { target: { value: 'video-b' } });
    expect(screen.getByLabelText('768P')).toBeChecked();
    expect(screen.queryByText('当前默认配置')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /完成/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({
      text: { modelId: 'text-a' },
      image: { modelId: 'image-a', resolution: '4K', aspectRatio: '9:16' },
      audio: { modelId: 'audio-a' },
      video: { modelId: 'video-b', resolution: '768P', aspectRatio: '9:16' },
    }));
  });
  it('supports a media-only wizard', async () => {
    const onComplete = vi.fn();
    render(<DefaultModelSelector models={models.filter((item) => item.type === 'image' || item.type === 'video')} kinds={['image', 'video']} onComplete={onComplete} />);
    expect(screen.getByText('步骤 1 / 2')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '选择文本模型' })).not.toBeInTheDocument();
    expect(screen.queryByText('音频')).not.toBeInTheDocument();
    next();
    expect(screen.getByRole('combobox', { name: '选择视频模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /完成/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({
      image: { modelId: 'image-a', resolution: '2K', aspectRatio: '9:16' },
      video: { modelId: 'video-a', resolution: '720P', aspectRatio: '9:16' },
    }));
  });
  it('blocks navigation if a required model list is missing', () => {
    render(<DefaultModelSelector models={models.filter((item) => item.type !== 'audio')} onComplete={vi.fn()} />);
    next(); next();
    expect(screen.getByRole('alert')).toHaveTextContent('未提供音频模型');
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });
  it('reflects changes to host model list without retaining unsupported resolutions', () => {
    const { rerender } = render(<DefaultModelSelector models={models} onComplete={vi.fn()} />);
    next(); next(); next();
    expect(screen.getByLabelText('720P')).toBeChecked();
    rerender(<DefaultModelSelector models={models.filter((item) => item.id !== 'video-a')} onComplete={vi.fn()} />);
    expect(screen.getByLabelText('768P')).toBeChecked();
  });
  it('keeps draft and exposes save failures', async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error('网络错误'));
    render(<DefaultModelSelector models={models} onComplete={onComplete} />);
    next(); next(); next();
    fireEvent.click(screen.getByRole('button', { name: /完成/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('网络错误'));
    expect(screen.getByLabelText('720P')).toBeChecked();
  });
  it('supports controlled modal mode and closes with Escape', () => {
    const onOpenChange = vi.fn();
    render(<DefaultModelSelector models={models} open onOpenChange={onOpenChange} onComplete={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '选择你的创作模型' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /上一步/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
