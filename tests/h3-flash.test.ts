import { describe, expect, it } from 'vitest';
import { buildH3FlashRequest } from '../examples/agent-chat/server/h3-flash';

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
});
