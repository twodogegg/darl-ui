import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileStore } from './file-storage';
import { composeVideo, videoCommand, withVideoFiles } from './video-processing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { isLocalOrLanAddress } from './local-access';

type Selection = { fileId: string; start: number; end?: number };

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1 * 1024 * 1024) throw new Error('剪辑请求超过 1MB');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
};

function selectionsFromInput(value: unknown, files: FileStore): Selection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) throw new Error('请选择 1–80 个视频片段');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 个视频片段无效`);
    const source = item as Record<string, unknown>;
    const start = Number(source.start ?? 0);
    const end = source.end === undefined || source.end === null || source.end === '' ? undefined : Number(source.end);
    if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) throw new Error(`第 ${index + 1} 个视频的裁剪区间无效`);
    const file = files.fromUrl(source.url);
    if (!file || file.mimeType !== 'video/mp4') throw new Error('只能剪辑已保存到文件服务的视频');
    return { fileId: file.id, start, ...(end === undefined ? {} : { end }) };
  });
}

export class VideoEditing {
  private thumbnails = new Map<string, Promise<Buffer>>();
  private thumbnailSlots = 0;
  private thumbnailQueue: Array<() => void> = [];
  constructor(private readonly files: FileStore) {}

  async thumbnail(url: string, start?: number) {
    const file = this.files.fromUrl(url);
    if (!file || file.mimeType !== 'video/mp4') throw new Error('视频文件不存在');
    if (start !== undefined && (!Number.isFinite(start) || start < 0)) throw new Error('首帧时间无效');
    const key = `${file.id}:${start ?? 0}`;
    let pending = this.thumbnails.get(key);
    if (!pending) {
      pending = (async () => {
        if (this.thumbnailSlots >= 2) await new Promise<void>(resolve => this.thumbnailQueue.push(resolve));
        else this.thumbnailSlots++;
        const render = async (path: string, root: string) => {
          const output = join(root, 'first.png');
          await videoCommand('ffmpeg', ['-y', '-ss', String(start ?? 0), '-i', path, '-frames:v', '1', output], AbortSignal.timeout(60_000));
          return sharp(await readFile(output)).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
        };
        try {
          if (start !== undefined && file.backend === 'cos') {
            const root = await mkdtemp(join(tmpdir(), 'darl-thumbnail-'));
            try { return await render(this.files.originalUrl(file)!, root); }
            finally { await rm(root, { recursive: true, force: true }); }
          }
          return await withVideoFiles(this.files, [file.id], ([path], root) => render(path, root));
        } finally { const next = this.thumbnailQueue.shift(); if (next) next(); else this.thumbnailSlots--; }
      })();
      this.thumbnails.set(key, pending);
      pending.catch(() => { if (this.thumbnails.get(key) === pending) this.thumbnails.delete(key); });
      if (this.thumbnails.size > 100) this.thumbnails.delete(this.thumbnails.keys().next().value!);
    }
    return pending;
  }

  async compose(input: Record<string, unknown>, signal: AbortSignal) {
    const ratio = typeof input.ratio === 'string' && /^\d+:\d+$/.test(input.ratio) ? input.ratio : '16:9';
    return composeVideo(this.files, selectionsFromInput(input.selections, this.files), ratio, signal);
  }
}

export async function handleVideoEditingRequest(req: IncomingMessage, res: ServerResponse, service: VideoEditing) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/video-editing/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '仅允许本机或局域网' }); return true; }
  if (req.method === 'GET' && url.pathname === '/api/video-editing/thumbnail') {
    try {
      const bytes = await service.thumbnail(url.searchParams.get('url') || '', url.searchParams.has('start') ? Number(url.searchParams.get('start')) : undefined);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
    } catch { send(404, { error: '视频首帧不可用' }); }
    return true;
  }
  if (req.method !== 'POST' || url.pathname !== '/api/video-editing/compose') { send(405, { error: '不支持的操作' }); return true; }
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try { send(200, await service.compose(await readBody(req), controller.signal)); }
  catch (error) { send(controller.signal.aborted ? 499 : 422, { error: error instanceof Error ? error.message : '视频合成失败' }); }
  return true;
}
