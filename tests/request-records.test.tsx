import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequestRecords } from '../src/components/request-records/RequestRecords';
import type { RequestRecord, RequestRecordFilters, RequestRecordRetention, RequestRecordsProps } from '../src/components/request-records/types';

const image: RequestRecord = { id: 'image-1', type: 'image', modelId: 'image-model', modelName: '图片模型', providerId: 'provider', providerName: '供应商', status: 'success', createdAt: '2026-10-22T03:00:00Z', references: [{ type: 'image', name: '参考图', url: '/reference.png', thumbnailUrl: '/thumb.png' }], results: [{ type: 'image', name: '生成图', url: '/result.png' }], parameters: { prompt: 'test' } };
const audio: RequestRecord = { ...image, id: 'audio-1', type: 'audio', modelId: 'audio-model', modelName: '音频模型', references: [], results: [{ type: 'audio', name: '语音结果', url: '/speech.wav' }], text: '**语音文本**' };
const video: RequestRecord = { ...image, id: 'video-1', type: 'video', modelId: 'video-model', modelName: '视频模型', results: [{ type: 'video', name: '视频结果', url: '/video.mp4' }] };
const records = [image, audio, video];
function props(overrides: Partial<RequestRecordsProps> = {}): RequestRecordsProps {
  return {
    loadRecords: async filters => ({ items: records.filter(record => !filters.type || filters.type === record.type), total: records.filter(record => !filters.type || filters.type === record.type).length, models: [], providers: [] }),
    loadRecord: async id => records.find(record => record.id === id)!,
    loadRetention: async () => ({ enabled: true, days: 30 }),
    saveRetention: async value => value,
    ...overrides,
  };
}

describe('RequestRecords interactions', () => {
  it('passes combined filters to its host and renders an empty state after filtering', async () => {
    let received: RequestRecordFilters | undefined;
    render(<RequestRecords {...props({ loadRecords: async filters => { received = filters; return { items: [], total: 0, models: [], providers: [] }; } })} />);
    await screen.findByText('暂无请求记录');
    fireEvent.click(screen.getByRole('radio', { name: '图片' }));
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'error' } });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'req-123' } });
    await waitFor(() => expect(received).toMatchObject({ type: 'image', status: 'error', from: '2026-10-20', query: 'req-123', page: 1 }));
  });

  it('opens reference and result images, enlarges the original, and reports failed media', async () => {
    render(<RequestRecords {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看 图片模型 成功 请求详情' }));
    await screen.findByRole('dialog');
    const reference = await screen.findByAltText('参考图');
    expect(reference).toHaveAttribute('src', '/thumb.png');
    expect(screen.getByAltText('生成图')).toHaveAttribute('src', '/result.png');
    fireEvent.click(screen.getByRole('button', { name: '放大 参考图' }));
    expect(screen.getByAltText('参考图')).toHaveAttribute('src', '/reference.png');
    fireEvent.click(screen.getByRole('button', { name: '返回详情' }));
    fireEvent.error(screen.getByAltText('生成图'));
    expect(screen.getByText('素材不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭请求详情' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses native audio/video controls without autoplay and renders formatted text', async () => {
    const view = render(<RequestRecords {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看 音频模型 成功 请求详情' }));
    expect(await screen.findByLabelText('语音结果')).toHaveAttribute('controls');
    expect(screen.getByLabelText('语音结果')).not.toHaveAttribute('autoplay');
    expect(screen.getByText('语音文本').tagName).toBe('STRONG');
    fireEvent.click(screen.getByRole('button', { name: '关闭请求详情' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看 视频模型 成功 请求详情' }));
    const player = await screen.findByLabelText('视频结果');
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('preload', 'none');
    expect(player).not.toHaveAttribute('autoplay');
    view.unmount();
  });

  it('keeps cleanup edits on save failure and persists a retry', async () => {
    let saved: RequestRecordRetention | undefined;
    let attempts = 0;
    render(<RequestRecords {...props({ saveRetention: async value => { if (++attempts === 1) throw new Error('保存失败'); saved = value; return value; } })} />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('保留天数'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: '保存清理设置' }));
    expect(await screen.findByText('保存失败')).toBeInTheDocument();
    expect(screen.getByLabelText('保留天数')).toHaveValue(7);
    fireEvent.click(screen.getByRole('button', { name: '保存清理设置' }));
    await screen.findByText('清理设置已保存');
    expect(saved).toEqual({ enabled: false, days: 7 });
  });

  it('renders image/video thumbnails in the list without preloading video', async () => {
    const view = render(<RequestRecords {...props()} />);
    const imageRow = await screen.findByRole('button', { name: '查看 图片模型 成功 请求详情' });
    expect(imageRow.querySelector('img')).toHaveAttribute('src', '/result.png');
    expect(imageRow.querySelector('img')).toHaveAttribute('loading', 'lazy');
    const videoRow = screen.getByRole('button', { name: '查看 视频模型 成功 请求详情' });
    const thumb = videoRow.querySelector('video');
    expect(thumb).not.toBeNull();
    expect(thumb).toHaveAttribute('preload', 'metadata');
    expect(thumb).not.toHaveAttribute('autoplay');
    expect(thumb).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: '查看 音频模型 成功 请求详情' }).querySelector('img, video')).toBeNull();
    view.unmount();
  });

  it('collapses cleanup settings and offers 20/50/100 page sizes', async () => {
    render(<RequestRecords {...props()} />);
    await screen.findByRole('button', { name: '查看 图片模型 成功 请求详情' });
    const details = document.querySelector('details.darl-request-retention-details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    const sizes = Array.from(screen.getByLabelText('每页数量').querySelectorAll('option')).map(option => option.value);
    expect(sizes).toEqual(['20', '50', '100']);
  });
});
