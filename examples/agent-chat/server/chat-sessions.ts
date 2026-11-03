import { DatabaseSync } from 'node:sqlite';
import type { AgentSession } from '../../../src/index';
import type { ClientState, LocalStorage } from './storage';

export class ChatSessionConflict extends Error {}

function validateSession(value: unknown): AgentSession {
  const session = value as AgentSession | undefined;
  if (!session || typeof session.id !== 'string' || !session.id.trim() || session.id.length > 200
    || typeof session.title !== 'string' || session.title.length > 500
    || (session.agentId !== undefined && typeof session.agentId !== 'string')
    || (session.updatedAt !== undefined && typeof session.updatedAt !== 'string')
    || !Array.isArray(session.messages) || session.messages.some(message => !message || typeof message.id !== 'string' || typeof message.content !== 'string' || !['user', 'assistant', 'system'].includes(message.role))) throw new Error('聊天记录格式无效');
  if (JSON.stringify(session).length > 64 * 1024 * 1024) throw new Error('单个会话超过 64MB');
  return session;
}

/** Messages live separately from the catalog; only explicit, versioned deletes remove history. */
export class ChatSessionStore {
  private readonly database: DatabaseSync;

  constructor(storage: LocalStorage) {
    this.database = new DatabaseSync(storage.path);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, agent_id TEXT, updated_at TEXT,
        preview TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL,
        saved_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Keep the legacy snapshot intact for recovery. Never reimport deleted records on restart.
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (!storage.getConfig('chatSessionsMigrated')) {
        this.importLegacy(storage.getConfig<ClientState>('clientState')?.sessions || []);
        this.database.prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run('chatSessionsMigrated', 'true', new Date().toISOString());
      }
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  list() {
    return this.database.prepare("SELECT id, title, agent_id, updated_at, preview, version, json_array_length(data, '$.messages') AS message_count FROM chat_sessions WHERE deleted = 0 ORDER BY saved_at DESC, rowid ASC").all().map(row => ({
      id: row.id as string, title: row.title as string, ...(row.agent_id ? { agentId: row.agent_id as string } : {}),
      ...(row.updated_at ? { updatedAt: row.updated_at as string } : {}), messagePreview: row.preview as string, messageCount: row.message_count as number, version: row.version as number, messages: [],
    }));
  }

  get(id: string): { session: AgentSession; version: number } | undefined {
    const row = this.database.prepare('SELECT data, version FROM chat_sessions WHERE id = ? AND deleted = 0').get(id);
    return row ? { session: JSON.parse(row.data as string), version: row.version as number } : undefined;
  }

  save(value: unknown, expectedVersion: number) {
    const session = validateSession(value);
    if (!session.messages.length) throw new Error('空对话无需保存');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('聊天记录版本无效');
    const preview = session.messages.at(-1)?.content.slice(0, 160) || '';
    const args = [session.title, session.agentId || null, session.updatedAt || null, preview, JSON.stringify(session), new Date().toISOString()];
    const result = expectedVersion === 0
      ? this.database.prepare('INSERT OR IGNORE INTO chat_sessions (title, agent_id, updated_at, preview, data, saved_at, id, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run(...args, session.id)
      : this.database.prepare('UPDATE chat_sessions SET title = ?, agent_id = ?, updated_at = ?, preview = ?, data = ?, saved_at = ?, version = version + 1 WHERE id = ? AND version = ? AND deleted = 0').run(...args, session.id, expectedVersion);
    if (result.changes !== 1) throw new ChatSessionConflict('此对话已在其他页面更新或删除。当前修改尚未保存，请保留内容后重新加载对话。');
    return { version: expectedVersion + 1 };
  }

  rename(id: string, title: unknown, version: number) {
    if (typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('会话名称无效');
    const saved = this.get(id);
    if (!saved) throw new ChatSessionConflict('对话已删除，请刷新列表');
    return this.save({ ...saved.session, title: title.trim(), updatedAt: new Date().toLocaleString() }, version);
  }

  delete(id: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('聊天记录版本无效');
    const result = this.database.prepare('UPDATE chat_sessions SET deleted = 1, version = version + 1 WHERE id = ? AND version = ? AND deleted = 0').run(id, version);
    if (result.changes !== 1) throw new ChatSessionConflict('此对话已更新或删除，请重新加载后再删除');
  }

  /** Old clients may add conversations, but can no longer overwrite or delete saved history. */
  importLegacy(sessions: unknown[]) {
    const validated = sessions.map(validateSession);
    for (const session of validated) {
      const saved = this.database.prepare('SELECT data, deleted FROM chat_sessions WHERE id = ?').get(session.id);
      if (saved && (saved.deleted || saved.data !== JSON.stringify(session))) throw new ChatSessionConflict('聊天保存方式已更新，请刷新页面后继续。旧页面不能覆盖已保存的记录。');
    }
    for (const session of validated) {
      if (!this.database.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(session.id)) this.save(session, 0);
    }
  }

  close() { this.database.close(); }
}
