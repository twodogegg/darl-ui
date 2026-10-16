import type { AgentMessage } from '@darl/ui';

const MAX_TOOL_OUTPUT = 20_000;

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
  const calls = message.toolCalls.filter((call) => call.status === 'success' || call.status === 'error');
  if (!calls.length) return '';
  return calls.map((call) => {
    const name = `${call.appName}/${call.toolTitle || call.toolName}`;
    if (call.status === 'error') return `[工具调用记录] ${name}：调用失败：${call.error || '未知错误'}`;
    const output = formatOutput(call.output);
    return `[工具调用记录] ${name}：已完成${output ? `；返回数据：${output}` : ''}`;
  }).join('\n');
}
