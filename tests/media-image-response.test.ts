// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistMediaReferencesInStore, resolveMediaReferencesInStore } from '../examples/agent-chat/server/media-references';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { closestAllowedSize, allowedSizesFromError, geminiImageEndpoint, geminiResponseRecord, generateGeminiImages, imageResponseRecord, imageSize, normalizeImageReferences } from '../examples/agent-chat/server/media-adapters';
import type { MediaJob } from '../examples/agent-chat/server/media-job-store';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const job = (options: Record<string, unknown> = {}, overrides: Partial<MediaJob> = {}): MediaJob => ({
  id: 'job-1', modelId: 'gpt-image-2', type: 'image', prompt: '雨夜街道', options,
  providerId: 'darl', upstreamModelId: 'gpt-image-2', baseUrl: 'https://api.example.test/v1',
  status: 'queued', attempts: 1, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
  ...overrides,
});

function respond(body: unknown, init: { status?: number } = {}) {
  return new Response(typeof body === 'string' || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body), {
    status: init.status ?? 200, headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('image results', () => {
  it('returns a URL result as-is without downloading it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ data: [{ url: 'https://img.example.test/a.png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    const { images } = await generateImages(job(), 'key');
    expect(images[0]).toMatchObject({ kind: 'url', url: 'https://img.example.test/a.png' });
    // One request only: the result link is never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('decodes inline b64_json into bytes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ data: [{ b64_json: PNG.toString('base64') }] })));
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    const { images } = await generateImages(job(), 'key');
    expect(images[0]).toMatchObject({ kind: 'b64', ext: 'png' });
    expect(images[0].kind === 'b64' && images[0].data.equals(PNG)).toBe(true);
  });

  it('keeps every image when the channel returns more than one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ data: [{ url: 'https://a.test/1.png' }, { url: 'https://a.test/2.png' }] })));
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    const { images } = await generateImages(job({ count: 2 }), 'key');
    expect(images).toHaveLength(2);
  });

  it('reports the provider payload when neither field is usable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ data: [{ revised_prompt: '只返回了改写后的提示词' }] })));
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await expect(generateImages(job(), 'key')).rejects.toThrow(/原始返回 .*"revised_prompt":"只返回了改写后的提示词"/);
  });
});

