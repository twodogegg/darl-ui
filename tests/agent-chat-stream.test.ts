// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { events, lines } from '../examples/agent-chat/stream';
import { publicProvider, safeError, validateProvider } from '../examples/agent-chat/server/models';

function stream(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
    controller.close();
  } });
}
async function collect<T>(generator: AsyncGenerator<T>) { const result: T[] = []; for await (const item of generator) result.push(item); return result; }

describe('agent chat network framing', () => {
  it('preserves Chinese UTF-8 text and CRLF event boundaries across one-byte chunks', async () => {
    const body = ': keepalive\r\nevent: response.output_text.delta\r\ndata: {"text":"松柏"}\r\n\r\ndata: [DONE]\r\n\r\n';
    expect(await collect(events(stream(body, 1)))).toEqual(['{"text":"松柏"}', '[DONE]']);
  });
  it('handles multiline SSE data and a final frame without a trailing newline', async () => {
    expect(await collect(events(stream('data: first\ndata: second\n\ndata: end', 3)))).toEqual(['first\nsecond', 'end']);
    expect(await collect(lines(stream('{"text":"中文"}\n{"type":"done"}', 2)))).toEqual(['{"text":"中文"}', '{"type":"done"}']);
  });
  it('cancels the network reader when the consumer stops', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: a\n\n')); }, cancel() { cancelled = true; } });
    for await (const _event of events(body)) break;
    expect(cancelled).toBe(true);
  });
});

describe('agent chat provider boundary', () => {
  const provider = { id: 'darl', name: 'Darl', baseUrl: 'https://example.test/v1', protocol: 'openai-completions' as const, models: [{ id: 'text', name: 'Text', providerId: 'darl', type: 'text' as const }] };
  it('rejects duplicate model IDs and credential-bearing URLs', () => {
    expect(() => validateProvider({ ...provider, models: [...provider.models, ...provider.models] })).toThrow('模型');
    expect(() => validateProvider({ ...provider, baseUrl: 'https://user:password@example.test/v1' })).toThrow('API 地址');
  });
  it('keeps credentials out of public settings and error messages', () => {
    const value = publicProvider({ ...provider, apiKey: 'private-placeholder' });
    expect(value).not.toHaveProperty('apiKey');
    expect(value.hasApiKey).toBe(true);
    expect(safeError(new Error('auth private-placeholder'), 'private-placeholder')).toBe('auth [已隐藏]');
  });
});
