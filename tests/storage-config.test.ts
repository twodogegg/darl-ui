// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { StorageSettings, publicStorageConfig, storageConfigFromEnv, validateStorageConfig } from '../examples/agent-chat/server/storage-config';

let root: string;
let storage: LocalStorage;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'darl-storage-config-')); storage = new LocalStorage(root); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('storage configuration', () => {
  it('keeps secrets server-side and preserves a stored secret when the field is blank', () => {
    const base = storageConfigFromEnv({ COS_SECRET_ID: 'secret-id', COS_SECRET_KEY: 'secret-key', COS_BUCKET: 'bucket' }, storage.path);
    const safe = publicStorageConfig(base);
    expect(safe).toMatchObject({ mode: 'cos', bucket: 'bucket', hasCredentials: true });
    expect(JSON.stringify(safe)).not.toContain('secret-id');
    expect(validateStorageConfig({ ...safe, mode: 'cos', bucket: 'bucket', secretId: '', secretKey: '' }, base)).toMatchObject({ secretId: 'secret-id', secretKey: 'secret-key' });
  });

  it('validates required COS fields, absolute local paths and object prefixes', () => {
    expect(() => validateStorageConfig({ mode: 'cos', root, bucket: '', secretId: '', secretKey: '' })).toThrow('COS 模式需要完整配置');
    expect(() => validateStorageConfig({ mode: 'local', root: 'relative/path' })).toThrow('绝对路径');
    expect(() => validateStorageConfig({ mode: 'local', root, prefix: 'a/../b' })).toThrow('对象前缀');
    expect(() => validateStorageConfig({ mode: 'local', root: '/tmp/files', prefix: '/safe/prefix/' })).not.toThrow();
  });

  it('tests local writes and applies a valid local configuration immediately', async () => {
    const settings = new StorageSettings(storage, new FileStore(storage.path, { root }), storageConfigFromEnv({}, storage.path));
    const configuration = { mode: 'local', root, prefix: 'tests', region: 'ap-guangzhou', bucket: '', scheme: 'https', publicBaseUrl: '', secretId: '', secretKey: '' };
    await expect(settings.test(configuration)).resolves.toBeUndefined();
    await expect(settings.save(configuration)).resolves.toMatchObject({ mode: 'local', root });
    expect(storage.getConfig('storageConfiguration')).toMatchObject({ mode: 'local', root, prefix: 'tests' });
  });

  it('does not save configuration when the COS probe fails', async () => {
    const store = new FileStore(storage.path, { root });
    vi.spyOn(store, 'checkCos').mockRejectedValue(new Error('COS 写入失败'));
    const settings = new StorageSettings(storage, store, storageConfigFromEnv({}, storage.path));
    await expect(settings.save({ mode: 'cos', root, prefix: 'tests', region: 'ap-guangzhou', bucket: 'bucket-1250000000', scheme: 'https', publicBaseUrl: '', secretId: 'id', secretKey: 'key' }))
      .rejects.toThrow('COS 写入失败');
    expect(storage.getConfig('storageConfiguration')).toBeUndefined();
  });

  it('never exposes either secret in the public shape', async () => {
    const store = new FileStore(storage.path, { root });
    const settings = new StorageSettings(storage, store, storageConfigFromEnv({}, storage.path));
    await settings.save({ mode: 'local', root, prefix: 'safe', region: 'ap-guangzhou', bucket: '', scheme: 'https', publicBaseUrl: '', secretId: '', secretKey: '' });
    const body = settings.public();
    expect(body).not.toHaveProperty('secretId');
    expect(body).not.toHaveProperty('secretKey');
  });

  it('keeps an old local file readable after switching to COS', async () => {
    const oldRoot = join(root, 'old-files');
    const newRoot = join(root, 'new-files');
    const store = new FileStore(storage.path, { mode: 'local', root: oldRoot });
    const file = await store.put(Buffer.from('legacy-local'), 'text/plain', 'legacy.txt');
    store.configure({ mode: 'cos', root: newRoot, bucket: 'bucket-1250000000', region: 'ap-guangzhou', secretId: 'id', secretKey: 'key' });
    expect((await store.getBytes(file.id))?.bytes.toString()).toBe('legacy-local');
  });
});