describe('reference storage', () => {
  it('resolves studio file URLs to stored bytes before sending an image edit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darl-media-'));
    const files = new FileStore(join(directory, 'data.sqlite'));
    try {
      const stored = await files.put(PNG, 'image/png', 'reference.png');
      const options = await resolveMediaReferencesInStore({ references: [`/api/files/${stored.id}`, { url: `/api/files/${stored.id}` }] }, files);
      const references = options.references as Array<{ fileId: string }>;
      expect(references.map(item => item.fileId)).toEqual([stored.id, stored.id]);
      const normalized = await normalizeImageReferences(references, 16, async url => {
        const value = await files.getBytes(url.split('/').pop()!);
        return value ? { bytes: value.bytes, mime: value.file.mimeType } : undefined;
      });
      expect(normalized?.every(item => 'data' in item && item.data.equals(PNG))).toBe(true);
      await expect(resolveMediaReferencesInStore({ references: ['/api/files/missing'] }, files)).rejects.toThrow('参考素材文件不存在');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('stores data URLs in the unified file store and reads them back as bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darl-media-'));
    const files = new FileStore(join(directory, 'data.sqlite'));
    try {
      const options = await persistMediaReferencesInStore({ references: [`data:image/png;base64,${PNG.toString('base64')}`] }, files);
      const references = options.references as Array<{ fileId: string; mimeType: string; url: string }>;
      expect(references[0]).toMatchObject({ mimeType: 'image/png' });
      expect(references[0].url).toBe(`/api/files/${references[0].fileId}`);
      expect(files.get(references[0].fileId)).toBeDefined();
      expect(JSON.stringify(options)).not.toContain('base64,');
      const normalized = await normalizeImageReferences(references, 16, async (url) =>
        files.getBytes(url.split('/').pop() || '').then((item) => item ? { bytes: item.bytes, mime: item.file.mimeType } : undefined));
      expect(normalized?.[0]).toMatchObject({ mimeType: 'image/png' });
      expect(normalized?.[0] && 'data' in normalized[0] && normalized[0].data.equals(PNG)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts an uploaded file reference by ID without restoring legacy file paths', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darl-media-'));
    const files = new FileStore(join(directory, 'data.sqlite'), {
      mode: 'cos', region: 'ap-guangzhou', bucket: 'test-1250000000', scheme: 'https',
      publicBaseUrl: 'https://demo.darl.cn', secretId: 'id', secretKey: 'key',
    });
    try {
      // Seed the metadata row for an object already uploaded to COS: retain() is metadata-only in COS mode, so no network is made.
      const stored = files.retain('stored-ref', PNG, 'image/png', 'reference.png');
      const options = await persistMediaReferencesInStore({ references: [{ fileId: stored.id, url: files.originalUrl(stored) }] }, files);
      expect(options.references).toEqual([{ fileId: stored.id, url: files.originalUrl(stored), mimeType: 'image/png', name: 'reference.png' }]);
      expect(files.fromUrl(files.originalUrl(stored))?.id).toBe(stored.id);
      expect(files.fromUrl(`https://other.example/darl-ui/${stored.sha256}.png`)).toBeUndefined();
      const resolved = await resolveMediaReferencesInStore({ references: [files.thumbnailUrl(stored, 320)] }, files);
      expect(resolved.references).toEqual(options.references);
      expect(JSON.stringify(resolved)).not.toContain('imageMogr2');
      await expect(persistMediaReferencesInStore({ references: [{ fileId: 'missing' }] }, files)).rejects.toThrow('参考素材文件不存在');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores a missing reference row from its stored COS URL before rejecting', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darl-media-'));
    // COS-mode store: rebuilding a lost row assumes the object already exists at the canonical key (metadata-only, no upload).
    const files = new FileStore(join(directory, 'data.sqlite'), {
      mode: 'cos', region: 'ap-guangzhou', bucket: 'demo-1253466849', scheme: 'https',
      publicBaseUrl: 'https://demo.darl.cn', secretId: 'id', secretKey: 'key',
    });
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } })));
      const options = await resolveMediaReferencesInStore({ references: [{ fileId: 'restored-id', url: 'https://cdn.example.test/ref.png', name: 'ref.png' }] }, files);
      expect(options.references).toEqual([{ fileId: 'restored-id', url: expect.stringMatching(/^https:\/\/demo\.darl\.cn\/darl-ui\/.+\.png$/), mimeType: 'image/png', name: 'ref.png' }]);
      expect(files.get('restored-id')).toMatchObject({ mimeType: 'image/png', size: PNG.length });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects non-image data URLs and malformed references before writing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darl-media-'));
    const files = new FileStore(join(directory, 'data.sqlite'));
    try {
      await expect(persistMediaReferencesInStore({ references: ['data:text/plain;base64,aGVsbG8='] }, files)).rejects.toThrow('参考素材必须是图片 data URL');
      await expect(persistMediaReferencesInStore({ references: [42] }, files)).rejects.toThrow('参考素材格式无效');
      expect(files.list()).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('reference images', () => {
  it('passes remote links through so the channel fetches them', async () => {
    const refs = await normalizeImageReferences(['https://cdn.example.test/a.png', { url: 'https://cdn.example.test/b.png' }]);
    expect(refs).toEqual([{ url: 'https://cdn.example.test/a.png' }, { url: 'https://cdn.example.test/b.png' }]);
  });

  it('decodes data: URLs for local upload', async () => {
    const refs = await normalizeImageReferences([`data:image/png;base64,${PNG.toString('base64')}`]);
    expect(refs?.[0]).toMatchObject({ mimeType: 'image/png', name: 'reference-1.png' });
  });

  it('rejects more than 16 references', async () => {
    await expect(normalizeImageReferences(Array.from({ length: 17 }, () => 'https://cdn.example.test/x.png'))).rejects.toThrow('最多 16 张');
  });

  it('sends remote references as JSON to the edit endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ data: [{ url: 'https://cdn.example.test/out.png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await generateImages(job({ references: ['https://cdn.example.test/ref.png'] }), 'key');
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe('https://api.example.test/v1/images/edits');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-image-2', image: ['https://cdn.example.test/ref.png'] });
  });

  it('sends base64 references as multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ data: [{ url: 'https://cdn.example.test/out.png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await generateImages(job({ references: [`data:image/png;base64,${PNG.toString('base64')}`] }), 'key');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect((init.body as FormData).getAll('image[]')).toHaveLength(1);
  });
});

