// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { callMcpToolWithRetry, createApi, findAttachedImageForUpload, isRetryableMcpError, mcpResultError } from '../examples/agent-chat/server/api';

async function withApi(directory: string, promptFile: string, test: (request: (path: string, body?: unknown, method?: string) => Promise<Response>) => Promise<void>) {
  const middleware = createApi(directory, {}, promptFile);
  const server = createServer((request, response) => { void middleware(request, response, () => { response.writeHead(404); response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await test((path, body, method = body ? 'POST' : 'GET') => new Promise<Response>((resolve, reject) => {
      const req = httpRequest(`http://127.0.0.1:${port}/api/${path}`, { method, headers: { Host: '127.0.0.1:5197', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    }));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
function dbJson<T>(directory: string, key: string): T {
  const database = new DatabaseSync(join(directory, 'data.sqlite'));
  const row = database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string };
  database.close();
  return JSON.parse(row.value) as T;
}

describe('Agent configuration API', () => {
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
          expect.objectContaining({ name: 'builtin_generate_media' }),
        ]));
        expect(await (await request('approval-settings')).json()).toEqual({ mode: 'auto' });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists approval modes, rejects invalid updates and refuses stale chat policies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-approval-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        for (const mode of ['ask', 'auto', 'full']) {
          expect(await (await request('approval-settings', { mode })).json()).toEqual({ mode });
          expect(await (await request('approval-settings')).json()).toEqual({ mode });
        }
        expect((await request('approval-settings', { mode: ['full'] })).ok).toBe(false);
        expect(await (await request('approval-settings')).json()).toEqual({ mode: 'full' });
        expect((await request('chat', { approvalMode: 'ask', messages: [] })).status).toBe(409);
      });
      await withApi(directory, promptFile, async (request) => {
        expect(await (await request('approval-settings')).json()).toEqual({ mode: 'full' });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists a conversation Agent and refuses switching it in a chat request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-bound-agent-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async request => {
        const sessions = [{ id: 'one', agentId: 'art', title: '会话', messages: [] }];
        expect((await request('state', { sessions, skills: [], activeId: 'one' })).ok).toBe(true);
        expect((await (await request('state')).json()).sessions).toEqual(sessions);
        const denied = await request('chat', { sessionId: 'one', agentId: 'writer', messages: [{ role: 'user', content: '你好' }] });
        expect(denied.status).toBe(409);
        expect((await denied.json()).error).toContain('Agent 已固定');
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps safe MCP error details visible while masking credentials', () => {
    expect(mcpResultError({ content: [{ type: 'text', text: 'Asset Hub API 404: asset 不存在或无权访问' }] })).toBe('Asset Hub API 404: asset 不存在或无权访问');
    expect(mcpResultError({ content: [{ type: 'text', text: 'request ahk_private failed' }] }, 'ahk_private')).toBe('request [已隐藏] failed');
    expect(mcpResultError({ content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }], structuredContent: { code: 'ASSET_NOT_FOUND' } })).toContain('第二段');
    expect(mcpResultError({ content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }], structuredContent: { code: 'ASSET_NOT_FOUND' } })).toContain('ASSET_NOT_FOUND');
  });

  it('reports a missing image attachment instead of dereferencing undefined', () => {
    const tool = { _meta: { 'darl-ui/image-input': { kind: 'data-url', fields: { assetId: 'assetId', dataUrl: 'dataUrl', fileName: 'fileName' } } } };
    expect(() => findAttachedImageForUpload(tool, { assetId: 'asset-1' }, [])).toThrow('缺少可上传的图片附件');
  });

  it('retries transient read-only MCP failures without retrying writes', async () => {
    expect(isRetryableMcpError(Object.assign(new Error('HTTP 401'), { status: 401 }))).toBe(false);
    expect(isRetryableMcpError(Object.assign(new Error('HTTP 503'), { status: 503 }))).toBe(true);
    expect(isRetryableMcpError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
    const readCall = vi.fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'HTTP 503 temporary failure' }], isError: true })
      .mockResolvedValueOnce({ content: [], isError: false });
    const readConnection = { app: { id: 'catalog', name: 'Catalog', url: 'https://example.test/mcp', readOnlyTools: ['read'] }, call: readCall } as never;
    const readTool = { name: 'read', inputSchema: { type: 'object' as const } };
    const attempts: number[] = [];
    const retries: number[] = [];
    expect((await callMcpToolWithRetry(readConnection, readTool, {}, new AbortController().signal, { onAttempt: (attempt) => attempts.push(attempt), onRetry: (attempt) => retries.push(attempt) })).isError).toBe(false);
    expect(readCall).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([1, 2]);
    expect(retries).toEqual([2]);

    const writeCall = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'failure' }], isError: true });
    const writeConnection = { app: { id: 'catalog', name: 'Catalog', url: 'https://example.test/mcp' }, call: writeCall } as never;
    const writeTool = { name: 'write', inputSchema: { type: 'object' as const } };
    expect((await callMcpToolWithRetry(writeConnection, writeTool, {}, new AbortController().signal)).isError).toBe(true);
    expect(writeCall).toHaveBeenCalledTimes(1);

    const notFoundCall = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'HTTP 404 not found' }], isError: true });
    const notFoundConnection = { app: { id: 'catalog', name: 'Catalog', url: 'https://example.test/mcp', readOnlyTools: ['read'] }, call: notFoundCall } as never;
    expect((await callMcpToolWithRetry(notFoundConnection, readTool, {}, new AbortController().signal)).isError).toBe(true);
    expect(notFoundCall).toHaveBeenCalledTimes(1);

    const abortedController = new AbortController();
    const transientCall = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'HTTP 503 temporary failure' }], isError: true });
    const transientConnection = { app: { id: 'catalog', name: 'Catalog', url: 'https://example.test/mcp', readOnlyTools: ['read'] }, call: transientCall } as never;
    const pending = callMcpToolWithRetry(transientConnection, readTool, {}, abortedController.signal);
    setTimeout(() => abortedController.abort(), 5);
    await expect(pending).rejects.toBeDefined();
    expect(transientCall).toHaveBeenCalledTimes(1);
  });

  it('persists, updates and deletes server-managed Agents without exposing keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-agents-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const agent = { id: 'art', name: '美术 Agent', instructions: '只负责美术任务', isDefault: true, providerId: 'darl', modelId: 'legacy-model' };
        const saved = await request('agents', { agent });
        expect(saved.status).toBe(200);
        const savedBody = await saved.json();
        expect(savedBody).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'art', isDefault: true })]));
        expect(JSON.stringify(savedBody)).not.toContain('apiKey');
        const stored = dbJson<Array<Record<string, unknown>>>(directory, 'agents').find((item) => item.id === 'art');
        expect(stored).toMatchObject({ id: 'art', name: '美术 Agent', instructions: '只负责美术任务' });
        expect(stored).not.toHaveProperty('providerId');
        expect(stored).not.toHaveProperty('modelId');
        const updated = await request('agents', { agent: { ...agent, name: '美术 Agent v2', enabled: false } });
        expect((await updated.json()).find((item: { id: string }) => item.id === 'art')).toMatchObject({ name: '美术 Agent v2', enabled: false });
        const removed = await request('agents/art', undefined, 'DELETE');
        expect(await removed.json()).toEqual([expect.objectContaining({ id: 'default', builtIn: true })]);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('returns a stable structured validation error with a requestId', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-agent-errors-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const response = await request('chat', { messages: [] });
        const body = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatchObject({ code: 'VALIDATION_FAILED', stage: 'validation', retryable: false });
        expect(body.error.requestId).toEqual(expect.any(String));
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
        expect((await request('state', { sessions: [], skills: [] })).ok).toBe(true);
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

  it('persists chat state and media tasks in the local database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-local-state-'));
    const promptFile = join(directory, 'system.md');
    await writeFile(promptFile, '默认提示词');
    try {
      await withApi(directory, promptFile, async (request) => {
        const state = { sessions: [{ id: 's1', title: '小说', messages: [] }], activeId: 's1', skills: [] };
        const skill = { id: 'skill-1', name: '编剧', description: '按场次写作', instructions: '按场次输出', version: '1.0' };
        expect((await request('skills', { skill })).ok).toBe(true);
        expect((await request('state', state)).status).toBe(200);
        const restored = await (await request('state')).json();
        expect(restored.sessions).toEqual(state.sessions);
        expect(restored.activeId).toBe(state.activeId);
        expect(restored.skills.map((item: { id: string }) => item.id)).toEqual(['builtin:skill-creator', 'skill-1']);
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
