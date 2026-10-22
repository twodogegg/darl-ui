import type { PromptOptimizationRequest } from '@darl/ui';

export async function optimizeMediaPrompt(input: PromptOptimizationRequest, { signal }: { signal: AbortSignal }): Promise<string> {
  const response = await fetch('/api/prompt-optimization', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input, (_key, value) => value instanceof File ? { name: value.name, mimeType: value.type, size: value.size } : value),
  }).catch(reason => { if (signal.aborted) throw reason; throw new Error('无法连接提示词优化服务，请检查网络后重试'); });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || '提示词优化失败');
  return result.prompt;
}