describe('image size mapping', () => {
  it('maps aspect ratio and tier to the recommended size', () => {
    expect(imageSize({ aspectRatio: '16:9', resolution: '4K' })).toBe('3840x2160');
    expect(imageSize({ aspectRatio: '9:16', resolution: '1K' })).toBe('720x1280');
    expect(imageSize({ aspectRatio: '2:3', resolution: '2K' })).toBe('2048x3072');
  });

  it('lets an explicit WIDTHxHEIGHT win, without policing it', () => {
    expect(imageSize({ size: ' 1024x1024 ', aspectRatio: '16:9', resolution: '4K' })).toBe('1024x1024');
    expect(imageSize({ size: '4096x4096' })).toBe('4096x4096');
  });

  it('falls back to a recommended default for unknown ratios and tiers', () => {
    expect(imageSize({ aspectRatio: '21:9', resolution: '8K' })).toBe('2048x2048');
  });
});

describe('channel size rejection', () => {
  it('reads the accepted sizes from the error body', () => {
    const body = JSON.stringify({ error: { code: 'INVALID_SIZE', metadata: { allowed: ['1024x1024', '3840x2160', 'auto'], field: 'size' } } });
    expect(allowedSizesFromError(body)).toEqual(['1024x1024', '3840x2160', 'auto']);
    expect(allowedSizesFromError('not json')).toBeUndefined();
  });

  it('picks the closest allowed size by aspect ratio then area', () => {
    const allowed = ['1024x1024', '2048x2048', '1536x1024', '1024x1536', '2048x1152', '3840x2160', '2160x3840', 'auto'];
    expect(closestAllowedSize('832x1248', allowed)).toBe('1024x1536');
    expect(closestAllowedSize('1280x720', allowed)).toBe('2048x1152');
    expect(closestAllowedSize('2160x3840', allowed)).toBe('2160x3840');
  });

  it('retries once with the channel-supported size instead of failing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond({
        error: { code: 'INVALID_SIZE', message: 'requested size is not supported', metadata: { allowed: ['1024x1024', '2048x2048', '1536x1024', '1024x1536', '2048x1152', '3840x2160', '2160x3840', 'auto'], field: 'size' } },
      }, { status: 400 }))
      .mockResolvedValueOnce(respond({ data: [{ url: 'https://cdn.example.test/out.png' }], size: '1024x1536' }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    const { images, provider } = await generateImages(job({ aspectRatio: '2:3', resolution: '1K' }), 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ size: '1024x1536' });
    expect(images[0]).toMatchObject({ kind: 'url' });
    expect(provider).toMatchObject({ requestedSize: '672x1008', usedSize: '1024x1536' });
  });
});

describe('style prompt injection', () => {
  const style = { id: 'style-1', name: '短剧感', description: '整体调性：当代短剧的影视质感。' };

  it('appends the style to free-form image prompts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ data: [{ url: 'https://cdn.example.test/out.png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await generateImages(job({}, { style }), 'key');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).toBe('雨夜街道\n\n视觉风格：短剧感。整体调性：当代短剧的影视质感。');
  });

  it('keeps the strict H3 video prompt verbatim so prompt optimization carries the style', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ id: 'video_123' }));
    vi.stubGlobal('fetch', fetchMock);
    const { submitVideo } = await import('../examples/agent-chat/server/media-adapters');
    const video = { type: 'video' as const, modelId: 'minimax-h3-flash', upstreamModelId: 'minimax-h3-flash', style };
    await expect(submitVideo(job({ duration: 5, resolution: '480P', aspectRatio: '16:9' }, video), 'key')).resolves.toBe('video_123');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe('雨夜街道');
    expect(body.prompt).not.toContain('视觉风格');
  });

  it('still appends the style for video models without h3 in their name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ id: 'video_123' }));
    vi.stubGlobal('fetch', fetchMock);
    const { submitVideo } = await import('../examples/agent-chat/server/media-adapters');
    const video = { type: 'video' as const, modelId: 'kling-2', upstreamModelId: 'kling-2', style };
    await submitVideo(job({ duration: 5, resolution: '480P', aspectRatio: '16:9' }, video), 'key');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).toBe('雨夜街道\n\n视觉风格：短剧感。整体调性：当代短剧的影视质感。');
  });
});

