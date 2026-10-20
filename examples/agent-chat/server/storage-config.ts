import type { FileStore, FileStoreOptions } from './file-storage';
import type { LocalStorage } from './storage';
import { dirname, join } from 'node:path';

export type StorageMode = 'local' | 'cos';
export type StoredStorageConfig = {
  mode: StorageMode;
  root: string;
  prefix: string;
  region: string;
  bucket: string;
  scheme: string;
  publicBaseUrl: string;
  secretId: string;
  secretKey: string;
};
export type PublicStorageConfig = Omit<StoredStorageConfig, 'secretId' | 'secretKey'> & { hasCredentials: boolean };

export function storageConfigFromEnv(env: Record<string, string>, dbPath: string): StoredStorageConfig {
  return validateStorageConfig({
    mode: env.STORAGE_MODE === 'cos' ? 'cos' : env.STORAGE_MODE === 'local' ? 'local' : env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET ? 'cos' : 'local',
    root: env.LOCAL_STORAGE_ROOT || join(dirname(dbPath), 'files'),
    prefix: env.COS_OBJECT_PREFIX || 'darl-ui',
    region: env.COS_REGION || 'ap-guangzhou',
    bucket: env.COS_BUCKET || '',
    scheme: env.COS_SCHEME || 'https',
    publicBaseUrl: env.COS_PUBLIC_BASE_URL || '',
    secretId: env.COS_SECRET_ID || '',
    secretKey: env.COS_SECRET_KEY || '',
  });
}

export function publicStorageConfig(config: StoredStorageConfig): PublicStorageConfig {
  const { secretId, secretKey, ...safe } = config;
  return { ...safe, hasCredentials: Boolean(secretId && secretKey) };
}

export function validateStorageConfig(value: unknown, previous?: StoredStorageConfig): StoredStorageConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('存储配置格式无效');
  const item = value as Record<string, unknown>;
  const mode = item.mode === 'cos' ? 'cos' : item.mode === 'local' ? 'local' : undefined;
  if (!mode) throw new Error('存储模式只能是 local 或 cos');
  const text = (key: string, max = 500) => {
    if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`${key} 格式无效`);
    const result = typeof item[key] === 'string' ? item[key].trim() : '';
    if (result.length > max) throw new Error(`${key} 过长`);
    return result;
  };
  const config: StoredStorageConfig = {
    mode,
    root: text('root', 1000),
    prefix: (text('prefix', 300) || 'darl-ui').replace(/^\/+|\/+$/g, '') || 'darl-ui',
    region: text('region', 100) || 'ap-guangzhou',
    bucket: text('bucket', 200),
    scheme: text('scheme', 16) || 'https',
    publicBaseUrl: text('publicBaseUrl', 1000),
    secretId: text('secretId', 1000) || (previous?.mode === 'cos' ? previous.secretId : ''),
    secretKey: text('secretKey', 2000) || (previous?.mode === 'cos' ? previous.secretKey : ''),
  };
  if (config.scheme !== 'https' && config.scheme !== 'http') throw new Error('COS Scheme 只能是 http 或 https');
  if (config.publicBaseUrl && !/^https?:\/\//i.test(config.publicBaseUrl)) throw new Error('公开访问地址必须以 http:// 或 https:// 开头');
  if (config.prefix.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('对象前缀不能包含空段、. 或 ..');
  if (mode === 'cos' && (!config.secretId || !config.secretKey || !config.bucket)) throw new Error('COS 模式需要完整配置 SecretId、SecretKey 和 Bucket');
  if (!config.root) throw new Error('本地存储目录不能为空');
  if (!config.root.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(config.root)) throw new Error('本地存储目录必须是绝对路径');
  return config;
}

export function fileOptions(config: StoredStorageConfig): FileStoreOptions {
  return {
    mode: config.mode, root: config.root, prefix: config.prefix, region: config.region,
    bucket: config.bucket, scheme: config.scheme, publicBaseUrl: config.publicBaseUrl || undefined,
    secretId: config.secretId, secretKey: config.secretKey,
  };
}

export class StorageSettings {
  constructor(private readonly storage: LocalStorage, private readonly files: FileStore, private readonly fallback: StoredStorageConfig) {}

  private load() {
    return this.storage.getConfig<StoredStorageConfig>('storageConfiguration') || this.fallback;
  }

  public() {
    return publicStorageConfig(this.load());
  }

  async test(value: unknown) {
    const config = validateStorageConfig(value, this.load());
    if (config.mode === 'local') {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(config.root || join(dirname(this.storage.path), 'files'), { recursive: true, mode: 0o700 });
      return;
    }
    await this.files.checkCos({ ...fileOptions(config), secretId: config.secretId, secretKey: config.secretKey, bucket: config.bucket });
  }

  async save(value: unknown) {
    const config = validateStorageConfig(value, this.load());
    await this.test(config);
    this.files.configure(fileOptions(config));
    this.storage.setConfig('storageConfiguration', config);
    return this.public();
  }
}
