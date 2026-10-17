// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applicationCatalog, conversationApplications, loadApplications, McpConnectionManager, toolRisk, ToolConfirmations, type McpApplicationConfig } from '../examples/agent-chat/server/mcp';
import { safeError } from '../examples/agent-chat/server/models';

const app = { id: 'catalog', name: 'Catalog', url: 'https://example.test/mcp', readOnlyTools: ['search'] };

describe('MCP host policy', () => {
  it('lists configured applications without connecting or discovering tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-mcp-catalog-'));
    try {
      await writeFile(join(directory, 'applications.json'), JSON.stringify([app]));
      expect(await applicationCatalog(directory)).toEqual([{ id: app.id, name: app.name, url: app.url, description: 'MCP 工具按需发现', tools: [] }]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reuses concurrent and sequential connections only within a user/session scope', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn(async (value: McpApplicationConfig) => ({ app: value, tools: [], close, call: vi.fn() }));
    const manager = new McpConnectionManager(connect);
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([manager.get('user-a:session-a', app, signal), manager.get('user-a:session-a', app, signal)]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    await manager.get('user-a:session-b', app, signal);
    await manager.get('user-b:session-a', app, signal);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('invalidates old configuration and reconnects after explicit refresh or failure', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn(async (value: McpApplicationConfig) => ({ app: value, tools: [], close, call: vi.fn() }));
    const manager = new McpConnectionManager(connect);
    const signal = new AbortController().signal;
    await manager.get('scope', app, signal);
    await manager.get('scope', { ...app, apiKey: 'new-key' }, signal);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    await manager.invalidate('scope', app.id);
    await manager.get('scope', { ...app, apiKey: 'new-key' }, signal);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(2);

    const failedConnect = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 401'))
      .mockImplementation(async (value: McpApplicationConfig) => ({ app: value, tools: [], close, call: vi.fn() }));
    const recovering = new McpConnectionManager(failedConnect);
    await expect(recovering.get('scope', app, signal)).rejects.toThrow('HTTP 401');
    await recovering.get('scope', app, signal);
    expect(failedConnect).toHaveBeenCalledTimes(2);
  });

  it('keeps user-referenced applications available on follow-ups and restored history', () => {
    const other = { ...app, id: 'other', name: 'Other' };
    const messages = [{ role: 'user' as const, content: '[素材库](app:catalog) 能做什么？' }, { role: 'assistant' as const, content: '可以查询素材。' }, { role: 'user' as const, content: '我有哪些素材？' }];
    expect(conversationApplications([app, other], [], JSON.parse(JSON.stringify(messages)))).toEqual([app]);
    expect(conversationApplications([app, other], ['other', 'catalog'], messages)).toEqual([other, app]);
  });

  it('isolates new conversations and excludes references after a regenerated turn', () => {
    const messages = [{ role: 'user' as const, content: '在吗？' }, { role: 'assistant' as const, content: '在。' }, { role: 'user' as const, content: '[素材库](app:catalog) 查询素材' }];
    expect(conversationApplications([app], [], [{ role: 'user', content: '新对话' }])).toEqual([]);
    expect(conversationApplications([app], [], messages.slice(0, 1))).toEqual([]);
    expect(conversationApplications([app], [], messages)).toEqual([app]);
  });

  it('ignores assistant references, removed apps and malformed IDs while rejecting unknown explicit selections', () => {
    const messages = [{ role: 'assistant' as const, content: '[素材库](app:catalog)' }, { role: 'user' as const, content: '@素材库 [旧应用](app:removed) [错误](app:%ZZ)' }];
    expect(conversationApplications([app], [], messages)).toEqual([]);
    expect(conversationApplications([app], [], [{ role: 'user', content: '[素材库](app:%63atalog) [再次引用](app:catalog)' }])).toEqual([app]);
    expect(() => conversationApplications([app], ['removed'], [])).toThrow('所选应用不存在');
  });

  it('requires confirmation for unknown tools and gives destructive hints precedence over overrides', () => {
    const tool = { name: 'search', inputSchema: { type: 'object' as const } };
    expect(toolRisk(app, tool)).toBe('read');
    expect(toolRisk(app, { ...tool, name: 'unknown' })).toBe('write');
    expect(toolRisk(app, { ...tool, name: 'read', annotations: { readOnlyHint: true } })).toBe('read');
    expect(toolRisk(app, { ...tool, annotations: { destructiveHint: true } })).toBe('dangerous');
    expect(safeError(new Error('auth ahk_private-example'))).toBe('auth [已隐藏]');
  });

  it('accepts each confirmation once and keeps simultaneous calls independent', async () => {
    const confirmations = new ToolConfirmations();
    const signal = new AbortController().signal;
    const first = confirmations.wait('first', signal);
    const second = confirmations.wait('second', signal);
    confirmations.decide('second', false);
    confirmations.decide('first', true);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(() => confirmations.decide('first', true)).toThrow('已过期');
  });

  it('expires pending confirmations when a run is stopped', async () => {
    const confirmations = new ToolConfirmations();
    const controller = new AbortController();
    const pending = confirmations.wait('stopped', controller.signal);
    const rejected = expect(pending).rejects.toThrow('已停止');
    controller.abort();
    await rejected;
    expect(() => confirmations.decide('stopped', true)).toThrow('已过期');
    expect(() => confirmations.wait('already-aborted', controller.signal)).toThrow();
  });

  it('loads only valid server-managed application configurations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-mcp-'));
    const file = join(directory, 'applications.json');
    try {
      expect(await loadApplications(directory)).toEqual([]);
      await writeFile(file, JSON.stringify([app]));
      expect(await loadApplications(directory)).toEqual([app]);
      await writeFile(file, JSON.stringify([app, app]));
      await expect(loadApplications(directory)).rejects.toThrow('ID');
      await writeFile(file, JSON.stringify([{ ...app, url: 'https://example.test/mcp?key=secret' }]));
      await expect(loadApplications(directory)).rejects.toThrow('地址');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
