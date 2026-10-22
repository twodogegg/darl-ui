import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import type { AgentModelConfig, ModelProvider } from '../../../src/components/settings/types';
import type { RequestRecord, RequestRecordMedia } from '../../../src/components/request-records/types';
import { requestFailureStatus, requestRecordScope } from './request-records';

type CallParams = Parameters<NonNullable<LanguageModelMiddleware['wrapStream']>>[0]['params'];

/** Observe the SDK model boundary so each step and transport retry has its own record. */
export function recordLanguageModel(model: Exclude<LanguageModel, string>, provider: ModelProvider, config: AgentModelConfig): LanguageModel {
  const scope = requestRecordScope.getStore();
  if (!scope) return model;
  const { store } = scope;
  const begin = async (params: CallParams) => {
    const references: RequestRecordMedia[] = [];
    for (const message of params.prompt) {
      if (typeof message.content === 'string') continue;
      for (const part of message.content) {
        if (part.type !== 'file' || !/^(image|audio|video)(?:\/|$)/.test(part.mediaType)) continue;
        const type = part.mediaType.split('/')[0] as RequestRecordMedia['type'];
        if (part.data.type === 'url') references.push({ type, name: part.filename || '参考素材', url: String(part.data.url) });
        if (part.data.type === 'data') {
          const bytes = typeof part.data.data === 'string' ? Buffer.from(part.data.data, 'base64') : Buffer.from(part.data.data);
          const file = await store.files.put(bytes, part.mediaType, part.filename || `reference.${part.mediaType.split('/')[1] || 'bin'}`);
          references.push(store.media(file.id, type));
        }
      }
    }
    const { abortSignal: _signal, headers: _headers, ...parameters } = params;
    return store.begin({ type: 'text', modelId: config.id, modelName: config.name, providerId: provider.id, providerName: provider.name,
      url: `${provider.baseUrl.replace(/\/$/, '')}/${provider.protocol === 'openai-responses' ? 'responses' : 'chat/completions'}`, method: 'POST', parameters, references });
  };
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const record = await begin(params);
      try {
        const result = await doGenerate();
        const failed = ['error', 'length', 'content-filter'].includes(result.finishReason.unified);
        store.finish(record.id, { status: failed ? 'error' : 'success', text: result.content.filter(part => part.type === 'text').map(part => part.text).join(''),
          inputTokens: result.usage.inputTokens.total, outputTokens: result.usage.outputTokens.total,
          response: { finishReason: result.finishReason, usage: result.usage, content: result.content.filter(part => !part.type.startsWith('reasoning')) },
          ...(failed ? { error: `模型结束原因：${result.finishReason.unified}` } : {}) });
        return result;
      } catch (reason) { store.finish(record.id, { status: requestFailureStatus(reason, params.abortSignal), error: String(reason) }); throw reason; }
    },
    wrapStream: async ({ doStream, params }) => {
      const record = await begin(params);
      let text = '';
      let textTruncated = false;
      let finished = false;
      let receivedFinish = false;
      let patch: Partial<RequestRecord> = {};
      const finish = (next: Partial<RequestRecord>) => {
        if (finished) return;
        finished = true;
        params.abortSignal?.removeEventListener('abort', aborted);
        store.finish(record.id, { ...patch, text, ...next });
      };
      const aborted = () => finish({ status: requestFailureStatus(params.abortSignal?.reason, params.abortSignal), error: '请求已中断' });
      params.abortSignal?.addEventListener('abort', aborted, { once: true });
      try {
        params.abortSignal?.throwIfAborted();
        const result = await doStream();
        const reader = result.stream.getReader();
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                finish(receivedFinish ? {} : { status: 'error', error: '模型响应在结束标记前中断' });
                reader.releaseLock(); controller.close(); return;
              }
              if (value.type === 'text-delta' && !textTruncated) {
                text += value.delta;
                if (text.length > 32_000) { text = `${text.slice(0, 31_980)}\n[内容已截断]`; textTruncated = true; }
              }
              if (value.type === 'error') { patch = { ...patch, status: 'error', error: String(value.error) }; }
              if (value.type === 'finish') {
                receivedFinish = true;
                const failed = ['error','length','content-filter'].includes(value.finishReason.unified);
                patch = { ...patch, status: patch.status === 'error' || failed ? 'error' : 'success', inputTokens: value.usage.inputTokens.total, outputTokens: value.usage.outputTokens.total,
                  response: { finishReason: value.finishReason, usage: value.usage }, ...(failed ? { error: `模型结束原因：${value.finishReason.unified}` } : {}) };
              }
              controller.enqueue(value);
            } catch (reason) { finish({ status: requestFailureStatus(reason, params.abortSignal), error: String(reason) }); reader.releaseLock(); controller.error(reason); }
          },
          async cancel(reason) { finish({ status: requestFailureStatus(reason, params.abortSignal) === 'timeout' ? 'timeout' : 'cancelled', error: '响应读取已停止' }); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
        });
        return { ...result, stream };
      } catch (reason) { finish({ status: requestFailureStatus(reason, params.abortSignal), error: String(reason) }); throw reason; }
    },
  };
  return wrapLanguageModel({ model, middleware });
}
