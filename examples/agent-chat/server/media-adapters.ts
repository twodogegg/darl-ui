import type { MediaJob } from './media-job-store';
import { createH3Video, getH3Video, downloadH3Video } from './h3-flash';

/** A finished image is either inline bytes or a link. The link IS the result. */
export type MediaImage =
  | { kind: 'url'; url: string; raw: string }
  | { kind: 'b64'; data: Buffer; ext: 'png'|'jpeg'|'webp'|'gif'; raw: string };
/** A provider may answer with inline base64 or with a URL to fetch. Both are valid. */
export type ImageForm = 'b64_json' | 'url';

/** Recommended output sizes: aspect ratio × tier → WIDTHxHEIGHT. */
export const IMAGE_SIZE_TABLE: Record<string, Record<'1K'|'2K'|'4K', string>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '2448x3264' },
  '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '3264x2448' },
  '2:3': { '1K': '672x1008', '2K': '2048x3072', '4K': '2336x3504' },
  '3:2': { '1K': '1008x672', '2K': '3072x2048', '4K': '3504x2336' },
  '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
};

const DIMENSION = /^\d{1,5}x\d{1,5}$/;

/**
 * Resolve the `size` field. An explicit `WIDTHxHEIGHT` always wins; otherwise
 * the recommended table maps aspect ratio + tier. Sizes are not policed — the
 * provider is the authority on what it accepts.
 */
export function imageSize(options: Record<string, unknown>) {
  if (typeof options.size === 'string' && DIMENSION.test(options.size.trim())) return options.size.trim();
  const tier = typeof options.resolution === 'string' && options.resolution in (IMAGE_SIZE_TABLE['1:1'] || {})
    ? options.resolution as '1K'|'2K'|'4K'
    : '2K';
  const ratio = typeof options.aspectRatio === 'string' && IMAGE_SIZE_TABLE[options.aspectRatio] ? options.aspectRatio : '1:1';
  return IMAGE_SIZE_TABLE[ratio][tier];
}

function url(base: string, endpoint: string) {
  return new URL(endpoint.replace(/^\//,''), base.replace(/\/$/,'')+'/').toString();
}
function ensureHttp(base: string) {
  const parsed = new URL(base);
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('供应商地址无效');
}
async function checked(response: Response, key: string) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error('供应商 HTTP '+response.status+': '+body.replaceAll(key,'[REDACTED]').slice(0,800));
    // Keep the raw body so callers can retry against the channel's own limits.
    (error as Error & { body?: string }).body = body;
    throw error;
  }
  return response;
}
function sniffImage(data: Buffer): 'png'|'jpeg'|'webp'|'gif' | undefined {
  const png = data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpeg=data.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
  const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  const gif=data.toString('ascii',0,6)==='GIF87a'||data.toString('ascii',0,6)==='GIF89a';
  return png?'png':jpeg?'jpeg':webp?'webp':gif?'gif':undefined;
}

/**
 * Keep the provider payload almost verbatim. Only the base64 body is elided,
 * because a megabyte of text tells nobody anything.
 */
export function imageResponseRecord(value: unknown, form: ImageForm | 'unknown') {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rows = Array.isArray(result.data) ? result.data : [];
  const data = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const { b64_json: base64, ...rest } = row as Record<string, unknown>;
    return typeof base64 === 'string' ? { ...rest, b64_json: `<base64 ${base64.length} 字符，已保存为文件>` } : rest;
  });
  return { form, ...result, data };
}

/** GPT Image 2 accepts at most 16 reference images. */
export const MAX_REFERENCE_IMAGES = 16;

/** Either a remote link the channel can fetch itself, or inline bytes it cannot. */
export type ImageReference = { url: string } | { name: string; mimeType: string; data: Buffer };

const DATA_URL = /^data:(image\/[\w.+-]+);base64,(.+)$/is;

function sniffMime(data: Buffer) {
  const ext = sniffImage(data);
  return ext === 'png' ? 'image/png' : ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : undefined;
}

/**
 * Accept the reference shapes a host can send: a `data:` URL, an HTTP(S) URL,
 * or `{ url }`. Remote links are passed through so the channel fetches them
 * directly; only local base64 needs re-uploading.
 */
