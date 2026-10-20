import type { FileStore, StoredFile } from './file-storage';

export const MAX_MEDIA_REFERENCE_BYTES = 50 * 1024 * 1024;
const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;
function extension(mimeType: string) { return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/svg+xml' ? 'svg' : mimeType.split('/')[1] || 'png'; }

/** Store data URL references once and keep only a stable file ID in the job row. */
export async function persistMediaReferencesInStore(options: Record<string, unknown>, files: FileStore): Promise<Record<string, unknown>> {
  if (!('references' in options) || options.references === undefined) return options;
  if (!Array.isArray(options.references)) throw new Error('参考素材必须是数组');
  const references = await Promise.all(options.references.map(async (reference) => {
    if (reference && typeof reference === 'object' && typeof (reference as { fileId?: unknown }).fileId === 'string') {
      const fileId = (reference as { fileId: string }).fileId;
      const file = files.get(fileId);
      if (!file) throw new Error('参考素材文件不存在');
      if (!file.mimeType.startsWith('image/')) throw new Error('参考素材必须是图片');
      return storedReference(file);
    }
    if (typeof reference !== 'string') throw new Error('参考素材格式无效');
    if (!reference.startsWith('data:')) return reference;
    const match = DATA_IMAGE.exec(reference);
    if (!match) throw new Error('参考素材必须是图片 data URL');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length) throw new Error('参考素材为空');
    if (data.length > MAX_MEDIA_REFERENCE_BYTES) throw new Error('单张参考图片不能超过 50MB');
    const file = await files.put(data, match[1], `reference.${extension(match[1])}`);
    return storedReference(file);
  }));
  return { ...options, references };
}

export async function resolveMediaReferencesInStore(options: Record<string, unknown>, files: FileStore): Promise<Record<string, unknown>> {
  if (!('references' in options) || options.references === undefined) return options;
  if (!Array.isArray(options.references)) throw new Error('参考素材必须是数组');
  const references = await Promise.all(options.references.map(async (reference) => {
    if (!reference || typeof reference !== 'object' || typeof (reference as { fileId?: unknown }).fileId !== 'string') return reference;
    const item = reference as { fileId: string; url?: unknown; name?: unknown };
    const existing = files.get(item.fileId);
    if (existing) return storedReference(existing);
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) throw new Error('参考素材文件不存在');
    const response = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`参考素材文件不存在且无法恢复（HTTP ${response.status}）`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > MAX_MEDIA_REFERENCE_BYTES) throw new Error('参考素材为空或超过 50MB');
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!mimeType.startsWith('image/')) throw new Error('参考素材必须是图片');
    // Metadata rebuild for an object that already exists at the canonical key;
    // keep its backend URL so callers can still fetch it directly.
    const retained = files.retain(item.fileId, data, mimeType, typeof item.name === 'string' ? item.name : 'reference');
    return { fileId: retained.id, url: files.originalUrl(retained) || storedReference(retained).url, mimeType: retained.mimeType, name: retained.name };
  }));
  return { ...options, references };
}

/** Job rows reference stored files through the backend-independent file proxy. */
function storedReference(file: StoredFile) {
  return { fileId: file.id, url: `/api/files/${file.id}`, mimeType: file.mimeType, name: file.name };
}

export function fileIdFromReference(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { fileId?: unknown }).fileId === 'string' ? (value as { fileId: string }).fileId : undefined;
}

export function referenceFiles(options: Record<string, unknown>, files: FileStore) {
  const references = Array.isArray(options.references) ? options.references : [];
  return references.flatMap((reference) => {
    const id = fileIdFromReference(reference);
    const file = id ? files.get(id) : undefined;
    return file ? [file] : [];
  });
}

export function referenceRecord(file: StoredFile) {
  return storedReference(file);
}
