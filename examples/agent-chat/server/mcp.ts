import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AgentApplication } from '../../../src/index';
import { safeError, type ChatMessage } from './models';

export interface McpApplicationConfig {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  /** Host-reviewed exceptions for servers without readOnlyHint annotations. */
  readOnlyTools?: string[];
}

export function conversationApplications(configs: McpApplicationConfig[], applicationIds: string[], messages: ChatMessage[]) {
  const selected = new Set(applicationIds);
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const match of message.content.matchAll(/\[[^\]]+\]\(app:([^\s)]+)\)/g)) {
      let id: string;
      try { id = decodeURIComponent(match[1]); } catch { continue; }
      if (configs.some((app) => app.id === id)) selected.add(id);
    }
  }
  return [...selected].map((id) => {
    const app = configs.find((item) => item.id === id);
    if (!app) throw new Error('所选应用不存在，请刷新应用列表');
    return app;
  });
}

export async function loadApplications(directory: string): Promise<McpApplicationConfig[]> {
  let value: McpApplicationConfig[];
  try { value = JSON.parse(await readFile(resolve(directory, 'applications.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (!Array.isArray(value) || value.length > 20) throw new Error('MCP 应用配置无效');
  const ids = new Set<string>();
  for (const app of value) {
    if (!app || !/^[\w-]{1,80}$/.test(app.id) || ids.has(app.id) || !app.name?.trim()) throw new Error('MCP 应用 ID 或名称无效');
    const url = new URL(app.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MCP 地址必须为不含凭证或查询参数的 HTTP(S) 地址');
    if (app.apiKey !== undefined && typeof app.apiKey !== 'string') throw new Error('MCP 密钥格式无效');
    if (app.readOnlyTools && (!Array.isArray(app.readOnlyTools) || app.readOnlyTools.some((name) => typeof name !== 'string'))) throw new Error('MCP 只读工具配置无效');
    ids.add(app.id);
  }
  return value;
}

export function toolRisk(app: McpApplicationConfig, tool: Tool): 'read' | 'write' | 'dangerous' {
  if (tool.annotations?.destructiveHint === true) return 'dangerous';
  if (app.readOnlyTools?.includes(tool.name) || tool.annotations?.readOnlyHint === true) return 'read';
  return 'write';
}

export async function connectApplication(app: McpApplicationConfig, signal: AbortSignal) {
  const transport = new StreamableHTTPClientTransport(new URL(app.url), {
    requestInit: { ...(app.apiKey ? { headers: { Authorization: `Bearer ${app.apiKey}` } } : {}), redirect: 'error' },
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
  });
  const client = new Client({ name: 'darl-ui-agent-chat', version: '0.1.0' });
  const close = async () => {
    try { await transport.terminateSession(); } catch { /* Some servers do not support session deletion. */ }
    await client.close();
  };
  try {
    await client.connect(transport, { signal, timeout: 20_000 });
    const tools: Tool[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 20_000 });
      tools.push(...page.tools);
      if (tools.length > 128) throw new Error('单个 MCP 应用的工具超过 128 个');
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('MCP 工具分页游标重复');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error('MCP 返回重复的工具名称');
    return { app, tools, close, call: async (name: string, args: Record<string, unknown>, callSignal = signal) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal: AbortSignal.any([signal, callSignal]), timeout: 60_000 });
      // Strip server-only widget metadata and embedded base64 media from text-model context.
      const content = Array.isArray(result.content) ? result.content.map((block) => {
        if (block.type === 'image' || block.type === 'audio') return { type: block.type, mimeType: block.mimeType, text: '二进制媒体内容未传给文本模型' };
        return block;
      }) : [];
      const json = JSON.stringify({ content, ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}), isError: result.isError === true });
      if (json.length > 200_000) throw new Error('工具结果超过 200KB，请缩小查询范围');
      return JSON.parse(app.apiKey ? json.split(app.apiKey).join('[已隐藏]') : json) as { content: unknown[]; structuredContent?: unknown; isError: boolean };
    } };
  } catch (error) {
    await close().catch(() => {});
    throw new Error(safeError(error, app.apiKey));
  }
}

export async function applicationCatalog(directory: string, signal: AbortSignal): Promise<AgentApplication[]> {
  const configs = await loadApplications(directory);
  return Promise.all(configs.map(async (app) => {
    try {
      const connection = await connectApplication(app, signal);
      try {
        return { id: app.id, name: app.name, status: 'connected' as const, description: `${connection.tools.length} 个 MCP 工具`, tools: connection.tools.map((tool) => ({ name: tool.name, title: tool.title || tool.annotations?.title, description: tool.description, risk: toolRisk(app, tool) })) };
      } finally { await connection.close(); }
    } catch (error) {
      return { id: app.id, name: app.name, status: 'disconnected' as const, description: safeError(error, app.apiKey), tools: [] };
    }
  }));
}

export class ToolConfirmations {
  private pending = new Map<string, (approved: boolean) => void>();

  wait(id: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (this.pending.has(id)) throw new Error('工具确认 ID 重复');
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending.delete(id); signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new Error('工具调用已停止')); };
      this.pending.set(id, (approved) => { cleanup(); resolve(approved); });
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  decide(id: string, approved: boolean) {
    const resolve = this.pending.get(id);
    if (!resolve) throw new Error('确认已过期或已处理，请重新发起请求');
    resolve(approved);
  }
}