export async function normalizeImageReferences(value: unknown): Promise<ImageReference[] | undefined> {
  if (value === undefined || value === null) return undefined;
  const rows = Array.isArray(value) ? value : [value];
  const picked = rows.flatMap((row) => typeof row === 'string' ? [row] : row && typeof row === 'object' && typeof (row as { url?: unknown }).url === 'string' ? [(row as { url: string }).url] : []);
  if (!picked.length) return undefined;
  if (picked.length > MAX_REFERENCE_IMAGES) throw new Error(`参考图片最多 ${MAX_REFERENCE_IMAGES} 张`);
  return picked.map((source, index) => {
    const inline = DATA_URL.exec(source);
    if (!inline) return { url: source };
    const data = Buffer.from(inline[2], 'base64');
    if (!data.length) throw new Error(`参考图片 ${index + 1} 为空`);
    const mimeType = sniffMime(data) || inline[1].toLowerCase();
    return { name: `reference-${index + 1}.${mimeType.split('/')[1].replace('jpeg', 'jpg')}`, mimeType, data };
  });
}

function requestOptions(options: Record<string, unknown>) {
  const count = Number(options.count ?? 1);
  const fields: Record<string, string> = { n: String(Number.isInteger(count) && count >= 1 ? Math.min(count, 10) : 1) };
  if (typeof options.quality === 'string') fields.quality = options.quality;
  if (typeof options.background === 'string') fields.background = options.background;
  if (typeof options.outputFormat === 'string') fields.output_format = options.outputFormat;
  if (typeof options.responseFormat === 'string') fields.response_format = options.responseFormat;
  return fields;
}

/** JSON body needs a numeric `n`; multipart needs the same value as a form field. */
function jsonOptions(options: Record<string, unknown>) {
  const fields = requestOptions(options);
  return { ...fields, n: Number(fields.n) };
}

/**
 * When a channel rejects `size`, it usually lists what it does accept. Pick the
 * allowed size with the closest aspect ratio, then the closest pixel count.
 */
export function closestAllowedSize(requested: string, allowed: string[]) {
  const parse = (value: string) => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
  };
  const target = parse(requested);
  const candidates = allowed.filter((size) => size !== 'auto').map((size) => ({ size, box: parse(size) })).filter((item): item is { size: string; box: { width: number; height: number } } => Boolean(item.box));
  if (!target) return allowed.find((size) => size !== 'auto') || 'auto';
  if (!candidates.length) return 'auto';
  const targetRatio = target.width / target.height;
  const targetArea = target.width * target.height;
  return candidates.sort((a, b) => {
    const ratioDiff = Math.abs(a.box.width / a.box.height - targetRatio) - Math.abs(b.box.width / b.box.height - targetRatio);
    if (Math.abs(ratioDiff) > 0.001) return ratioDiff;
    return Math.abs(a.box.width * a.box.height - targetArea) - Math.abs(b.box.width * b.box.height - targetArea);
  })[0].size;
}

/** Pull the channel's accepted sizes out of a rejected-size response. */
export function allowedSizesFromError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { metadata?: { allowed?: unknown } } };
    const allowed = parsed.error?.metadata?.allowed;
    return Array.isArray(allowed) && allowed.every((item) => typeof item === 'string') ? allowed as string[] : undefined;
  } catch { return undefined; }
}

function editForm(job: MediaJob, size: string, references: ImageReference[]) {
  const form = new FormData();
  form.set('model', job.upstreamModelId);
  form.set('prompt', job.prompt);
  if (size !== 'auto') form.set('size', size);
  for (const [key, value] of Object.entries(requestOptions(job.options))) form.set(key, value);
  references.forEach((reference) => {
    if (!('url' in reference)) form.append('image[]', new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }), reference.name);
  });
  return form;
}

/** The channel accepts remote links in a JSON body, so a URL reference needs no upload. */
function editJson(job: MediaJob, size: string, references: ImageReference[]) {
  return {
    model: job.upstreamModelId,
    prompt: job.prompt,
    image: references.map((reference) => 'url' in reference ? reference.url : `data:${reference.mimeType};base64,${reference.data.toString('base64')}`),
    ...(size !== 'auto' ? { size } : {}),
    ...jsonOptions(job.options),
  };
}

