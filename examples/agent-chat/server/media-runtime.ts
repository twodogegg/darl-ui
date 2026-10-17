import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatImage, StoredProvider } from './models';
import type { ModelConfiguration } from '../../../src/components/settings/model-config';
import { generateGptImage2, inspectH3Flash, saveH3Flash, submitH3Flash, type MediaConnection, type MediaBinary } from './media-providers';

export type MediaType = 'image' | 'video';
export interface QueueSettings { submitConcurrency: number; pollConcurrency: number; pollSeconds: number }
export interface MediaOptions { count?: number; size?: string; quality?: 'auto' | 'low' | 'medium' | 'high'; format?: 'png' | 'jpeg' | 'webp'; seconds?: number; resolution?: '480' | '768'; aspectRatio?: '16:9' | '9:16' }
interface Job {
  id: string; project_id: number | null; type: MediaType; model_id: string; provider_id: string; base_url: string;
  upstream_model_id: string; status: 'queued' | 'running' | 'completed' | 'failed';
  phase: string; prompt: string; options_json: string; references_json: string;
  remote_id: string | null; result_json: string | null; error: string | null;
  lease_token: string | null; available_at: number; next_poll_at: number | null;
  created_at: number; updated_at: number; attempts: number;
}
interface Reference { file: string; name: string; mime: string }
const DEFAULT_SETTINGS: QueueSettings = { submitConcurrency: 64, pollConcurrency: 24, pollSeconds: 5 };

export class MediaRuntime {
  private readonly db: DatabaseSync;
  private readonly root: string;
  private readonly config: () => ModelConfiguration;
  private readonly providers: () => StoredProvider[];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly submitting = new Set<string>();
  private readonly polling = new Set<string>();
  private busy = false;

  constructor(input: { dbPath: string; directory: string; config: () => ModelConfiguration; providers: () => StoredProvider[] }) {
    this.db = new DatabaseSync(input.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS generation_jobs (',
      'id TEXT PRIMARY KEY, project_id INTEGER, type TEXT NOT NULL, model_id TEXT NOT NULL,',
      'provider_id TEXT NOT NULL, base_url TEXT NOT NULL, upstream_model_id TEXT NOT NULL,',
      'status TEXT NOT NULL, phase TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT NOT NULL,',
      'references_json TEXT NOT NULL, remote_id TEXT, result_json TEXT, error TEXT,',
      'lease_token TEXT, available_at INTEGER NOT NULL, next_poll_at INTEGER,',
      'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);',
      'CREATE INDEX IF NOT EXISTS generation_jobs_ready ON generation_jobs(status,available_at,created_at);',
      'CREATE INDEX IF NOT EXISTS generation_jobs_poll ON generation_jobs(status,next_poll_at);',
      'CREATE TABLE IF NOT EXISTS generation_queue_settings (',
      'id INTEGER PRIMARY KEY CHECK(id=1), submit_concurrency INTEGER NOT NULL DEFAULT 64,',
      'poll_concurrency INTEGER NOT NULL DEFAULT 24, poll_seconds INTEGER NOT NULL DEFAULT 5);',
      'INSERT OR IGNORE INTO generation_queue_settings(id) VALUES(1);',
    ].join('\n'));
    this.root = resolve(input.directory, 'media-files');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.config = input.config;
    this.providers = input.providers;
  }

