// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { sendRevalidatedJson } from '../examples/agent-chat/server/http-cache';

it('returns an empty 304 only for unchanged snapshots and sends changed data', async () => {
  let version = 1;
  const server = createServer((req, res) => sendRevalidatedJson(req, res, { version }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const first = await fetch(url), etag = first.headers.get('etag')!;
    expect(await first.json()).toEqual({ version: 1 });
    const unchanged = await fetch(url, { headers: { 'If-None-Match': etag } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    version++;
    const changed = await fetch(url, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(await changed.json()).toEqual({ version: 2 });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
