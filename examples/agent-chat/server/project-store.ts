import { DatabaseSync } from 'node:sqlite';

export type ProjectInput = {
  name: string;
  description: string | null;
  aspect_ratio: string;
  style_catalog_id: number;
};

export type StyleInput = { name: string; prompt: string; image?: Buffer; mimeType?: string };

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

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS workspace_styles (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,',
      'prompt TEXT NOT NULL, preset_image TEXT, is_owned INTEGER NOT NULL DEFAULT 0,',
      'image_mime TEXT, image_data BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE TABLE IF NOT EXISTS workspace_projects (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,',
      'aspect_ratio TEXT NOT NULL, style_catalog_id INTEGER NOT NULL REFERENCES workspace_styles(id),',
      'cover_asset_id INTEGER, status TEXT NOT NULL DEFAULT \'active\',',
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE TABLE IF NOT EXISTS workspace_covers (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES workspace_projects(id),',
      'mime_type TEXT NOT NULL, image_data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'CREATE INDEX IF NOT EXISTS workspace_projects_status_idx ON workspace_projects(status, id);',
    ].join('\n'));
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO workspace_styles (id, name, category, prompt, preset_image) VALUES (?, ?, ?, ?, ?)',
    );
    builtinStyles.forEach(([name, category, prompt, image], index) =>
      insert.run(index + 1, name, category, prompt, '/media-workspace/scene-' + image + '.svg'));
  }

  styles() {
    const rows = this.db.prepare(
      'SELECT id, name, category, prompt, preset_image, is_owned, image_mime FROM workspace_styles ORDER BY id',
    ).all() as StoredRow[];
    const serialize = (row: StoredRow) => ({
      id: Number(row.id), name: String(row.name), category: String(row.category),
      prompt: String(row.prompt), image_url: row.image_mime ? '/storage/styles/' + row.id : (row.preset_image || ''),
    });
    return { items: rows.filter((row) => Number(row.is_owned) === 1).map(serialize),
      official_items: rows.filter((row) => Number(row.is_owned) !== 1).map(serialize) };
  }

  hasStyle(id: number) {
    return Boolean(this.db.prepare('SELECT 1 FROM workspace_styles WHERE id = ?').get(id));
  }

  createStyle(value: StyleInput) {
    if (!value.name.trim() || value.name.trim().length > 80 ||
      !value.prompt.trim() || value.prompt.trim().length > 500) throw new Error('风格名称或描述无效');
    const result = this.db.prepare(
      'INSERT INTO workspace_styles (name, category, prompt, is_owned, image_mime, image_data) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(value.name.trim(), '我的风格', value.prompt.trim(), value.mimeType || null, value.image || null);
    return { id: Number(result.lastInsertRowid) };
  }

  updateStyle(id: number, value: StyleInput) {
    const existing = this.db.prepare('SELECT id FROM workspace_styles WHERE id = ? AND is_owned = 1').get(id);
    if (!existing) return null;
    if (!value.name.trim() || value.name.trim().length > 80 || !value.prompt.trim() || value.prompt.trim().length > 500)
      throw new Error('风格名称或描述无效');
    if (value.image && value.mimeType) {
      this.db.prepare('UPDATE workspace_styles SET name = ?, prompt = ?, image_mime = ?, image_data = ? WHERE id = ?')
        .run(value.name.trim(), value.prompt.trim(), value.mimeType, value.image, id);
    } else {
      this.db.prepare('UPDATE workspace_styles SET name = ?, prompt = ? WHERE id = ?')
        .run(value.name.trim(), value.prompt.trim(), id);
    }
    return { id };
  }

  image(kind: 'covers' | 'styles', id: number): { mime: string; data: Uint8Array } | null {
    const sql = kind === 'covers'
      ? 'SELECT mime_type AS mime, image_data AS data FROM workspace_covers WHERE id = ?'
      : 'SELECT image_mime AS mime, image_data AS data FROM workspace_styles WHERE id = ? AND image_data IS NOT NULL';
    const row = this.db.prepare(sql).get(id) as { mime: string; data: Uint8Array } | undefined;
    return row ? { mime: row.mime, data: row.data } : null;
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

  private episodeCount(projectId: number): number {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_episodes'").get();
    if (!exists) return 0;
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM workspace_episodes WHERE project_id=?').get(projectId) as { count:number }).count);
  }
  private serialize(row: StoredRow) {
    const coverId = row.cover_asset_id ? Number(row.cover_asset_id) : null;
    const style = this.db.prepare('SELECT id, name FROM workspace_styles WHERE id = ?')
      .get(Number(row.style_catalog_id)) as { id: number; name: string } | undefined;
    return {
      id: Number(row.id), name: String(row.name), description: row.description ?? null,
      aspect_ratio: String(row.aspect_ratio), style_catalog_id: Number(row.style_catalog_id),
      cover_asset_id: coverId, cover_asset: coverId ? { storage_key: 'covers/' + coverId } : null,
      style: style || null, episode_count: this.episodeCount(Number(row.id)),
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

  uploadCover(projectId: number, mimeType: string, data: Buffer) {
    if (!this.get(projectId)) return null;
    const result = this.db.prepare(
      'INSERT INTO workspace_covers (project_id, mime_type, image_data) VALUES (?, ?, ?)',
    ).run(projectId, mimeType, data);
    return { id: Number(result.lastInsertRowid) };
  }

  selectCover(projectId: number, coverId: number) {
    const exists = this.db.prepare('SELECT 1 FROM workspace_covers WHERE id = ? AND project_id = ?')
      .get(coverId, projectId);
    if (!exists) return null;
    this.db.prepare(
      "UPDATE workspace_projects SET cover_asset_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
    ).run(coverId, projectId);
    return this.get(projectId);
  }
}
