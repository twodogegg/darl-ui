import { DatabaseSync } from 'node:sqlite';
import type { FileStore, StoredFile } from './file-storage';

export type ProjectInput = {
  name: string;
  description: string | null;
  aspect_ratio: string;
  style_catalog_id: number;
};

export type StyleInput = { name: string; prompt: string; image?: Buffer; mimeType?: string };
type StyleRow = StoredRow & { file_id?: string | null };

type StoredRow = Record<string, string | number | Uint8Array | null>;

const ratios = new Set(['9:16', '16:9', '4:3', '1:1', '3:4', '21:9']);

/** Genuine built-in style presets; unlike the Playground's 90 demo cards, these are persisted catalog entries. */
const builtinStyles: Array<[string, string, string, number]> = [
  ['暖阳赛璐璐CG', '2D风格', '清透高饱和，阳光感', 1],
  ['原子朋克末日风格', '3D风格', '粗粝颗粒与电影光', 2],
  ['手绘质感3D动画', '3D风格', '手绘线稿与柔和体积光', 3],
  ['电影感', '真人风格', '自然肤色，浅景深', 4],
  ['UE5渲染风格', '3D风格', '真实材质与戏剧光', 5],
  ['电视剧感', '真人风格', '生活化镜头语言', 6],
  ['科幻国漫', '2D风格', '冷色霓虹与国漫线条', 1],
  ['科幻机甲CG', '3D风格', '硬表面机械细节', 2],
  ['国漫3D电影', '3D风格', '东方幻想与电影构图', 3],
  ['爱死机CG短片', '3D风格', '未来感工业质感', 4],
  ['漫画感3D动画', '2D风格', '大胆色块与漫画构图', 5],
  ['短剧风格', '真人风格', '情绪特写与柔光', 6],
  ['游戏动画电影感', '3D风格', '明亮奇幻世界', 1],
  ['时尚大片', '真人风格', '高级灰与棚拍质感', 2],
  ['温情家庭动画', '2D风格', '温暖柔和的生活感', 3],
];

export class ProjectStore {
  private readonly db: DatabaseSync;
  readonly files: FileStore;

  constructor(path: string, files: FileStore) {
    this.db = new DatabaseSync(path);
    this.files = files;
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS workspace_styles (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,',
      'prompt TEXT NOT NULL, preset_image TEXT, is_owned INTEGER NOT NULL DEFAULT 0,',
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE TABLE IF NOT EXISTS workspace_style_files (style_id INTEGER PRIMARY KEY REFERENCES workspace_styles(id), file_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE TABLE IF NOT EXISTS workspace_projects (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,',
      'aspect_ratio TEXT NOT NULL, style_catalog_id INTEGER NOT NULL REFERENCES workspace_styles(id),',
      'cover_file_id TEXT, status TEXT NOT NULL DEFAULT \'active\',',
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE INDEX IF NOT EXISTS workspace_projects_status_idx ON workspace_projects(status, id);',
    ].join('\n'));
    const projectColumns = this.db.prepare('PRAGMA table_info(workspace_projects)').all() as Array<{ name: string }>;
    if (!projectColumns.some((column) => column.name === 'cover_file_id')) this.db.exec('ALTER TABLE workspace_projects ADD COLUMN cover_file_id TEXT');
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO workspace_styles (id, name, category, prompt, preset_image) VALUES (?, ?, ?, ?, ?)',
    );
    builtinStyles.forEach(([name, category, prompt, image], index) =>
      insert.run(index + 1, name, category, prompt, '/media-workspace/scene-' + image + '.svg'));
  }

