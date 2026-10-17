import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { handleWorkspaceProjectRequest } from '../examples/agent-chat/server/projects';

let server: Server;
let root: string;
let store: ProjectStore;
let dbPath: string;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'darl-workspace-'));
  const storage = new LocalStorage(root);
  dbPath = storage.path;
  store = new ProjectStore(dbPath);
  server = createServer((req, res) => {
    void handleWorkspaceProjectRequest(req, res, store).then((handled) => {
      if (!handled) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  base = 'http://127.0.0.1:' + address.port + '/api/workspace/';
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function request(path: string, options?: RequestInit) {
  const response = await fetch(base + path, options);
  return { status: response.status, data: await response.json() };
}

const createProject = (name = '测试短剧') => request('projects', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, aspect_ratio: '9:16', style_catalog_id: 4, description: '' }),
});

describe('SQLite project workspace', () => {
  it('uses built-in style catalog, not external API credentials or fake project results', async () => {
    const styles = await request('styles');
    expect(styles.status).toBe(200);
    expect(styles.data.data.official_items.some((item: { name: string }) => item.name === '电影感')).toBe(true);
    const created = await createProject();
    expect(created.status).toBe(201);
    expect(created.data.data.project.name).toBe('测试短剧');
    expect(created.data.data.project.episode_count).toBe(0);
    const found = await request('projects');
    expect(found.data.data.items).toHaveLength(1);
    expect(found.data.data.items[0].id).toBe(created.data.data.project_id);
    expect(new ProjectStore(dbPath).list()).toHaveLength(1);
  });

  it('allows updates, then archives a project without affecting other stored state', async () => {
    const created = await createProject();
    const id = created.data.data.project_id;
    const updated = await request('projects/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新版', description: '都市短剧', aspect_ratio: '16:9', style_catalog_id: 3 }),
    });
    expect(updated.status).toBe(200);
    expect(updated.data.data.aspect_ratio).toBe('16:9');
    expect(updated.data.data.description).toBe('都市短剧');
    expect((await request('projects/' + id)).data.data.name).toBe('新版');
    expect((await request('projects/' + id, { method: 'DELETE' })).status).toBe(200);
    expect((await request('projects/' + id)).status).toBe(404);
    expect((await request('projects')).data.data.items).toHaveLength(0);
  });

  it('requires title, selected style and supported aspect ratio', async () => {
    const bad = await request('projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', aspect_ratio: '9:16', style_catalog_id: 4 }),
    });
    expect(bad.status).toBe(422);
    const nonexistent = await request('projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', aspect_ratio: '9:16', style_catalog_id: 200000 }),
    });
    expect(nonexistent.status).toBe(422);
  });

  it('saves optional manually uploaded cover image and makes it visible', async () => {
    const id = (await createProject()).data.data.project_id;
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('image', new Blob([onePixelPng], { type: 'image/png' }), 'cover.png');
    const uploaded = await request('projects/' + id + '/covers/upload', { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const coverId = uploaded.data.data.id;
    const select = await request('projects/' + id + '/covers/' + coverId + '/select', { method: 'POST' });
    expect(select.status).toBe(200);
    expect(select.data.data.cover_asset.storage_key).toBe('covers/' + coverId);
    const image = await fetch(base + 'storage/covers/' + coverId);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(onePixelPng);
  });

  it('allows creating custom style and rejects unsupported routes or encoded storage paths', async () => {
    const form = new FormData();
    form.set('name', '我的写实风格');
    form.set('prompt', '自然光，真实肤色');
    const saved = await request('styles', { method: 'POST', body: form });
    expect(saved.status).toBe(201);
    const id = saved.data.data.id;
    expect((await request('styles')).data.data.items.some((style: { id: number }) => style.id === id)).toBe(true);
    expect((await request('projects/1/script')).status).toBe(404);
    expect((await request('storage/%2Fsecret.png')).status).toBe(404);
  });
});
