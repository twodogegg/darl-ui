import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';
import { ProjectStore } from './project-store';
import { isLocalOrLanAddress } from './local-access';

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readLimited(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, '上传内容超过 12MB 限制');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers['content-type'] || '').startsWith('application/json'))
    throw new RequestError(415, '请求内容必须为 JSON');
  try { return JSON.parse((await readLimited(request)).toString('utf8')); }
  catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'JSON 格式无效');
  }
}

async function checkImage(type: string, bytes: Buffer) {
  if (!allowedTypes.has(type) || !bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new RequestError(422, '只接受不超过 10MB 的 PNG、JPG 或 WebP 图片');
  const valid = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : type === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new RequestError(422, '图片文件与格式不一致');
  try { await sharp(bytes).stats(); }
  catch { throw new RequestError(422, '图片内容损坏，无法读取'); }
}

async function readUpload(request: IncomingMessage, field: string, required: boolean) {
  const type = request.headers['content-type'] || '';
  if (!type.startsWith('multipart/form-data;')) throw new RequestError(415, '请使用表单上传');
  let form: FormData;
  try {
    const body = await readLimited(request);
    form = await new Request('http://localhost/upload', { method: 'POST',
      headers: { 'Content-Type': type }, body: Uint8Array.from(body).buffer as ArrayBuffer }).formData();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, '上传表单格式无效');
  }
  const file = form.get(field);
  if ((!file || typeof file === 'string') && required) throw new RequestError(422, '请选择图片');
  if (!file || typeof file === 'string') return { form };
  const bytes = Buffer.from(await file.arrayBuffer());
  await checkImage(file.type, bytes);
  return { form, image: { type: file.type, bytes } };
}

function numeric(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new RequestError(400, '编号无效');
  return n;
}

/** First-phase single-user local SQLite API; Tools/Agents never bypass the main chat runtime. */
export async function handleWorkspaceProjectRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: ProjectStore,
): Promise<boolean> {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (!path.startsWith('/api/workspace/')) return false;
  const send = (status: number, data: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  if (!isLocalOrLanAddress(request.socket.remoteAddress)) {
    send(403, { error: '本地项目数据只允许本机或同一局域网访问' });
    return true;
  }

  const method = request.method || 'GET';
  try {
    if (path === '/api/workspace/styles' && method === 'GET') {
      send(200, { code: 'OK', data: store.styles() }); return true;
    }
    if (path === '/api/workspace/styles' && method === 'POST') {
      const { form, image: file } = await readUpload(request, 'reference_image', false);
      const name = form.get('name'), prompt = form.get('prompt');
      if (typeof name !== 'string' || typeof prompt !== 'string')
        throw new RequestError(422, '请填写风格名称和描述');
      const style = await store.createStyle({ name, prompt, image: file?.bytes, mimeType: file?.type });
      send(201, { code: 'CREATED', data: style }); return true;
    }
    const styleRoute = path.match(/^\/api\/workspace\/styles\/(\d+)$/);
    if (styleRoute && method === 'PATCH') {
      const { form, image: file } = await readUpload(request, 'reference_image', false);
      const name = form.get('name'), prompt = form.get('prompt');
      if (typeof name !== 'string' || typeof prompt !== 'string')
        throw new RequestError(422, '请填写风格名称和描述');
      const style = await store.updateStyle(numeric(styleRoute[1]), { name, prompt, image: file?.bytes, mimeType: file?.type });
      if (!style) throw new RequestError(404, '只能编辑自己的风格');
      send(200, { code: 'OK', data: style }); return true;
    }
    if (path === '/api/workspace/projects' && method === 'GET') {
      const items = store.list();
      send(200, { code: 'OK', data: { items, total: items.length } }); return true;
    }
    if (path === '/api/workspace/projects' && method === 'POST') {
      const project = store.create(ProjectStore.validate(await readJson(request)));
      send(201, { code: 'CREATED', data: project }); return true;
    }
    const project = path.match(/^\/api\/workspace\/projects\/(\d+)$/);
    if (project) {
      const id = numeric(project[1]);
      if (method === 'GET') {
        const value = store.get(id);
        if (!value) throw new RequestError(404, '项目不存在');
        send(200, { code: 'OK', data: value }); return true;
      }
      if (method === 'PATCH') {
        const value = store.update(id, ProjectStore.validate(await readJson(request)));
        if (!value) throw new RequestError(404, '项目不存在');
        send(200, { code: 'OK', data: value }); return true;
      }
      if (method === 'DELETE') {
        if (!store.archive(id)) throw new RequestError(404, '项目不存在');
        send(200, { code: 'OK', data: { project_id: id } }); return true;
      }
    }
    const upload = path.match(/^\/api\/workspace\/projects\/(\d+)\/covers\/upload$/);
    if (upload && method === 'POST') {
      const file = (await readUpload(request, 'image', true)).image;
      if (!file) throw new RequestError(422, '请选择图片');
      const value = await store.uploadCover(numeric(upload[1]), file.type, file.bytes);
      if (!value) throw new RequestError(404, '项目不存在');
      send(201, { code: 'CREATED', data: value }); return true;
    }
    const selectFile = path.match(/^\/api\/workspace\/projects\/(\d+)\/covers\/files\/([a-f0-9-]+)\/select$/);
    if (selectFile && method === 'POST') {
      const file = store.files?.get(selectFile[2]);
      if (!file) throw new RequestError(404, '封面文件不存在');
      const value = await store.selectCoverFile(numeric(selectFile[1]), file);
      if (!value) throw new RequestError(404, '项目不存在');
      send(200, { code: 'OK', data: value }); return true;
    }
    send(404, { error: '未提供该项目接口' });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : error instanceof SyntaxError ? 400 : 422;
    send(status, { error: error instanceof Error ? error.message : '项目操作失败' });
  }
  return true;
}
