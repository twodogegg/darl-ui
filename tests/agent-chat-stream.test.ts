// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lines } from '../examples/agent-chat/stream';
import { checkedText, publicProvider, safeError, validateProvider } from '../examples/agent-chat/server/models';

function stream(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
    controller.close();
  } });
}
async function collect<T>(generator: AsyncGenerator<T>) { const result: T[] = []; for await (const item of generator) result.push(item); return result; }

describe('agent chat network framing', () => {
  it('preserves Chinese UTF-8 text and CRLF line boundaries across one-byte chunks', async () => {
    expect(await collect(lines(stream('{"text":"松柏"}\r\n{"type":"done"}\r\n', 1)))).toEqual(['{"text":"松柏"}', '{"type":"done"}']);
  });
  it('handles a final line without a trailing newline', async () => {
    expect(await collect(lines(stream('{"text":"中文"}\n{"type":"done"}', 2)))).toEqual(['{"text":"中文"}', '{"type":"done"}']);
  });
  it('cancels the network reader when the consumer stops', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"text":"a"}\n')); }, cancel() { cancelled = true; } });
    for await (const _line of lines(body)) break;
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

describe('model answer protocol boundary', () => {
  async function* chunks(value: string, size = 1) {
    for (let offset = 0; offset < value.length; offset += size) yield value.slice(offset, offset + size);
  }
  it.each(['<budget:token_budget>200000</budget:token_budget>', '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="list_assets">'])('rejects split internal prefixes without emitting them: %s', async (value) => {
    const emitted: string[] = [];
    await expect((async () => {
      for await (const part of checkedText(chunks(` \n${value}`))) emitted.push(part);
    })()).rejects.toThrow('模型接口返回了内部协议标记');
    expect(emitted).toEqual([]);
  });
  it.each(['正常回复。', '<div>内容</div>', '<', '```xml\n<budget:token_budget>200000</budget:token_budget>\n```', '字段示例：<｜｜DSML｜｜ calls>'])('preserves normal answers and quoted protocol examples: %s', async (value) => {
    expect((await collect(checkedText(chunks(value)))).join('')).toBe(value);
  });
  it('streams ordinary text without waiting for completion and closes the source on rejection', async () => {
    const stream = checkedText(chunks('你好'));
    expect(await stream.next()).toEqual({ value: '你', done: false });
    await stream.return();
    let closed = false;
    async function* invalid() { try { yield '<budget:token_budget>'; yield 'unread'; } finally { closed = true; } }
    await expect(collect(checkedText(invalid()))).rejects.toThrow('内部协议标记');
    expect(closed).toBe(true);
  });
});
