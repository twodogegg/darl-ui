/**
 * MiniMax H3 video contract as published by the New API gateway:
 * `POST /v1/h3/assets` upload, `POST /v1/videos` create, `GET /v1/videos/{id}`
 * poll, `GET /v1/videos/{id}/content` download.
 */
export type H3ModelId = 'minimax-h3-flash' | 'minimax-h3-standard';
export type H3Resolution = '480P' | '768P' | '1080P';
export type H3Ratio = 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
/** Contract status vocabulary; the hosted gateway also answers `in_progress` / `completed`. */
export type H3VideoStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export const H3_MODEL_IDS: H3ModelId[] = ['minimax-h3-flash', 'minimax-h3-standard'];
export const H3_RESOLUTIONS: H3Resolution[] = ['480P', '768P', '1080P'];
export const H3_RATIOS: H3Ratio[] = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const H3_MAX_REFERENCE_IMAGES = 9;
export const H3_MAX_REFERENCE_VIDEOS = 3;
export const H3_MAX_REFERENCE_AUDIOS = 3;
/** Upload limit documented for the asset endpoint; the server may enforce less. */
export const H3_MAX_ASSET_BYTES = 64 * 1024 * 1024;

export interface H3VideoOptions {
  model?: string;
  prompt: string;
  seconds?: number;
  size?: H3Resolution;
  ratio?: H3Ratio;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  firstFrameImage?: string;
  lastFrameImage?: string;
}

export interface H3VideoRequest {
  model: string;
  prompt: string;
  seconds: number;
  size: H3Resolution;
  ratio: H3Ratio;
  images?: string[];
  metadata?: {
    first_frame_image?: string;
    last_frame_image?: string;
    reference_video?: string[];
    reference_audio?: string[];
  };
}

export interface H3AssetDescriptor { id: string; fileName?: string; type?: string; size?: string; expires_in?: number }
export interface H3VideoTask { id: string; status: H3VideoStatus; progress?: number; error?: string }

/** Standard tops out at 768P; flash also accepts 1080P. */
export function h3Resolutions(model: string | undefined): H3Resolution[] {
  return model === 'minimax-h3-standard' ? ['480P', '768P'] : [...H3_RESOLUTIONS];
}

function apiUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = normalizedBase.endsWith('/v1') && path.startsWith('/v1/') ? path.slice(4) : path;
  return new URL(normalizedPath.replace(/^\//, ''), `${normalizedBase}/`).toString();
}

function assertReferences(name: string, values: string[] | undefined, max: number) {
  if (!values) return;
  if (values.length > max) throw new Error(`${name}最多支持 ${max} 个`);
  values.forEach((value) => { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { throw new Error(`${name}必须是公网 HTTP(S) URL`); } });
}

/**
 * Build only documented fields. Only `seconds` is sent so it can never disagree
 * with the deprecated `duration`. A first/last frame cannot be mixed with
 * `images` or reference video/audio, and `adaptive` needs visual input.
 */
export function buildH3VideoRequest(options: H3VideoOptions): H3VideoRequest {
  const prompt = options.prompt?.trim();
  if (!prompt) throw new Error('H3 提示词不能为空');
  const model = options.model || 'minimax-h3-flash';
  const seconds = options.seconds ?? 5;
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) throw new Error('H3 时长只能是 4–15 秒的整数');
  const size = options.size ?? '480P';
  const resolutions = h3Resolutions(model);
  if (!resolutions.includes(size)) throw new Error(`${model === 'minimax-h3-standard' ? 'H3 Standard' : 'H3 Flash'} 分辨率只能是 ${resolutions.join(' / ')}`);
  const ratio = options.ratio ?? '16:9';
  if (!H3_RATIOS.includes(ratio)) throw new Error(`H3 画幅只能是 ${H3_RATIOS.join(' / ')}`);
  assertReferences('参考图片', options.referenceImages, H3_MAX_REFERENCE_IMAGES);
  assertReferences('参考视频', options.referenceVideos, H3_MAX_REFERENCE_VIDEOS);
  assertReferences('参考音频', options.referenceAudios, H3_MAX_REFERENCE_AUDIOS);
  const frames = Boolean(options.firstFrameImage || options.lastFrameImage);
  const references = Boolean(options.referenceImages?.length || options.referenceVideos?.length || options.referenceAudios?.length);
  if (frames && references) throw new Error('首尾帧不能与参考图片或参考音视频同时提交');
  if (ratio === 'adaptive' && !frames && !options.referenceImages?.length && !options.referenceVideos?.length) {
    throw new Error('adaptive 画幅需要提供图片或视频参考素材');
  }
  const request: H3VideoRequest = { model, prompt, seconds, size, ratio };
  if (!frames && options.referenceImages?.length) request.images = [...options.referenceImages];
  const metadata: NonNullable<H3VideoRequest['metadata']> = {};
  if (options.firstFrameImage) metadata.first_frame_image = options.firstFrameImage;
  if (options.lastFrameImage) metadata.last_frame_image = options.lastFrameImage;
  if (options.referenceVideos?.length) metadata.reference_video = [...options.referenceVideos];
  if (options.referenceAudios?.length) metadata.reference_audio = [...options.referenceAudios];
  if (Object.keys(metadata).length) request.metadata = metadata;
  return request;
}

