export type H3Resolution = '480' | '768';
export type H3AspectRatio = '16:9' | '9:16';
/** Status vocabulary actually returned by the unified gateway. */
export type H3VideoStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export interface H3FlashOptions {
  prompt: string;
  seconds?: number;
  resolution?: H3Resolution;
  aspectRatio?: H3AspectRatio;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  referenceVideo?: string;
  mode?: 'text-to-video' | 'reference' | 'first-last-frame';
}

export interface H3FlashRequest {
  model: 'minimax-h3-flash';
  prompt: string;
  seconds: number;
  resolution: H3Resolution;
  aspect_ratio: H3AspectRatio;
  reference_images?: string[];
  reference_videos?: string[];
  reference_audios?: string[];
  reference_video?: string;
}

export interface H3FileDescriptor { id: string; url?: string; purpose?: string }
export interface H3VideoTask { id: string; status: H3VideoStatus; videoUrl?: string; error?: string }

const H3_STATUSES: H3VideoStatus[] = ['queued', 'processing', 'succeeded', 'failed'];

/** The gateway returns relative `video_url` paths; they need the API origin. */
function absolute(baseUrl: string, url: string) {
  return new URL(url, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function apiUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = normalizedBase.endsWith('/v1') && path.startsWith('/v1/') ? path.slice(4) : path;
  return new URL(normalizedPath.replace(/^\//, ''), `${normalizedBase}/`).toString();
}

function assertUrlList(name: string, values: string[] | undefined, max: number) {
  if (!values) return;
  if (values.length > max) throw new Error(`${name} 最多支持 ${max} 个`);
  values.forEach((value) => { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { throw new Error(`${name} 必须是公网 HTTP(S) URL`); } });
}

/** Build only fields documented by the unified H3 Flash contract. */
export function buildH3FlashRequest(options: H3FlashOptions): H3FlashRequest {
  const prompt = options.prompt?.trim();
  if (!prompt) throw new Error('H3 Flash 提示词不能为空');
  const seconds = options.seconds ?? 10;
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) throw new Error('H3 Flash 时长只能是 4–15 秒的整数');
  const resolution = options.resolution ?? '768';
  const aspectRatio = options.aspectRatio ?? '9:16';
  if (resolution !== '480' && resolution !== '768') throw new Error('H3 Flash 分辨率只能是 480 或 768');
  if (aspectRatio !== '16:9' && aspectRatio !== '9:16') throw new Error('H3 Flash 画幅只能是 16:9 或 9:16');
  if (options.mode === 'first-last-frame') throw new Error('H3 Flash 首尾帧字段尚未完成网关核对');
  assertUrlList('参考图片', options.referenceImages, 9);
  assertUrlList('参考视频', options.referenceVideos, 3);
  assertUrlList('参考音频', options.referenceAudios, 3);
  if (options.referenceVideo && options.referenceVideos?.length) throw new Error('reference_video 不能与 reference_videos 同时提交');
  const request: H3FlashRequest = { model: 'minimax-h3-flash', prompt, seconds, resolution, aspect_ratio: aspectRatio };
  if (options.referenceImages?.length) request.reference_images = [...options.referenceImages];
  if (options.referenceVideos?.length) request.reference_videos = [...options.referenceVideos];
  if (options.referenceAudios?.length) request.reference_audios = [...options.referenceAudios];
  if (options.referenceVideo) request.reference_video = options.referenceVideo;
  return request;
}

async function h3Response(response: Response, apiKey: string) {
  if (response.ok) return response;
  // The gateway answers 5xx with a flat { code, message } body instead of OpenAI's { error }.
  const value = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
  const message = value?.error?.message || value?.message || `H3 Flash API 请求失败（HTTP ${response.status}）`;
  throw new Error(message.replaceAll(apiKey, '[已隐藏]'));
}

export async function uploadH3File(baseUrl: string, apiKey: string, file: Blob, fileName: string, purpose?: string, signal?: AbortSignal): Promise<H3FileDescriptor> {
  if (file.size > 100 * 1024 * 1024) throw new Error('H3 Flash 素材不能超过 100 MiB');
  const form = new FormData();
  form.append('file', file, fileName);
  if (purpose) form.append('purpose', purpose);
  const response = await fetch(apiUrl(baseUrl, '/v1/files'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as Partial<H3FileDescriptor>;
  if (typeof value.id !== 'string' || !value.id.startsWith('file_')) throw new Error('H3 Flash 文件上传响应缺少 file_* ID');
  return { id: value.id, ...(typeof value.url === 'string' ? { url: value.url } : {}), ...(typeof value.purpose === 'string' ? { purpose: value.purpose } : {}) };
}

export async function resolveH3File(baseUrl: string, apiKey: string, fileId: string, signal?: AbortSignal): Promise<H3FileDescriptor> {
  if (!/^file_[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('H3 Flash 素材 ID 无效');
  const response = await fetch(apiUrl(baseUrl, `/v1/files/${encodeURIComponent(fileId)}`), { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as Partial<H3FileDescriptor>;
  if (value.id !== fileId || typeof value.url !== 'string' || !/^https?:\/\//.test(value.url)) throw new Error('H3 Flash 文件没有返回可访问的公网 URL');
  return { id: fileId, url: value.url, ...(typeof value.purpose === 'string' ? { purpose: value.purpose } : {}) };
}

export async function createH3Video(baseUrl: string, apiKey: string, options: H3FlashOptions, signal?: AbortSignal): Promise<{ id: string }> {
  const body = buildH3FlashRequest(options);
  const response = await fetch(apiUrl(baseUrl, '/v1/videos'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as { id?: unknown };
  if (typeof value.id !== 'string' || !value.id) throw new Error('H3 Flash 创建响应缺少任务 ID');
  return { id: value.id };
}

export async function getH3Video(baseUrl: string, apiKey: string, taskId: string, signal?: AbortSignal): Promise<H3VideoTask> {
  const response = await fetch(apiUrl(baseUrl, `/v1/videos/${encodeURIComponent(taskId)}`), { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  const value = await h3Response(response, apiKey).then((item) => item.json()) as { id?: unknown; status?: unknown; video_url?: unknown; error?: unknown };
  if (value.id !== taskId || !H3_STATUSES.includes(value.status as H3VideoStatus)) throw new Error('H3 Flash 任务状态响应无效');
  return {
    id: taskId,
    status: value.status as H3VideoStatus,
    ...(typeof value.video_url === 'string' ? { videoUrl: absolute(baseUrl, value.video_url) } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export async function downloadH3Video(baseUrl: string, apiKey: string, task: H3VideoTask, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (task.status !== 'succeeded') throw new Error('H3 Flash 任务尚未完成');
  const contentUrl = task.videoUrl ? new URL(task.videoUrl, `${baseUrl.replace(/\/$/, '')}/`).toString() : apiUrl(baseUrl, `/v1/videos/${encodeURIComponent(task.id)}/content`);
  const response = await h3Response(await fetch(contentUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal }), apiKey);
  return response.arrayBuffer();
}
