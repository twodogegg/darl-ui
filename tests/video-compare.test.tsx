import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoCompare, type CompareVideo } from '../src/components/video-compare/VideoCompare';

const two: CompareVideo[] = [
  { id: 'a', name: '版本 A', src: '/a.mp4' },
  { id: 'b', name: '版本 B', src: '/b.mp4' },
];

const loadMetadata = (video: HTMLVideoElement, duration = 15, width = 1920, height = 1080) => {
  Object.defineProperties(video, {
    duration: { configurable: true, value: duration },
    videoWidth: { configurable: true, value: width },
    videoHeight: { configurable: true, value: height },
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_METADATA },
  });
  fireEvent.loadedMetadata(video);
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

describe('VideoCompare', () => {
  it('requires two videos and caps the visible list at three', () => {
    const { rerender } = render(<VideoCompare videos={[two[0]]}/>);
    expect(screen.getByText('至少添加 2 个视频才能开始对比。')).toBeInTheDocument();
    rerender(<VideoCompare videos={[...two, { id: 'c', name: '版本 C', src: '/c.mp4' }, { id: 'd', name: '版本 D', src: '/d.mp4' }]}/>);
    expect(screen.getByText(/最多支持 3 个视频/)).toBeInTheDocument();
    expect(screen.queryByText('版本 D')).not.toBeInTheDocument();
  });

  it('uses horizontal media in a vertical stack, and portrait media side by side', async () => {
    const { container } = render(<VideoCompare videos={two}/>);
    const v = container.querySelectorAll('video');
    loadMetadata(v[0], 15, 1920, 1080);
    loadMetadata(v[1], 15, 1920, 1080);
    expect(container.querySelector('.darl-compare-grid--vertical')).toBeTruthy();
    loadMetadata(v[0], 15, 1080, 1920);
    expect(container.querySelector('.darl-compare-grid--horizontal')).toBeTruthy();
  });

  it('lets best version selection be single and independent of audio', () => {
    const onBestChange = vi.fn();
    const { container } = render(<VideoCompare videos={two} onBestChange={onBestChange}/>);
    fireEvent.click(screen.getAllByRole('button', { name: '选为最佳' })[1]);
    expect(onBestChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('button', { name: '已选最佳' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: '选择声音来源' })).toHaveValue('a');
    fireEvent.click(screen.getByRole('button', { name: '已选最佳' }));
    expect(onBestChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelectorAll('.darl-compare-card--best')).toHaveLength(0);
  });

  it('keeps exactly one audio source unmuted when switching', () => {
    const { container } = render(<VideoCompare videos={two}/>);
    const videos = container.querySelectorAll('video');
    expect(videos[0].muted).toBe(false);
    expect(videos[1].muted).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '选择声音来源' }), { target: { value: 'b' } });
    expect(videos[0].muted).toBe(true);
    expect(videos[1].muted).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: '选择声音来源' }), { target: { value: '' } });
    expect(videos[0].muted).toBe(true);
    expect(videos[1].muted).toBe(true);
  });

  it('uses the longest duration as a shared timeline and starts both media elements', async () => {
    const { container } = render(<VideoCompare videos={two}/>);
    const elements = container.querySelectorAll('video');
    loadMetadata(elements[0], 10);
    loadMetadata(elements[1], 15);
    expect(screen.getByText('00:15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放全部视频' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('slider', { name: '统一视频进度' }), { target: { value: '12' } });
    expect(elements[0].currentTime).toBeLessThanOrEqual(10);
    expect(elements[1].currentTime).toBe(12);
  });

  it('clears selected best when a video is removed, preserving ID semantics', async () => {
    const onBestChange = vi.fn();
    const { rerender } = render(<VideoCompare videos={two} defaultBestVideoId="b" onBestChange={onBestChange}/>);
    expect(screen.getByRole('button', { name: '已选最佳' })).toBeInTheDocument();
    rerender(<VideoCompare videos={[two[0]]} defaultBestVideoId="b" onBestChange={onBestChange}/>);
    await waitFor(() => expect(onBestChange).toHaveBeenCalledWith(null));
  });
});
