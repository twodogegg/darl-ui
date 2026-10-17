import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function upstreamPath(path: string, method: string): string | null {
  if (path === '/api/workspace/styles' && method === 'GET') return '/styles';
  if (path === '/api/workspace/projects' && ['GET', 'POST'].includes(method)) return '/projects';
  const project = path.match(/^\/api\/workspace\/projects\/(\d+)$/);
  if (project && ['GET', 'PATCH', 'DELETE'].includes(method)) return `/projects/${project[1]}`;
  const covers = path.match(/^\/api\/workspace\/projects\/(\d+)\/covers\/upload$/);
  if (covers && method === 'POST') return `/projects/${covers[1]}/covers/upload`;
  const choose = path.match(/^\/api\/workspace\/projects\/(\d+)\/covers\/(\d+)\/select$/);
  if (choose && method === 'POST') return `/projects/${choose[1]}/covers/${choose[2]}/select`;
  return null;
}

async function readLimited(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('上传内容超过 12MB 限制');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

/** Private local-development bridge. The backend owns authentication and all project data. */
export async function handleWorkspaceProjectRequest(
  request: IncomingMessage,
  response: ServerResponse,
  env: Record<string, string>,
): Promise<boolean> {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/workspace/')) return false;
  const reply = (status: number, error: string) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error }));
  };
  const method = request.method || 'GET';
  const storageMatch = url.pathname.match(/^\/api\/workspace\/storage\/(.+)$/);
  if (storageMatch) {
    if (!LOOPBACK.has(request.socket.remoteAddress || '')) {
      reply(403, '仅允许本机访问项目图片'); return true;
    }
    const parts = storageMatch[1].split('/');
    if (method !== 'GET' || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
      reply(400, '图片路径无效'); return true;
    }
    const base = env.PROJECT_API_BASE_URL?.trim();
    const token = env.PROJECT_API_TOKEN?.trim();
    if (!base || !token) { reply(503, '项目服务尚未配置'); return true; }
    try {
      const origin = new URL(base);
      const target = new URL('/storage/' + parts.map(encodeURIComponent).join('/'), origin);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('invalid');
      const result = await fetch(target, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
      });
      if (!result.ok) { reply(result.status, '项目图片加载失败'); return true; }
      const type = result.headers.get('content-type') || '';
      if (!/^image\/(png|jpeg|webp)$/i.test(type)) { reply(502, '图片类型不受支持'); return true; }
      const bytes = Buffer.from(await result.arrayBuffer());
      if (bytes.length > 12 * 1024 * 1024) { reply(502, '图片文件过大'); return true; }
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=120', 'X-Content-Type-Options': 'nosniff' });
      response.end(bytes);
    } catch { reply(502, '无法读取项目图片'); }
    return true;
  }
  const path = upstreamPath(url.pathname, method);
  if (!path) { reply(404, '未提供该项目接口'); return true; }
  if (!LOOPBACK.has(request.socket.remoteAddress || '')) {
    reply(403, '项目 API 的本地开发代理仅允许本机访问'); return true;
  }
  const base = env.PROJECT_API_BASE_URL?.trim();
  const token = env.PROJECT_API_TOKEN?.trim();
  if (!base || !token) {
    reply(503, '请在服务端配置 PROJECT_API_BASE_URL 和 PROJECT_API_TOKEN'); return true;
  }
  let target: URL;
  try {
    target = new URL(path.slice(1), base.replace(/\/+$/, '') + '/');
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
  } catch {
    reply(503, 'PROJECT_API_BASE_URL 配置不合法'); return true;
  }
  try {
    const body = method === 'GET' || method === 'DELETE' ? undefined : await readLimited(request);
    const result = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body?.length ? { 'Content-Type': request.headers['content-type'] || 'application/json' } : {}),
        Accept: 'application/json',
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(25_000),
      redirect: 'error',
    });
    const data = await result.arrayBuffer();
    if (data.byteLength > 2_000_000) throw new Error('后端响应过大');
    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(Buffer.from(data));
  } catch (error) {
    reply(error instanceof Error && error.message.includes('12MB') ? 413 : 502,
      error instanceof Error && error.message.includes('12MB') ? error.message : '无法连接项目后端，请检查服务地址及后端状态');
  }
  return true;
}
