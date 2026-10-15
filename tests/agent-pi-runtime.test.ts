// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { generate, piHistory, piModel, piTools, type StoredProvider } from '../examples/agent-chat/server/models';
import { ToolConfirmations } from '../examples/agent-chat/server/mcp';

const model = { id: 'custom-model', name: '自定义模型', type: 'text' as const, providerId: 'custom', reasoningEfforts: ['low'] };
const provider: StoredProvider = { id: 'custom', name: '自定义中转', baseUrl: 'https://example.test/v1', apiKey: 'server-only', protocol: 'openai-completions', models: [model] };

describe('Pi runtime integration boundary', () => {
  it.each(['openai-completions', 'openai-responses'] as const)('maps the saved provider without inferring model limits or exposing credentials (%s)', (protocol) => {
    const mapped = piModel({ ...provider, protocol }, model);
    expect(mapped).toMatchObject({ id: model.id, api: protocol, provider: provider.id, baseUrl: provider.baseUrl, maxTokens: 0, contextWindow: 0 });
    expect(mapped).not.toHaveProperty('apiKey');
    expect(piModel(provider, { ...model, capabilities: { contextWindow: 64000 } }).contextWindow).toBe(64000);
    const history = piHistory([{ role: 'user', content: '[应用](app:custom) 你好' }, { role: 'assistant', content: '**你好**' }, { role: 'user', content: '继续' }], mapped);
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(history[0]).toMatchObject({ content: '[应用](app:custom) 你好' });
    expect(history[1]).toMatchObject({ content: [{ type: 'text', text: '**你好**' }], api: protocol });
  });

  it('keeps MCP schemas intact and uses Pi validation for required and enum arguments', () => {
    const parameters = { type: 'object', properties: { scope: { type: 'string', enum: ['mine', 'discover'] } }, required: ['scope'], additionalProperties: false };
    const [tool] = piTools({ tools: [{ name: 'mcp_0_0', parameters }], execute: async () => 'unused' }, new AbortController().signal);
    expect(JSON.parse(JSON.stringify(tool.parameters))).toEqual(parameters);
    expect(validateToolArguments(tool, { type: 'toolCall', id: 'one', name: tool.name, arguments: { scope: 'mine' } })).toEqual({ scope: 'mine' });
    expect(() => validateToolArguments(tool, { type: 'toolCall', id: 'two', name: tool.name, arguments: {} })).toThrow();
    expect(() => validateToolArguments(tool, { type: 'toolCall', id: 'three', name: tool.name, arguments: { scope: 'invalid' } })).toThrow();
    expect(piTools(undefined, new AbortController().signal)).toEqual([]);
  });

  it('passes host execution outcomes through the tool bridge and stops before execution after cancellation', async () => {
    const controller = new AbortController();
    const received: unknown[] = [];
    let executionSignal: AbortSignal | undefined;
    const [tool] = piTools({ tools: [{ name: 'mcp_0_0', parameters: { type: 'object' } }], execute: async (call, signal) => { received.push(call); executionSignal = signal; return '{"isError":true,"error":"拒绝执行"}'; } }, controller.signal);
    expect(await tool.execute('call', { id: 'asset' })).toMatchObject({ isError: true, content: [{ type: 'text', text: '{"isError":true,"error":"拒绝执行"}' }] });
    expect(received).toEqual([{ id: 'call', name: 'mcp_0_0', arguments: '{"id":"asset"}' }]);
    controller.abort();
    expect(executionSignal?.aborted).toBe(true);
    await expect(tool.execute('cancelled', {})).rejects.toThrow();
    expect(received).toHaveLength(1);
    const [plain] = piTools({ tools: [{ name: 'plain', parameters: { type: 'object' } }], execute: async () => '普通文本结果' }, new AbortController().signal);
    expect(await plain.execute('plain', {})).toMatchObject({ isError: false, content: [{ type: 'text', text: '普通文本结果' }] });
  });

  it('does not start an upstream request for an already cancelled generation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generate(provider, model, [{ role: 'user', content: '你好' }], '中文提示词', undefined, controller.signal).next()).rejects.toThrow();
  });

  it('expires a host confirmation when Pi cancels a tool independently of the HTTP request', async () => {
    const request = new AbortController();
    const runtime = new AbortController();
    const confirmations = new ToolConfirmations();
    const [tool] = piTools({ tools: [{ name: 'write', parameters: { type: 'object' } }], execute: async (_call, signal) => {
      await confirmations.wait('pending', signal!);
      throw new Error('取消后不能执行工具');
    } }, request.signal);
    const pending = tool.execute('pending', {}, runtime.signal);
    runtime.abort();
    await expect(pending).rejects.toThrow('工具调用已停止');
    expect(() => confirmations.decide('pending', false)).toThrow('已过期');
    expect(request.signal.aborted).toBe(false);
  });
});
