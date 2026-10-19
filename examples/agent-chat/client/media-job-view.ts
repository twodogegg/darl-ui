import type { GenerateRequest, MediaBatch, MediaResult, MediaTask } from '../../../src/components/media-workspace/types';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type MediaJob = {
  id: string;
  modelId: string;
  type: 'image' | 'video';
  status: JobStatus;
  prompt: string;
  options: Record<string, unknown>;
  providerId: string;
  upstreamModelId: string;
  protocolKey?: string;
  error?: string;
  resultPath?: string;
  resultPaths?: string[];
  resultUrls?: string[];
  providerUrls?: string[];
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
  const files = job.resultPaths?.length ? job.resultPaths : job.resultPath ? [job.resultPath] : [];
  const urls = files.length
    ? files.map((_, index) => `/api/media-generation/jobs/${job.id}/file${index ? `?index=${index}` : ''}`)
    : [...(job.resultUrls || []), ...(job.providerUrls || [])];
  if (job.status === 'completed') {
    return urls.length
      ? urls.map((url, index) => ({ id: `${job.id}-${index}`, url, status: 'completed' as const }))
      : [{ id: `${job.id}-empty`, status: 'failed', error: job.error || '任务已完成但没有返回结果' }];
  }
  if (job.status === 'failed' || job.status === 'uncertain') {
    return [{ id: `${job.id}-error`, status: 'failed', error: job.error || '生成失败' }];
  }
  if (job.status === 'cancelled') return [{ id: `${job.id}-cancelled`, status: 'cancelled', error: job.error || '任务已取消' }];
  return [{ id: `${job.id}-pending`, status: job.status }];
}

export function jobToBatch(job: MediaJob): MediaBatch {
  return {
    id: job.id,
    type: job.type,
    modelId: job.modelId,
    prompt: job.prompt,
    options: jobOptions(job),
    results: jobResults(job),
    providerId: job.providerId,
    upstreamModelId: job.upstreamModelId,
    ...(job.protocolKey ? { protocolKey: job.protocolKey } : {}),
  };
}

export function jobToTask(job: MediaJob): MediaTask {
  return { id: job.id, title: job.prompt.trim().slice(0, 24) || '媒体任务', batches: [jobToBatch(job)] };
}
