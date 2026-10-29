import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestRecord, RequestRecordFilters, RequestRecordMedia, RequestRecordPage, RequestRecordRetention } from '../../../src/components/request-records/types';
import type { FileStore } from './file-storage';
import { removeStoredThoughtSignatures, type LocalStorage } from './storage';
import type { MediaJob } from './media-job-store';
import { isLocalOrLanAddress } from './local-access';

const ACTIVE = new Set(['queued', 'running']);
const SECRET_FIELD = /authorization|cookie|password|credential|api[_-]?key|secret|^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token)$/i;
export const requestRecordScope = new AsyncLocalStorage<{ store: RequestRecordStore; requestId: string; sessionId?: string; runId?: string; agentId?: string }>();

/** Bound snapshots before writing; never store credentials or inline media. */
export function sanitizeRecordValue(value: unknown, secrets: string[] = []): unknown {
  let budget = 200_000;
  const clean = (item: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 12) return '[内容已截断]';
    if (typeof item === 'string') {
      let result = item;
      for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[已隐藏]');
      result = result.replace(/(?:sk|ahk)_[\w-]+|sk-[\w-]+|Bearer\s+[^\s"']+/gi, '[已隐藏]');
      if (/^data:/i.test(result)) return '[媒体内容已保存为文件]';
      if (/^https?:\/\//i.test(result)) {
        try {
          const url = new URL(result);
          url.username = ''; url.password = ''; url.hash = '';
          for (const key of [...url.searchParams.keys()]) if (SECRET_FIELD.test(key) || /token|signature|sign|auth/i.test(key)) url.searchParams.delete(key);
          result = url.href;
        } catch { /* Keep a bounded diagnostic string. */ }
      }
      const limit = Math.min(32_000, budget);
      budget -= Math.min(result.length, limit);
      return result.length > limit ? `${result.slice(0, limit)}\n[内容已截断]` : result;
    }
    if (item instanceof Uint8Array || item instanceof ArrayBuffer) return `[二进制 ${item.byteLength} 字节]`;
    if (item instanceof URL) return clean(item.href, depth + 1);
    if (Array.isArray(item)) return item.slice(0, 100).map(entry => clean(entry, depth + 1));
    if (item && typeof item === 'object' && 'type' in item && item.type === 'data' && 'data' in item) return { type: 'data', data: '[媒体内容已保存为文件]' };
    if (item && typeof item === 'object' && 'type' in item && (item.type === 'reasoning' || item.type === 'reasoning-file')) return { type: item.type, content: '[内容已省略]' };
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => !/^thought_?signature$/i.test(key)).slice(0, 100).map(([key, entry]) => {
      budget -= key.length;
      return [key, SECRET_FIELD.test(key) ? '[已隐藏]' : /^(?:b64_json|base64|reasoning|reasoningText)$/i.test(key) ? '[内容已省略]' : clean(entry, depth + 1)];
    }));
    return typeof item === 'function' || item === undefined ? undefined : item;
  };
  return clean(value, 0);
}

export function requestFailureStatus(reason: unknown, signal?: AbortSignal): RequestRecord['status'] {
  if ((signal?.reason as Error)?.name === 'TimeoutError' || (reason as Error)?.name === 'TimeoutError') return 'timeout';
  return signal?.aborted || (reason as Error)?.name === 'AbortError' ? 'cancelled' : 'error';
}

