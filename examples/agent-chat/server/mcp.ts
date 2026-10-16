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
    const text = typeof message.content === 'string' ? message.content : message.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    for (const match of text.matchAll(/\[[^\]]+\]\(app:([^\s)]+)\)/g)) {
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

export function applicationConfigFingerprint(app: McpApplicationConfig) {
  return JSON.stringify([app.id, app.name, app.url, app.apiKey || '', [...(app.readOnlyTools || [])].sort()]);
}

type McpConnection = Awaited<ReturnType<typeof connectApplication>>;
type ConnectApplication = (app: McpApplicationConfig, signal: AbortSignal) => Promise<McpConnection>;

interface CachedConnection {
  appId: string;
  fingerprint: string;
  controller: AbortController;
  promise: Promise<McpConnection>;
  connection?: McpConnection;
}

/** Process-local MCP connection and tool-directory cache scoped by user/session. */
export class McpConnectionManager {
  private readonly entries = new Map<string, CachedConnection>();

  constructor(private readonly connect: ConnectApplication = connectApplication) {}

  async get(scopeKey: string, app: McpApplicationConfig, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = `${scopeKey}\u0000${app.id}`;
    const fingerprint = applicationConfigFingerprint(app);
    const existing = this.entries.get(key);
    if (existing && existing.fingerprint === fingerprint) return existing.promise;
    if (existing) await this.invalidateKey(key, existing);

    const controller = new AbortController();
    const entry = { appId: app.id, fingerprint, controller } as CachedConnection;
    const promise = this.connect(app, controller.signal).then((connection) => {
      const current = this.entries.get(key);
      if (!current || current.promise !== promise) {
        void connection.close();
        throw new Error('MCP 连接已失效，请重试');
      }
      current.connection = connection;
      return connection;
    }).catch((error) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });
    entry.promise = promise;
    this.entries.set(key, entry);
    return promise;
  }

  async reconcile(scopeKey: string, apps: McpApplicationConfig[]) {
    const fingerprints = new Map(apps.map((app) => [app.id, applicationConfigFingerprint(app)]));
    await Promise.all([...this.entries].flatMap(([key, entry]) => {
      if (!key.startsWith(`${scopeKey}\u0000`) || fingerprints.get(entry.appId) === entry.fingerprint) return [];
      return [this.invalidateKey(key, entry)];
    }));
  }

  async invalidate(scopeKey: string, appId: string) {
    const key = `${scopeKey}\u0000${appId}`;
    const entry = this.entries.get(key);
    if (entry) await this.invalidateKey(key, entry);
  }

  async invalidateAll(scopeKey?: string) {
    await Promise.all([...this.entries].flatMap(([key, entry]) => {
      if (scopeKey !== undefined && !key.startsWith(`${scopeKey}\u0000`)) return [];
      return [this.invalidateKey(key, entry)];
    }));
  }

  private async invalidateKey(key: string, entry: CachedConnection) {
    if (this.entries.get(key) === entry) this.entries.delete(key);
    entry.controller.abort();
    if (entry.connection) await entry.connection.close().catch(() => {});
  }
}

export async function connectApplication(app: McpApplicationConfig, signal: AbortSignal) {
  const transport = new StreamableHTTPClientTransport(new URL(app.url), {
    requestInit: { ...(app.apiKey ? { headers: { Authorization: `Bearer ${app.apiKey}` } } : {}), redirect: 'error' },
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
  });
  const client = new Client({ name: 'darl-ui-agent-chat', version: '0.1.0' });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
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
    const wrapped = new Error(safeError(error, app.apiKey), { cause: error });
    const status = error && typeof error === 'object' ? (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode : undefined;
    if (typeof status === 'number' || typeof status === 'string') Object.assign(wrapped, { status });
    throw wrapped;
  }
}

export async function applicationCatalog(directory: string, signal?: AbortSignal): Promise<AgentApplication[]> {
  const configs = await loadApplications(directory);
  void signal;
  return configs.map((app) => ({ id: app.id, name: app.name, description: 'MCP 工具按需发现', tools: [] }));
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
