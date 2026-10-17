// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGptImage2 } from '../examples/agent-chat/server/media-providers';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
const connection = { baseUrl: 'https://gateway.example/v1', apiKey: 'development-test-key', upstreamModelId: 'gpt-image-2' };
afterEach(() => vi.unstubAllGlobals());

describe('GPT Image 2 actual wire mapping', () => {
  it('builds document-specified JSON generation and decodes Base64 response', async () => {
    const fetcher = vi.fn(async (_target: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'gpt-image-2', prompt: '电影感女孩', size: '1024x1024', quality: 'high', n: 2, output_format: 'png', response_format: 'b64_json' });
      return Response.json({ data: [{ b64_json: image.toString('base64') }, { b64_json: image.toString('base64') }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await generateGptImage2(connection, { prompt: '电影感女孩', size: '1024x1024', quality: 'high', count: 2 });
    expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example/v1/images/generations');
    expect(result).toHaveLength(2);
    expect(result[0].mime).toBe('image/png');
    expect(result[0].data).toEqual(image);
  });

  it('uses multipart image[] for reference editing without changing the main prompt', async () => {
    const fetcher = vi.fn(async (_target: unknown, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('prompt')).toBe('换背景');
      expect(form.getAll('image[]')).toHaveLength(2);
      expect(form.get('response_format')).toBe('b64_json');
      return Response.json({ data: [{ b64_json: image.toString('base64') }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const refs = [{ data: image, name: 'front.png', mime: 'image/png' }, { data: image, name: 'side.png', mime: 'image/png' }];
    const output = await generateGptImage2(connection, { prompt: '换背景', referenceImages: refs });
    expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example/v1/images/edits');
    expect(output).toHaveLength(1);
  });

  it('rejects invalid image sizes before sending any paid API request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(generateGptImage2(connection, { prompt: '测试', size: '2K' })).rejects.toThrow();
    await expect(generateGptImage2(connection, { prompt: '测试', size: '2049x2048' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
