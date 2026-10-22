// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aiTools, generate, languageModel, modelMessages, type StoredProvider } from '../examples/agent-chat/server/models';
import { ToolConfirmations } from '../examples/agent-chat/server/mcp';
import { resolveTextModel } from '../examples/agent-chat/server/api';
import { defaultModelConfiguration } from '../src/components/settings/model-config';

const model = { id: 'custom-model', name: '自定义模型', type: 'text' as const, providerId: 'custom', reasoningEfforts: ['low'] };
const provider: StoredProvider = { id: 'custom', name: '自定义中转', baseUrl: 'https://example.test/v1', apiKey: 'server-only', protocol: 'openai-completions', models: [model] };
type TestTool = { type: string; inputSchema: { jsonSchema?: unknown; validate?: (value: unknown) => { success: boolean; error?: Error } }; execute: (input: unknown, options: { toolCallId: string; messages: []; context: Record<string, never>; abortSignal?: AbortSignal }) => Promise<unknown> };

describe('AI SDK runtime integration boundary', () => {
  it('resolves text protocol per model binding on the same supplier', () => {
    const configuration = defaultModelConfiguration();
    const configuredProvider = { ...provider, id: 'darl', protocol: 'openai-completions' as const };
    expect(resolveTextModel([configuredProvider], configuration, 'darl', 'gpt-6.1-sol')?.provider.protocol).toBe('openai-responses');
    expect(resolveTextModel([configuredProvider], configuration, 'darl', 'deepseek-v4.1-flash')?.provider.protocol).toBe('openai-completions');
  });
  it.each(['openai-completions', 'openai-responses'] as const)('maps the saved provider without exposing credentials (%s)', (protocol) => {
    const mapped = languageModel({ ...provider, protocol }, model) as { provider: string; modelId: string };
    expect(mapped).toMatchObject({ modelId: model.id });
    expect(mapped.provider).toContain(provider.id);
    expect(mapped).not.toHaveProperty('apiKey');
  });

  it('maps text and image history to AI SDK model messages', () => {
    const history = modelMessages([{ role: 'user', content: [{ type: 'text', text: '描述这张图' }, { type: 'image', name: '参考图.png', mimeType: 'image/png', data: 'aGVsbG8=' }] }, { role: 'assistant', content: '**好的**' }]);
    expect(history).toEqual([
      { role: 'user', content: [{ type: 'text', text: '描述这张图' }, { type: 'image', image: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png' }] },
      { role: 'assistant', content: '**好的**' },
    ]);
  });

  it('keeps MCP schemas intact and passes execution through dynamic tools', async () => {
    const parameters = { type: 'object', properties: { scope: { type: 'string', enum: ['mine', 'discover'] } }, required: ['scope'], additionalProperties: false };
    let received: unknown;
    const tools = aiTools({ tools: [{ name: 'mcp_0_0', parameters }], execute: async (call, signal) => { received = { call, aborted: signal?.aborted }; return '普通文本结果'; } }, new AbortController().signal);
    const tool = tools?.mcp_0_0 as TestTool | undefined;
    expect(tool?.type).toBe('dynamic');
    expect(tool?.inputSchema.jsonSchema).toEqual(parameters);
    expect(tool?.inputSchema.validate?.({}).success).toBe(false);
    expect(tool?.inputSchema.validate?.({ scope: 'mine' }).success).toBe(true);
    await tool?.execute({ scope: 'mine' }, { toolCallId: 'call-1', messages: [], context: {} });
    expect(received).toEqual({ call: { id: 'call-1', name: 'mcp_0_0', arguments: '{"scope":"mine"}' }, aborted: false });
    expect(aiTools(undefined, new AbortController().signal)).toBeUndefined();
  });

  it('expires host confirmation when the AI SDK tool execution signal is aborted', async () => {
    const request = new AbortController();
    const runtime = new AbortController();
    const confirmations = new ToolConfirmations();
    const tools = aiTools({ tools: [{ name: 'write', parameters: { type: 'object' } }], execute: async (_call, signal) => {
      await confirmations.wait('pending', signal!);
      throw new Error('取消后不能执行工具');
    } }, request.signal);
    const pending = (tools!.write as TestTool).execute({}, { toolCallId: 'pending', messages: [], context: {}, abortSignal: runtime.signal });
    runtime.abort();
    await expect(pending).rejects.toThrow('工具调用已停止');
    expect(() => confirmations.decide('pending', false)).toThrow('已过期');
    expect(request.signal.aborted).toBe(false);
  });

  it('does not start an upstream request for an already cancelled generation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generate(provider, model, [{ role: 'user', content: '你好' }], '中文提示词', undefined, controller.signal).next()).rejects.toThrow();
  });
});