async function h3Response(response: Response, apiKey: string) {
  if (response.ok) return response;
  // New API answers with { error: { message } } or a flat { code, message }; surface the real reason.
  const value = await response.json().catch(() => null) as { error?: { message?: string; http_code?: string }; message?: string } | null;
  const message = value?.error?.message || value?.message || `H3 API 请求失败（HTTP ${response.status}）`;
  throw new Error(message.replaceAll(apiKey, '[已隐藏]'));
}

/** Upload one image/video/audio asset and keep the opaque `id` for the create call. */
export async function uploadH3Asset(baseUrl: string, apiKey: string, file: Blob, fileName: string, signal?: AbortSignal): Promise<H3AssetDescriptor> {
  if (file.size > H3_MAX_ASSET_BYTES) throw new Error('H3 素材不能超过 64 MiB');
  const form = new FormData();
  form.append('file', file, fileName);
  const response = await fetch(apiUrl(baseUrl, '/v1/h3/assets'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as Partial<H3AssetDescriptor>;
  if (typeof value.id !== 'string' || !value.id) throw new Error('H3 素材上传响应缺少 id');
  return {
    id: value.id,
    ...(typeof value.fileName === 'string' ? { fileName: value.fileName } : {}),
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(typeof value.size === 'string' ? { size: value.size } : {}),
    ...(typeof value.expires_in === 'number' ? { expires_in: value.expires_in } : {}),
  };
}

export async function createH3Video(baseUrl: string, apiKey: string, options: H3VideoOptions, signal?: AbortSignal): Promise<{ id: string }> {
  const body = buildH3VideoRequest(options);
  const response = await fetch(apiUrl(baseUrl, '/v1/videos'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as { id?: unknown };
  if (typeof value.id !== 'string' || !value.id) throw new Error('H3 创建响应缺少任务 ID');
  return { id: value.id };
}

/** Accept both the documented `in_progress`/`completed` and the hosted `processing`/`succeeded`. */
export async function getH3Video(baseUrl: string, apiKey: string, taskId: string, signal?: AbortSignal): Promise<H3VideoTask> {
  const response = await fetch(apiUrl(baseUrl, `/v1/videos/${encodeURIComponent(taskId)}`), { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as { id?: unknown; status?: unknown; progress?: unknown; error?: string | { code?: string; message?: string } };
  const status = value.status === 'succeeded' ? 'completed' : value.status === 'processing' ? 'in_progress' : value.status;
  if (value.id !== taskId || !['queued', 'in_progress', 'completed', 'failed'].includes(status as string)) throw new Error('H3 任务状态响应无效');
  const error = value.error ? (typeof value.error === 'string' ? value.error : value.error.message) : undefined;
  return {
    id: taskId,
    status: status as H3VideoStatus,
    ...(typeof value.progress === 'number' && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100 ? { progress: value.progress } : {}),
    ...(error ? { error } : {}),
  };
}

/** Always download through the gateway content route, never through a temporary media URL. */
export async function downloadH3Video(baseUrl: string, apiKey: string, task: H3VideoTask, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (task.status !== 'completed') throw new Error('H3 任务尚未完成');
  const response = await h3Response(await fetch(apiUrl(baseUrl, `/v1/videos/${encodeURIComponent(task.id)}/content`), { headers: { Authorization: `Bearer ${apiKey}` }, signal }), apiKey);
  return response.arrayBuffer();
}