  styles() {
    const rows = this.db.prepare(
      'SELECT s.id, s.name, s.category, s.prompt, s.preset_image, s.is_owned, f.file_id FROM workspace_styles s LEFT JOIN workspace_style_files f ON f.style_id = s.id ORDER BY s.id',
    ).all() as StyleRow[];
    const serialize = (row: StyleRow) => ({
      id: Number(row.id), name: String(row.name), category: String(row.category),
      prompt: String(row.prompt),
      image_url: row.file_id && this.files ? this.files.originalUrl(String(row.file_id)) || '' : String(row.preset_image || ''),
      thumbnail_url: row.file_id && this.files ? this.files.thumbnailUrl(String(row.file_id), 320) || undefined : undefined,
    });
    return { items: rows.filter((row) => Number(row.is_owned) === 1).map(serialize),
      official_items: rows.filter((row) => Number(row.is_owned) !== 1).map(serialize) };
  }

  hasStyle(id: number) {
    return Boolean(this.db.prepare('SELECT 1 FROM workspace_styles WHERE id = ?').get(id));
  }

  async createStyle(value: StyleInput) {
    if (!value.name.trim() || value.name.trim().length > 80 ||
      !value.prompt.trim() || value.prompt.trim().length > 500) throw new Error('风格名称或描述无效');
    const files = this.requiredFiles();
    const file = value.image && value.mimeType ? await files.put(value.image, value.mimeType, `${value.name.trim()}-reference`) : undefined;
    const result = this.db.prepare(
      'INSERT INTO workspace_styles (name, category, prompt, is_owned) VALUES (?, ?, ?, 1)',
    ).run(value.name.trim(), '我的风格', value.prompt.trim());
    try {
      if (file) this.db.prepare('INSERT INTO workspace_style_files (style_id, file_id) VALUES (?, ?)').run(Number(result.lastInsertRowid), file.id);
    } catch (error) {
      this.db.prepare('DELETE FROM workspace_styles WHERE id = ?').run(Number(result.lastInsertRowid));
      if (file && !files.references(file.id)) await files.remove(file.id);
      throw error;
    }
    return { id: Number(result.lastInsertRowid) };
  }

  async updateStyle(id: number, value: StyleInput) {
    const existing = this.db.prepare('SELECT id FROM workspace_styles WHERE id = ? AND is_owned = 1').get(id);
    if (!existing) return null;
    if (!value.name.trim() || value.name.trim().length > 80 || !value.prompt.trim() || value.prompt.trim().length > 500)
      throw new Error('风格名称或描述无效');
    if (value.image && value.mimeType) {
      const previous = this.db.prepare('SELECT file_id FROM workspace_style_files WHERE style_id = ?').get(id) as { file_id?: string } | undefined;
      const files = this.requiredFiles();
      const file = await files.put(value.image, value.mimeType, `${value.name.trim()}-reference`);
      try {
        this.db.prepare('UPDATE workspace_styles SET name = ?, prompt = ? WHERE id = ?')
          .run(value.name.trim(), value.prompt.trim(), id);
        this.db.prepare('INSERT INTO workspace_style_files (style_id, file_id) VALUES (?, ?) ON CONFLICT(style_id) DO UPDATE SET file_id = excluded.file_id').run(id, file.id);
      } catch (error) {
        if (file.id !== previous?.file_id && !files.references(file.id)) await files.remove(file.id);
        throw error;
      }
      if (previous?.file_id && previous.file_id !== file.id) await files.removeUnreferenced(previous.file_id);
    } else {
      this.db.prepare('UPDATE workspace_styles SET name = ?, prompt = ? WHERE id = ?')
        .run(value.name.trim(), value.prompt.trim(), id);
    }
    return { id };
  }

  list() {
    return this.db.prepare(
      "SELECT * FROM workspace_projects WHERE status = 'active' ORDER BY id DESC",
    ).all().map((row) => this.serialize(row as StoredRow));
  }

  get(id: number) {
    const row = this.db.prepare(
      "SELECT * FROM workspace_projects WHERE id = ? AND status = 'active'",
    ).get(id) as StoredRow | undefined;
    return row ? this.serialize(row) : null;
  }

