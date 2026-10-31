import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import type { AgentModelConfig, ModelProvider } from '../../../src/components/settings/types';

type DebugContext = { write: (entry: Record<string, unknown>) => void; jobId: string; projectId: string; episodeId?: string; kind: string; phase: () => string };
const scope = new AsyncLocalStorage<DebugContext>();
const secretField = /authorization|cookie|password|credential|api[_-]?key|secret|^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token)$/i;

/** Preserve all text while excluding credentials, signed URL credentials and inline binary media. */
export function sanitizeWorkflowDebug(value: unknown, secrets: string[] = []): unknown {
  const clean = (item: unknown, ancestors: Set<object>): unknown => {
    if (typeof item === 'string') {
      let result = item;
      for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[已隐藏]');
      result = result.replace(/(?:sk|ahk)_[\w-]+|sk-[\w-]+|Bearer\s+[^\s"']+/gi, '[已隐藏]');
      result = result.replace(/("(?:authorization|password|credential|api[_-]?key|secret|access[_-]?token|refresh[_-]?token)"\s*:\s*")[^"]*/gi, '$1[已隐藏]');
      result = result.replace(/([?&](?:[\w-]*(?:signature|credential|security[_-]?token|access[_-]?(?:token|key)|api[_-]?key|secret)|token|q-ak)=)[^&\s"'\\]*/gi, '$1[已隐藏]');
      if (/^data:[^,]*;base64,/i.test(result)) return `[内联媒体已省略：${result.length} 字符]`;
      return result;
    }
    if (item instanceof URL) return clean(item.href, ancestors);
    if (item instanceof Uint8Array || item instanceof ArrayBuffer) return `[二进制 ${item.byteLength} 字节]`;
    if (item instanceof Error) {
      if (ancestors.has(item)) return '[循环引用]';
      const next = new Set(ancestors); next.add(item);
      return { name: item.name, message: clean(item.message, next), stack: clean(item.stack || '', next), ...(item.cause ? { cause: clean(item.cause, next) } : {}) };
    }
    if (Array.isArray(item)) {
      if (ancestors.has(item)) return '[循环引用]';
      const next = new Set(ancestors); next.add(item);
      return item.map(entry => clean(entry, next));
    }
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) return '[循环引用]';
      const next = new Set(ancestors); next.add(item);
      if ('type' in item && item.type === 'data' && 'data' in item) return { ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'data').map(([key, value]) => [key, clean(value, next)])), data: '[内联媒体已省略]' };
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, secretField.test(key) ? '[已隐藏]' : /^(?:b64_json|base64)$/i.test(key) || (key === 'data' && 'type' in item && ['image', 'audio', 'video', 'file'].includes(String(item.type)) && typeof entry === 'string' && !/^https?:/i.test(entry)) ? '[内联媒体已省略]' : clean(entry, next)]));
    }
    if (typeof item === 'bigint') return String(item);
    return typeof item === 'function' || item === undefined ? undefined : item;
  };
  return clean(value, new Set());
}

export function createWorkflowDebugLog(directory: string, enabled: boolean, secrets: () => string[] = () => []) {
  if (!enabled) return undefined;
  const path = join(directory, 'workflow-debug.jsonl');
  let ready = false, warned = false;
  return (entry: Record<string, unknown>) => {
    try {
      if (!ready) { mkdirSync(directory, { recursive: true, mode: 0o700 }); ready = true; }
      const line = JSON.stringify(sanitizeWorkflowDebug({ timestamp: new Date().toISOString(), ...entry }, secrets()));
      appendFileSync(path, `${line}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    } catch {
      if (!warned) { warned = true; process.stderr.write('[workflow-debug] 无法写入调试日志，请检查日志目录权限。\n'); }
    }
  };
}

export function runWithWorkflowDebug<T>(context: DebugContext, run: () => T): T { return scope.run(context, run); }
export function logWorkflowDebug(event: string, details: Record<string, unknown> = {}) {
  const current = scope.getStore();
  if (!current) return;
  current.write({ event, jobId: current.jobId, projectId: current.projectId, episodeId: current.episodeId, kind: current.kind, phase: current.phase(), ...details });
}

/** Capture every SDK model step, including tool calls and partial output, without changing it. */
export function recordWorkflowDebugModel(model: Exclude<LanguageModel, string>, provider: ModelProvider, config: AgentModelConfig): LanguageModel {
  if (!scope.getStore()) return model;
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const callId = randomUUID(), { abortSignal: _signal, headers: _headers, ...input } = params;
      logWorkflowDebug('model.request', { callId, providerId: provider.id, modelId: config.id, protocol: provider.protocol, baseUrl: provider.baseUrl, input });
      try { const output = await doGenerate(); logWorkflowDebug('model.response', { callId, output }); return output; }
      catch (error) { logWorkflowDebug('model.error', { callId, error }); throw error; }
    },
    wrapStream: async ({ doStream, params }) => {
      const callId = randomUUID(), { abortSignal: _signal, headers: _headers, ...input } = params;
      logWorkflowDebug('model.request', { callId, providerId: provider.id, modelId: config.id, protocol: provider.protocol, baseUrl: provider.baseUrl, input });
      const parts: unknown[] = [];
      let outputText = '', finished = false;
      const finish = (event: string, details: Record<string, unknown> = {}) => { if (!finished) { finished = true; logWorkflowDebug(event, { callId, outputText, parts, ...details }); } };
      try {
        const result = await doStream(), reader = result.stream.getReader();
        return { ...result, stream: new ReadableStream({
          async pull(controller) {
            try { const { done, value } = await reader.read(); if (done) { finish('model.response'); reader.releaseLock(); controller.close(); return; } if (value.type === 'text-delta') outputText += value.delta; parts.push(value); controller.enqueue(value); }
            catch (error) { finish('model.error', { error }); reader.releaseLock(); controller.error(error); }
          },
          async cancel(reason) { finish('model.cancelled', { reason }); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
        }) };
      } catch (error) { finish('model.error', { error }); throw error; }
    },
  };
  return wrapLanguageModel({ model, middleware });
}
