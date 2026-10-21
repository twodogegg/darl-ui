// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { gzipApiResponses } from '../examples/agent-chat/server/http-compress';

async function serve(handle: (response: ServerResponse) => void, check: (url: string) => Promise<void>) {
  const compress = gzipApiResponses();
  const server = createServer((request, response) => compress(request, response, () => handle(response)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('API response compression', () => {
  it.each(['application/octet-stream', 'application/x-ndjson; charset=utf-8', 'text/event-stream'])('preserves explicitly flushed %s headers and delivers chunks immediately', async (type) => {
    let stream!: ServerResponse;
    await serve((response) => {
      stream = response;
      response.writeHead(200, { 'Content-Type': type, 'X-Audio-Sample-Rate': '24000', 'Cache-Control': 'no-store' });
      response.flushHeaders();
    }, async (url) => {
      // Headers must arrive before any body is written.
      const response = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(response.headers.get('Content-Type')).toBe(type);
      expect(response.headers.get('X-Audio-Sample-Rate')).toBe('24000');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Content-Encoding')).toBe(false);
      expect(stream.headersSent).toBe(true);
      const reader = response.body!.getReader();
      try {
        stream.write('first chunk');
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe('first chunk');
        expect(first.done).toBe(false);
        stream.end();
        expect((await reader.read()).done).toBe(true);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    });
  });

  it('still compresses ordinary JSON responses', async () => {
    const body = JSON.stringify({ text: 'compressible response '.repeat(100) });
    await serve((response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(body);
    }, async (url) => {
      const response = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(response.headers.get('Content-Encoding')).toBe('gzip');
      expect(await response.text()).toBe(body);
    });
  });
});
