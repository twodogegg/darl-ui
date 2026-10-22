// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lines } from '../examples/agent-chat/stream';
import { agentStepText, checkedText, publicProvider, safeError, validateProvider } from '../examples/agent-chat/server/models';
import { createAgentError, failure } from '../examples/agent-chat/server/errors';

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
    expect(safeError(new Error('network error'))).toBe('无法连接模型服务，请检查 API 地址、网络或代理设置后重试');
  });
});

describe('structured Agent errors', () => {
  it('keeps stage, retry guidance and tracing fields while hiding credentials', () => {
    const error = createAgentError('mcp-tool', new Error('request sk-secret-value failed'), { requestId: 'req-1', runId: 'run-1', parentRunId: 'run-0', key: 'sk-secret-value' });
    expect(error).toMatchObject({ code: 'MCP_TOOL_FAILED', stage: 'mcp-tool', requestId: 'req-1', runId: 'run-1', parentRunId: 'run-0', retryable: true });
    expect(error.message).not.toContain('sk-secret-value');
    expect(error.suggestion).toContain('工具');
  });

  it('keeps safe AgentFailure details in the structured error', () => {
    const error = createAgentError('mcp-connection', failure('mcp-connection', 'MCP_CONNECTION_FAILED', 'Asset Hub API 404: asset 不存在或无权访问', false), { requestId: 'req-404' });
    expect(error).toMatchObject({ message: 'Asset Hub API 404: asset 不存在或无权访问', retryable: false });
  });
  it('exposes safe validation details instead of collapsing every request into a generic error', () => {
    expect(createAgentError('validation', new Error('消息格式无效'), { requestId: 'req-validation' })).toMatchObject({ code: 'VALIDATION_FAILED', message: '消息格式无效', retryable: false });
  });

  it('distinguishes cancellation and timeout from model failures', () => {
    expect(createAgentError('model', Object.assign(new Error('aborted'), { name: 'AbortError' }), { requestId: 'req-2' })).toMatchObject({ code: 'REQUEST_CANCELLED', stage: 'cancellation', retryable: false });
    expect(createAgentError('mcp-tool', Object.assign(new Error('aborted'), { name: 'AbortError' }), { requestId: 'req-tool' })).toMatchObject({ code: 'REQUEST_CANCELLED', stage: 'cancellation', retryable: false });
    expect(createAgentError('delegation', Object.assign(new Error('timed out'), { name: 'TimeoutError' }), { requestId: 'req-3' })).toMatchObject({ code: 'REQUEST_TIMEOUT', stage: 'timeout' });
    expect(failure('tool-validation', 'TOOL_ARGUMENT_INVALID', '参数不正确', false).code).toBe('TOOL_ARGUMENT_INVALID');
  });
});

describe('model answer protocol boundary', () => {
  it('moves only public intermediate text into process notes and leaves the last response as the answer', async () => {
    async function* parts() {
      yield { type: 'start-step' };
      yield { type: 'reasoning-delta', text: 'private-reasoning' };
      yield { type: 'text-delta', text: '我先查询' };
      yield { type: 'text-delta', text: '素材。' };
      yield { type: 'tool-call' };
      yield { type: 'tool-call' };
      yield { type: 'finish-step', finishReason: 'tool-calls' };
      yield { type: 'start-step' };
      yield { type: 'text-delta', text: '已完成查询。' };
      yield { type: 'finish-step', finishReason: 'stop' };
      yield { type: 'finish', finishReason: 'stop' };
    }
    const notes: string[] = [];
    let answer = '';
    for await (const text of agentStepText(parts(), (note, startedAt) => { notes.push(note); expect(Number.isFinite(Date.parse(startedAt))).toBe(true); answer = ''; })) answer += text;
    expect(notes).toEqual(['我先查询素材。']);
    expect(answer).toBe('已完成查询。');
    expect(answer).not.toContain('private-reasoning');
  });

  it('preserves plain replies and propagates real stream errors', async () => {
    async function* plain() { yield { type: 'text-delta', text: '你好。' }; yield { type: 'finish', finishReason: 'stop' }; }
    expect(await collect(agentStepText(plain(), () => { throw new Error('不应创建过程说明'); }))).toEqual(['你好。']);
    async function* broken() { yield { type: 'error', error: new Error('连接已中断') }; }
    await expect(collect(agentStepText(broken(), () => {}))).rejects.toThrow('连接已中断');
    async function* empty() { yield { type: 'finish', finishReason: 'stop' }; }
    await expect(collect(agentStepText(empty(), () => {}))).rejects.toThrow('模型没有返回文本内容');
    async function* limited() { yield { type: 'tool-call' }; yield { type: 'finish', finishReason: 'tool-calls' }; }
    expect(await collect(agentStepText(limited(), () => {}))).toEqual([]);
  });

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
