// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApi } from '../examples/agent-chat/server/api';

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
});
