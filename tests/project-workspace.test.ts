// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { handleWorkspaceProjectRequest } from '../examples/agent-chat/server/projects';
import { FileStore } from '../examples/agent-chat/server/file-storage';

let server: Server;
let root: string;
let store: ProjectStore;
let dbPath: string;
let base: string;
let validImage: Buffer;

beforeEach(async () => {
  validImage ??= await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
  root = mkdtempSync(join(tmpdir(), 'darl-workspace-'));
  const storage = new LocalStorage(root);
  dbPath = storage.path;
  store = new ProjectStore(dbPath, new FileStore(dbPath));
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
    expect(new ProjectStore(dbPath, new FileStore(dbPath)).list()).toHaveLength(1);
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
    const form = new FormData();
    form.append('image', new Blob([Uint8Array.from(validImage)], { type: 'image/png' }), 'cover.png');
    const uploaded = await request('projects/' + id + '/covers/upload', { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.data.data.file_id;
    const select = await request('projects/' + id + '/covers/files/' + fileId + '/select', { method: 'POST' });
    expect(select.status).toBe(200);
    expect(select.data.data.cover_asset.file_id).toBe(fileId);
    expect(select.data.data.cover_asset.thumbnail_url).toMatch(/^\/api\/files\/[a-f0-9-]+\?width=320$/);
    expect(select.data.data).not.toHaveProperty('cover_asset_id');
    expect(select.data.data).not.toHaveProperty('cover_url');
    expect(new FileStore(dbPath).get(fileId)?.id).toBe(fileId);
    expect(new FileStore(dbPath).references(fileId)).toBe(true);
  });

  it('rejects corrupt image bytes before storing them', async () => {
    const id = (await createProject()).data.data.project_id;
    const form = new FormData();
    form.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'corrupt.png');
    const response = await request('projects/' + id + '/covers/upload', { method: 'POST', body: form });
    expect(response.status).toBe(422);
    expect(response.data.error).toContain('图片内容损坏');
    expect(new FileStore(dbPath).list()).toHaveLength(0);
  });

  it('keeps a shared cover file and deletes it after the last reference moves away', async () => {
    const first = (await createProject('第一封面')).data.data.project_id;
    const second = (await createProject('共享封面')).data.data.project_id;
    const bytes = validImage;
    const other = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 1 } } }).png().toBuffer();
    const upload = async (id: number, value: Buffer, name: string) => {
      const form = new FormData();
      form.append('image', new Blob([Uint8Array.from(value)], { type: 'image/png' }), name);
      return (await request(`projects/${id}/covers/upload`, { method: 'POST', body: form })).data.data.file_id as string;
    };
    const firstFile = await upload(first, bytes, 'first.png');
    const sharedFile = await upload(second, bytes, 'shared.png');
    expect(sharedFile).toBe(firstFile);
    await request(`projects/${first}/covers/files/${firstFile}/select`, { method: 'POST' });
    await request(`projects/${second}/covers/files/${sharedFile}/select`, { method: 'POST' });
    const replacement = await upload(first, other, 'replacement.png');
    await request(`projects/${first}/covers/files/${replacement}/select`, { method: 'POST' });
    const files = new FileStore(dbPath);
    expect(files.get(firstFile)).toBeDefined();
    expect(files.references(firstFile)).toBe(true);
    await request(`projects/${second}/covers/files/${replacement}/select`, { method: 'POST' });
    expect(files.get(firstFile)).toBeUndefined();
  });

  it('allows creating custom style and no longer exposes retired storage routes', async () => {
    const form = new FormData();
    form.set('name', '我的写实风格');
    form.set('prompt', '自然光，真实肤色');
    const saved = await request('styles', { method: 'POST', body: form });
    expect(saved.status).toBe(201);
    const id = saved.data.data.id;
    expect((await request('styles')).data.data.items.some((style: { id: number }) => style.id === id)).toBe(true);
    expect((await request('projects/1/script')).status).toBe(404);
    expect((await request('storage/%2Fsecret.png')).status).toBe(404);
    expect((await request('storage/styles/16')).status).toBe(404);
    expect((await request('storage/covers/1')).status).toBe(404);
  });

  it('allows updating an owned style but protects built-in styles', async () => {
    const form = new FormData();
    form.set('name', '我的风格');
    form.set('prompt', '原始描述');
    form.set('reference_image', new Blob([Uint8Array.from(validImage)], { type: 'image/png' }), 'style.png');
    const saved = await request('styles', { method: 'POST', body: form });
    const id = saved.data.data.id;
    const update = new FormData();
    update.set('name', '更新后的风格');
    update.set('prompt', '更新后的描述');
    update.set('reference_image', new Blob([Uint8Array.from(validImage)], { type: 'image/png' }), 'style-2.png');
    expect((await request(`styles/${id}`, { method: 'PATCH', body: update })).status).toBe(200);
    const styles = (await request('styles')).data.data.items as Array<{ id: number; name: string; prompt: string }>;
    expect(styles.find((style) => style.id === id)).toMatchObject({ name: '更新后的风格', prompt: '更新后的描述' });
    const updatedStyle = (await request('styles')).data.data.items.find((style: { id: number }) => style.id === id);
    expect(updatedStyle.image_url).toMatch(/^\/api\/files\/[a-f0-9-]+$/);
    expect(updatedStyle.thumbnail_url).toMatch(/^\/api\/files\/[a-f0-9-]+\?width=320$/);
    const builtIn = new FormData();
    builtIn.set('name', '不应修改');
    builtIn.set('prompt', '不应修改');
    expect((await request('styles/1', { method: 'PATCH', body: builtIn })).status).toBe(404);
  });
});
