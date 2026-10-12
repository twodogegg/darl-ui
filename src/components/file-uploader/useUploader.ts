import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileUploaderProps, RejectedFile, UploadItem, UploadFn } from './types';
import { fileFingerprint, rejectReason, validateFile } from './validation';

export function useUploader<T>({
  upload, accept, maxFileSizeMB, maxFiles, multiple = true, showPreview = true,
  concurrency = 3, autoUpload = true, onSuccess, onError, onReject, onChange
}: FileUploaderProps<T>) {
  const [items, setItems] = useState<UploadItem<T>[]>([]);
  const itemsRef = useRef<UploadItem<T>[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const [manualEnabled, setManualEnabled] = useState(false);
  const [tick, setTick] = useState(0);
  const idCounter = useRef(0);
  const updateItems = useCallback((fn: (current: UploadItem<T>[]) => UploadItem<T>[]) => {
    const next = fn(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);
  const callbacksRef = useRef({ onSuccess, onError, onReject, onChange });
  callbacksRef.current = { onSuccess, onError, onReject, onChange };
  const uploadRef = useRef<UploadFn<T>>(upload);
  uploadRef.current = upload;

  useEffect(() => { callbacksRef.current.onChange?.(items); }, [items]);
  useEffect(() => () => {
    controllers.current.forEach((c) => c.abort());
    itemsRef.current.forEach((i) => { if (i.previewUrl) URL.revokeObjectURL(i.previewUrl); });
  }, []);

  const addFiles = useCallback((incoming: FileList | File[] | null | undefined): RejectedFile[] => {
    if (!incoming?.length) return [];
    const selected = Array.from(incoming);
    const existing = itemsRef.current;
    const fingerprints = new Set(existing.map((i) => fileFingerprint(i.file)));
    const accepted: UploadItem<T>[] = [];
    const rejected: RejectedFile[] = [];
    const capacity = Math.max(0, Math.min(multiple ? Infinity : 1, maxFiles ?? Infinity) - existing.length);
    selected.forEach((file) => {
      const validation = validateFile(file, { accept, maxFileSizeMB });
      const fingerprint = fileFingerprint(file);
      if (validation) rejected.push(validation);
      else if (fingerprints.has(fingerprint)) rejected.push(rejectReason(file, 'duplicate', { accept, maxFileSizeMB }));
      else if (accepted.length >= capacity) rejected.push(rejectReason(file, 'count', { accept, maxFileSizeMB }));
      else {
        fingerprints.add(fingerprint);
        accepted.push({
          id: `darl-${++idCounter.current}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          status: 'queued',
          progress: null,
          previewUrl: showPreview && file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        });
      }
    });
    if (accepted.length) updateItems((current) => [...current, ...accepted]);
    if (rejected.length) callbacksRef.current.onReject?.(rejected);
    return rejected;
  }, [accept, maxFileSizeMB, maxFiles, multiple, showPreview, updateItems]);

  const startOne = useCallback((item: UploadItem<T>) => {
    if (controllers.current.has(item.id)) return;
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    updateItems((current) => current.map((i) => i.id === item.id ? { ...i, status: 'uploading', error: undefined, progress: null } : i));
    Promise.resolve().then(() => uploadRef.current(item.file, {
      signal: controller.signal,
      onProgress: (value) => {
        if (controller.signal.aborted) return;
        const progress = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
        updateItems((current) => current.map((i) => i.id === item.id && i.status === 'uploading' ? { ...i, progress } : i));
      }
    })).then((result) => {
      if (controller.signal.aborted || !itemsRef.current.some((i) => i.id === item.id)) return;
      updateItems((current) => current.map((i) => i.id === item.id && i.status === 'uploading' ? { ...i, status: 'success', progress: 100, result } : i));
      callbacksRef.current.onSuccess?.(item.file, result);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || !itemsRef.current.some((i) => i.id === item.id)) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      updateItems((current) => current.map((i) => i.id === item.id && i.status === 'uploading' ? { ...i, status: 'error', error: error.message, progress: null } : i));
      callbacksRef.current.onError?.(item.file, error);
    }).finally(() => {
      controllers.current.delete(item.id);
      setTick((n) => n + 1);
    });
  }, [updateItems]);

  useEffect(() => {
    if (!autoUpload && !manualEnabled) return;
    const slots = Math.max(0, Math.max(1, Math.floor(concurrency)) - controllers.current.size);
    const toStart = itemsRef.current.filter((i) => i.status === 'queued').slice(0, slots);
    toStart.forEach(startOne);
    if (!autoUpload && manualEnabled && !toStart.length && controllers.current.size === 0 && !itemsRef.current.some((i) => i.status === 'queued')) {
      setManualEnabled(false);
    }
  }, [items, concurrency, autoUpload, manualEnabled, tick, startOne]);

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    updateItems((current) => current.map((i) => i.id === id && (i.status === 'uploading' || i.status === 'queued') ? { ...i, status: 'canceled', progress: null } : i));
  }, [updateItems]);
  const retry = useCallback((id: string) => {
    updateItems((current) => current.map((i) => i.id === id && (i.status === 'error' || i.status === 'canceled') ? { ...i, status: 'queued', error: undefined, progress: null } : i));
    if (!autoUpload) setManualEnabled(true);
  }, [autoUpload, updateItems]);
  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    const found = itemsRef.current.find((i) => i.id === id);
    if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
    updateItems((current) => current.filter((i) => i.id !== id));
  }, [updateItems]);
  const clear = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    itemsRef.current.forEach((i) => { if (i.previewUrl) URL.revokeObjectURL(i.previewUrl); });
    updateItems(() => []);
    setManualEnabled(false);
  }, [updateItems]);
  const startAll = useCallback(() => setManualEnabled(true), []);
  return { items, addFiles, startAll, cancel, retry, remove, clear };
}
