// @vitest-environment node
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../examples/agent-chat/server/api';

let server: Server;
let root: string;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'darl-default-agent-'));
  const handler = createApi(root, {}, resolve('examples/agent-chat/prompts/system.md'));
  server = createServer((request, response) => {
    void handler(request, response, () => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  base = 'http://127.0.0.1:' + address.port;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const target = new URL(base + path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((done, fail) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: target.pathname,
      method,
      headers: {
        // The local service expects its configured Host port even when CI uses a random listen port.
        Host: '127.0.0.1:5197',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => {
        try { done({ status: response.statusCode || 0, body: JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch (error) { fail(error); }
      });
    });
    request.on('error', fail);
    request.end(payload);
  });
}

describe('default Agent selection in episode breakdown', () => {
  it('exposes the built-in Agent and accepts it for analysis without a separately saved Agent', async () => {
    const agents = await call('/api/agents');
    expect(agents.status).toBe(200);
    const builtIn = agents.body.find((agent: { id: string }) => agent.id === 'default');
    expect(builtIn).toMatchObject({ id: 'default', name: '网站助手', builtIn: true, enabled: true, isDefault: true });

    const project = await call('/api/workspace/projects', 'POST', {
      name: '默认 Agent 测试', style_catalog_id: 4, aspect_ratio: '9:16',
    });
    expect(project.status).toBe(201);
    const projectId = project.body.data.project_id;
    const episode = await call('/api/workspace/projects/' + projectId + '/episodes', 'POST', { title: '第 01 集' });
    expect(episode.status).toBe(201);
    const episodeId = episode.body.data.id;
    const saved = await call('/api/workspace/episodes/' + episodeId + '/script', 'PUT', {
      script: '人物走进房间，说：你好。', scriptRevision: 0,
    });
    expect(saved.status).toBe(200);

    // No key has been supplied: the request should reach provider validation, not reject the default Agent.
    const analysis = await call('/api/workspace/episodes/' + episodeId + '/analyze', 'POST', {
      agentId: 'default', scriptRevision: 1,
    });
    expect(analysis.status).toBe(422);
    expect(analysis.body.error).toContain('API Key');
    expect((await call('/api/workspace/episodes/' + episodeId)).body.data.episode.script).toBe('人物走进房间，说：你好。');
  });
});