  private serialize(row: StoredRow) {
    const coverFile = row.cover_file_id && this.files ? this.files.get(String(row.cover_file_id)) : undefined;
    const coverUrl = coverFile && this.files ? this.files.originalUrl(coverFile) : undefined;
    const coverThumbnail = coverFile && this.files ? this.files.thumbnailUrl(coverFile, 320) : undefined;
    const coverPreview = coverFile && this.files ? this.files.thumbnailUrl(coverFile, 1024) : undefined;
    const style = this.db.prepare('SELECT id, name FROM workspace_styles WHERE id = ?')
      .get(Number(row.style_catalog_id)) as { id: number; name: string } | undefined;
    return {
      id: Number(row.id), name: String(row.name), description: row.description ?? null,
      aspect_ratio: String(row.aspect_ratio), style_catalog_id: Number(row.style_catalog_id),
      cover_asset: coverFile && coverUrl && coverThumbnail ? { file_id: coverFile.id, storage_key: coverUrl, thumbnail_url: coverThumbnail, ...(coverPreview ? { preview_url: coverPreview } : {}) } : null,
      style: style || null, episode_count: 0,
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  static validate(value: unknown): ProjectInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目字段格式无效');
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 30)
      throw new Error('标题必须为 1-30 个字符');
    if (item.description != null && (typeof item.description !== 'string' || item.description.length > 2000))
      throw new Error('项目简介不能超过 2000 字');
    if (!ratios.has(String(item.aspect_ratio))) throw new Error('不支持的画面比例');
    if (!Number.isSafeInteger(item.style_catalog_id) || Number(item.style_catalog_id) <= 0)
      throw new Error('请选择有效的视觉风格');
    return { name: item.name.trim(),
      description: typeof item.description === 'string' ? item.description.trim() || null : null,
      aspect_ratio: String(item.aspect_ratio), style_catalog_id: Number(item.style_catalog_id) };
  }

  create(value: ProjectInput) {
    if (!this.hasStyle(value.style_catalog_id)) throw new Error('视觉风格不存在');
    const result = this.db.prepare(
      'INSERT INTO workspace_projects (name, description, aspect_ratio, style_catalog_id) VALUES (?, ?, ?, ?)',
    ).run(value.name, value.description, value.aspect_ratio, value.style_catalog_id);
    const id = Number(result.lastInsertRowid);
    return { project_id: id, project: this.get(id) };
  }

  update(id: number, value: ProjectInput) {
    if (!this.get(id)) return null;
    if (!this.hasStyle(value.style_catalog_id)) throw new Error('视觉风格不存在');
    this.db.prepare(
      "UPDATE workspace_projects SET name = ?, description = ?, aspect_ratio = ?, style_catalog_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
    ).run(value.name, value.description, value.aspect_ratio, value.style_catalog_id, id);
    return this.get(id);
  }

  archive(id: number) {
    return this.db.prepare(
      "UPDATE workspace_projects SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
    ).run(id).changes > 0;
  }

  async uploadCover(projectId: number, mimeType: string, data: Buffer) {
    if (!this.get(projectId)) return null;
    const files = this.requiredFiles();
    const file = await files.put(data, mimeType, `project-${projectId}-cover`);
    return { file_id: file.id, url: files.originalUrl(file) };
  }

  async selectCoverFile(projectId: number, file: StoredFile) {
    if (!this.get(projectId)) return null;
    const files = this.requiredFiles();
    const previous = this.db.prepare('SELECT cover_file_id FROM workspace_projects WHERE id = ?').get(projectId) as { cover_file_id?: string } | undefined;
    this.db.prepare("UPDATE workspace_projects SET cover_file_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").run(file.id, projectId);
    if (previous?.cover_file_id && previous.cover_file_id !== file.id) await files.removeUnreferenced(previous.cover_file_id);
    return this.get(projectId);
  }

  private requiredFiles() {
    if (!this.files) throw new Error('文件存储不可用');
    return this.files;
  }
}
