import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 为 dev / preview 服务端的 API 响应补充 gzip。
 *
 * Vite 静态产物本身会压缩，但 `createApi` 等中间件写出的 JSON 未压缩；通过隧道或慢速上行链路访问时，
 * 未压缩的 `/api/state` 可达数百 KB，首屏会被上行带宽拖到数十秒。这里只压缩一次性完成的响应，
 * 跳过流式响应（NDJSON / SSE）和已经压缩过的内容，避免破坏流式交付。
 */
const COMPRESSIBLE = /^(?:application\/(?:json|javascript|xml)|text\/)/i;
const STREAMING = /^(?:application\/x-ndjson|text\/event-stream)/i;
const MIN_SIZE = 1024;

function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers['accept-encoding'];
  return typeof header === 'string' && /\bgzip\b/i.test(header);
}

export function gzipApiResponses() {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith('/api/') || !acceptsGzip(request)) return next();

    const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
    const flushHeaders = response.flushHeaders.bind(response);
    const write = response.write.bind(response);
    const end = response.end.bind(response);

    let headArgs: unknown[] | undefined;
    let headFlushed = false;
    let decided = false;
    let compress = false;
    const chunks: Buffer[] = [];

    const flushHead = (extraHeaders: Record<string, string | number> = {}) => {
      if (headFlushed) return;
      headFlushed = true;
      const args = headArgs ?? [response.statusCode];
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        writeHead(...args.slice(0, -1), { ...(last as Record<string, string>), ...extraHeaders });
      } else {
        writeHead(...args, extraHeaders);
      }
    };

    const decide = () => {
      if (decided) return compress;
      decided = true;
      const headers = (headArgs?.[headArgs.length - 1] ?? {}) as Record<string, unknown>;
      const type = String(headers['Content-Type'] ?? headers['content-type'] ?? response.getHeader('content-type') ?? '');
      const encoding = headers['Content-Encoding'] ?? headers['content-encoding'] ?? response.getHeader('content-encoding');
      const length = Number(headers['Content-Length'] ?? headers['content-length'] ?? response.getHeader('content-length') ?? 0);
      const status = Number(headArgs?.[0] ?? response.statusCode);
      compress = !headFlushed && status !== 204 && status !== 304 && COMPRESSIBLE.test(type) && !STREAMING.test(type) && !encoding && (length === 0 || length >= MIN_SIZE);
      return compress;
    };

    response.writeHead = ((...args: unknown[]) => {
      headArgs = args;
      return response;
    }) as typeof response.writeHead;

    response.flushHeaders = () => {
      // Explicit flushing starts a stream; preserve its headers and bypass buffering.
      decided = true;
      compress = false;
      flushHead();
      flushHeaders();
    };

    response.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      if (!decide()) {
        flushHead();
        return write(chunk as never, encoding as never, callback as never);
      }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, (encoding as BufferEncoding) || 'utf8'));
      if (typeof callback === 'function') (callback as () => void)();
      return true;
    }) as typeof response.write;

    response.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
      const done = typeof chunk === 'function' ? (chunk as () => void) : typeof callback === 'function' ? (callback as () => void) : undefined;
      const body = typeof chunk === 'function' ? undefined : chunk;
      if (!decide()) {
        flushHead();
        return body === undefined ? end(done as never) : end(body as never, encoding as never, done as never);
      }
      if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body as string, (encoding as BufferEncoding) || 'utf8'));
      const gzipped = gzipSync(Buffer.concat(chunks));
      const headers = (headArgs?.[headArgs.length - 1] ?? {}) as Record<string, unknown>;
      const patched: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (/^(?:content-length|content-encoding|vary)$/i.test(key)) continue;
        patched[key] = value as string | number;
      }
      patched['Content-Encoding'] = 'gzip';
      patched.Vary = 'Accept-Encoding';
      patched['Content-Length'] = gzipped.length;
      headArgs = headArgs ? [...headArgs.slice(0, -1), patched] : [response.statusCode, patched];
      flushHead();
      return end(gzipped, done as never);
    }) as typeof response.end;

    next();
  };
}
