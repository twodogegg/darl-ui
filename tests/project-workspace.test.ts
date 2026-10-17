import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { handleWorkspaceProjectRequest } from '../examples/agent-chat/server/projects';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function request(path: string, options?: RequestInit) {
  const server = createServer((req, res) => {
    void handleWorkspaceProjectRequest(req, res, {}).then((handled) => {
      if (!handled) { res.statusCode = 404; res.end(); }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
  return { status: response.status, result: await response.json() };
}

describe('workspace project API bridge', () => {
  it('requires server credentials and does not pretend to create a project', async () => {
    const response = await request('/api/workspace/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '电影', aspect_ratio: '9:16', style_catalog_id: 1 }),
    });
    expect(response.status).toBe(503);
    expect(response.result.error).toContain('PROJECT_API_TOKEN');
  });
  it('rejects unsupported business routes', async () => {
    const response = await request('/api/workspace/projects/1/script');
    expect(response.status).toBe(404);
  });
  it('rejects encoded traversal in private storage paths', async () => {
    const response = await request('/api/workspace/storage/%2e%2e/secret.png');
    expect(response.status).toBe(400);
  });
});
