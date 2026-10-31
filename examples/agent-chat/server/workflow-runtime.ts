import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Agent, fetch as undiciFetch } from 'undici';
import { randomUUID } from 'node:crypto';
import { logWorkflowDebug } from './workflow-debug';
import { generate, safeError, toolResultForModel, type FunctionTool, type StoredProvider, type ToolExecution } from './models';
import type { AgentModelConfig } from '../../../src/index';
import type { AgentSkill } from '../../../src/components/agent-sidebar/types';
import type { WorkflowAgent } from './workflow-agents';

export type WorkflowStep = { tool: string; status: 'running' | 'completed' | 'failed'; error?: string };
// Video responses can take longer than Undici's default five-minute header timeout.
// The workflow's AbortSignal still enforces its overall deadline and cancellation.
export const videoAnalysisDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
export type WorkflowDependencies = {
  workflowTools?: () => FunctionTool[];
  executeWorkflowTool?: (name: string, args: Record<string, unknown>, context: { sessionId: string; agentId: string; runId: string; skills: AgentSkill[]; signal: AbortSignal }) => Promise<unknown>;
};
export function workflowExecution(config: WorkflowAgent, skills: AgentSkill[], jobId: string, deps: WorkflowDependencies, steps: WorkflowStep[], save: () => void): ToolExecution | undefined {
  if (!config.toolNames.length) return undefined;
  const catalog = deps.workflowTools?.() || [];
  const tools = config.toolNames.map(name => {
    const tool = catalog.find(item => item.name === name);
    if (!tool) throw new Error(`工作流工具不可用：${name}`);
    return tool;
  });
  const validator = new AjvJsonSchemaValidator();
  return { tools, maxSteps: 8, execute: async (call, signal) => {
    const tool = tools.find(item => item.name === call.name);
    if (!tool || !deps.executeWorkflowTool || !signal) throw new Error('工作流工具不可用');
    logWorkflowDebug('tool.request', { toolCallId: call.id, tool: call.name, arguments: call.arguments });
    let args: Record<string, unknown>;
    try { args = JSON.parse(call.arguments); } catch { throw new Error(`工具 ${call.name} 参数不是有效 JSON`); }
    const valid = validator.getValidator(tool.parameters as Parameters<AjvJsonSchemaValidator['getValidator']>[0])(args);
    if (!valid.valid) throw new Error(`工具 ${call.name} 参数无效：${valid.errorMessage}`);
    const step: WorkflowStep = { tool: call.name, status: 'running' }; steps.push(step); save();
    try {
      const value = await deps.executeWorkflowTool(call.name, args, { sessionId: `workflow-${jobId}`, agentId: config.kind, runId: jobId, skills, signal });
      if (value && typeof value === 'object' && (value as { isError?: unknown }).isError === true) throw new Error(`工具 ${call.name} 执行失败`);
      step.status = 'completed'; save();
      const output = toolResultForModel(value as Record<string, unknown>);
      logWorkflowDebug('tool.response', { toolCallId: call.id, tool: call.name, output });
      return output;
    } catch (error) { step.status = 'failed'; step.error = safeError(error); save(); logWorkflowDebug('tool.error', { toolCallId: call.id, tool: call.name, error }); throw error; }
  } };
}
export function workflowInstructions(config: WorkflowAgent, skills: AgentSkill[]) {
  return [config.instructions, ...skills.map(skill => `# Skill: ${skill.name}\n${skill.instructions || ''}`)].join('\n\n');
}
export async function runTextWorkflow(provider: StoredProvider, model: AgentModelConfig, context: unknown, instructions: string, signal: AbortSignal, execution?: ToolExecution, onPartial?: (text: string) => void) {
  if (execution && model.capabilities?.tools === false) throw new Error('所选模型不支持工具调用，请更换模型或移除工具');
  let raw = '';
  try { for await (const chunk of generate(provider, model, [{ role: 'user', content: JSON.stringify(context) }], instructions, undefined, signal, execution)) raw += chunk; }
  catch (error) { if (raw) onPartial?.(raw); throw error; }
  return raw;
}
export async function runVideoWorkflow(baseUrl: string, apiKey: string, model: string, instructions: string, content: unknown[], signal: AbortSignal, execution?: ToolExecution, onPartial?: (text: string) => void) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('视频分析接口地址无效');
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: instructions }, { role: 'user', content }];
  for (let step = 0; step < 8; step++) {
    const body = { model, messages, ...(execution ? { tools: execution.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}) };
    const callId = randomUUID();
    logWorkflowDebug('model.request', { callId, modelId: model, protocol: 'video-chat-completions', url: `${url.toString().replace(/\/$/, '')}/chat/completions`, input: body });
    let response: Awaited<ReturnType<typeof undiciFetch>>, data: any;
    try {
      response = await undiciFetch(`${url.toString().replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal, dispatcher: videoAnalysisDispatcher, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      data = await response.json().catch(error => { if (signal.aborted || response.ok) throw error; return null; });
      logWorkflowDebug('model.response', { callId, status: response.status, output: data });
    } catch (error) {
      logWorkflowDebug('model.error', { callId, error });
      if (signal.aborted) {
        if (signal.reason?.name === 'TimeoutError') throw new Error('视频分析等待超时，任务已停止；上游可能仍在处理');
        throw signal.reason || error;
      }
      const code = error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? String(error.cause.code) : '';
      if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') throw new Error('视频分析接口响应超时，未收到完整结果');
      if (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') throw new Error('视频分析接口连接被中途关闭，未收到完整结果');
      if (error instanceof SyntaxError) throw new Error('视频分析接口返回了无效 JSON');
      throw new Error(safeError(error, apiKey));
    }
    if (!response.ok) throw new Error(safeError(new Error(`视频分析接口 HTTP ${response.status}：${data?.error?.message || response.statusText}`), apiKey));
    const choice = data?.choices?.[0], message = choice?.message;
    if (choice?.finish_reason === 'length') { if (typeof message?.content === 'string' && message.content) onPartial?.(message.content); throw new Error('视频分析结果被模型截断'); }
    const calls = message?.tool_calls;
    if (Array.isArray(calls) && calls.length) {
      if (!execution) throw new Error('视频分析模型返回了未授权的工具调用');
      if (calls.length > 8) throw new Error('单次返回的工作流工具调用数量超过上限');
      messages.push(message);
      for (const call of calls) {
        if (typeof call?.id !== 'string' || typeof call?.function?.name !== 'string' || typeof call?.function?.arguments !== 'string') throw new Error('视频分析接口返回了无效的工具调用');
        const output = await execution.execute({ id: call.id, name: call.function.name, arguments: call.function.arguments }, signal);
        if (typeof output !== 'string') throw new Error('当前视频分析协议不能接收工具返回的图片，请选择文本读取工具');
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
      continue;
    }
    if (choice?.finish_reason === 'tool_calls') throw new Error('视频模型未返回有效的工具调用');
    if (typeof message?.content !== 'string' || !message.content.trim()) throw new Error('视频分析接口未返回分析内容');
    return message.content as string;
  }
  throw new Error('已达到工作流工具调用上限，任务尚未完成');
}
