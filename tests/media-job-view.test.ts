import { describe, expect, it } from 'vitest';
import { jobsToTasks, type MediaJob } from '../examples/agent-chat/client/media-job-view';

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

  it('keeps legacy jobs without a task ID as standalone tasks', () => {
    const tasks = jobsToTasks([job('job-1', undefined, '旧图片'), job('job-2', undefined, '另一张旧图片')]);
    expect(tasks.map((task) => task.id)).toEqual(['job-1', 'job-2']);
  });
});
