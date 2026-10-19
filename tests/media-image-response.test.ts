// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closestAllowedSize, allowedSizesFromError, imageResponseRecord, imageSize, normalizeImageReferences } from '../examples/agent-chat/server/media-adapters';
import type { MediaJob } from '../examples/agent-chat/server/media-job-store';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const job = (options: Record<string, unknown> = {}): MediaJob => ({
  id: 'job-1', modelId: 'gpt-image-2', type: 'image', prompt: '雨夜街道', options,
  providerId: 'darl', upstreamModelId: 'gpt-image-2', baseUrl: 'https://api.example.test/v1',
  status: 'queued', attempts: 1, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
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
