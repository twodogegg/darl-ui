import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MediaRuntime } from './media-runtime';

export async function handleMediaRequest(request: IncomingMessage, response: ServerResponse, runtime: MediaRuntime): Promise<boolean> {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (!path.startsWith('/api/media-jobs') && path !== '/api/media-runtime-settings') return false;
  const send = (status: number, data: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  if (path === '/api/media-runtime-settings') {
    if (request.method === 'GET') { send(200, runtime.settings()); return true; }
    if (request.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const input of request) {
        const bytes = Buffer.from(input);
        size += bytes.length;
        if (size > 20_000) { send(413, { error: '配置过大' }); return true; }
        chunks.push(bytes);
      }
      try { send(200, runtime.setSettings(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch (reason) { send(400, { error: reason instanceof Error ? reason.message : '配置格式不正确' }); }
      return true;
    }
    send(405, { error: '请求方法不受支持' }); return true;
  }
  if (request.method !== 'GET') { send(405, { error: '生成任务只能由 Agent Tool 提交' }); return true; }
  if (path === '/api/media-jobs') {
    const value = new URL(request.url || '/', 'http://localhost').searchParams.get('projectId');
    const id = value ? Number(value) : undefined;
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) { send(400, { error: '项目编号无效' }); return true; }
    send(200, runtime.list(id)); return true;
  }
  const file = path.match(/^\/api\/media-jobs\/([a-f0-9-]+)\/results\/(\d+)$/);
  if (file) {
    try {
      const result = runtime.result(file[1], Number(file[2]));
      if (!result) { send(404, { error: '媒体结果不存在' }); return true; }
      response.writeHead(200, { 'Content-Type': result.mime, 'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      response.end(result.data);
    } catch { send(404, { error: '媒体文件无法读取' }); }
    return true;
  }
  const job = path.match(/^\/api\/media-jobs\/([a-f0-9-]+)$/);
  if (job) {
    const result = runtime.get(job[1]);
    send(result ? 200 : 404, result || { error: '任务不存在' });
    return true;
  }
  send(404, { error: '接口不存在' });
  return true;
}
