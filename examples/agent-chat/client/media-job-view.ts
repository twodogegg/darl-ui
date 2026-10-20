import type { GenerateRequest, MediaBatch, MediaInput, MediaReferences, MediaResult, MediaStyleOption, MediaTask } from '../../../src/components/media-workspace/types';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type JobResultFile = { fileId: string; url: string; thumbnailUrl?: string; listThumbnailUrl?: string; previewUrl?: string };
export type MediaJob = {
  id: string;
  taskId?: string;
  batchId?: string;
  modelId: string;
  type: 'image' | 'video';
  status: JobStatus;
  prompt: string;
  options: Record<string, unknown>;
  style?: MediaStyleOption;
  providerId: string;
  upstreamModelId: string;
  protocolKey?: string;
  error?: string;
  resultFileIds?: string[];
  /** Server-resolved original/thumbnail URLs, keyed to resultFileIds by index. */
  resultFiles?: JobResultFile[];
  createdAt: string;
};

export function jobOptions(job: MediaJob): GenerateRequest['options'] {
  const options = job.options || {};
  return {
    count: 1,
    ...(typeof options.aspectRatio === 'string' ? { aspectRatio: options.aspectRatio } : {}),
    ...(typeof options.resolution === 'string' ? { resolution: options.resolution } : {}),
    ...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
    ...(typeof options.generateAudio === 'boolean' ? { generateAudio: options.generateAudio } : {}),
  };
}

export function jobResults(job: MediaJob): MediaResult[] {
  const files = job.resultFileIds || [];
  const served = job.resultFiles || [];
  if (job.status === 'completed') {
    const results = files.length
      ? files.map((fileId, index) => {
        const servedFile = served.find((item) => item.fileId === fileId) ?? served[index];
        const isImage = job.type === 'image';
        const proxy = (width?: number) => `/api/files/${fileId}${width ? `?width=${width}` : ''}`;
        const url = servedFile?.url || `/api/media-generation/jobs/${job.id}/file${index ? `?index=${index}` : ''}`;
        // Width tiers: 160 list / 320 card / 1024 detail preview; videos are only served as the original.
        return {
          id: `${job.id}-${index}`, fileId, url,
          ...(isImage ? {
            thumbnailUrl: servedFile?.thumbnailUrl || proxy(320),
            listThumbnailUrl: servedFile?.listThumbnailUrl || proxy(160),
            previewUrl: servedFile?.previewUrl || proxy(1024),
          } : {}),
          status: 'completed' as const,
        };
      })
      : [];
    return results.length
      ? results
      : [{ id: `${job.id}-empty`, status: 'failed', error: job.error || '任务已完成但没有返回结果' }];
  }
  if (job.status === 'failed' || job.status === 'uncertain') {
    return [{ id: `${job.id}-error`, status: 'failed', error: job.error || '生成失败' }];
  }
  if (job.status === 'cancelled') return [{ id: `${job.id}-cancelled`, status: 'cancelled', error: job.error || '任务已取消' }];
  return [{ id: `${job.id}-pending`, status: job.status }];
}

/** Rebuild reusable reference inputs from the persisted job options so historical batches keep their reference images after refresh. */
export function jobReferences(options: Record<string, unknown>): MediaReferences | undefined {
  const rows = Array.isArray(options.references) ? options.references : [];
  const images: MediaInput[] = [];
  for (const row of rows) {
    if (typeof row === 'string') images.push({ id: row, url: row });
    else if (row && typeof row === 'object') {
      const item = row as { fileId?: unknown; url?: unknown; thumbnailUrl?: unknown };
      if (typeof item.fileId === 'string') {
        images.push({
          id: item.fileId, fileId: item.fileId,
          url: typeof item.url === 'string' && item.url ? item.url : `/api/files/${item.fileId}`,
          ...(typeof item.thumbnailUrl === 'string' && item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : { thumbnailUrl: `/api/files/${item.fileId}?width=160` }),
        });
      } else if (typeof item.url === 'string' && item.url) {
        images.push({ id: item.url, url: item.url });
      }
    }
  }
  return images.length ? { images } : undefined;
}

export function jobToBatch(job: MediaJob, jobs: MediaJob[] = [job]): MediaBatch {
  const references = jobReferences(job.options || {});
  return {
    id: job.batchId || job.id,
    createdAt: job.createdAt,
    type: job.type,
    modelId: job.modelId,
    prompt: job.prompt,
    options: jobOptions(job),
    ...(job.style ? { style: job.style } : {}),
    ...(references ? { references } : {}),
    results: jobs.flatMap(jobResults),
    providerId: job.providerId,
    upstreamModelId: job.upstreamModelId,
    ...(job.protocolKey ? { protocolKey: job.protocolKey } : {}),
  };
}

/** Recover groups created before batch IDs existed: same-task, same-prompt jobs launched together. */
export function jobGroups(jobs: MediaJob[]): MediaJob[][] {
  const groups = new Map<string, MediaJob[]>();
  for (const job of jobs) {
    const expected = typeof job.options.generationCount === 'number' ? Math.max(1, Math.floor(job.options.generationCount)) : 1;
    const key = job.batchId || (expected > 1
      ? `${job.taskId || job.id}:${job.prompt}:${job.createdAt.slice(0, 19)}`
      : `${job.taskId || job.id}:${job.id}`);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()];
}

export function jobsToBatchId(jobs: MediaJob[]): string {
  return jobs[0].batchId || jobs[0].id;
}

export function jobToTask(job: MediaJob): MediaTask {
  return { id: job.id, title: job.prompt.trim().slice(0, 24) || '媒体任务', batches: [jobToBatch(job)] };
}

/** Group persisted jobs by their owning task. */
export function jobsToTasks(jobs: MediaJob[]): MediaTask[] {
  const tasks = new Map<string, MediaTask>();
  for (const group of jobGroups(jobs)) {
    const job = group[0];
    const id = job.taskId || job.id;
    const existing = tasks.get(id);
    const batchId = jobsToBatchId(group);
    if (existing?.batches.some((batch) => batch.id === batchId)) continue;
    if (existing) existing.batches.push(jobToBatch(job, group));
    else tasks.set(id, { id, title: job.prompt.trim().slice(0, 24) || '媒体任务', batches: [jobToBatch(job, group)] });
  }
  return [...tasks.values()];
}
