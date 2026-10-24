// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildH3VideoRequest, downloadH3Video, getH3Video, h3Resolutions, uploadH3Asset } from '../examples/agent-chat/server/h3-flash';

function respond(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const BASE = 'https://api.example.test/v1';

afterEach(() => { vi.unstubAllGlobals(); });

describe('unified H3 video contract', () => {
  it('builds the documented size and ratio fields', () => {
    expect(buildH3VideoRequest({ prompt: '海边日落', seconds: 4, size: '480P', ratio: '16:9' })).toEqual({
      model: 'minimax-h3-flash', prompt: '海边日落', seconds: 4, size: '480P', ratio: '16:9',
    });
  });

  it('sends only seconds and never the deprecated duration field', () => {
    expect(buildH3VideoRequest({ prompt: 'x' })).toMatchObject({ seconds: 5, size: '480P', ratio: '16:9' });
    expect(buildH3VideoRequest({ prompt: 'x', seconds: 4 })).not.toHaveProperty('duration');
  });

  it('uses the selected upstream model mapping', () => {
    expect(buildH3VideoRequest({ model: 'minimax-h3-standard', prompt: '画面' }).model).toBe('minimax-h3-standard');
  });

  it('maps reference images, reference video/audio and first/last frames onto the documented fields', () => {
    expect(buildH3VideoRequest({ prompt: 'x', ratio: 'adaptive', referenceImages: ['https://cdn.example/a.png'] })).toMatchObject({
      images: ['https://cdn.example/a.png'],
    });
    expect(buildH3VideoRequest({
      prompt: 'x', ratio: 'adaptive',
      referenceVideos: ['https://cdn.example/a.mp4'], referenceAudios: ['https://cdn.example/a.mp3'],
    })).toMatchObject({ metadata: { reference_video: ['https://cdn.example/a.mp4'], reference_audio: ['https://cdn.example/a.mp3'] } });
    expect(buildH3VideoRequest({ prompt: 'x', ratio: 'adaptive', firstFrameImage: 'first', lastFrameImage: 'last' })).toMatchObject({
      metadata: { first_frame_image: 'first', last_frame_image: 'last' },
    });
    expect(buildH3VideoRequest({ prompt: 'x', firstFrameImage: 'first' })).not.toHaveProperty('images');
  });

  it('rejects frames mixed with references and adaptive without visual input', () => {
    expect(() => buildH3VideoRequest({ prompt: 'x', firstFrameImage: 'first', referenceImages: ['https://cdn.example/a.png'] })).toThrow('不能与参考图片');
    expect(() => buildH3VideoRequest({ prompt: 'x', ratio: 'adaptive' })).toThrow('adaptive 画幅需要');
    expect(() => buildH3VideoRequest({ prompt: 'x', ratio: 'adaptive', firstFrameImage: 'first' })).not.toThrow();
  });

  it('only lets Flash use 1080P', () => {
    expect(h3Resolutions('minimax-h3-flash')).toEqual(['480P', '768P', '1080P']);
    expect(h3Resolutions('minimax-h3-standard')).toEqual(['480P', '768P']);
    expect(() => buildH3VideoRequest({ model: 'minimax-h3-standard', prompt: 'x', size: '1080P' })).toThrow('480P / 768P');
    expect(() => buildH3VideoRequest({ prompt: 'x', size: '480' as never })).toThrow('480P / 768P / 1080P');
  });

  it('accepts every documented ratio and rejects anything else', () => {
    for (const ratio of ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const) {
      expect(buildH3VideoRequest({ prompt: 'x', ratio }).ratio).toBe(ratio);
    }
    expect(() => buildH3VideoRequest({ prompt: 'x', ratio: '5:4' as never })).toThrow('H3 画幅只能是');
  });

  it('enforces per-type limits and public URLs', () => {
    expect(() => buildH3VideoRequest({ prompt: 'x', referenceImages: Array.from({ length: 10 }, (_, i) => `https://a/${i}.png`) })).toThrow('最多支持 9');
    expect(() => buildH3VideoRequest({ prompt: 'x', referenceVideos: ['https://a', 'https://b', 'https://c', 'https://d'] })).toThrow('最多支持 3');
    expect(() => buildH3VideoRequest({ prompt: 'x', referenceImages: ['/tmp/image.png'] })).toThrow('公网 HTTP(S) URL');
  });

  it('normalizes documented and hosted status vocabularies', async () => {
    const cases: Array<[string, string]> = [['queued', 'queued'], ['in_progress', 'in_progress'], ['processing', 'in_progress'], ['completed', 'completed'], ['succeeded', 'completed'], ['failed', 'failed']];
    for (const [input, expected] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: input, progress: 40 })));
      expect(await getH3Video(BASE, 'key', 'task_1')).toMatchObject({ status: expected, progress: 40 });
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'queued' })));
    expect((await getH3Video(BASE, 'key', 'task_1')).progress).toBeUndefined();
  });

  it('downloads through the content route, not a temporary video_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('video-bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await downloadH3Video(BASE, 'key', { id: 'task_1', status: 'completed' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/videos/task_1/content');
  });

  it('surfaces the gateway error message and hides the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ code: 'plugin_submit_response_failed', message: 'Video submission failed: code 605 - Your balance is insufficient.' }, 502)));
    await expect(getH3Video(BASE, 'key', 'task_1')).rejects.toThrow('balance is insufficient');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ error: { type: 'bad_request_error', message: 'seconds must be an integer between 4 and 15', http_code: '400' } }, 400)));
    await expect(getH3Video(BASE, 'key', 'task_1')).rejects.toThrow('seconds must be an integer between 4 and 15');
  });

  it('rejects an unknown status instead of treating it as completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'unknown-state' })));
    await expect(getH3Video(BASE, 'key', 'task_1')).rejects.toThrow('任务状态响应无效');
  });

  it('uploads an asset and keeps the opaque id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ id: 'openapi/hash.png', fileName: 'openapi/hash.png', type: 'image', size: '3490', expires_in: 86400 }));
    vi.stubGlobal('fetch', fetchMock);
    const asset = await uploadH3Asset(BASE, 'key', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'first.png');
    expect(asset).toMatchObject({ id: 'openapi/hash.png', type: 'image', expires_in: 86400 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/h3/assets');
  });

  it('rejects an oversize asset before uploading', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadH3Asset(BASE, 'key', new Blob([new Uint8Array(65 * 1024 * 1024)]), 'big.png')).rejects.toThrow('64 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
