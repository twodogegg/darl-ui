import type { AgentErrorInfo, AgentMessage, AgentToolCall } from '@darl/ui';

const MAX_TOOL_OUTPUT = 20_000;

export function finishToolCalls(calls: AgentToolCall[] | undefined, error?: AgentErrorInfo): AgentToolCall[] | undefined {
  return calls?.map((call) => ['pending', 'running', 'retrying', 'confirmation'].includes(call.status)
    ? { ...call, status: error?.stage === 'cancellation' ? 'cancelled' : 'error', error: error?.stage === 'cancellation' ? undefined : '工具调用已中断，请重新发起请求。', errorInfo: error }
    : call);
}

function formatOutput(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, MAX_TOOL_OUTPUT);
  try { return JSON.stringify(value).slice(0, MAX_TOOL_OUTPUT); }
  catch { return String(value).slice(0, MAX_TOOL_OUTPUT); }
}

/**
 * Keep completed tool calls visible to the model on the next turn.
 * Tool results are data, never instructions, and are deliberately bounded.
 */
export function toolHistoryForModel(message: AgentMessage): string {
  if (message.role !== 'assistant' || !message.toolCalls?.length) return '';
  const calls = message.toolCalls.filter((call) => ['success', 'error', 'cancelled'].includes(call.status));
  if (!calls.length) return '';
  return calls.map((call) => {
    const name = `${call.appName}/${call.toolTitle || call.toolName}`;
    if (call.status === 'cancelled' || call.errorInfo?.stage === 'cancellation') return `[工具调用记录] ${name}：${call.errorInfo?.message || '已停止'}；未经重新授权不要重试。`;
    if (call.status === 'error') return `[工具调用记录] ${name}：调用失败：${call.error || '未知错误'}`;
    const output = formatOutput(call.output);
    return `[工具调用记录] ${name}：已完成${output ? `；返回数据：${output}` : ''}`;
  }).join('\n');
}
