import { describe, expect, it } from 'vitest';
import { imageUrl } from '../examples/agent-chat/client/image-url';

describe('display image URLs', () => {
  const original = `https://demo.darl.cn/darl-drama/${'a'.repeat(64)}.png`;
  it('derives every display size without altering the original', () => {
    for (const width of [160, 320, 640, 1024] as const) {
      expect(imageUrl(original, width)).toBe(`${original}?imageMogr2/thumbnail/${width}x/quality/80/format/webp`);
    }
    expect(original).not.toContain('?');
  });
  it('replaces the processing directive and preserves other parameters and fragments', () => {
    expect(imageUrl(`${original}?version=2&imageMogr2/thumbnail/160x/format/webp#preview`, 640)).toBe(`${original}?version=2&imageMogr2/thumbnail/640x/quality/80/format/webp#preview`);
    expect(imageUrl('/api/files/file-id?width=160&version=2', 320)).toBe('/api/files/file-id?width=320&version=2');
  });
  it('keeps local previews and unrelated remote providers unchanged', () => {
    for (const url of ['blob:local-preview', 'data:image/png;base64,abc', 'https://other.example/image.png']) expect(imageUrl(url, 320)).toBe(url);
  });
});
