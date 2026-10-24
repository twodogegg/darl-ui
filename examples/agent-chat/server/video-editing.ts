import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileStore } from './file-storage';
import { composeVideo } from './video-processing';
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

const fileIdFromUrl = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('视频来源无效');
  const match = value.match(/^\/api\/files\/([a-f0-9-]+)(?:\?.*)?$/);
  if (!match) throw new Error('只能剪辑已保存到文件服务的视频');
  return match[1];
};

function selectionsFromInput(value: unknown): Selection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) throw new Error('请选择 1–80 个视频片段');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 个视频片段无效`);
    const source = item as Record<string, unknown>;
    const start = Number(source.start ?? 0);
    const end = source.end === undefined || source.end === null || source.end === '' ? undefined : Number(source.end);
    if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) throw new Error(`第 ${index + 1} 个视频的裁剪区间无效`);
    return { fileId: fileIdFromUrl(source.url), start, ...(end === undefined ? {} : { end }) };
  });
}

export class VideoEditing {
  constructor(private readonly files: FileStore) {}

  async compose(input: Record<string, unknown>, signal: AbortSignal) {
    const ratio = typeof input.ratio === 'string' && /^\d+:\d+$/.test(input.ratio) ? input.ratio : '16:9';
    return composeVideo(this.files, selectionsFromInput(input.selections), ratio, signal);
  }
}

export async function handleVideoEditingRequest(req: IncomingMessage, res: ServerResponse, service: VideoEditing) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/video-editing/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '仅允许本机或局域网' }); return true; }
  if (req.method !== 'POST' || url.pathname !== '/api/video-editing/compose') { send(405, { error: '不支持的操作' }); return true; }
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try { send(200, await service.compose(await readBody(req), controller.signal)); }
  catch (error) { send(controller.signal.aborted ? 499 : 422, { error: error instanceof Error ? error.message : '视频合成失败' }); }
  return true;
}
