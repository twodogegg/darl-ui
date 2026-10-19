import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Per-image limit for references stored on disk. */
export const MAX_MEDIA_REFERENCE_BYTES = 50 * 1024 * 1024;
const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

function extension(mimeType: string) {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/svg+xml' ? 'svg' : mimeType.split('/')[1] || 'png';
}

/**
 * Turn base64 image references into files so job rows stay small. Remote URLs
 * are kept as-is; adapters decide whether to fetch them or pass them through.
 */
export function persistMediaReferences(root: string, options: Record<string, unknown>): Record<string, unknown> {
  if (!('references' in options) || options.references === undefined) return options;
  if (!Array.isArray(options.references)) throw new Error('参考素材必须是数组');
  if (!options.references.length) return options;
  const directory = join(root, 'references');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const references = options.references.map((reference) => {
    if (typeof reference !== 'string') throw new Error('参考素材格式无效');
    if (!reference.startsWith('data:')) return reference;
    const match = DATA_IMAGE.exec(reference);
    if (!match) throw new Error('参考素材必须是图片 data URL');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length) throw new Error('参考素材为空');
    if (data.length > MAX_MEDIA_REFERENCE_BYTES) throw new Error('单张参考图片不能超过 50MB');
    const file = join(directory, `${randomUUID()}.${extension(match[1])}`);
    writeFileSync(file, data, { mode: 0o600 });
    return { mediaReference: file, mimeType: match[1] };
  });
  return { ...options, references };
}
