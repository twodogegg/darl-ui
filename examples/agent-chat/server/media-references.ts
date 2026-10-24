import type { FileStore, StoredFile } from './file-storage';

export const MAX_MEDIA_REFERENCE_BYTES = 50 * 1024 * 1024;
const DATA_MEDIA = /^data:((?:image|audio|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;
export const MEDIA_REFERENCE_FIELDS = { references: 'image', referenceVideos: 'video', referenceAudios: 'audio' } as const;
const mediaNames = { image: '图片', video: '视频', audio: '音频' };
async function mapReferences(options: Record<string, unknown>, map: (reference: unknown, kind: 'image' | 'video' | 'audio') => Promise<unknown>) {
  const result = { ...options };
  for (const [field, kind] of Object.entries(MEDIA_REFERENCE_FIELDS)) {
    if (options[field] === undefined) continue;
    if (!Array.isArray(options[field])) throw new Error(`参考${mediaNames[kind]}必须是数组`);
    result[field] = await Promise.all(options[field].map(reference => map(reference, kind)));
  }
  return result;
}
function extension(mimeType: string) { return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/svg+xml' ? 'svg' : mimeType.split('/')[1] || 'png'; }

/** Store data URL references once and keep only a stable file ID in the job row. */
export async function persistMediaReferencesInStore(options: Record<string, unknown>, files: FileStore): Promise<Record<string, unknown>> {
  return mapReferences(options, async (reference, kind) => {
    if (reference && typeof reference === 'object' && typeof (reference as { fileId?: unknown }).fileId === 'string') {
      const fileId = (reference as { fileId: string }).fileId;
      const file = files.get(fileId);
      if (!file) throw new Error('参考素材文件不存在');
      if (!file.mimeType.startsWith(`${kind}/`)) throw new Error(`参考素材必须是${mediaNames[kind]}`);
      return storedReference(file);
    }
    if (typeof reference !== 'string') throw new Error('参考素材格式无效');
    if (!reference.startsWith('data:')) return reference;
    const match = DATA_MEDIA.exec(reference);
    if (!match || !match[1].startsWith(`${kind}/`)) throw new Error(`参考素材必须是${mediaNames[kind]} data URL`);
    const data = Buffer.from(match[2], 'base64');
    if (!data.length) throw new Error('参考素材为空');
    if (data.length > MAX_MEDIA_REFERENCE_BYTES) throw new Error('单个参考素材不能超过 50MB');
    const file = await files.put(data, match[1], `reference.${extension(match[1])}`);
    return storedReference(file);
  });
}

export async function resolveMediaReferencesInStore(options: Record<string, unknown>, files: FileStore): Promise<Record<string, unknown>> {
  return mapReferences(options, async (reference, kind) => {
    const url = typeof reference === 'string' ? reference : reference && typeof reference === 'object' ? (reference as { url?: unknown }).url : undefined;
    const local = typeof url === 'string' && /^\/api\/files\/([^/?#]+)(?:\/thumbnail)?(?:[?#].*)?$/.exec(url);
    if (local) {
      const file = files.get(decodeURIComponent(local[1]));
      if (!file) throw new Error('参考素材文件不存在');
      if (!file.mimeType.startsWith(`${kind}/`)) throw new Error(`参考素材必须是${mediaNames[kind]}`);
      return storedReference(file);
    }
    if (!reference || typeof reference !== 'object' || typeof (reference as { fileId?: unknown }).fileId !== 'string') return reference;
    const item = reference as { fileId: string; url?: unknown; name?: unknown };
    const existing = files.get(item.fileId);
    if (existing) {
      if (!existing.mimeType.startsWith(`${kind}/`)) throw new Error(`参考素材必须是${mediaNames[kind]}`);
      return storedReference(existing);
    }
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) throw new Error('参考素材文件不存在');
    const response = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`参考素材文件不存在且无法恢复（HTTP ${response.status}）`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > MAX_MEDIA_REFERENCE_BYTES) throw new Error('参考素材为空或超过 50MB');
    const mimeType = response.headers.get('content-type')?.split(';')[0] || `${kind}/${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mpeg'}`;
    if (!mimeType.startsWith(`${kind}/`)) throw new Error(`参考素材必须是${mediaNames[kind]}`);
    // Metadata rebuild for an object that already exists at the canonical key;
    // keep its backend URL so callers can still fetch it directly.
    const retained = files.retain(item.fileId, data, mimeType, typeof item.name === 'string' ? item.name : 'reference');
    return { fileId: retained.id, url: files.originalUrl(retained) || storedReference(retained).url, mimeType: retained.mimeType, name: retained.name };
  });
}

/** Job rows reference stored files through the backend-independent file proxy. */
function storedReference(file: StoredFile) {
  return { fileId: file.id, url: `/api/files/${file.id}`, mimeType: file.mimeType, name: file.name };
}

export function fileIdFromReference(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { fileId?: unknown }).fileId === 'string' ? (value as { fileId: string }).fileId : undefined;
}

export function referenceFiles(options: Record<string, unknown>, files: FileStore) {
  const references = Object.keys(MEDIA_REFERENCE_FIELDS).flatMap(field => Array.isArray(options[field]) ? options[field] : []);
  return references.flatMap((reference) => {
    const id = fileIdFromReference(reference);
    const file = id ? files.get(id) : undefined;
    return file ? [file] : [];
  });
}

export function referenceRecord(file: StoredFile) {
  return storedReference(file);
}
