// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { RequestRecordStore, requestRecordsApi, requestRecordScope, requestFailureStatus, sanitizeRecordValue } from '../examples/agent-chat/server/request-records';
import type { RequestModelType, RequestRecord } from '../src/components/request-records/types';

let directory: string;
let store: RequestRecordStore;
let files: FileStore;
let storage: LocalStorage;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'darl-requests-'));
  storage = new LocalStorage(directory);
  files = new FileStore(storage.path, { mode: 'local', root: join(directory, 'files') });
  store = new RequestRecordStore(storage, files, () => ['private-provider-value']);
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
const begin = (type: RequestModelType, patch: Partial<RequestRecord> = {}) => store.begin({ type, modelId: `${type}-model`, modelName: `${type}模型`, providerId: 'provider', providerName: '供应商', ...patch });

describe('persistent request records', () => {
  it('combines type, status, model, provider, dates and escaped keyword filters with real SQLite pagination', () => {
    for (const type of ['text','image','audio','video'] as const) {
      const record = begin(type);
      store.finish(record.id, { status: type === 'image' ? 'error' : 'success', error: type === 'image' ? 'HTTP 429 100%_quota' : undefined });
    }
    expect(store.list({ page: 1, pageSize: 2 }).items).toHaveLength(2);
    expect(store.list({ page: 2, pageSize: 2 }).items).toHaveLength(2);
    const filtered = store.list({ type: 'image', status: 'error', modelId: 'image-model', providerId: 'provider', query: '100%_quota', from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString(), page: 1, pageSize: 20 });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].type).toBe('image');
    expect(filtered.models).toHaveLength(4);
    expect(store.list({ query: '%SQL%', page: 1, pageSize: 20 }).total).toBe(0);
  });

  it('persists sanitized detail, associations and playable file URLs, keeping snapshots out of the list', async () => {
    const file = await files.put(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=', 'base64'), 'image/png', 'reference.png');
    const record = requestRecordScope.run({ store, requestId: 'request-123', sessionId: 'session-456', runId: 'run-789' }, () => begin('image', { parameters: { Authorization: 'Bearer secret', nested: { apiKey: 'private-provider-value' }, binary: new Uint8Array([1,2]), prompt: 'private-provider-value test' }, references: [store.media(file.id, 'image')], results: [store.media(file.id, 'image')] }));
    const persisted = store.get(record.id)!;
    expect(persisted).toMatchObject({ requestId: 'request-123', sessionId: 'session-456', runId: 'run-789' });
    expect(JSON.stringify(persisted)).not.toContain('private-provider-value');
    expect(store.present(persisted).references?.[0].url).toBe(`/api/files/${file.id}`);
    expect(store.list({ page: 1, pageSize: 20 }).items[0].parameters).toBeUndefined();
    const listed = store.list({ page: 1, pageSize: 20 }).items[0];
    expect(listed.results).toBeUndefined();
    expect(listed.thumbnail).toMatchObject({ type: 'image', url: `/api/files/${file.id}`, thumbnailUrl: `/api/files/${file.id}?width=160` });
    files.forget(file.id);
    expect(store.present(persisted).results?.[0]).toMatchObject({ unavailable: true });
    expect(store.present(persisted).results?.[0].url).toBeUndefined();
  });

  it('cleans only expired finished records, preserves actual files, and honors the disabled setting across restarts', async () => {
    const file = await files.put(Buffer.from('retained result'), 'text/plain', 'result.txt');
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const ended = begin('image', { createdAt: old, results: [store.media(file.id, 'image')] });
    store.put({ ...ended, createdAt: old, endedAt: old, status: 'success' });
    const running = begin('video');
    store.put({ ...running, createdAt: old });
    store.saveRetention({ enabled: false, days: 30 });
    expect(store.cleanup()).toBe(0);
    store.close();
    store = new RequestRecordStore(storage, files);
    expect(store.retention()).toEqual({ enabled: false, days: 30 });
    expect(store.get(ended.id)).toBeDefined();
    store.saveRetention({ enabled: true, days: 30 });
    expect(store.get(ended.id)).toBeUndefined();
    expect(store.get(running.id)?.status).toBe('running');
    expect((await files.getBytes(file.id))?.bytes.toString()).toBe('retained result');
    expect(() => store.saveRetention({ enabled: true, days: 0 })).toThrow();
    expect(() => store.saveRetention({ enabled: true, days: 2.5 })).toThrow();
  });

  it('marks interrupted text calls uncertain after a restart and keeps active video tracking', () => {
    const text = begin('text');
    const video = begin('video');
    store.close(); store = new RequestRecordStore(storage, files);
    expect(store.get(text.id)?.status).toBe('uncertain');
    expect(store.get(video.id)?.status).toBe('running');
    expect(requestFailureStatus(new DOMException('', 'TimeoutError'))).toBe('timeout');
    expect(requestFailureStatus(new DOMException('', 'AbortError'))).toBe('cancelled');
  });

  it('cleans historical request signatures on startup while preserving other fields', () => {
    const record = begin('image');
    const historical = { ...record, status: 'success', response: { parts: [{ text: '生成完成', thoughtSignature: 'unused-signature', thought_signature: 'legacy-signature' }] } };
    const database = new DatabaseSync(storage.path);
    try {
      database.prepare('UPDATE request_records SET status=?, data=? WHERE id=?').run('success', JSON.stringify(historical), record.id);
      store.close();
      store = new RequestRecordStore(storage, files);
      const expected = { ...historical, response: { parts: [{ text: '生成完成' }] } };
      expect(store.get(record.id)).toEqual(expected);
      expect(JSON.parse(database.prepare('SELECT data FROM request_records WHERE id=?').get(record.id)!.data as string)).toEqual(expected);
    } finally { database.close(); }
  });

  it('does not persist nested Gemini signatures in request responses', () => {
    const record = begin('image', { response: { candidates: [{ content: { parts: [
      { text: '生成完成', thoughtSignature: 'unused-signature' },
      { thought_signature: 'unused-legacy-signature' },
    ] } }], usageMetadata: { totalTokenCount: 42 } } });
    expect(store.get(record.id)?.response).toEqual({ candidates: [{ content: { parts: [
      { text: '生成完成' }, {},
    ] } }], usageMetadata: { totalTokenCount: 42 } });
  });

  it('strips nested credentials, signed URL tokens, inline media and hidden reasoning while bounding snapshots', () => {
    const cleaned = JSON.stringify(sanitizeRecordValue({ headers: { cookie: 'session=private', Authorization: 'Bearer secret' }, SecretKey: 'cos-secret', token: 'private-token', url: 'https://user:password@example.com/a?access_token=secret&signature=private&width=320', image: 'data:image/png;base64,verylong', data: { type: 'data', data: 'base64-payload' }, reasoning: 'private thought', prompt: [{ type: 'reasoning', text: 'hidden thought' }], oversized: 'x'.repeat(400_000) }));
    expect(cleaned).not.toMatch(/session=private|Bearer secret|user:password|access_token|signature=private|hidden thought|private thought|verylong|cos-secret|private-token|base64-payload/);
    expect(cleaned.length).toBeLessThan(40_000);
    expect(cleaned).toContain('已截断');
  });
});

describe('real request-record HTTP endpoints', () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    server = createServer((request, response) => { void requestRecordsApi(store, request, response); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/request-records`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it('returns paginated data and safe details, persists settings, and rejects invalid filters and methods', async () => {
    const record = begin('audio');
    const list = await fetch(`${base}?type=audio&page=1&pageSize=1`);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(await list.json()).toMatchObject({ total: 1, items: [{ id: record.id, type: 'audio' }] });
    expect((await fetch(`${base}/${record.id}`)).status).toBe(200);
    expect((await fetch(`${base}/missing`)).status).toBe(404);
    expect((await fetch(`${base}?type=unknown`)).status).toBe(400);
    expect((await fetch(`${base}?from=2026-10-22&to=2026-10-20`)).status).toBe(400);
    expect((await fetch(base, { method: 'POST' })).status).toBe(405);
    const settings = await fetch(`${base}/retention`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, days: 7 }) });
    expect(await settings.json()).toEqual({ enabled: false, days: 7 });
    expect(await (await fetch(`${base}/retention`)).json()).toEqual({ enabled: false, days: 7 });
  });
});
