// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildH3FlashRequest, downloadH3Video, getH3Video } from '../examples/agent-chat/server/h3-flash';

function respond(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const BASE = 'https://api.example.test/v1';

afterEach(() => { vi.unstubAllGlobals(); });

describe('unified H3 Flash contract', () => {
  it('builds only the current resolution and aspect ratio fields', () => {
    expect(buildH3FlashRequest({ prompt: '海边日落', seconds: 8, resolution: '480', aspectRatio: '16:9', referenceImages: ['https://cdn.example/image.png'] })).toEqual({
      model: 'minimax-h3-flash', prompt: '海边日落', seconds: 8, resolution: '480', aspect_ratio: '16:9', reference_images: ['https://cdn.example/image.png'],
    });
  });

  it('rejects legacy values, local references and unsupported frame guesses', () => {
    expect(() => buildH3FlashRequest({ prompt: 'x', resolution: '720' as never })).toThrow('480 或 768');
    expect(() => buildH3FlashRequest({ prompt: 'x', referenceImages: ['/tmp/image.png'] })).toThrow('公网 HTTP(S) URL');
    expect(() => buildH3FlashRequest({ prompt: 'x', mode: 'first-last-frame' })).toThrow('字段尚未完成网关核对');
  });

  it('enforces per-type limits and mutually exclusive video fields', () => {
    expect(() => buildH3FlashRequest({ prompt: 'x', referenceVideos: ['https://a', 'https://b', 'https://c', 'https://d'] })).toThrow('最多支持 3');
    expect(() => buildH3FlashRequest({ prompt: 'x', referenceVideo: 'https://one', referenceVideos: ['https://two'] })).toThrow('不能与 reference_videos 同时提交');
  });

  // The gateway answers with processing/succeeded, not in_progress/completed.
  it('maps the gateway status vocabulary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'processing' })));
    expect((await getH3Video(BASE, 'key', 'task_1')).status).toBe('processing');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'queued' })));
    expect((await getH3Video(BASE, 'key', 'task_1')).status).toBe('queued');
  });

  it('expands the relative video_url returned on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'succeeded', video_url: '/v1/videos/task_1/content' })));
    expect((await getH3Video(BASE, 'key', 'task_1')).videoUrl).toBe('https://api.example.test/v1/videos/task_1/content');
  });

  it('downloads from the absolute task URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('video-bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await downloadH3Video(BASE, 'key', { id: 'task_1', status: 'succeeded', videoUrl: 'https://api.example.test/v1/videos/task_1/content' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/videos/task_1/content');
  });

  // The gateway answers 5xx with a flat { code, message }; the real reason must surface.
  it('reports the gateway message on HTTP 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ code: 'plugin_submit_response_failed', message: 'Video submission failed: code 605 - Your balance is insufficient.' }, 502)));
    await expect(getH3Video(BASE, 'key', 'task_1')).rejects.toThrow('balance is insufficient');
  });

  it('rejects an unknown status instead of treating it as completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ id: 'task_1', status: 'in_progress' })));
    await expect(getH3Video(BASE, 'key', 'task_1')).rejects.toThrow('任务状态响应无效');
  });
});
