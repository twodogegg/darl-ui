import { createH3Video, downloadH3Video, getH3Video, resolveH3File, uploadH3File, type H3FlashOptions } from './h3-flash';

export interface MediaConnection { baseUrl: string; apiKey: string; upstreamModelId: string }
export interface ImageOptions {
  prompt: string; count?: number; size?: string; quality?: 'auto' | 'low' | 'medium' | 'high';
  format?: 'png' | 'jpeg' | 'webp'; referenceImages?: Array<{ data: Uint8Array; name: string; mime: string }>;
}
export interface VideoOptions {
  prompt: string; seconds?: number; resolution?: '480' | '768'; aspectRatio?: '9:16' | '16:9';
  referenceImages?: Array<{ data: Uint8Array; name: string; mime: string }>;
}
export interface MediaBinary { data: Buffer; mime: string }
const MAX_IMAGE_DOWNLOAD = 35 * 1024 * 1024;
const MAX_VIDEO_DOWNLOAD = 300 * 1024 * 1024;

function url(base: string, path: string) {
  const value = new URL(base);
  if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password) throw new Error('供应商 URL 不合法');
  const root = base.replace(/\/+$/, '');
  return new URL(path.replace(/^\//, ''), root.endsWith('/v1') ? root + '/' : root + '/v1/').toString();
}

async function checked(response: Response, secret: string, action: string) {
  if (response.ok) return response;
  const error = await response.text().catch(() => '');
  let detail = '';
  try {
    const data = JSON.parse(error);
    detail = String(data.error?.message || data.message || data.detail || '').slice(0, 400);
  } catch { /* Upstream may send non-JSON. */ }
  const reason = (detail || '供应商响应失败').replaceAll(secret, '[已隐藏]');
  const failure = new Error(action + '失败 (HTTP ' + response.status + '): ' + reason) as Error & { status: number };
  failure.status = response.status;
  throw failure;
}

async function limitedBinary(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error('媒体下载失败 (HTTP ' + response.status + ')');
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('生成媒体文件过大');
  const chunks: Buffer[] = [];
  let size = 0;
  if (!response.body) throw new Error('供应商未返回媒体内容');
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > limit) { await reader.cancel().catch(() => {}); throw new Error('生成媒体文件超过大小上限'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function mimeFor(data: Buffer): string {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('供应商返回的图像格式无法识别');
}

function validateImage(input: ImageOptions) {
  if (!input.prompt?.trim() || input.prompt.length > 20000) throw new Error('图片提示词无效');
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('图片数量应为 1-10');
  const size = input.size || '1024x1024';
  if (size !== 'auto') {
    const dimensions = size.match(/^(\d{2,4})x(\d{2,4})$/);
    if (!dimensions) throw new Error('图片尺寸应为 WIDTHxHEIGHT');
    const width = Number(dimensions[1]), height = Number(dimensions[2]);
    if (width < 256 || height < 256 || width > 3840 || height > 3840 || width % 16 || height % 16 || Math.max(width, height) / Math.min(width, height) > 3) throw new Error('图片尺寸不符合网关要求');
  }
  const quality = input.quality || 'auto';
  if (!['auto', 'low', 'medium', 'high'].includes(quality)) throw new Error('画质参数无效');
  const format = input.format || 'png';
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('图片格式无效');
  if ((input.referenceImages || []).length > 16) throw new Error('参考图片最多 16 张');
  return { count, size, quality, format };
}

/** Supports the Darl GPT Image 2 JSON generation and multipart editing contracts. */
export async function generateGptImage2(connection: MediaConnection, input: ImageOptions, signal?: AbortSignal): Promise<MediaBinary[]> {
  const { count, size, quality, format } = validateImage(input);
  const refs = input.referenceImages || [];
  const fields = { model: connection.upstreamModelId, prompt: input.prompt.trim(), size, quality, n: count, output_format: format, response_format: 'b64_json' };
  let response: Response;
  if (refs.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const image of refs) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) throw new Error('参考图类型不支持');
      if (!image.data.length || image.data.length >= 50 * 1024 * 1024) throw new Error('单张参考图不能超过 50MB');
      form.append('image[]', new Blob([Uint8Array.from(image.data)], { type: image.mime }), image.name || 'reference.png');
    }
    response = await fetch(url(connection.baseUrl, 'images/edits'), { method: 'POST', headers: { Authorization: 'Bearer ' + connection.apiKey }, body: form, signal });
  } else {
    response = await fetch(url(connection.baseUrl, 'images/generations'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + connection.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields), signal,
    });
  }
  const result = await (await checked(response, connection.apiKey, '图片生成')).json() as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  if (!Array.isArray(result.data) || !result.data.length || result.data.length > count) throw new Error('图片生成响应缺少有效结果');
  const output: MediaBinary[] = [];
  for (const item of result.data) {
    let bytes: Buffer;
    if (item.b64_json && typeof item.b64_json === 'string') {
      if (item.b64_json.length > MAX_IMAGE_DOWNLOAD * 1.4) throw new Error('图片结果超过大小上限');
      bytes = Buffer.from(item.b64_json, 'base64');
    } else if (item.url && typeof item.url === 'string') {
      const value = new URL(item.url);
      if (value.protocol !== 'https:') throw new Error('供应商返回了非 HTTPS 图片地址');
      bytes = await limitedBinary(await fetch(value, { signal, redirect: 'error' }), MAX_IMAGE_DOWNLOAD);
    } else throw new Error('图片结果没有 b64_json 或 url');
    if (bytes.length > MAX_IMAGE_DOWNLOAD) throw new Error('图片结果超过大小上限');
    output.push({ data: bytes, mime: mimeFor(bytes) });
  }
  return output;
}

/** H3 Flash text-to-video; references use unified /v1/files contract and need live gateway verification. */
export async function submitH3Flash(connection: MediaConnection, input: VideoOptions, signal?: AbortSignal) {
  if (connection.upstreamModelId !== 'minimax-h3-flash') throw new Error('当前视频适配器只支持 minimax-h3-flash');
  const refs: string[] = [];
  for (const image of input.referenceImages || []) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) throw new Error('视频参考图格式不支持');
    const uploaded = await uploadH3File(connection.baseUrl, connection.apiKey, new Blob([Uint8Array.from(image.data)], { type: image.mime }), image.name, 'vision', signal);
    const result = await resolveH3File(connection.baseUrl, connection.apiKey, uploaded.id, signal);
    if (!result.url) throw new Error('无法获取可访问参考素材地址');
    refs.push(result.url);
  }
  const options: H3FlashOptions = { prompt: input.prompt,
    seconds: input.seconds ?? 10, resolution: input.resolution ?? '768', aspectRatio: input.aspectRatio ?? '9:16',
    ...(refs.length ? { referenceImages: refs, mode: 'reference' } : { mode: 'text-to-video' }),
  };
  return createH3Video(connection.baseUrl, connection.apiKey, options, signal);
}

export async function inspectH3Flash(connection: MediaConnection, remoteId: string, signal?: AbortSignal) {
  return getH3Video(connection.baseUrl, connection.apiKey, remoteId, signal);
}
export async function saveH3Flash(connection: MediaConnection, remoteId: string, signal?: AbortSignal): Promise<MediaBinary> {
  const task = await getH3Video(connection.baseUrl, connection.apiKey, remoteId, signal);
  const data = Buffer.from(await downloadH3Video(connection.baseUrl, connection.apiKey, task, signal));
  if (!data.length || data.length > MAX_VIDEO_DOWNLOAD) throw new Error('视频产物为空或超过 300MB');
  return { data, mime: 'video/mp4' };
}
