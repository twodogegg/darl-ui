import { chmodSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ChatMessage } from './models';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ClientState { sessions: unknown[]; activeId?: string; skills: unknown[] }
export interface SubAgentThreadKey {
  scope: string;
  rootSessionId: string;
  parentAgentId: string;
  childAgentId: string;
}
export interface StoredSubAgentThread extends SubAgentThreadKey {
  id: string;
  version: number;
  updatedAt: string;
  messages: ChatMessage[];
}
export interface AgentInvocationRecord {
  id: string;
  scope: string;
  rootSessionId: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
  contextStrategy: string;
  contextScope: string;
  result: string;
  status: 'success' | 'error';
  createdAt: string;
}

/** Single-user local persistence for the example host. SQLite is the only source of truth. */
export class LocalStorage {
  readonly path: string;
  private readonly database: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = resolve(directory, 'data.sqlite');
    this.database = new DatabaseSync(this.path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subagent_threads (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        parent_agent_id TEXT NOT NULL,
        child_agent_id TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (scope, root_session_id, parent_agent_id, child_agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_subagent_threads_parent
        ON subagent_threads (scope, root_session_id, updated_at);
      CREATE TABLE IF NOT EXISTS agent_invocations (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        parent_agent_id TEXT NOT NULL,
        child_agent_id TEXT NOT NULL,
        task TEXT NOT NULL,
        context_strategy TEXT NOT NULL,
        context_scope TEXT NOT NULL,
        result TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_invocations_session
        ON agent_invocations (scope, root_session_id, created_at);
    `);
    chmodSync(this.path, 0o600);
  }

  saveAgentInvocation(record: Omit<AgentInvocationRecord, 'id' | 'createdAt'>): AgentInvocationRecord {
    const saved: AgentInvocationRecord = { ...record, id: randomUUID(), createdAt: new Date().toISOString() };
    if (Object.values(saved).some((value) => typeof value !== 'string') || saved.task.length > 100_000 || saved.result.length > 1_000_000) throw new Error('Agent 调用记录无效');
    this.database.prepare(`INSERT INTO agent_invocations (id, scope, root_session_id, parent_agent_id, child_agent_id, task, context_strategy, context_scope, result, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(saved.id, saved.scope, saved.rootSessionId, saved.parentAgentId, saved.childAgentId, saved.task, saved.contextStrategy, saved.contextScope, saved.result, saved.status, saved.createdAt);
    return saved;
  }

  getAgentInvocations(scope?: string, rootSessionId?: string): AgentInvocationRecord[] {
    const rows = scope && rootSessionId
      ? this.database.prepare('SELECT id, scope, root_session_id, parent_agent_id, child_agent_id, task, context_strategy, context_scope, result, status, created_at FROM agent_invocations WHERE scope = ? AND root_session_id = ? ORDER BY created_at ASC').all(scope, rootSessionId)
      : this.database.prepare('SELECT id, scope, root_session_id, parent_agent_id, child_agent_id, task, context_strategy, context_scope, result, status, created_at FROM agent_invocations ORDER BY created_at DESC LIMIT 500').all();
    return rows.map((row) => { const item = row as Record<string, string>; return { id: item.id, scope: item.scope, rootSessionId: item.root_session_id, parentAgentId: item.parent_agent_id, childAgentId: item.child_agent_id, task: item.task, contextStrategy: item.context_strategy, contextScope: item.context_scope, result: item.result, status: item.status as AgentInvocationRecord['status'], createdAt: item.created_at }; });
  }

  getConfig<T>(key: string): T | undefined {
    const row = this.database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value?: string } | undefined;
    if (!row?.value) return undefined;
    return JSON.parse(row.value) as T;
  }

  setConfig<T>(key: string, value: T) {
    this.database.prepare(`
      INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }

  /** The demo uses a fixed local scope; multi-user hosts must provide authenticated isolation. */
  getSubAgentThread(key: SubAgentThreadKey): StoredSubAgentThread | undefined {
    const row = this.database.prepare(
      'SELECT id, version, updated_at, messages_json FROM subagent_threads WHERE scope = ? AND root_session_id = ? AND parent_agent_id = ? AND child_agent_id = ?'
    ).get(key.scope, key.rootSessionId, key.parentAgentId, key.childAgentId) as { id: string; version: number; updated_at: string; messages_json: string } | undefined;
    if (!row) return undefined;
    return { ...key, id: row.id, version: row.version, updatedAt: row.updated_at, messages: JSON.parse(row.messages_json) as ChatMessage[] };
  }

  /** Atomic optimistic version check also prevents stale writes by a second process. */
  saveSubAgentThread(key: SubAgentThreadKey, messages: ChatMessage[], expectedVersion: number): StoredSubAgentThread {
    if (Object.values(key).some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)) throw new Error('子 Agent 会话标识无效');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('子 Agent 会话版本无效');
    const json = JSON.stringify(messages);
    if (!Array.isArray(messages) || messages.length > 200 || json.length > 16_000_000) throw new Error('子 Agent 会话历史过长');
    const updatedAt = new Date().toISOString();
    if (expectedVersion === 0) {
      const id = randomUUID();
      const result = this.database.prepare(
        'INSERT OR IGNORE INTO subagent_threads (id, scope, root_session_id, parent_agent_id, child_agent_id, messages_json, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
      ).run(id, key.scope, key.rootSessionId, key.parentAgentId, key.childAgentId, json, updatedAt);
      if (result.changes !== 1) throw new Error('子 Agent 会话已被其他请求更新，请重试');
      return { ...key, id, version: 1, updatedAt, messages };
    }
    const result = this.database.prepare(
      'UPDATE subagent_threads SET messages_json = ?, version = version + 1, updated_at = ? WHERE scope = ? AND root_session_id = ? AND parent_agent_id = ? AND child_agent_id = ? AND version = ?'
    ).run(json, updatedAt, key.scope, key.rootSessionId, key.parentAgentId, key.childAgentId, expectedVersion);
    if (result.changes !== 1) throw new Error('子 Agent 会话已被其他请求更新，请重试');
    const saved = this.getSubAgentThread(key);
    if (!saved) throw new Error('子 Agent 会话不存在');
    return saved;
  }

  getMediaTasks<T>(): T[] {
    return this.database.prepare('SELECT data FROM media_tasks ORDER BY updated_at DESC').all().map((row) => JSON.parse((row as { data: string }).data) as T);
  }

  setMediaTasks<T extends { id: string; title: string }>(tasks: T[]) {
    if (!Array.isArray(tasks) || tasks.length > 500) throw new Error('媒体任务数量无效');
    this.database.exec('BEGIN');
    try {
      this.database.exec('DELETE FROM media_tasks');
      const statement = this.database.prepare('INSERT INTO media_tasks (id, title, updated_at, data) VALUES (?, ?, ?, ?)');
      const now = new Date().toISOString();
      tasks.forEach((task) => statement.run(task.id, task.title, now, JSON.stringify(task)));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function validateClientState(value: unknown): ClientState {
  if (!value || typeof value !== 'object') throw new Error('本地状态格式无效');
  const item = value as Partial<ClientState>;
  if (!Array.isArray(item.sessions) || item.sessions.length > 500) throw new Error('会话数量无效');
  if (!Array.isArray(item.skills) || item.skills.length > 200) throw new Error('Skill 数量无效');
  if (item.activeId !== undefined && typeof item.activeId !== 'string') throw new Error('当前会话无效');
  const sessions = item.sessions.filter((session) => Array.isArray((session as { messages?: unknown[] } | null)?.messages) && (session as { messages: unknown[] }).messages.length > 0);
  const state = { sessions, skills: item.skills, ...(item.activeId ? { activeId: item.activeId } : {}) };
  if (JSON.stringify(state).length > 80 * 1024 * 1024) throw new Error('本地状态超过 80MB');
  return state;
}