describe('gemini images', () => {
  it('omits multi-turn signatures from every diagnostic part without changing the source response', () => {
    const payload = { usageMetadata: { totalTokenCount: 42 }, candidates: [
      { content: { parts: [
        { inlineData: { mimeType: 'image/png', data: 'image-bytes' }, thoughtSignature: 'image-signature' },
        { text: '生成完成', thoughtSignature: 'text-signature' },
      ] } },
      { content: { parts: [{ thought_signature: 'legacy-signature', finishReason: 'STOP' }] } },
    ] };
    const record = geminiResponseRecord(payload);
    expect(record).toEqual({ usageMetadata: { totalTokenCount: 42 }, candidates: [
      { content: { parts: [
        { inlineData: { mimeType: 'image/png', data: '<base64 11 字符，已保存为文件>' } },
        { text: '生成完成' },
      ] } },
      { content: { parts: [{ finishReason: 'STOP' }] } },
    ] });
    expect(payload.candidates[0].content.parts[0]).toMatchObject({ thoughtSignature: 'image-signature', inlineData: { data: 'image-bytes' } });
  });

  const geminiJob = (options: Record<string, unknown> = {}) => ({
    ...job(options), modelId: 'gemini-3-pro-image-preview', upstreamModelId: 'gemini-3-pro-image-preview', protocolKey: 'gemini-generate-content',
  });

  it('builds the v1beta endpoint from a v1 provider base', () => {
    expect(geminiImageEndpoint('https://api.darl.cn/v1', 'gemini-3-pro-image-preview')).toBe('https://api.darl.cn/v1beta/models/gemini-3-pro-image-preview:generateContent');
    expect(geminiImageEndpoint('https://api.darl.cn', 'gemini-3-pro-image-preview')).toBe('https://api.darl.cn/v1beta/models/gemini-3-pro-image-preview:generateContent');
  });

  it('maps ratio and tier into imageConfig and decodes the gateway markdown data URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `![image](data:image/png;base64,${PNG.toString('base64')})` }] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { images, provider } = await generateGeminiImages(geminiJob({ aspectRatio: '16:9', resolution: '4K' }), 'key');
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe('https://api.example.test/v1beta/models/gemini-3-pro-image-preview:generateContent');
    expect(JSON.parse(init.body)).toMatchObject({ generationConfig: { imageConfig: { aspectRatio: '16:9', imageSize: '4K' } } });
    expect(images[0]).toMatchObject({ kind: 'b64', ext: 'png' });
    expect(provider).toMatchObject({ aspectRatio: '16:9', imageSize: '4K' });
  });

  it('decodes an inlineData part', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] })));
    const { images } = await generateGeminiImages(geminiJob(), 'key');
    expect(images[0]).toMatchObject({ kind: 'b64', ext: 'png' });
  });

  it('rejects more than 14 references', async () => {
    await expect(generateGeminiImages(geminiJob({ references: Array.from({ length: 15 }, () => 'https://cdn.example.test/x.png') }), 'key')).rejects.toThrow('最多 14 张');
  });

  it('reports finishReason when no image comes back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'blocked' }] } }] })));
    await expect(generateGeminiImages(geminiJob(), 'key')).rejects.toThrow(/SAFETY/);
  });
});

describe('supplier error messages', () => {
  it('shows the gateway reason instead of the raw JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ error: { message: '预扣费额度失败, 用户剩余额度: ¥0.01' } }, { status: 403 })));
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await expect(generateImages(job(), 'key')).rejects.toThrow(/供应商 HTTP 403：预扣费额度失败/);
  });

  it('falls back to the raw body when it is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('upstream exploded', { status: 500 })));
    const { generateImages } = await import('../examples/agent-chat/server/media-adapters');
    await expect(generateImages(job(), 'key')).rejects.toThrow(/供应商 HTTP 500：upstream exploded/);
  });
});

describe('raw provider record for diagnostics', () => {
  it('keeps urls and metadata verbatim but elides base64 bodies', () => {
    const record = imageResponseRecord({
      data: [{ url: 'https://img.example.test/a.png', b64_json: PNG.toString('base64') }],
      created: 1792046111, usage: { total_tokens: 1414 }, model: 'gpt-image-2-4k', size: '2880x2880',
    }, 'url');
    expect(record).toMatchObject({ form: 'url', created: 1792046111, model: 'gpt-image-2-4k', size: '2880x2880' });
    expect(record.data[0]).toMatchObject({ url: 'https://img.example.test/a.png' });
    expect(String(record.data[0].b64_json)).toContain('已保存为文件');
  });

  it('handles empty and malformed payloads', () => {
    expect(imageResponseRecord({ data: [] }, 'unknown')).toMatchObject({ form: 'unknown', data: [] });
    expect(imageResponseRecord(null, 'unknown')).toMatchObject({ form: 'unknown', data: [] });
  });
});
