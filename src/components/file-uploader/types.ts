export type UploadStatus = 'queued' | 'uploading' | 'success' | 'error' | 'canceled';
export type RejectCode = 'type' | 'size' | 'count' | 'duplicate';
export interface RejectedFile { file: File; code: RejectCode; reason: string }
export interface UploadContext { signal: AbortSignal; onProgress: (percent: number) => void }
export type UploadFn<T = unknown> = (file: File, context: UploadContext) => Promise<T>;
export interface UploadItem<T = unknown> {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number | null;
  previewUrl?: string;
  error?: string;
  result?: T;
}
export interface FileUploaderProps<T = unknown> {
  upload: UploadFn<T>;
  multiple?: boolean;
  pasteEnabled?: boolean;
  dragEnabled?: boolean;
  accept?: string[];
  maxFileSizeMB?: number;
  maxFiles?: number;
  concurrency?: number;
  autoUpload?: boolean;
  showPreview?: boolean;
  showProgress?: boolean;
  disabled?: boolean;
  accentColor?: string;
  className?: string;
  onSuccess?: (file: File, result: T) => void;
  onError?: (file: File, error: Error) => void;
  onReject?: (rejections: RejectedFile[]) => void;
  onChange?: (items: UploadItem<T>[]) => void;
}
