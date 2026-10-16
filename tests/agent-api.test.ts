// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { callMcpToolWithRetry, createApi, isRetryableMcpError, mcpResultError } from '../examples/agent-chat/server/api';

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

describe('Agent configuration API', () => {
  it('keeps safe MCP error details visible while masking credentials', () => {
    expect(mcpResultError({ content: [{ type: 'text', text: 'Asset Hub API 404: asset 不存在或无权访问' }] })).toBe('Asset Hub API 404: asset 不存在或无权访问');
    expect(mcpResultError({ content: [{ type: 'text', text: 'request ahk_private failed' }] }, 'ahk_private')).toBe('request [已隐藏] failed');
    expect(mcpResultError({ content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }], structuredContent: { code: 'ASSET_NOT_FOUND' } })).toContain('第二段');
    expect(mcpResultError({ content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }], structuredContent: { code: 'ASSET_NOT_FOUND' } })).toContain('ASSET_NOT_FOUND');
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
        const agent = { id: 'art', name: '美术 Agent', instructions: '只负责美术任务', providerId: 'darl', modelId: 'deepseek-v4.1-flash', isDefault: true };
        const saved = await request('agents', { agent });
        expect(saved.status).toBe(200);
        const savedBody = await saved.json();
        expect(savedBody).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'art', isDefault: true })]));
        expect(JSON.stringify(savedBody)).not.toContain('apiKey');
        expect(JSON.parse(await readFile(join(directory, 'agents.json'), 'utf8')).find((item: { id: string }) => item.id === 'art')).toMatchObject(agent);
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
});
