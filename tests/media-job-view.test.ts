import { describe, expect, it } from 'vitest';
import { jobResults, jobToBatch, jobsToTasks, type MediaJob } from '../examples/agent-chat/client/media-job-view';

const job = (id: string, taskId: string | undefined, prompt: string): MediaJob => ({
  id, ...(taskId ? { taskId } : {}), modelId: 'gpt-image-2', type: 'image', status: 'completed', prompt,
  options: { count: 1 }, providerId: 'darl', upstreamModelId: 'gpt-image-2', createdAt: '2026-10-20T00:00:00.000Z',
});

describe('media jobs to workspace tasks', () => {
  it('groups repeatedly generated batches under the same task', () => {
    const tasks = jobsToTasks([job('job-2', 'task-1', '第二次调整'), job('job-1', 'task-1', '第一次生成')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'task-1', title: '第二次调整' });
    expect(tasks[0].batches.map((batch) => batch.id)).toEqual(['job-2', 'job-1']);
  });

  it('uses the job ID as the task ID when no task ID is supplied', () => {
    const tasks = jobsToTasks([job('job-1', undefined, '独立图片'), job('job-2', undefined, '另一张图片')]);
    expect(tasks.map((task) => task.id)).toEqual(['job-1', 'job-2']);
  });

  it('maps completed results to stable file IDs and prefers server-served URLs', () => {
    const completed: MediaJob = {
      ...job('job-1', undefined, '多图生成'), type: 'image',
      resultFileIds: ['file-a', 'file-b'],
      resultFiles: [{
        fileId: 'file-a', url: 'https://demo.darl.cn/darl-ui/a.png',
        listThumbnailUrl: 'https://demo.darl.cn/darl-ui/a-160.webp',
        thumbnailUrl: 'https://demo.darl.cn/darl-ui/a-320.webp',
        previewUrl: 'https://demo.darl.cn/darl-ui/a-1024.webp',
      }],
    };
    const [first, second] = jobResults(completed);
    // 160 list / 320 card / 1024 preview tiers, all served by the host.
    expect(first).toMatchObject({ id: 'job-1-0', fileId: 'file-a', url: 'https://demo.darl.cn/darl-ui/a.png', listThumbnailUrl: 'https://demo.darl.cn/darl-ui/a-160.webp', thumbnailUrl: 'https://demo.darl.cn/darl-ui/a-320.webp', previewUrl: 'https://demo.darl.cn/darl-ui/a-1024.webp', status: 'completed' });
    // A result without a served entry falls back to the backend-independent proxies.
    expect(second).toMatchObject({ id: 'job-1-1', fileId: 'file-b', url: '/api/media-generation/jobs/job-1/file?index=1', listThumbnailUrl: '/api/files/file-b?width=160', thumbnailUrl: '/api/files/file-b?width=320', previewUrl: '/api/files/file-b?width=1024', status: 'completed' });
  });

  it('serves video results as the original without image thumbnail tiers', () => {
    const video: MediaJob = { ...job('job-v', undefined, '视频生成'), type: 'video', resultFileIds: ['file-v'] };
    const result = jobResults(video)[0];
    expect(result).toMatchObject({ fileId: 'file-v', url: '/api/media-generation/jobs/job-v/file' });
    expect(result.thumbnailUrl).toBeUndefined();
    expect(result.listThumbnailUrl).toBeUndefined();
    expect(result.previewUrl).toBeUndefined();
  });

  it('rebuilds reference inputs from persisted job options so historical batches keep their references', () => {
    const restored = jobToBatch({
      ...job('job-1', 'task-1', '参考图再生成'),
      options: { references: [{ fileId: 'ref-1', url: '/api/files/ref-1', mimeType: 'image/png', name: 'ref.png' }, 'https://cdn.example.test/remote.png'] },
    });
    expect(restored.references?.images).toEqual([
      { id: 'ref-1', fileId: 'ref-1', url: '/api/files/ref-1', thumbnailUrl: '/api/files/ref-1?width=160' },
      { id: 'https://cdn.example.test/remote.png', url: 'https://cdn.example.test/remote.png' },
    ]);
  });
});