  settings(): QueueSettings {
    const row = this.db.prepare('SELECT * FROM generation_queue_settings WHERE id=1')
      .get() as { submit_concurrency: number; poll_concurrency: number; poll_seconds: number } | undefined;
    return row ? { submitConcurrency: row.submit_concurrency, pollConcurrency: row.poll_concurrency, pollSeconds: row.poll_seconds } : DEFAULT_SETTINGS;
  }
  setSettings(raw: unknown) {
    if (!raw || typeof raw !== 'object') throw new Error('队列设置无效');
    const value = raw as Record<string, unknown>;
    const number = (key: keyof QueueSettings, max: number) => {
      const v = value[key];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) throw new Error(key + ' 必须为 1-' + max);
      return Number(v);
    };
    const result = { submitConcurrency: number('submitConcurrency', 10000), pollConcurrency: number('pollConcurrency', 2000), pollSeconds: number('pollSeconds', 300) };
    this.db.prepare('UPDATE generation_queue_settings SET submit_concurrency=?,poll_concurrency=?,poll_seconds=? WHERE id=1')
      .run(result.submitConcurrency, result.pollConcurrency, result.pollSeconds);
    this.schedule();
    return result;
  }

  start() {
    const now = Date.now();
    // The upstream request may have succeeded before its remote ID was persisted.
    // Never automatically resubmit these ambiguous paid requests after a crash.
    this.db.prepare("UPDATE generation_jobs SET status='failed',phase='unknown-submission',error=?,updated_at=? WHERE status='running' AND remote_id IS NULL")
      .run('服务中断时提交结果未知，为防止重复付费，已停止自动重试', now);
    this.db.prepare("UPDATE generation_jobs SET phase='remote',next_poll_at=?,updated_at=? WHERE status='running' AND remote_id IS NOT NULL")
      .run(now, now);
    if (!this.timer) { this.timer = setInterval(() => this.schedule(), 1000); this.timer.unref?.(); }
    this.schedule();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private row(id: string) { return this.db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(id) as unknown as Job | undefined; }
  private rows(sql: string, param?: number) {
    return (param === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(param)) as unknown as Job[];
  }
  private present(job: Job) {
    const files = JSON.parse(job.result_json || '[]') as Array<{ index: number; mime: string }>;
    return { id: job.id, projectId: job.project_id, type: job.type, modelId: job.model_id,
      status: job.status, phase: job.phase, prompt: job.prompt, options: JSON.parse(job.options_json) as MediaOptions,
      remoteTaskId: job.remote_id, error: job.error, attempts: job.attempts,
      createdAt: new Date(job.created_at).toISOString(), updatedAt: new Date(job.updated_at).toISOString(),
      results: files.map((file) => ({ index: file.index, mime: file.mime, url: '/api/media-jobs/' + job.id + '/results/' + file.index })) };
  }
  list(projectId?: number) {
    const rows = projectId ? this.rows('SELECT * FROM generation_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 500', projectId) :
      this.rows('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 500');
    return rows.map((r) => this.present(r));
  }
  get(id: string) { const row = this.row(id); return row ? this.present(row) : null; }
  result(id: string, index: number): { data: Buffer; mime: string } | null {
    const job = this.row(id);
    if (!job || job.status !== 'completed') return null;
    const result = (JSON.parse(job.result_json || '[]') as Array<{ index: number; name: string; mime: string }>).find((x) => x.index === index);
    if (!result || !/^[a-f0-9-]+\.(png|jpeg|webp|mp4)$/.test(result.name)) return null;
    return { data: readFileSync(join(this.root, result.name)), mime: result.mime };
  }

  enqueue(type: MediaType, request: { prompt: string; projectId?: number; options?: MediaOptions }, images: ChatImage[] = []) {
    if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 20000) throw new Error('请输入有效的提示词');
    if (images.length > 16) throw new Error('参考图片最多 16 张');
    const modelId = type === 'image' ? 'gpt-image-2' : 'minimax-h3-flash';
    const config = this.config().models.find((m) => m.id === modelId && m.type === type && m.enabled !== false);
    if (!config) throw new Error('当前模型尚未启用：' + modelId);
    const bindings = config.bindings.filter((b) => b.enabled !== false);
    if (bindings.length !== 1) throw new Error('一个模型必须且只能绑定一个有效供应商');
    const binding = bindings[0];
    if (binding.protocolKey !== (type === 'image' ? 'openai-images' : 'darl-h3-flash-unified')) throw new Error('模型协议未接通');
    const provider = this.providers().find((p) => p.id === binding.providerId);
    if (!provider?.apiKey || !provider.baseUrl) throw new Error('请先设置供应商 API Key 与地址');
    if (request.projectId !== undefined && (!Number.isSafeInteger(request.projectId) || request.projectId <= 0)) throw new Error('项目编号无效');
    const id = randomUUID();
    const references: Reference[] = images.map((image, index) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('参考图仅支持 PNG/JPEG/WebP');
      const bytes = Buffer.from(image.data, 'base64');
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('单张参考图超过 20MB');
      const file = id + '-ref-' + index;
      writeFileSync(join(this.root, file), bytes, { mode: 0o600, flag: 'wx' });
      return { file, mime: image.mimeType, name: image.name };
    });
    const now = Date.now();
    this.db.prepare('INSERT INTO generation_jobs(id,project_id,type,model_id,provider_id,base_url,upstream_model_id,status,phase,prompt,options_json,references_json,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'queued\',\'waiting\',?,?,?,?,?,?)')
      .run(id, request.projectId || null, type, modelId, provider.id, provider.baseUrl, binding.upstreamModelId,
        request.prompt.trim(), JSON.stringify(request.options || {}), JSON.stringify(references), now, now, now);
    this.schedule();
    return this.get(id)!;
  }

  private connection(job: Job): MediaConnection {
    const provider = this.providers().find((p) => p.id === job.provider_id);
    if (!provider?.apiKey) throw new Error('原供应商的凭据已缺失，无法查询任务');
    return { baseUrl: job.base_url, apiKey: provider.apiKey, upstreamModelId: job.upstream_model_id };
  }
  private modelCapacity(id: string) {
    const bindings = this.config().models.find((m) => m.id === id)?.bindings.filter((b) => b.enabled !== false) || [];
    return bindings.length === 1 ? (bindings[0].maxConcurrency ?? 64) : 0;
  }
  private references(job: Job) {
    return (JSON.parse(job.references_json) as Reference[]).map((r) => ({ name: r.name, mime: r.mime, data: readFileSync(join(this.root, r.file)) }));
  }
  private finish(job: Job, data: MediaBinary[]) {
    const result = data.map((file, index) => {
      const ext = file.mime === 'image/png' ? 'png' : file.mime === 'image/jpeg' ? 'jpeg' :
        file.mime === 'image/webp' ? 'webp' : file.mime === 'video/mp4' ? 'mp4' : '';
      if (!ext) throw new Error('未知的媒体文件类型');
      const name = job.id + '-' + index + '.' + ext;
      writeFileSync(join(this.root, name), file.data, { mode: 0o600 });
      return { index, name, mime: file.mime };
    });
    this.db.prepare("UPDATE generation_jobs SET status='completed',phase='done',result_json=?,error=NULL,updated_at=? WHERE id=? AND status='running'")
      .run(JSON.stringify(result), Date.now(), job.id);
  }
  private fail(job: Job, error: unknown) {
    this.db.prepare("UPDATE generation_jobs SET status='failed',phase='failed',error=?,updated_at=? WHERE id=? AND status='running'")
      .run((error instanceof Error ? error.message : '生成失败').slice(0, 900), Date.now(), job.id);
  }
  private schedule() {
    if (this.busy) return;
    this.busy = true;
    try {
      const settings = this.settings();
      let free = Math.max(0, settings.submitConcurrency - this.submitting.size);
      const counts = new Map<string, number>();
      for (const row of this.rows("SELECT * FROM generation_jobs WHERE status='running'"))
        counts.set(row.model_id, (counts.get(row.model_id) || 0) + 1);
      const queued = this.rows("SELECT * FROM generation_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at,id LIMIT 1000", Date.now());
      for (const job of queued) {
        if (!free) break;
        const active = counts.get(job.model_id) || 0;
        if (active >= this.modelCapacity(job.model_id)) continue;
        const token = randomUUID();
        const marked = this.db.prepare("UPDATE generation_jobs SET status='running',phase='submitting',lease_token=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'")
          .run(token, Date.now(), job.id);
        if (!marked.changes) continue;
        counts.set(job.model_id, active + 1);
        free--;
        void this.execute({ ...job, status: 'running', phase: 'submitting', lease_token: token });
      }
      let polls = Math.max(0, settings.pollConcurrency - this.polling.size);
      const due = this.rows("SELECT * FROM generation_jobs WHERE status='running' AND remote_id IS NOT NULL AND next_poll_at<=? ORDER BY next_poll_at LIMIT 2000", Date.now());
      for (const job of due) {
        if (!polls) break;
        if (this.polling.has(job.id)) continue;
        this.polling.add(job.id);
        polls--;
        void this.poll(job).finally(() => this.polling.delete(job.id));
      }
    } finally { this.busy = false; }
  }
  private async execute(job: Job) {
    this.submitting.add(job.id);
    try {
      const options = JSON.parse(job.options_json) as MediaOptions;
      const conn = this.connection(job);
      if (job.type === 'image') {
        const files = await generateGptImage2(conn, { prompt: job.prompt, count: options.count,
          size: options.size, quality: options.quality, format: options.format, referenceImages: this.references(job) });
        this.finish(job, files);
      } else {
        const created = await submitH3Flash(conn, { prompt: job.prompt, seconds: options.seconds,
          resolution: options.resolution, aspectRatio: options.aspectRatio, referenceImages: this.references(job) });
        const now = Date.now();
        this.db.prepare("UPDATE generation_jobs SET remote_id=?,phase='remote',lease_token=NULL,next_poll_at=?,updated_at=? WHERE id=? AND status='running'")
          .run(created.id, now + this.settings().pollSeconds * 1000, now, job.id);
      }
    } catch (error) { this.fail(job, error); }
    finally { this.submitting.delete(job.id); this.schedule(); }
  }
  private async poll(job: Job) {
    if (!job.remote_id) return;
    try {
      const conn = this.connection(job);
      const remote = await inspectH3Flash(conn, job.remote_id);
      if (remote.status === 'failed') { this.fail(job, remote.error || '视频生成失败'); return; }
      if (remote.status === 'completed') {
        try { this.finish(job, [await saveH3Flash(conn, job.remote_id)]); }
        catch (error) {
          // Preserve the remote task: retry downloading, never create a second paid video.
          this.db.prepare("UPDATE generation_jobs SET phase='download-retry',error=?,next_poll_at=?,updated_at=? WHERE id=? AND status='running'")
            .run((error instanceof Error ? error.message : '下载失败').slice(0, 450), Date.now() + 15000, Date.now(), job.id);
        }
        return;
      }
      this.db.prepare("UPDATE generation_jobs SET phase='remote',error=NULL,next_poll_at=?,updated_at=? WHERE id=? AND status='running'")
        .run(Date.now() + this.settings().pollSeconds * 1000, Date.now(), job.id);
    } catch (error) {
      // Network/429 errors do not mean the remote generation failed.
      this.db.prepare("UPDATE generation_jobs SET error=?,next_poll_at=?,updated_at=? WHERE id=? AND status='running'")
        .run((error instanceof Error ? error.message : '查询失败').slice(0, 450), Date.now() + 15000, Date.now(), job.id);
    }
  }
}
