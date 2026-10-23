import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { LocalStorage } from './storage';
import { isLocalOrLanAddress } from './local-access';
import { requestFailureStatus, type RequestRecordStore } from './request-records';

import { defaultVoiceSettings, type VoiceSettings } from '../voice-config';
export { defaultVoiceSettings, type VoiceSettings } from '../voice-config';
type StoredVoiceSettings = VoiceSettings & { apiKey?: string };
const MAX_AUDIO = 25 * 1024 * 1024;
export type TimedTranscript = { text: string; language: string; segments: Array<{ text: string; start: number; end: number }> };

/** Video analysis needs source-language timing; chat dictation keeps its existing text-only contract. */
export async function transcribeVideoAudio(storage: LocalStorage, env: Record<string, string>, bytes: Buffer, language: string, signal: AbortSignal, records?: RequestRecordStore): Promise<TimedTranscript> {
  const settings = storage.getConfig<StoredVoiceSettings>('voiceConfiguration');
  const key = settings?.apiKey || env.FISH_API_KEY;
  if (!key) throw new Error('有声原片需要先在设置 → 语音配置 Fish Audio API Key，或明确选择仅分析画面');
  if (!bytes.length || bytes.length > MAX_AUDIO) throw new Error('原片音轨为空或超过 25 MB');
  if (language && !/^[a-z]{2}$/.test(language)) throw new Error('原片语言应为两位语言代码或留空自动识别');
  const form = new FormData();
  form.set('audio', new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }), 'source.wav');
  form.set('ignore_timestamps', 'false'); form.set('diarize', 'true'); form.set('tag_audio_events', 'false');
  if (language) form.set('language', language);
  const record = records?.begin({ type: 'audio', modelId: 'transcribe-1-pro', modelName: 'Fish 原片转写', providerId: 'fish', providerName: 'Fish Audio', method: 'POST', url: 'https://api.fish.audio/v1/asr', parameters: { language, ignore_timestamps: false, size: bytes.length } });
  try {
    const response = await fetch('https://api.fish.audio/v1/asr', { method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, model: 'transcribe-1-pro' }, body: form });
    if (!response.ok) throw new Error(`Fish Audio 转写 HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.text !== 'string' || !Array.isArray(data.segments)) throw new Error('转写接口未返回文本和时间戳');
    const segments = data.segments.map((segment: Record<string, unknown>) => {
      if (typeof segment.text !== 'string' || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || Number(segment.start) < 0 || Number(segment.end) < Number(segment.start)) throw new Error('转写时间戳无效');
      return { text: segment.text, start: Number(segment.start), end: Number(segment.end) };
    });
    const result = { text: data.text, language: String(data.language_code || data.language || language), segments };
    if (record) records!.finish(record.id, { status: 'success', text: result.text, response: result });
    return result;
  } catch (error) {
    if (record) records!.finish(record.id, { status: requestFailureStatus(error, signal), error: error instanceof Error ? error.message : '转写失败' });
    throw error;
  }
}

/** Keep full guidance out of repeated requests; compact rules remain available each turn. */
export function loadVoiceGuide(promptFile: string) {
  const guide = JSON.parse(readFileSync(join(dirname(promptFile), 'voice-tags.json'), 'utf8')) as { title: string; summary: string; instructions: string[]; source: string };
  if ([guide.title, guide.summary, guide.source].some((value) => typeof value !== 'string' || !value.trim()) || !Array.isArray(guide.instructions) || !guide.instructions.length || guide.instructions.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('语音标签指南配置无效');
  const content = [guide.title, guide.summary, ...guide.instructions, guide.source].join('\n\n');
  return { summary: guide.summary, content, version: createHash('sha256').update(content).digest('hex') };
}

export function voiceGuideForTurn(storage: LocalStorage, scope: string, guide: ReturnType<typeof loadVoiceGuide>) {
  const key = `voiceGuide:${scope}`;
  return {
    instructions: storage.getConfig<string>(key) === guide.version ? guide.summary : guide.content,
    // Commit only after the model completes; cancelled or failed requests retry the full guide.
    markLoaded: () => storage.setConfig(key, guide.version),
  };
}

export function validateVoiceSettings(value: unknown): VoiceSettings {
  const item = value as Partial<VoiceSettings> | null;
  if (!item || typeof item.enabled !== 'boolean' || !['s2.1-pro-free', 's2.1-pro', 's2-pro'].includes(item.ttsModel || '') || typeof item.voiceId !== 'string' || (item.voiceId !== '' && !/^[a-f\d]{32}$/i.test(item.voiceId)) || typeof item.voiceName !== 'string' || item.voiceName.length > 200 || typeof item.speed !== 'number' || !Number.isFinite(item.speed) || item.speed < 0.5 || item.speed > 2) throw new Error('语音设置无效');
  return { enabled: item.enabled, ttsModel: item.ttsModel!, voiceId: item.voiceId, voiceName: item.voiceName, speed: item.speed };
}

async function readBytes(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('语音请求超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function voiceCatalogParams(search: URLSearchParams) {
  const page = Math.min(100, Math.max(1, Math.floor(Number(search.get('page')) || 1)));
  const query = search.get('q')?.trim().slice(0, 100);
  const language = search.get('language') ?? 'zh';
  const sort = search.get('sort') || 'score';
  if (language && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) throw new Error('音色语言无效');
  if (!['score', 'task_count', 'created_at'].includes(sort)) throw new Error('音色排序无效');
  const tags = [...new Set(search.getAll('tag').map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 20 || tags.some((tag) => tag.length > 80)) throw new Error('音色标签过多或过长');
  const params = new URLSearchParams({ page_size: '20', page_number: String(page), sort_by: sort });
  if (query) params.set('title', query);
  if (language) params.set('language', language);
  tags.forEach((tag) => params.append('tag', tag));
  return params;
}

export function voiceSampleUrl(samples: unknown): string | undefined {
  if (!Array.isArray(samples)) return;
  for (const sample of samples) {
    if (typeof sample?.audio !== 'string') continue;
    try {
      const url = new URL(sample.audio);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* Skip absent or malformed sample URLs. */ }
  }
}

export function createVoiceApi(storage: LocalStorage, env: Record<string, string>, records?: RequestRecordStore) {
  const load = (): StoredVoiceSettings => ({ ...defaultVoiceSettings, ...storage.getConfig<StoredVoiceSettings>('voiceConfiguration') });
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/voice/')) return false;
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(data));
    };
    if (!isLocalOrLanAddress(request.socket.remoteAddress)) { send(403, { error: '语音服务仅允许本机或局域网访问' }); return true; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.on('close', abort);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    let recordId: string | undefined;
    try {
      const settings = load();
      const key = settings.apiKey || env.FISH_API_KEY || '';
      if (url.pathname === '/api/voice/settings') {
        if (request.method === 'GET') {
          const { apiKey: _secret, ...publicSettings } = settings;
          send(200, { ...publicSettings, hasApiKey: Boolean(key) });
          return true;
        }
        if (request.method !== 'POST') { send(405, { error: '不支持的请求方式' }); return true; }
        const body = JSON.parse((await readBytes(request, 10_000)).toString('utf8'));
        if (body.apiKey !== undefined) {
          const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
          if (!['127.0.0.1', '::1'].includes(address || '')) { send(403, { error: 'API Key 只能在本机配置' }); return true; }
          if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 500 || /[\r\n]/.test(body.apiKey)) throw new Error('Fish API Key 无效');
        }
        const next: StoredVoiceSettings = { ...validateVoiceSettings(body), ...(settings.apiKey ? { apiKey: settings.apiKey } : {}), ...(body.apiKey ? { apiKey: body.apiKey.trim() } : {}) };
        storage.setConfig('voiceConfiguration', next);
        const { apiKey: _secret, ...publicSettings } = next;
        send(200, { ...publicSettings, hasApiKey: Boolean(next.apiKey || env.FISH_API_KEY) });
        return true;
      }
      if (!key) { send(400, { error: '请先在设置 → 语音中配置 Fish Audio API Key' }); return true; }
      const upstream = async (path: string, init: RequestInit = {}) => {
        const result = await fetch(`https://api.fish.audio${path}`, { ...init, signal, redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${key}` } });
        if (!result.ok) {
          await result.body?.cancel();
          const hint = result.status === 401 ? 'API Key 无效' : result.status === 402 ? '余额或所选模型权限不足' : result.status === 429 ? '并发限制，请稍后重试' : '请稍后重试';
          throw new Error(`Fish Audio HTTP ${result.status}：${hint}`);
        }
        return result;
      };
      if (url.pathname === '/api/voice/voices' && request.method === 'GET') {
        const params = voiceCatalogParams(url.searchParams);
        const result = await (await upstream(`/model?${params}`)).json();
        if (!Array.isArray(result.items)) throw new Error('Fish 没有返回音色目录');
        const strings = (items: unknown) => Array.isArray(items) ? items.filter((value): value is string => typeof value === 'string').slice(0, 20).map((value) => value.slice(0, 80)) : [];
        const voices = result.items.filter((item: { _id?: string; title?: string; type?: string; state?: string }) => item.type === 'tts' && item.state === 'trained' && /^[a-f\d]{32}$/i.test(item._id || '') && typeof item.title === 'string').map((item: { _id: string; title: string; description?: string; tags?: unknown; languages?: unknown; samples?: unknown }) => ({ id: item._id, name: item.title.slice(0, 200), description: typeof item.description === 'string' ? item.description.slice(0, 1000) : '', tags: strings(item.tags), languages: strings(item.languages), previewUrl: voiceSampleUrl(item.samples) }));
        send(200, { voices, hasMore: result.has_more ?? Number(params.get('page_number')) * 20 < result.total });
        return true;
      }
      if (url.pathname === '/api/voice/transcribe' && request.method === 'POST') {
        const mime = request.headers['content-type']?.split(';')[0] || '';
        const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac' };
        if (!extensions[mime]) throw new Error('请上传支持的音频文件');
        const bytes = await readBytes(request, MAX_AUDIO);
        if (!bytes.length) throw new Error('录音为空，请重新录制');
        if (records) {
          recordId = records.begin({ type: 'audio', modelId: 'transcribe-1-pro', modelName: 'Fish 语音识别', providerId: 'fish', providerName: 'Fish Audio', method: 'POST', url: 'https://api.fish.audio/v1/asr', parameters: { model: 'transcribe-1-pro', mimeType: mime, size: bytes.length } }).id;
          const file = await records.files.put(bytes, mime, `recording.${extensions[mime]}`);
          const record = records.get(recordId)!;
          records.put({ ...record, references: [records.media(file.id, 'audio')] });
        }
        const form = new FormData();
        form.set('audio', new Blob([Uint8Array.from(bytes)], { type: mime }), `recording.${extensions[mime]}`);
        form.set('ignore_timestamps', 'true');
        form.set('tag_audio_events', 'false');
        form.set('diarize', 'false');
        const result = await (await upstream('/v1/asr', { method: 'POST', headers: { model: 'transcribe-1-pro' }, body: form })).json();
        if (typeof result.text !== 'string') throw new Error('Fish 没有返回转写文字');
        const text = result.text.replace(/<\|speaker:\d+\|>/g, '').trim();
        if (!text) throw new Error('没有识别到语音，请重新录制');
        if (recordId) records!.finish(recordId, { status: 'success', text, response: { text } });
        send(200, { text });
        return true;
      }
      if (url.pathname === '/api/voice/speech' && request.method === 'POST') {
        const body = JSON.parse((await readBytes(request, 20_000)).toString('utf8'));
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new Error('语音文案为空或超过 2000 字');
        const voiceId = body.voiceId || settings.voiceId;
        if (typeof voiceId !== 'string' || !/^[a-f\d]{32}$/i.test(voiceId)) throw new Error('请先选择音色');
        const parameters = { text: body.text, reference_id: voiceId, format: 'pcm', sample_rate: 24000, prosody: { speed: settings.speed }, latency: 'balanced' };
        if (records) recordId = records.begin({ type: 'audio', modelId: settings.ttsModel, modelName: settings.ttsModel, providerId: 'fish', providerName: 'Fish Audio', method: 'POST', url: 'https://api.fish.audio/v1/tts', parameters }).id;
        const result = await upstream('/v1/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', model: settings.ttsModel }, body: JSON.stringify(parameters) });
        if (!result.body) throw new Error('Fish 音频响应为空');
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Audio-Sample-Rate': '24000', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.flushHeaders();
        let size = 0;
        const chunks: Buffer[] = [];
        const reader = result.body.getReader();
        try { while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          signal.throwIfAborted();
          size += chunk.byteLength;
          if (size > MAX_AUDIO) throw new Error('语音输出超过大小限制');
          if (records) chunks.push(Buffer.from(chunk));
          if (!response.write(chunk)) await once(response, 'drain', { signal });
        }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (!size) throw new Error('Fish 没有返回音频');
        if (recordId && records) {
          const pcm = Buffer.concat(chunks);
          const header = Buffer.alloc(44);
          header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
          header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
          header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
          header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
          const file = await records.files.put(Buffer.concat([header, pcm]), 'audio/wav', 'speech.wav');
          records.finish(recordId, { status: 'success', text: body.text, results: [records.media(file.id, 'audio')], response: { sampleRate: 24000, size } });
        }
        response.end();
        return true;
      }
      send(404, { error: '语音接口不存在' });
    } catch (reason) {
      if (recordId) records!.finish(recordId, { status: requestFailureStatus(reason, signal), error: reason instanceof Error ? reason.message : String(reason) });
      if (!controller.signal.aborted) {
        if (response.headersSent) response.destroy();
        else send(400, { error: reason instanceof Error && reason.message.startsWith('Fish Audio HTTP') ? reason.message : signal.aborted ? '语音请求超时，请重试' : reason instanceof Error && !/fetch|network|json/i.test(reason.message) ? reason.message : '语音请求失败，请检查网络和设置' });
      }
    } finally { response.off('close', abort); controller.abort(); }
    return true;
  };
}
