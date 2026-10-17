import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MediaJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type MediaJob = { id: string; modelId: 'gpt-image-2' | 'minimax-h3-flash'; type: 'image' | 'video'; status: MediaJobStatus;
  prompt: string; options: Record<string, unknown>; providerId: string; upstreamModelId: string; baseUrl: string;
  remoteTaskId?: string; resultPath?: string; error?: string; phase?: string; attempts: number;
  createdAt: string; updatedAt: string; nextPollAt?: number };
type Row = { data: string };
const now = () => new Date().toISOString();

/** The DB, not a timer or browser tab, owns job state. One local Node server is supported. */
export class MediaJobStore {
  private db: DatabaseSync;
  readonly mediaRoot: string;
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS media_generation_jobs (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS media_generation_jobs_queue ON media_generation_jobs(status,updated_at)');
    this.db.exec('CREATE TABLE IF NOT EXISTS media_model_limits (model_id TEXT PRIMARY KEY, concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 100000))');
    this.mediaRoot = join(dirname(dbPath), 'generated-media');
    mkdirSync(this.mediaRoot, { recursive: true, mode: 0o700 });
  }
  list(): MediaJob[] {
    return (this.db.prepare('SELECT data FROM media_generation_jobs ORDER BY updated_at DESC').all() as unknown as Row[]).map(row => JSON.parse(row.data) as MediaJob);
  }
  get(id: string): MediaJob | undefined {
    const row = this.db.prepare('SELECT data FROM media_generation_jobs WHERE id=?').get(id) as Row | undefined;
    return row ? JSON.parse(row.data) as MediaJob : undefined;
  }
  put(job: MediaJob) {
    job.updatedAt = now();
    this.db.prepare('INSERT INTO media_generation_jobs(id,model_id,status,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,data=excluded.data')
      .run(job.id, job.modelId, job.status, job.updatedAt, JSON.stringify(job));
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
  limits() { return { 'gpt-image-2': this.limit('gpt-image-2'), 'minimax-h3-flash': this.limit('minimax-h3-flash') }; }
  setLimit(model: string, limit: number) {
    if (!['gpt-image-2','minimax-h3-flash'].includes(model) || !Number.isSafeInteger(limit) || limit<1 || limit>100000) throw new Error('并发配置无效（1–100000）');
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
  saveMedia(id: string, bytes: Buffer, ext: 'png'|'jpeg'|'webp'|'mp4'): string {
    if (bytes.length > 200*1024*1024) throw new Error('生成文件超过 200MB');
    const path = join(this.mediaRoot, id+'.'+ext);
    writeFileSync(path, bytes, { flag:'wx', mode:0o600 });
    return path;
  }
}
