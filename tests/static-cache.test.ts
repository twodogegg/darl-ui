// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { immutableAssets } from '../examples/agent-chat/server/static-cache';

/** 用与 Vite preview 相同的方式写头（setHeader + 隐式发头），验证缓存头被改写。 */
async function headersFor(path: string) {
  const middleware = immutableAssets();
  const server = createServer((request, response) => middleware(request, response, () => {
    response.setHeader('Content-Type', 'text/javascript');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Vary', 'Origin');
    response.end('body');
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
    const response = await fetch(url);
    await response.text();
    return response.headers;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('static asset caching', () => {
  it('makes hashed bundles immutable and drops Vary so shared caches can store them', async () => {
    const headers = await headersFor('/assets/index-CKngtBwB.js');
    expect(headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(headers.has('Vary')).toBe(false);
  });

  it('leaves the HTML entry point cacheable-but-revalidated', async () => {
    const headers = await headersFor('/');
    expect(headers.get('Cache-Control')).toBe('no-cache');
    expect(headers.get('Vary')).toBe('Origin');
  });
});
