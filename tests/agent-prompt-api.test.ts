// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-settings`;
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

describe('Markdown prompt persistence', () => {
  it('reads the file on demand, saves exact Markdown, and survives API recreation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-prompt-'));
    const file = join(directory, 'system.md');
    const content = '# 系统提示词\n\n请简短回复。\n';
    try {
      await writeFile(file, '原有指令');
      await withApi(directory, file, async (request) => {
        expect(await (await request()).json()).toEqual({ systemPrompt: '原有指令' });
        const saved = await request({ systemPrompt: content });
        expect(saved.ok).toBe(true);
        expect(await saved.json()).toEqual({ systemPrompt: content });
        expect(await readFile(file, 'utf8')).toBe(content);
        for (const invalid of ['', '   ', null]) expect((await request({ systemPrompt: invalid })).status).toBe(400);
        const longPrompt = 'x'.repeat(100_001);
        expect((await request({ systemPrompt: longPrompt })).status).toBe(200);
        expect(await readFile(file, 'utf8')).toBe(longPrompt);
        expect((await request({ systemPrompt: content })).status).toBe(200);
        expect(await readFile(file, 'utf8')).toBe(content);
      });
      await withApi(directory, file, async (request) => {
        expect(await (await request()).json()).toEqual({ systemPrompt: content });
        await writeFile(file, '直接编辑文件');
        expect(await (await request()).json()).toEqual({ systemPrompt: '直接编辑文件' });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reports missing files and write failures without inventing a default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-prompt-'));
    try {
      await withApi(directory, join(directory, 'missing', 'system.md'), async (request) => {
        const missing = await request();
        expect(missing.status).toBe(400);
        expect(await missing.json()).toHaveProperty('error');
        const saved = await request({ systemPrompt: '有效指令' });
        expect(saved.status).toBe(400);
        expect(await saved.json()).toHaveProperty('error');
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
