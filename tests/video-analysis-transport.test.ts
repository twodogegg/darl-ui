// @vitest-environment node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Agent, fetch } from 'undici';
import { expect, it } from 'vitest';
import { videoAnalysisDispatcher } from '../examples/agent-chat/server/workflow-runtime';

it('keeps a slow HTTP response alive while still respecting cancellation', async () => {
  const server = createServer((_request, response) => { setTimeout(() => response.end('ok'), 1800).unref(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not start');
  const url = `http://127.0.0.1:${address.port}`;
  const shortTimeout = new Agent({ headersTimeout: 100 });
  try {
    await expect(fetch(url, { dispatcher: shortTimeout })).rejects.toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    expect(await (await fetch(url, { dispatcher: videoAnalysisDispatcher })).text()).toBe('ok');
    await expect(fetch(url, { dispatcher: videoAnalysisDispatcher, signal: AbortSignal.timeout(100) })).rejects.toThrow();
  } finally {
    await shortTimeout.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 10000);
