import type { AgentErrorInfo, AgentErrorStage } from '../../../src/index';
import { APICallError, RetryError } from 'ai';
import { redactMessage } from './failure-log';

export class AgentFailure extends Error {
  readonly stage: AgentErrorStage;
  readonly code: string;
  readonly retryable: boolean;
  readonly suggestion: string;

  constructor(stage: AgentErrorStage, code: string, message: string, retryable: boolean, suggestion: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentFailure';
    this.stage = stage;
    this.code = code;
    this.retryable = retryable;
    this.suggestion = suggestion;
  }
}

const suggestions: Record<AgentErrorStage, string> = {
  model: '根据上方具体错误处理后重试。',
  'mcp-connection': '检查应用地址和连接状态后重试。',
  'mcp-tool': '检查应用权限和工具状态后重试。',
  runtime: '检查命令输出、工作区文件和所需依赖后继续。',
  delegation: '稍后重试，或直接让当前 Agent 完成任务。',
  'tool-validation': '检查工具所需参数后重试。',
  validation: '检查请求内容和配置后重试。',
  cancellation: '可以点击“重新生成”继续请求。',
  timeout: '稍后重试，或缩小任务范围。',
};

const messages: Record<AgentErrorStage, string> = {
  model: '模型请求失败，请检查模型和提供方设置后重试。',
  'mcp-connection': 'MCP 应用连接失败，请检查应用地址和连接状态后重试。',
  'mcp-tool': 'MCP 工具调用失败，请检查应用状态后重试。',
  runtime: '本机执行工具失败，请检查工作区和命令输出。',
  delegation: '子 Agent 请求失败，请稍后重试。',
  'tool-validation': '工具参数无效，请检查工具要求后重试。',
  validation: '请求参数无效，请检查输入和配置后重试。',
  cancellation: '请求已取消。',
  timeout: '请求超时，请稍后重试。',
};

function modelErrorMessage(reason: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (RetryError.isInstance(reason)) return modelErrorMessage(reason.lastError, depth + 1) || reason.message;
  if (APICallError.isInstance(reason)) return reason.message;
  if (reason instanceof Error) return modelErrorMessage(reason.cause, depth + 1) || reason.message;
  return typeof reason === 'string' ? reason.trim() : '';
}

export function createAgentError(stage: AgentErrorStage, reason: unknown, context: { requestId?: string; runId?: string; parentRunId?: string; key?: string; code?: string; retryable?: boolean; suggestion?: string; message?: string }): AgentErrorInfo {
  const aborted = reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError');
  const timeout = reason instanceof Error && reason.name === 'TimeoutError';
  const custom = reason instanceof AgentFailure ? reason : undefined;
  const resolvedStage = timeout ? 'timeout' : aborted ? 'cancellation' : custom?.stage || stage;
  const code = context.code || custom?.code || (resolvedStage === 'cancellation' ? 'REQUEST_CANCELLED' : resolvedStage === 'timeout' ? 'REQUEST_TIMEOUT' : `${resolvedStage.replaceAll('-', '_').toUpperCase()}_FAILED`);
  const safeValidationMessage = resolvedStage === 'validation' || resolvedStage === 'tool-validation'
    ? (reason instanceof Error ? reason.message.slice(0, 400) : '')
    : '';
  return {
    code,
    stage: resolvedStage,
    message: redactMessage(context.message || custom?.message || safeValidationMessage || (resolvedStage === 'model' ? modelErrorMessage(reason) : '') || messages[resolvedStage], context.key),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
    retryable: context.retryable ?? custom?.retryable ?? (resolvedStage !== 'validation' && resolvedStage !== 'tool-validation' && resolvedStage !== 'cancellation'),
    suggestion: redactMessage(context.suggestion || custom?.suggestion || suggestions[resolvedStage], context.key),
  };
}

export function commandResultError(result: { status: string; exitCode: number | null; output: string }, context: { requestId?: string; runId?: string; parentRunId?: string; key?: string } = {}) {
  const timedOut = result.status === 'timed_out';
  const summary = timedOut ? '命令执行超时' : result.status === 'failed' ? '命令启动失败' : `命令已退出，退出码：${result.exitCode ?? '未知'}`;
  const message = redactMessage(`${summary}${result.output.trim() ? `\n命令输出：\n${result.output}` : ''}`, context.key);
  return createAgentError(timedOut ? 'timeout' : 'runtime', new Error(message), {
    ...context, code: timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED', message, retryable: false,
  });
}

export function failure(stage: AgentErrorStage, code: string, message: string, retryable = true, suggestion?: string) {
  return new AgentFailure(stage, code, message, retryable, suggestion || suggestions[stage]);
}

