// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { createApi } from '../examples/agent-chat/server/api';

async function withApi(directory: string, promptFile: string, test: (request: (path: string, body?: unknown, method?: string) => Promise<Response>) => Promise<void>, env: Record<string, string> = {}) {
  const middleware = createApi(directory, env, promptFile);
  const server = createServer((request, response) => { void middleware(request, response, () => { response.writeHead(404); response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await test((path, body, method = body ? 'POST' : 'GET') => new Promise<Response>((resolve, reject) => {
      const req = httpRequest(`http://127.0.0.1:${port}/api/${path}`, { method, headers: { Host: '127.0.0.1:5197', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    }));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await middleware.dispose(); }
}
function dbJson<T>(directory: string, key: string): T {
  const database = new DatabaseSync(join(directory, 'data.sqlite'));
  const row = database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string };
  database.close();
  return JSON.parse(row.value) as T;
}

describe('Agent configuration API', () => {
  it('uses the configured SQLite file without modifying the previous database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-database-switch-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    const previous = new LocalStorage(directory);
    previous.setConfig('sentinel', '旧库数据');
    try {
      await withApi(directory, promptFile, async request => {
        expect((await request('workflow-agents')).ok).toBe(true);
        const current = new LocalStorage(directory, 'new-data.sqlite');
        expect(current.getConfig('sentinel')).toBeUndefined();
        expect(previous.getConfig('sentinel')).toBe('旧库数据');
        expect(current.getConfig('modelConfiguration')).toBeDefined();
      }, { AGENT_CHAT_DB_PATH: 'new-data.sqlite' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });


  it('persists chat sessions and approval settings alongside workflow configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-no-chat-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async request => {
        for (const path of ['agents', 'state', 'agent-settings', 'studio-agent-buttons']) {
          expect((await request(path)).status).toBe(404);
          expect((await request(path, {})).status).toBe(404);
        }
        expect(await (await request('sessions')).json()).toEqual([]);
        const session = { id: 'test-session', title: '测试', messages: [{ id: 'message', role: 'user', content: '你好' }] };
        expect((await request('sessions/test-session', { session, version: 0 }, 'PUT')).status).toBe(200);
        expect((await (await request('sessions/test-session')).json()).session).toEqual(session);
        expect((await request('sessions/test-session', { session, version: 0 }, 'PUT')).status).toBe(409);
        expect((await (await request('approval-settings', { mode: 'ask' })).json()).mode).toBe('ask');
        expect((await (await request('approval-settings')).json()).mode).toBe('ask');
        expect((await request('workflow-agents')).ok).toBe(true);
        expect((await request('skills?summary=1')).ok).toBe(true);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('exposes the actual runtime schemas alongside media tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-runtime-tools-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const tools = await (await request('tools')).json() as Array<Record<string, unknown>>;
        expect(tools).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'builtin_load_skill', risk: 'read', appId: 'builtin:runtime' }),
          expect.objectContaining({ name: 'builtin_run_command', risk: 'write', inputSchema: expect.objectContaining({ required: ['command'] }) }),
          expect.objectContaining({ name: 'builtin_read_studio', risk: 'read' }),
        ]));
        expect(tools.some(tool => tool.name === 'builtin_request_user_input')).toBe(false);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists model configuration separately from provider credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-model-config-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const initial = await request('model-config');
        expect(initial.status).toBe(200);
        const configuration = await initial.json() as { models: Array<{ id: string }>; version: number };
        configuration.models.push({ id: 'test' });
        const invalid = await request('model-config', { configuration });
        expect(invalid.status).toBe(400);
        const valid = await request('model-config', { configuration: await (await request('model-config')).json() });
        expect(valid.status).toBe(200);
        expect(JSON.stringify(dbJson(directory, 'modelConfiguration'))).not.toContain('apiKey');
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists the Agents page media defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-default-media-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const initial = await request('default-models');
        expect(await initial.json()).toEqual({
          image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' },
          video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' },
        });
        const saved = await request('default-models', { selection: { image: { modelId: 'gpt-image-2', resolution: '4K', aspectRatio: '9:16' }, video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' } } });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toMatchObject({ image: { resolution: '4K', aspectRatio: '9:16' } });
        expect(dbJson(directory, 'defaultMediaModels')).toMatchObject({ image: { resolution: '4K', aspectRatio: '9:16' } });
        expect((await request('default-models', { selection: { image: { modelId: 'gpt-image-2', resolution: '8K', aspectRatio: '16:9' }, video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' } } })).status).toBe(400);
        expect((await request('default-models', { selection: { image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' }, video: { modelId: 'minimax-h3-standard', resolution: '1080P', aspectRatio: '16:9' } } })).status).toBe(400);
        expect((await request('default-models', { selection: { image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' }, video: { modelId: 'minimax-h3-standard', resolution: '768P', aspectRatio: '21:9' } } })).status).toBe(200);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('migrates persisted H3 default resolutions without changing the selected model, image settings or ratio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-default-media-migration-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    const storage = new LocalStorage(directory);
    try {
      for (const [modelId, resolution] of [['minimax-h3-flash', '480'], ['minimax-h3-standard', '768']]) {
        const legacy = { image: { modelId: 'gpt-image-2.5', resolution: '2K', aspectRatio: '9:16' }, video: { modelId, resolution, aspectRatio: '16:9' } };
        const expected = { ...legacy, video: { ...legacy.video, resolution: `${resolution}P` } };
        storage.setConfig('defaultMediaModels', legacy);
        await withApi(directory, promptFile, async request => {
          const response = await request('default-models');
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual(expected);
          expect(dbJson(directory, 'defaultMediaModels')).toEqual(expected);
          expect((await request('default-models', { selection: legacy })).status).toBe(400);
        });
        await withApi(directory, promptFile, async request => {
          expect(await (await request('default-models')).json()).toEqual(expected);
        });
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('migrates legacy Skills and protects the default creator from state autosaves and edits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-skill-migration-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    const storage = new LocalStorage(directory);
    storage.setConfig('clientState', { sessions: [], skills: [{ id: 'legacy', name: '旧技能', instructions: '保留原始数据' }] });
    try {
      await withApi(directory, promptFile, async request => {
        const list = await (await request('skills')).json();
        expect(list.map((item: { id: string }) => item.id)).toEqual(['builtin:skill-creator', 'legacy']);
        expect(list[0].resources.some((item: { path: string }) => item.path === 'scripts/quick_validate.py')).toBe(true);
        expect((await request('skills', { skill: { ...list[0], instructions: '篡改默认技能' } })).status).toBe(400);
        expect((await request('skills/builtin%3Askill-creator', undefined, 'DELETE')).status).toBe(400);
        expect((await request('skills', { skill: { ...list[0], favorite: true, allowImplicitInvocation: false, version: '1.1' } })).ok).toBe(true);
      });
      await withApi(directory, promptFile, async request => {
        const list = await (await request('skills')).json();
        expect(list.map((item: { id: string }) => item.id)).toEqual(['builtin:skill-creator', 'legacy']);
        expect(list[0].favorite).toBe(true);
        expect(list[0].allowImplicitInvocation).toBe(false);
        expect(list[0].version).toBe('1.1');
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists Skills and media tasks in the local database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-local-state-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const skill = { id: 'skill-1', name: '编剧', description: '按场次写作', instructions: '按场次输出', version: '1.0' };
        expect((await request('skills', { skill })).ok).toBe(true);
        expect((await (await request('skills')).json()).map((item: { id: string }) => item.id)).toEqual(['builtin:skill-creator', 'skill-1']);
        expect(dbJson<unknown[]>(directory, 'skills')).toHaveLength(1);
        expect((await request('skills/skill-1', undefined, 'DELETE')).ok).toBe(true);
        expect((await (await request('skills')).json()).map((item: { id: string }) => item.id)).toEqual(['builtin:skill-creator']);
        const tasks = [{ id: 'task-1', title: '第一集', batches: [] }];
        expect((await request('media-tasks', { tasks })).status).toBe(200);
        expect(await (await request('media-tasks')).json()).toEqual(tasks);
        const database = new DatabaseSync(join(directory, 'data.sqlite'));
        expect((database.prepare('SELECT COUNT(*) AS count FROM media_tasks').get() as { count: number }).count).toBe(1);
        database.close();
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
