import COS from 'cos-nodejs-sdk-v5';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';

export type StorageBackend = 'local' | 'cos';
export type StoredFile = {
  id: string;
  sha256: string;
  name: string;
  mimeType: string;
  size: number;
  extension: string;
  backend: StorageBackend;
  objectKey: string;
  createdAt: string;
  config: FileStoreOptions;
};

type FileRow = {
  id: string; sha256: string; name: string; mime_type: string; size: number; extension: string;
  backend: StorageBackend; object_key: string; created_at: string; config_json: string;
};

export type FileStoreOptions = {
  mode?: string;
  root?: string;
  prefix?: string;
  region?: string;
  bucket?: string;
  scheme?: string;
  publicBaseUrl?: string;
  secretId?: string;
  secretKey?: string;
};

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const FILE_MIMES = new Set([...IMAGE_MIMES, 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/x-wav', 'audio/ogg', 'audio/opus', 'audio/flac', 'application/pdf', 'text/plain', 'application/zip', 'application/octet-stream']);
const WIDTHS = new Set([160, 320, 640, 1024]);
const extensionFor = (mime: string, name = '') => {
  const fromName = extname(name).replace(/^\./, '').toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  return mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
};
const mimeForExtension = (extension: string) => extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
  : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif'
    : extension === 'mp4' ? 'video/mp4' : 'application/octet-stream';

function publicCosUrl(base: string | undefined, scheme: string, bucket: string, region: string, key: string) {
  const root = (base || `${scheme}://${bucket}.cos.${region}.myqcloud.com`).replace(/\/$/, '');
  return `${root}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export class FileStore {
  private readonly db: DatabaseSync;
  private cos?: InstanceType<typeof COS>;
  mode: StorageBackend;
  root: string;
  prefix: string;
  region: string;
  bucket: string;
  scheme: string;
  publicBaseUrl?: string;
  private readonly localRoot: string;
  private cosSecretId?: string;
  private cosSecretKey?: string;

  constructor(dbPath: string, options: FileStoreOptions = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_assets (
        id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL,
        size INTEGER NOT NULL, extension TEXT NOT NULL, backend TEXT NOT NULL,
        object_key TEXT NOT NULL, created_at TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS file_assets_backend_key_idx ON file_assets(backend, object_key);
    `);
    const columns = this.db.prepare('PRAGMA table_info(file_assets)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'name')) this.db.exec("ALTER TABLE file_assets ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    if (!columns.some((column) => column.name === 'config_json')) this.db.exec("ALTER TABLE file_assets ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'");
    this.root = options.root || join(dirname(dbPath), 'files');
    this.prefix = (options.prefix || 'darl-ui').replace(/^\/+|\/+$/g, '') || 'darl-ui';
    this.region = options.region || 'ap-guangzhou';
    this.bucket = options.bucket || '';
    this.scheme = options.scheme || 'https';
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, '') || undefined;
    this.localRoot = this.root;
    this.cosSecretId = options.secretId;
    this.cosSecretKey = options.secretKey;
    const wantsCos = (options.mode || '').toLowerCase() === 'cos' || Boolean(options.secretId && options.secretKey && options.bucket);
    if (wantsCos && (!options.secretId || !options.secretKey || !this.bucket)) throw new Error('COS 模式需要 COS_SECRET_ID、COS_SECRET_KEY 和 COS_BUCKET');
    this.mode = wantsCos ? 'cos' : 'local';
    if (this.mode === 'cos') this.cos = new COS({ SecretId: options.secretId, SecretKey: options.secretKey });
    else mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  configure(options: FileStoreOptions) {
    const mode = options.mode || 'local';
    if (mode !== 'local' && mode !== 'cos') throw new Error('存储模式只能是 local 或 cos');
    const secretId = options.secretId || this.cosSecretId;
    const secretKey = options.secretKey || this.cosSecretKey;
    if (mode === 'cos' && (!secretId || !secretKey || !options.bucket)) throw new Error('COS 模式需要完整配置 SecretId、SecretKey 和 Bucket');
    this.root = options.root || this.localRoot;
    this.prefix = (options.prefix || 'darl-ui').replace(/^\/+|\/+$/g, '') || 'darl-ui';
    this.region = options.region || 'ap-guangzhou';
    this.bucket = options.bucket || '';
    this.scheme = options.scheme || 'https';
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, '') || undefined;
    this.mode = mode;
    this.cosSecretId = secretId;
    this.cosSecretKey = secretKey;
    this.cos = mode === 'cos' ? new COS({ SecretId: secretId, SecretKey: secretKey }) : undefined;
    if (mode === 'local') mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  private rowToFile(row: FileRow) {
    const file: Omit<StoredFile, 'config'> = { id: row.id, sha256: row.sha256, name: row.name, mimeType: row.mime_type, size: Number(row.size), extension: row.extension, backend: row.backend, objectKey: row.object_key, createdAt: row.created_at };
    let config: FileStoreOptions = {};
    try { config = JSON.parse(row.config_json) as FileStoreOptions; } catch { /* Keep safe defaults for rows created before snapshots existed. */ }
    return { ...file, config };
  }
  get(id: string) {
    const row = this.db.prepare('SELECT * FROM file_assets WHERE id = ?').get(id) as FileRow | undefined;
    return row ? this.rowToFile(row) : undefined;
  }
  byHash(sha256: string) {
    const row = this.db.prepare('SELECT * FROM file_assets WHERE sha256 = ?').get(sha256) as FileRow | undefined;
    return row ? this.rowToFile(row) : undefined;
  }
  fromUrl(value: unknown) {
    if (typeof value !== 'string') return undefined;
    const local = /^\/api\/files\/([a-f0-9-]+)(?:[?#].*)?$/.exec(value);
    if (local) return this.get(local[1]);
    const original = value.split('?')[0].split('#')[0];
    return this.list().find(file => file.backend === 'cos' && this.originalUrl(file) === original);
  }
  originalUrl(file: StoredFile | string) {
    const item = typeof file === 'string' ? this.get(file) : file;
    if (!item) return undefined;
    if (item.backend !== 'cos') return `/api/files/${encodeURIComponent(item.id)}`;
    const config = this.fileConfig(item);
    return publicCosUrl(config.publicBaseUrl, config.scheme || 'https', config.bucket || '', config.region || 'ap-guangzhou', item.objectKey);
  }
  thumbnailUrl(file: StoredFile | string, width: 160 | 320 | 640 | 1024) {
    const item = typeof file === 'string' ? this.get(file) : file;
    if (!item || !IMAGE_MIMES.has(item.mimeType)) return this.originalUrl(item || '');
    if (item.backend === 'cos') {
      const original = this.originalUrl(item);
      return `${original}?imageMogr2/thumbnail/${width}x/quality/80/format/webp`;
    }
    return `/api/files/${encodeURIComponent(item.id)}?width=${width}`;
  }
  private fileConfig(item: StoredFile): FileStoreOptions {
    return {
      scheme: item.config.scheme || this.scheme, bucket: item.config.bucket || this.bucket,
      region: item.config.region || this.region, publicBaseUrl: item.config.publicBaseUrl || this.publicBaseUrl,
      secretId: item.config.secretId || this.cosSecretId, secretKey: item.config.secretKey || this.cosSecretKey, root: item.config.root || this.root };
  }
  private localPath(item: StoredFile) { return join(item.config?.root || this.localRoot, item.objectKey); }

  async put(bytes: Buffer, mimeType: string, name = ''): Promise<StoredFile> {
    if (!bytes.length) throw new Error('文件不能为空');
    if (bytes.length > 500 * 1024 * 1024) throw new Error('文件不能超过 500MB');
    if (!FILE_MIMES.has(mimeType)) throw new Error('不支持的文件类型');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = this.byHash(sha256);
    if (existing) return existing;
    const extension = extensionFor(mimeType, name);
    const id = randomUUID();
    const objectKey = `${this.prefix}/${sha256}.${extension}`;
    const createdAt = new Date().toISOString();
    const config = JSON.stringify({ root: this.root, prefix: this.prefix, region: this.region, bucket: this.bucket, scheme: this.scheme, publicBaseUrl: this.publicBaseUrl, secretId: this.cosSecretId, secretKey: this.cosSecretKey } satisfies FileStoreOptions);
    let uploaded = false;
    if (this.mode === 'cos') {
      await new Promise<void>((resolve, reject) => this.cos!.putObject({ Bucket: this.bucket, Region: this.region, Key: objectKey, Body: bytes, ContentType: mimeType }, (error) => error ? reject(error) : resolve()));
      uploaded = true;
    } else {
      const path = this.localPath({ id, sha256, name, mimeType, size: bytes.length, extension, backend: 'local', objectKey, createdAt, config: JSON.parse(config) as FileStoreOptions });
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    }
    try {
      this.db.prepare('INSERT INTO file_assets(id,sha256,name,mime_type,size,extension,backend,object_key,created_at,config_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, sha256, name.slice(0, 240), mimeType, bytes.length, extension, this.mode, objectKey, createdAt, config);
    } catch (error) {
      const duplicate = this.byHash(sha256);
      if (duplicate) return duplicate;
      if (uploaded) await new Promise<void>((resolve) => this.cos!.deleteObject({ Bucket: this.bucket, Region: this.region, Key: objectKey }, () => resolve()));
      throw error;
    }
    return { id, sha256, name: name.slice(0, 240), mimeType, size: bytes.length, extension, backend: this.mode, objectKey, createdAt, config: JSON.parse(config) as FileStoreOptions };
  }

  getLocalBytes(id: string): { bytes: Buffer; mime: string } | undefined {
    const file = this.get(id);
    if (!file || file.backend !== 'local') return undefined;
    try { return { bytes: readFileSync(this.localPath(file)), mime: file.mimeType }; } catch { return undefined; }
  }

  async getBytes(id: string): Promise<{ file: StoredFile; bytes: Buffer } | undefined> {
    const file = this.get(id);
    if (!file) return undefined;
    if (file.backend === 'local') return { file, bytes: readFileSync(this.localPath(file)) };
    const config = this.fileConfig(file);
    const result = await new Promise<{ Body?: Buffer | Uint8Array }>((resolve, reject) => new COS({ SecretId: config.secretId, SecretKey: config.secretKey }).getObject({ Bucket: config.bucket || '', Region: config.region || 'ap-guangzhou', Key: file.objectKey }, (error, data) => error ? reject(error) : resolve(data)));
    return { file, bytes: Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body || []) };
  }

  async getRange(id: string, start: number, end: number): Promise<{ file: StoredFile; bytes: Buffer } | undefined> {
    const file = this.get(id);
    if (!file) return undefined;
    if (file.backend === 'local') return { file, bytes: readFileSync(this.localPath(file)).subarray(start, end + 1) };
    const config = this.fileConfig(file);
    const result = await new Promise<{ Body?: Buffer | Uint8Array; ContentRange?: string; ContentLength?: string }>((resolve, reject) => new COS({ SecretId: config.secretId, SecretKey: config.secretKey }).getObject({
      Bucket: config.bucket || '', Region: config.region || 'ap-guangzhou', Key: file.objectKey, Range: `bytes=${start}-${end}`,
    }, (error, data) => error ? reject(error) : resolve(data)));
    return { file, bytes: Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body || []) };
  }

  async output(id: string, width?: number): Promise<{ file: StoredFile; bytes: Buffer; mimeType: string } | undefined> {
    const value = await this.getBytes(id);
    if (!value) return undefined;
    if (!width || !IMAGE_MIMES.has(value.file.mimeType)) return { ...value, mimeType: value.file.mimeType };
    if (!WIDTHS.has(width)) throw new Error('仅支持 160、320、640 或 1024 像素缩略图');
    const bytes = await sharp(value.bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { file: value.file, bytes, mimeType: 'image/webp' };
  }
  async original(id: string) {
    const value = await this.getBytes(id);
    return value ? { ...value, mimeType: value.file.mimeType } : undefined;
  }

  async remove(id: string) {
    const file = this.get(id);
    if (!file) return false;
    if (file.backend === 'cos') {
      const config = this.fileConfig(file);
      await new Promise<void>((resolve, reject) => new COS({ SecretId: config.secretId, SecretKey: config.secretKey }).deleteObject({ Bucket: config.bucket || '', Region: config.region || 'ap-guangzhou', Key: file.objectKey }, (error) => error ? reject(error) : resolve()));
    }
    else { try { unlinkSync(this.localPath(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    return true;
  }

  async removeUnreferenced(id: string) {
    if (this.references(id)) return false;
    const item = this.get(id);
    if (!item) return false;
    await this.remove(id);
    this.forget(id);
    return true;
  }

  async checkCos(options: FileStoreOptions & { secretId: string; secretKey: string; bucket: string }) {
    const prefix = (options.prefix || 'darl-ui').replace(/^\/+|\/+$/g, '') || 'darl-ui';
    const key = `${prefix}/.connection-check-${randomUUID()}`;
    const cos = new COS({ SecretId: options.secretId, SecretKey: options.secretKey });
    const params = { Bucket: options.bucket, Region: options.region || 'ap-guangzhou', Key: key };
    await new Promise<void>((resolve, reject) => cos.putObject({ ...params, Body: Buffer.from('ok'), ContentType: 'text/plain' }, (error) => error ? reject(error) : resolve()));
    try { await new Promise<void>((resolve, reject) => cos.deleteObject(params, (error) => error ? reject(error) : resolve())); }
    catch (error) { throw new Error(`COS 探针文件已写入，但删除失败：${error instanceof Error ? error.message : '未知错误'}`); }
  }

  references(id: string) {
    const rows: unknown[][] = [];
    const original = this.originalUrl(id);
    if (this.tableExists('workspace_style_files')) rows.push(this.db.prepare('SELECT file_id FROM workspace_style_files WHERE file_id = ?').all(id));
    if (this.tableExists('workspace_projects')) rows.push(this.db.prepare('SELECT cover_file_id AS file_id FROM workspace_projects WHERE cover_file_id = ?').all(id));
    if (this.tableExists('media_generation_jobs')) rows.push(this.db.prepare('SELECT id FROM media_generation_jobs WHERE data LIKE ?').all(`%"fileId":"${id}"%`));
    if (this.tableExists('studio_records')) rows.push(this.db.prepare('SELECT id FROM studio_records WHERE data LIKE ? OR data LIKE ? OR data LIKE ?').all(`%/api/files/${id}%`, `%"fileId":"${id}"%`, original ? `%${original}%` : `%/api/files/${id}%`));
    if (this.tableExists('video_redraw_jobs')) rows.push(this.db.prepare('SELECT id FROM video_redraw_jobs WHERE data LIKE ?').all(`%${id}%`));
    return rows.some((items) => items.length > 0);
  }

  /**
   * Register metadata under a caller-supplied ID without a new upload. COS mode
   * assumes the object already exists at the canonical key (rebuild after a lost
   * row); local mode materializes the downloaded bytes on disk.
   */
  retain(id: string, bytes: Buffer, mimeType: string, name = '') {
    const existing = this.get(id);
    if (existing) return existing;
    if (!bytes.length) throw new Error('文件不能为空');
    if (!FILE_MIMES.has(mimeType)) throw new Error('不支持的文件类型');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = extensionFor(mimeType, name);
    const safeName = name.slice(0, 240);
    const objectKey = `${this.prefix}/${sha256}.${extension}`;
    const createdAt = new Date().toISOString();
    const config = JSON.stringify({ root: this.root, prefix: this.prefix, region: this.region, bucket: this.bucket, scheme: this.scheme, publicBaseUrl: this.publicBaseUrl, secretId: this.cosSecretId, secretKey: this.cosSecretKey } satisfies FileStoreOptions);
    const item: StoredFile = { id, sha256, name: safeName, mimeType, size: bytes.length, extension, backend: this.mode, objectKey, createdAt, config: JSON.parse(config) as FileStoreOptions };
    if (this.mode === 'local') {
      const path = this.localPath(item);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    }
    this.db.prepare('INSERT INTO file_assets(id,sha256,name,mime_type,size,extension,backend,object_key,created_at,config_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, sha256, safeName, mimeType, bytes.length, extension, this.mode, objectKey, createdAt, config);
    return this.get(id)!;
  }

  private tableExists(name: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  forget(id: string) {
    return this.db.prepare('DELETE FROM file_assets WHERE id = ?').run(id).changes > 0;
  }

  list() { return (this.db.prepare('SELECT * FROM file_assets ORDER BY created_at DESC').all() as FileRow[]).map((row) => this.rowToFile(row)); }
  async transformLocal(bytes: Buffer, width: number) { return sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(); }
  mimeFromName(name: string) { return mimeForExtension(extname(name).replace(/^\./, '').toLowerCase()); }
}