export class RequestRecordStore {
  private db: DatabaseSync;
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private storage: LocalStorage, readonly files: FileStore, private secrets: () => string[] = () => []) {
    this.db = new DatabaseSync(storage.path);
    this.db.exec(`PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS request_records (id TEXT PRIMARY KEY, type TEXT NOT NULL, model_id TEXT NOT NULL, provider_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS request_records_time ON request_records(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS request_records_filter ON request_records(type, status, created_at DESC);`);
    removeStoredThoughtSignatures(this.db, 'request_records');
    // A process restart cannot prove that an interrupted upstream call failed.
    for (const row of this.db.prepare("SELECT data FROM request_records WHERE status='running' AND type IN ('text','audio')").all()) {
      const item = JSON.parse(row.data as string) as RequestRecord;
      this.finish(item.id, { status: 'uncertain', error: '服务中断，无法确认请求最终结果' });
    }
    this.cleanup();
    this.timer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    this.timer.unref();
  }
  close() { if (!this.closed) { clearInterval(this.timer); this.closed = true; this.db.close(); } }
  retention(): RequestRecordRetention { return this.storage.getConfig<RequestRecordRetention>('requestRecordRetention') || { enabled: true, days: 30 }; }
  saveRetention(value: unknown) {
    const input = value as Partial<RequestRecordRetention> | null;
    if (!input || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.days) || input.days! < 1 || input.days! > 3650) throw new Error('保留天数须为 1–3650 的整数');
    const settings = { enabled: input.enabled, days: input.days! };
    this.storage.setConfig('requestRecordRetention', settings);
    this.cleanup();
    return settings;
  }
  cleanup(now = Date.now()) {
    const settings = this.retention();
    if (!settings.enabled) return 0;
    return Number(this.db.prepare("DELETE FROM request_records WHERE status NOT IN ('queued','running') AND ended_at < ?").run(new Date(now - settings.days * 86_400_000).toISOString()).changes);
  }
  get(id: string): RequestRecord | undefined {
    if (this.closed) return;
    const row = this.db.prepare('SELECT data FROM request_records WHERE id=?').get(id);
    return row ? JSON.parse(row.data as string) as RequestRecord : undefined;
  }
  put(record: RequestRecord) {
    const secrets = this.secrets();
    const { parameters, response, references, results, ...metadata } = record;
    const safe: RequestRecord = { ...sanitizeRecordValue(metadata, secrets) as RequestRecord,
      parameters: sanitizeRecordValue(parameters, secrets), response: sanitizeRecordValue(response, secrets),
      references: references?.map(media => sanitizeRecordValue(media, secrets) as RequestRecordMedia),
      results: results?.map(media => sanitizeRecordValue(media, secrets) as RequestRecordMedia) };
    if (this.closed) return safe;
    this.db.prepare('INSERT INTO request_records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, ended_at=excluded.ended_at, data=excluded.data')
      .run(safe.id, safe.type, safe.modelId, safe.providerId, safe.status, safe.createdAt, safe.endedAt || null, JSON.stringify(safe));
    return safe;
  }
  begin(input: Omit<RequestRecord, 'id' | 'status' | 'createdAt'>) {
    const scope = requestRecordScope.getStore();
    return this.put({ requestId: scope?.requestId, sessionId: scope?.sessionId, runId: scope?.runId, ...input, id: randomUUID(), status: 'running', createdAt: new Date().toISOString() });
  }
  finish(id: string, patch: Partial<RequestRecord>) {
    const record = this.get(id);
    if (!record) return;
    const endedAt = new Date().toISOString();
    this.put({ ...record, ...patch, endedAt, durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(record.createdAt)) });
  }
  media(fileId: string, type: RequestRecordMedia['type'], name?: string): RequestRecordMedia {
    const file = this.files.get(fileId);
    return { type, name: name || file?.name || '素材', fileId };
  }
  presentMedia(media: RequestRecordMedia): RequestRecordMedia {
    if (!media.fileId) return media;
    const file = this.files.get(media.fileId);
    if (!file) return { ...media, url: undefined, thumbnailUrl: undefined, unavailable: true };
    return { ...media, url: this.files.originalUrl(file), thumbnailUrl: media.type === 'image' ? this.files.thumbnailUrl(file, 160) : undefined };
  }
  present(record: RequestRecord): RequestRecord {
    return { ...record, references: record.references?.map(media => this.presentMedia(media)), results: record.results?.map(media => this.presentMedia(media)) };
  }
  list(filters: RequestRecordFilters): RequestRecordPage {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    for (const [key, column] of [['type','type'],['status','status'],['modelId','model_id'],['providerId','provider_id']] as const) {
      if (filters[key]) { conditions.push(`${column}=?`); values.push(filters[key]!); }
    }
    if (filters.from) { conditions.push('created_at>=?'); values.push(filters.from); }
    if (filters.to) { conditions.push('created_at<=?'); values.push(filters.to); }
    if (filters.query) {
      conditions.push("(id LIKE ? ESCAPE '\\' OR json_extract(data,'$.requestId') LIKE ? ESCAPE '\\' OR model_id LIKE ? ESCAPE '\\' OR json_extract(data,'$.error') LIKE ? ESCAPE '\\' OR json_extract(data,'$.taskId') LIKE ? ESCAPE '\\')");
      const pattern = `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT count(*) AS total FROM request_records ${where}`).get(...values)?.total || 0);
    const rows = this.db.prepare(`SELECT data FROM request_records ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, filters.pageSize, (filters.page - 1) * filters.pageSize);
    const items = rows.map(row => {
      const { parameters: _parameters, response: _response, text: _text, references: _references, results, ...summary } = JSON.parse(row.data as string) as RequestRecord;
      const thumbSource = summary.type === 'image' || summary.type === 'video'
        ? results?.find(media => media.type === summary.type && !media.unavailable)
        : undefined;
      return { ...summary, thumbnail: thumbSource ? this.presentMedia(thumbSource) : undefined };
    });
    const options = (column: 'model' | 'provider') => this.db.prepare(`SELECT ${column}_id AS id, max(json_extract(data,'$.${column}Name')) AS name FROM request_records GROUP BY ${column}_id ORDER BY name`).all() as unknown as Array<{ id: string; name: string }>;
    return { items, total, models: options('model'), providers: options('provider') };
  }
  syncMedia(job: MediaJob, names: { modelName?: string; providerName?: string; secret?: string } = {}) {
    const status = ({ completed: 'success', failed: 'error', queued: 'queued', running: 'running', cancelled: 'cancelled', uncertain: 'uncertain' } as const)[job.status];
    const old = this.get(job.id);
    const scope = requestRecordScope.getStore();
    const references = (['references', 'referenceVideos', 'referenceAudios'] as const).flatMap(field => {
      const type = field === 'references' ? 'image' : field === 'referenceVideos' ? 'video' : 'audio';
      return Array.isArray(job.options[field]) ? job.options[field].flatMap((ref): RequestRecordMedia[] => {
        if (ref && typeof ref === 'object' && typeof ref.fileId === 'string') return [this.media(ref.fileId, type)];
        return typeof ref === 'string' && /^(?:https?:\/\/|\/api\/files\/)/.test(ref) ? [{ type, name: '参考素材', url: ref }] : [];
      }) : [];
    });
    this.put({ ...old, id: job.id, type: job.type, modelId: job.modelId, modelName: names.modelName || old?.modelName || job.modelId,
      providerId: job.providerId, providerName: names.providerName || old?.providerName || job.providerId, status, createdAt: job.createdAt,
      requestId: old?.requestId || scope?.requestId, sessionId: old?.sessionId || scope?.sessionId, runId: old?.runId || scope?.runId,
      taskId: job.taskId || job.id, upstreamTaskId: job.remoteTaskId, url: job.baseUrl, method: 'POST',
      ...(!ACTIVE.has(status) ? { endedAt: job.updatedAt, durationMs: Math.max(0, Date.parse(job.updatedAt) - Date.parse(job.createdAt)) } : {}),
      parameters: { model: job.upstreamModelId, prompt: job.prompt, ...job.options, style: job.style }, response: job.providerResponse,
      error: names.secret ? job.error?.replaceAll(names.secret, '[已隐藏]') : job.error, references,
      results: job.resultFileIds?.map(id => this.media(id, job.type)),
    });
  }
}

export function requestRecordsApi(store: RequestRecordStore, request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/request-records')) return false;
  const send = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); };
  return (async () => {
    if (!isLocalOrLanAddress(request.socket.remoteAddress)) { send(403, { error: '请求记录仅允许本机或局域网访问' }); return true; }
    try {
      if (url.pathname === '/api/request-records/retention') {
        if (request.method === 'GET') send(200, store.retention());
        else if (request.method === 'POST') {
          let body = '';
          for await (const chunk of request) { body += chunk.toString(); if (body.length > 1000) throw new Error('配置过大'); }
          send(200, store.saveRetention(JSON.parse(body)));
        } else send(405, { error: '不支持的请求方式' });
      } else if (request.method !== 'GET') send(405, { error: '不支持的请求方式' });
      else if (url.pathname === '/api/request-records') {
        const filters = Object.fromEntries(url.searchParams) as unknown as RequestRecordFilters;
        if (filters.type && !['text','image','audio','video'].includes(filters.type)) throw new Error('模型类型无效');
        if (filters.status && !['queued','running','success','error','cancelled','timeout','uncertain'].includes(filters.status)) throw new Error('请求状态无效');
        for (const key of ['from','to'] as const) if (filters[key]) { if (!Number.isFinite(Date.parse(filters[key]))) throw new Error('时间范围无效'); filters[key] = new Date(filters[key]).toISOString(); }
        if (filters.from && filters.to && filters.from > filters.to) throw new Error('结束时间须晚于开始时间');
        filters.page = Math.max(1, Math.min(1_000_000, Math.floor(Number(filters.page) || 1)));
        filters.pageSize = Math.max(1, Math.min(100, Math.floor(Number(filters.pageSize) || 20)));
        if (filters.query) filters.query = filters.query.slice(0, 200);
        send(200, store.list(filters));
      } else {
        const id = url.pathname.slice('/api/request-records/'.length);
        const record = /^[\w-]{1,100}$/.test(id) ? store.get(id) : undefined;
        if (record) send(200, store.present(record)); else send(404, { error: '请求记录已清理或不存在' });
      }
    } catch (reason) { send(400, { error: reason instanceof Error ? reason.message : '请求失败' }); }
    return true;
  })();
}
