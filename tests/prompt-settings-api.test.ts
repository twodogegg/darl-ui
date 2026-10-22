// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApi } from '../examples/agent-chat/server/api';

async function withApi(directory: string, file: string, test: (request: (body?: unknown) => Promise<Response>) => Promise<void>) {
  const middleware = createApi(directory, {}, file);
  const server = createServer((request, response) => { void middleware(request, response, () => { response.writeHead(404); response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prompts`;
  try {
    await test((body) => new Promise<Response>((resolve, reject) => {
      const request = httpRequest(url, { method: body ? 'POST' : 'GET', headers: { Host: '127.0.0.1:5197', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
      });
      request.on('error', reject);
      request.end(body ? JSON.stringify(body) : undefined);
    }));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

describe('Prompt settings API', () => {
  it('返回系统与语音提示词及默认内容，并分别保存', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-prompts-'));
    const system = join(directory, 'system.md');
    try {
      await writeFile(system, '系统默认');
      await writeFile(join(directory, 'voice.md'), '语音默认');
      await withApi(directory, system, async (request) => {
        const initial = await (await request()).json();
        expect(initial).toEqual({ system: '系统默认', voice: '语音默认', defaults: { system: '系统默认', voice: '语音默认' } });

        const saved = await request({ system: '新系统', voice: '新语音' });
        expect(saved.ok).toBe(true);
        expect(await saved.json()).toMatchObject({ system: '新系统', voice: '新语音', defaults: { system: '系统默认', voice: '语音默认' } });

        // 只更新一项不影响另一项
        await request({ voice: '再改语音' });
        expect(await (await request()).json()).toMatchObject({ system: '新系统', voice: '再改语音' });

        // 空值被拒绝
        expect((await request({ system: '   ' })).status).toBe(400);
        expect((await request({ voice: '' })).status).toBe(400);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
