import { chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ClientState { sessions: unknown[]; activeId?: string; skills: unknown[] }

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
    `);
    chmodSync(this.path, 0o600);
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
  const state = { sessions: item.sessions, skills: item.skills, ...(item.activeId ? { activeId: item.activeId } : {}) };
  if (JSON.stringify(state).length > 80 * 1024 * 1024) throw new Error('本地状态超过 80MB');
  return state;
}
