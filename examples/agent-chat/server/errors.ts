import type { AgentErrorInfo, AgentErrorStage } from '../../../src/index';

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
  model: '检查模型、提供方和网络设置后重试。',
  'mcp-connection': '检查应用地址和连接状态后重试。',
  'mcp-tool': '检查应用权限和工具状态后重试。',
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
  delegation: '子 Agent 请求失败，请稍后重试。',
  'tool-validation': '工具参数无效，请检查工具要求后重试。',
  validation: '请求参数无效，请检查输入和配置后重试。',
  cancellation: '请求已取消。',
  timeout: '请求超时，请稍后重试。',
};

export function createAgentError(stage: AgentErrorStage, reason: unknown, context: { requestId?: string; runId?: string; parentRunId?: string; key?: string; code?: string; retryable?: boolean; suggestion?: string; message?: string }): AgentErrorInfo {
  const aborted = reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError');
  const timeout = reason instanceof Error && reason.name === 'TimeoutError';
  const custom = reason instanceof AgentFailure ? reason : undefined;
  const resolvedStage = timeout ? 'timeout' : aborted ? 'cancellation' : custom?.stage || stage;
  const code = context.code || custom?.code || (resolvedStage === 'cancellation' ? 'REQUEST_CANCELLED' : resolvedStage === 'timeout' ? 'REQUEST_TIMEOUT' : `${resolvedStage.replaceAll('-', '_').toUpperCase()}_FAILED`);
  return {
    code,
    stage: resolvedStage,
    message: context.message || custom?.message || messages[resolvedStage],
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
    retryable: context.retryable ?? custom?.retryable ?? (resolvedStage !== 'validation' && resolvedStage !== 'tool-validation' && resolvedStage !== 'cancellation'),
    suggestion: context.suggestion || custom?.suggestion || suggestions[resolvedStage],
  };
}

export function failure(stage: AgentErrorStage, code: string, message: string, retryable = true, suggestion?: string) {
  return new AgentFailure(stage, code, message, retryable, suggestion || suggestions[stage]);
}

