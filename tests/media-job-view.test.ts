import { describe, expect, it } from 'vitest';
import { jobResults, jobToBatch, jobsToTasks, standaloneMediaJobs, type MediaJob } from '../examples/agent-chat/client/media-job-view';

const job = (id: string, taskId: string | undefined, prompt: string): MediaJob => ({
  id, ...(taskId ? { taskId } : {}), modelId: 'gpt-image-2', type: 'image', status: 'completed', prompt,
  options: { count: 1 }, providerId: 'darl', upstreamModelId: 'gpt-image-2', createdAt: '2026-10-20T00:00:00.000Z',
});

describe('media jobs to workspace tasks', () => {
  it('keeps project image and video jobs out of the standalone media workspace', () => {
    const independent = job('standalone', 'task', '单独生成');
    const asset = { ...job('asset', 'asset-task', '角色'), options: { studioTarget: { resource: 'assets', id: 'asset' } } };
    const clip = { ...job('clip', 'clip-task', '视频'), type: 'video' as const, options: { studioTarget: { resource: 'clips', id: 'clip' } } };
    expect(standaloneMediaJobs([asset, independent, clip])).toEqual([independent]);
  });
  it('passes through provider progress and leaves missing progress unknown', () => {
    const pending = { ...job('job-v', 't', '视频'), type: 'video' as const, status: 'running' as const };
    expect(jobResults({ ...pending, progress: 42 })[0].progress).toBe(42);
    expect(jobResults(pending)[0].progress).toBeUndefined();
  });
  it('groups repeatedly generated batches under the same task', () => {
    const tasks = jobsToTasks([job('job-2', 'task-1', '第二次调整'), job('job-1', 'task-1', '第一次生成')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'task-1', title: '第二次调整' });
    expect(tasks[0].batches.map((batch) => batch.id)).toEqual(['job-2', 'job-1']);
  });

  it('merges independent jobs from one generation into one batch', () => {
    const first = { ...job('job-1', 'task-1', '两次生成'), batchId: 'batch-1', resultFileIds: ['file-a'] };
    const second = { ...job('job-2', 'task-1', '两次生成'), batchId: 'batch-1', resultFileIds: ['file-b'] };
    const tasks = jobsToTasks([second, first]);
    expect(tasks[0].batches).toHaveLength(1);
    expect(tasks[0].batches[0]).toMatchObject({ id: 'batch-1', results: [{ id: 'job-2-0' }, { id: 'job-1-0' }] });
  });

  it('groups legacy generation-count jobs that share a second-level launch time', () => {
    const base = job('job-1', 'task-1', '旧的数量 2');
    const legacy = [
      { ...base, options: { count: 1, generationCount: 2 }, createdAt: '2026-10-20T15:55:08.642Z' },
      { ...base, id: 'job-2', options: { count: 1, generationCount: 2 }, createdAt: '2026-10-20T15:55:08.699Z' },
    ];
    const tasks = jobsToTasks(legacy);
    expect(tasks[0].batches).toHaveLength(1);
    expect(tasks[0].batches[0].results).toHaveLength(2);
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
    expect(restored.createdAt).toBe('2026-10-20T00:00:00.000Z');
  });
});
