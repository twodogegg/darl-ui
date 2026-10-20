import { useState } from 'react';
import { validateFile } from '../file-uploader/validation';
import { useUploader } from '../file-uploader/useUploader';
import type { UploadContext } from '../file-uploader/types';
import type { MediaInput, MediaReferences } from './types';

const kindOf = (file: File) => file.type.startsWith('video/') ? 'videos' : file.type.startsWith('audio/') ? 'audios' : 'images';
export function useReferences(onError: (message: string) => void, upload?: (file: File, context: UploadContext) => Promise<MediaInput>) {
  // Reuse FileUploader's local queue, validation, deduplication and object URL cleanup.
  const remoteOnly = async () => { throw new Error('参考素材尚未上传完成'); };
  const uploadFile = upload ? async (file: File, context: UploadContext) => { const result = await upload(file, context); if (result instanceof File) throw new Error('上传适配器必须返回文件引用'); return result; } : remoteOnly;
  const files = useUploader({ upload: uploadFile, autoUpload: Boolean(upload), accept: ['image/*', 'video/*', 'audio/*'], onReject: (items) => onError(items.map((item) => item.reason).join('；')) });
  const first = useUploader({ upload: uploadFile, autoUpload: Boolean(upload), accept: ['image/*'], maxFiles: 1, onReject: (items) => onError(items[0].reason) });
  const last = useUploader({ upload: uploadFile, autoUpload: Boolean(upload), accept: ['image/*'], maxFiles: 1, onReject: (items) => onError(items[0].reason) });
  const [remote, setRemote] = useState<MediaReferences>({});
  const references: MediaReferences = { ...remote };
  for (const kind of ['images', 'videos', 'audios'] as const) {
    references[kind] = [...(remote[kind] ?? []), ...files.items.filter((item) => kindOf(item.file) === kind).flatMap((item) => upload ? item.status === 'success' && item.result ? [item.result as MediaInput] : [] : [item.file])];
  }
  if (first.items[0]) references.firstFrame = upload ? first.items[0].result || first.items[0].file : first.items[0].file;
  if (last.items[0]) references.lastFrame = upload ? last.items[0].result || last.items[0].file : last.items[0].file;
  const previews = (kind: 'images' | 'videos' | 'audios') => [
    ...(remote[kind] ?? []).map((input, index) => ({ key: `remote-${kind}-${index}`, name: input instanceof File ? input.name : input.id, url: input instanceof File ? undefined : input.thumbnailUrl || input.url, status: undefined, progress: undefined, error: undefined, remove: () => setRemote((prev) => ({ ...prev, [kind]: prev[kind]?.filter((_, i) => i !== index) })) })),
    ...files.items.filter((item) => kindOf(item.file) === kind).map((item) => ({ key: item.id, name: item.file.name, url: item.previewUrl, status: item.status as string | undefined, progress: item.progress as number | null | undefined, error: item.error as string | undefined, remove: () => files.remove(item.id) }))
  ];
  const frame = (role: 'firstFrame' | 'lastFrame') => {
    const queue = role === 'firstFrame' ? first : last;
    const input = remote[role];
    return { url: queue.items[0]?.previewUrl ?? (input && !(input instanceof File) ? input.url : undefined), hasValue: Boolean(references[role]), clear: () => { queue.clear(); setRemote((prev) => ({ ...prev, [role]: undefined })); }, add: (incoming: File[]) => {
      if (!incoming.length) return;
      if (incoming.length > 1) { onError('每个首尾帧位置只能添加一张图片'); return; }
      const rejected = validateFile(incoming[0], { accept: ['image/*'] });
      if (rejected) { onError(rejected.reason); return; }
      queue.clear(); setRemote((prev) => ({ ...prev, [role]: undefined })); queue.addFiles(incoming);
    } };
  };
  const setFrame = (role: 'firstFrame' | 'lastFrame', input: MediaInput) => {
    if (input instanceof File) frame(role).add([input]);
    else { (role === 'firstFrame' ? first : last).clear(); setRemote((prev) => ({ ...prev, [role]: input })); }
  };
  const restore = (values: MediaReferences = {}) => {
    files.clear(); first.clear(); last.clear();
    const next: MediaReferences = {};
    for (const kind of ['images', 'videos', 'audios'] as const) {
      const inputs = values[kind] ?? [];
      next[kind] = inputs.filter((input) => !(input instanceof File));
      files.addFiles(inputs.filter((input): input is File => input instanceof File));
    }
    for (const role of ['firstFrame', 'lastFrame'] as const) {
      const input = values[role];
      if (input instanceof File) (role === 'firstFrame' ? first : last).addFiles([input]);
      else next[role] = input;
    }
    setRemote(next);
  };
  const addRemote = (kind: 'images' | 'videos', input: MediaInput) => {
    if (input instanceof File) files.addFiles([input]);
    else setRemote((prev) => ({ ...prev, [kind]: [...(prev[kind] ?? []).filter((item) => item instanceof File || item.id !== input.id), input] }));
  };
  return { references, previews, frame, setFrame, restore, addRemote, addFiles: files.addFiles };
}
export type ReferenceDraft = ReturnType<typeof useReferences>;