/** Read one image out of the provider payload. A URL result needs no download. */
async function readImage(value: unknown): Promise<MediaImage> {
  if (!value || typeof value !== 'object') throw new Error('图片结果无效');
  const item = value as { b64_json?: unknown; url?: unknown };
  if (typeof item.url === 'string' && item.url) return { kind: 'url', url: item.url, raw: JSON.stringify(value) };
  if (typeof item.b64_json === 'string' && item.b64_json) {
    const data = Buffer.from(item.b64_json, 'base64');
    const ext = sniffImage(data);
    if (!ext) throw new Error('图片内容无效（无法识别 PNG/JPEG/WebP/GIF）');
    return { kind: 'b64', data, ext, raw: JSON.stringify(value) };
  }
  throw new Error('图片结果既不包含 b64_json 也不包含 url');
}

/**
 * Generate or edit an image. References decide the endpoint: no references use
 * `/images/generations`, references use the multipart `/images/edits`.
 */
export async function generateImages(job: MediaJob, key: string): Promise<{ images: MediaImage[]; provider: unknown }> {
  ensureHttp(job.baseUrl);
  const size = imageSize(job.options);
  const references = await normalizeImageReferences(job.options.references);
  const request = (requestedSize: string) => references?.length
    ? fetch(url(job.baseUrl, 'images/edits'), references.some((reference) => 'url' in reference)
        ? { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(editJson(job, requestedSize, references)), signal: AbortSignal.timeout(180000) }
        : { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: editForm(job, requestedSize, references), signal: AbortSignal.timeout(180000) })
    : fetch(url(job.baseUrl, 'images/generations'), {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: job.upstreamModelId, prompt: job.prompt, size: requestedSize, ...jsonOptions(job.options) }),
        signal: AbortSignal.timeout(180000),
      });
  let response: Response;
  let usedSize = size;
  try {
    response = await checked(await request(size), key);
  } catch (error) {
    // A channel that rejects `size` usually lists what it accepts. Use it instead
    // of failing a request the user already paid for.
    const body = (error as Error & { body?: string }).body || '';
    const allowed = allowedSizesFromError(body);
    const fallback = allowed ? closestAllowedSize(size, allowed) : undefined;
    if (!fallback || fallback === size) throw error;
    usedSize = fallback;
    response = await checked(await request(fallback), key);
  }
  const text = await response.text();
  let payload: { data?: unknown[] };
  try { payload = JSON.parse(text) as { data?: unknown[] }; }
  catch { throw new Error(`供应商返回的不是 JSON：${text.slice(0, 800)}`); }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) throw new Error(`供应商没有返回图片；原始返回 ${JSON.stringify(imageResponseRecord(payload, 'unknown'))}`);
  const images: MediaImage[] = [];
  for (const [index, row] of rows.entries()) {
    try { images.push(await readImage(row)); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`第 ${index + 1} 张：${reason}；原始返回 ${JSON.stringify(imageResponseRecord(payload, 'unknown'))}`);
    }
  }
  return { images, provider: { requestedSize: size, usedSize, ...imageResponseRecord(payload, images[0]?.kind === 'url' ? 'url' : 'b64_json') } };
}

/** Single-image convenience wrapper used by callers that only keep one result. */
export async function generateImage(job: MediaJob, key: string) {
  const { images } = await generateImages(job, key);
  return images[0];
}

export async function submitVideo(job:MediaJob,key:string):Promise<string>{
  ensureHttp(job.baseUrl);
  if(job.options.references)throw new Error('H3 参考素材上传协议尚未实测，不允许直接提交');
  const result=await createH3Video(job.baseUrl,key,{
    prompt:job.prompt, seconds:Number(job.options.duration??10),
    resolution:(job.options.resolution ?? '768') as '480'|'768',
    aspectRatio:(job.options.aspectRatio ?? '9:16') as '16:9'|'9:16',
    mode:'text-to-video',
  },AbortSignal.timeout(30000));
  return result.id;
}
export async function checkVideo(job:MediaJob,key:string):Promise<{state:'running'|'failed'|'completed';error?:string;media?:Buffer}>{
  if(!job.remoteTaskId)throw new Error('视频远端编号未保存');
  ensureHttp(job.baseUrl);
  const remote=await getH3Video(job.baseUrl,key,job.remoteTaskId,AbortSignal.timeout(30000));
  if(remote.status==='failed')return {state:'failed',error:remote.error||'视频生成失败'};
  if(remote.status==='completed')return {state:'completed',media:Buffer.from(await downloadH3Video(job.baseUrl,key,remote,AbortSignal.timeout(120000)))};
  return {state:'running'};
}
