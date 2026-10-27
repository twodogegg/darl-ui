import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Private snapshots may be revalidated, but must never be served stale without checking. */
export function sendRevalidatedJson(request: IncomingMessage, response: ServerResponse, value: unknown) {
  const body = JSON.stringify(value);
  const etag = `W/"${createHash('sha256').update(body).digest('hex')}"`;
  const unchanged = request.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
  response.writeHead(unchanged ? 304 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private,no-cache', ETag: etag });
  response.end(unchanged ? undefined : body);
}
