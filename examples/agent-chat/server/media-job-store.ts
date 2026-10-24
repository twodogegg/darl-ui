import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { MediaStyleOption } from '../../../src/components/media-workspace/types';
import { FileStore, type StoredFile } from './file-storage';

export type MediaJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type MediaJob = { id: string; taskId?: string; batchId?: string; modelId: string; type: 'image' | 'video'; status: MediaJobStatus;
  prompt: string; options: Record<string, unknown>; style?: MediaStyleOption; providerId: string; upstreamModelId: string; baseUrl: string; protocolKey?: string;
  remoteTaskId?: string; progress?: number; error?: string; phase?: string; attempts: number;
  /** IDs in the unified file store for generated outputs. */
  resultFileIds?: string[];
  /** Which payload shape the provider used for the finished image. */
  resultForm?: 'b64_json' | 'url';
  /** Trimmed provider payload, kept so the UI can show what actually came back. */
  providerResponse?: Record<string, unknown>;
  createdAt: string; updatedAt: string; nextPollAt?: number };
type Row = { data: string };
const now = () => new Date().toISOString();

const FAILED_STATUSES: ReadonlySet<MediaJobStatus> = new Set(['failed', 'uncertain', 'cancelled']);

/**
 * A failed or uncertain job is a failed tool call, not a successful status read.
 * Returning `isError` here is what makes the UI show the error instead of a green card.
 */
export function mediaTaskResult(job: MediaJob) {
  const results = job.resultFileIds?.length || 0;
  const payload = {
    id: job.id,
    status: job.status,
    modelId: job.modelId,
    ...(job.progress !== undefined ? { progress: job.progress } : {}),
    ...(results ? { resultUrls: Array.from({ length: results }, (_, index) => `/api/media-generation/jobs/${job.id}/file${index ? `?index=${index}` : ''}`) } : {}),
    ...(job.resultForm ? { resultForm: job.resultForm } : {}),
    ...(job.providerResponse ? { providerResponse: job.providerResponse } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
  const failed = FAILED_STATUSES.has(job.status);
  return {
    failed,
    code: job.status === 'uncertain' ? 'MEDIA_TASK_UNCERTAIN' : job.status === 'cancelled' ? 'MEDIA_TASK_CANCELLED' : 'MEDIA_TASK_FAILED',
    message: job.error || `任务状态：${job.status}`,
    body: JSON.stringify(failed ? { isError: true, ...payload } : payload),
  };
}

export const MEDIA_MODEL_IDS = ['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview', 'minimax-h3-flash', 'minimax-h3-standard'] as const;

/** The DB, not a timer or browser tab, owns job state. One local Node server is supported. */
export class MediaJobStore {
  private db: DatabaseSync;
  constructor(dbPath: string, readonly files: FileStore, private onChange?: (job: MediaJob) => void) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS media_generation_jobs (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS media_generation_jobs_queue ON media_generation_jobs(status,updated_at)');
    this.db.exec('CREATE TABLE IF NOT EXISTS media_model_limits (model_id TEXT PRIMARY KEY, concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 100000))');
  }
  list(): MediaJob[] {
    return (this.db.prepare('SELECT data FROM media_generation_jobs ORDER BY updated_at DESC').all() as unknown as Row[]).map(row => JSON.parse(row.data) as MediaJob);
  }
  get(id: string): MediaJob | undefined {
    const row = this.db.prepare('SELECT data FROM media_generation_jobs WHERE id=?').get(id) as Row | undefined;
    return row ? JSON.parse(row.data) as MediaJob : undefined;
  }
  delete(id: string) {
    const job = this.get(id);
    if (!job) return undefined;
    if (job.status === 'queued' || job.status === 'running') throw new Error('任务仍在生成，请等待完成或失败后再删除');
    this.db.prepare('DELETE FROM media_generation_jobs WHERE id=?').run(id);
    return job;
  }
  deleteTask(taskId: string) {
    const jobs = this.list().filter((job) => (job.taskId || job.id) === taskId);
    if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) throw new Error('任务仍在生成，请等待完成或失败后再删除');
    return jobs;
  }
  put(job: MediaJob) {
    job.updatedAt = now();
    this.db.prepare('INSERT INTO media_generation_jobs(id,model_id,status,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,data=excluded.data')
      .run(job.id, job.modelId, job.status, job.updatedAt, JSON.stringify(job));
    this.onChange?.(job);
  }
  create(job: Omit<MediaJob,'id'|'attempts'|'createdAt'|'updatedAt'|'status'>): MediaJob {
    const item: MediaJob = { ...job, id: randomUUID(), status: 'queued', attempts: 0, createdAt: now(), updatedAt: now() };
    this.put(item);
    return item;
  }
  limit(model: string): number {
    const row = this.db.prepare('SELECT concurrency FROM media_model_limits WHERE model_id=?').get(model) as { concurrency:number } | undefined;
    return row?.concurrency ?? 4;
  }
  limits() { return Object.fromEntries(MEDIA_MODEL_IDS.map((model) => [model, this.limit(model)])); }
  setLimit(model: string, limit: number) {
    if (!(MEDIA_MODEL_IDS as readonly string[]).includes(model) || !Number.isSafeInteger(limit) || limit<1 || limit>100000) throw new Error('并发配置无效（1–100000）');
    this.db.prepare('INSERT INTO media_model_limits(model_id,concurrency) VALUES(?,?) ON CONFLICT(model_id) DO UPDATE SET concurrency=excluded.concurrency').run(model, limit);
  }
  /** Unknown remote submission MUST NOT be automatically repeated (billing risk). */
  recover() {
    for (const job of this.list()) {
      if (job.status !== 'running') continue;
      if (job.type === 'video' && job.remoteTaskId) {
        job.phase = 'remote-running';
        job.nextPollAt = Date.now();
      } else {
        job.status = 'uncertain';
        job.error = '服务中断时任务提交结果未知；请检查供应商记录后再决定是否重试';
      }
      this.put(job);
    }
  }
  async saveFile(bytes: Buffer, mime: string, name: string): Promise<StoredFile> {
    if (bytes.length > 200 * 1024 * 1024) throw new Error('生成文件超过 200MB');
    return this.files.put(bytes, mime, name);
  }

  async removeFiles(jobs: MediaJob[]) {
    const remaining = this.list().filter((item) => !jobs.some((job) => job.id === item.id));
    const ids = new Set(jobs.flatMap((job) => job.resultFileIds || []));
    const conflicts = [...ids].filter((id) => remaining.some((job) => (job.resultFileIds || []).includes(id)));
    if (conflicts.length) throw new Error('生成结果仍被其他任务引用，未删除');
    const removed: string[] = [];
    try {
      for (const id of ids) {
        if (this.files.references(id)) continue;
        if (await this.files.remove(id)) removed.push(id);
      }
    } catch (error) {
      for (const id of removed) this.files.forget(id);
      throw error;
    }
    for (const id of removed) this.files.forget(id);
  }
  removeMany(jobs: MediaJob[]) {
    this.db.exec('BEGIN');
    try {
      for (const job of jobs) this.db.prepare('DELETE FROM media_generation_jobs WHERE id=?').run(job.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
