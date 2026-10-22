import type { StyleCreateRequest } from '../style-selector/StyleSelector';
import type { UploadContext } from '../file-uploader/types';
import type { ReactNode } from 'react';

export interface BaseCapabilities {
  aspectRatios?: string[];
  resolutions?: string[];
  maxOutputs?: number;
  generationModes?: MediaGenerationMode[];
}
export interface BaseDefaults { aspectRatio?: string; resolution?: string; count?: number }
export type MediaGenerationMode = 'text-to-image' | 'reference-edit' | 'text-to-video' | 'first-last-frame' | 'reference';
export type MediaRouteStrategy = 'selected-binding' | 'auto';
export interface MediaRoute {
  strategy: MediaRouteStrategy;
  bindingId?: string;
  providerId?: string;
}
export interface ImageModel {
  id: string;
  name: string;
  type: 'image';
  logicalModelId?: string;
  bindingId?: string;
  providerId?: string;
  providerName?: string;
  upstreamModelId?: string;
  protocolKey?: string;
  capabilities: BaseCapabilities & { images?: number };
  defaults?: BaseDefaults;
}
export interface VideoModel {
  id: string;
  name: string;
  type: 'video';
  logicalModelId?: string;
  bindingId?: string;
  providerId?: string;
  providerName?: string;
  upstreamModelId?: string;
  protocolKey?: string;
  capabilities: BaseCapabilities & {
    images?: number;
    videos?: number;
    audios?: number;
    firstLastFrame?: boolean;
    durations?: number[] | { min: number; max: number };
    generateAudio?: boolean;
  };
  defaults?: BaseDefaults & { duration?: number; generateAudio?: boolean };
}
export type MediaModel = ImageModel | VideoModel;
export type MediaInput = File | { id: string; url: string; thumbnailUrl?: string; /** Stable ID in the host's unified file store; `id` may be a display key. */ fileId?: string };
export interface MediaStyleOption {
  id: string;
  name: string;
  description?: string;
  image?: string;
  category?: string;
  favorite?: boolean;
  isOwned?: boolean;
  lastUsedAt?: number;
}export interface MediaReferences {
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
}
export interface GenerateRequest {
  taskId: string;
  modelId: string;
  /** Independent host invocations. Never forwarded to the provider as its `n` parameter. */
  generationCount?: number;
  /** Stable logical model identity, when supplied by the host model registry. */
  logicalModelId?: string;
  /** Selected channel metadata; the host resolves the actual credentials. */
  bindingId?: string;
  providerId?: string;
  upstreamModelId?: string;
  protocolKey?: string;
  route?: MediaRoute;
  mode?: MediaGenerationMode;
  style?: MediaStyleOption;
  prompt: string;
  references?: MediaReferences;
  options: { aspectRatio?: string; resolution?: string; duration?: number; count: number; generateAudio?: boolean };
}
export interface MediaResult {
  id: string;
  /** Stable file identity when the host stores this result in the unified file store. */
  fileId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  url?: string;
  /** 320px card thumbnail (WebP when the host transforms images). */
  thumbnailUrl?: string;
  /** 160px list thumbnail, e.g. the task sidebar. */
  listThumbnailUrl?: string;
  /** 1024px preview used inside the detail modal; downloads keep using `url` (the original). */
  previewUrl?: string;
  error?: string;
  favorited?: boolean;
}
export interface MediaBatch {
  id: string;
  modelId: string;
  /** ISO creation time. When present, historical batches are shown oldest first. */
  createdAt?: string;
  logicalModelId?: string;
  bindingId?: string;
  providerId?: string;
  upstreamModelId?: string;
  protocolKey?: string;
  route?: MediaRoute;
  mode?: MediaGenerationMode;
  style?: MediaStyleOption;
  /** Save the output type if a historical model may be removed from the model list. */
  type?: MediaModel['type'];
  prompt: string;
  options: GenerateRequest['options'];
  references?: MediaReferences;
  results: MediaResult[];
}
export interface MediaTask { id: string; title: string; batches: MediaBatch[] }
export interface MediaReferencePickerProps {
  kinds: Array<'images' | 'videos' | 'audios'>;
  references: MediaReferences;
  onApply: (references: MediaReferences) => void;
  onClose: () => void;
}
export interface MediaWorkspaceProps {
  models: MediaModel[];
  tasks: MediaTask[];
  styles?: MediaStyleOption[];
  /** Save a style created from the composer; reject to keep the draft. */
  onCreateStyle?: (request: StyleCreateRequest) => void | Promise<void>;
  /** How the host should select a channel when a model has binding metadata. */
  routingStrategy?: MediaRouteStrategy;
  activeTaskId?: string;
  onTaskChange?: (taskId: string) => void;
  onCreateTask?: () => void;
  onRenameTask?: (taskId: string, title: string) => void;
  onDeleteTask?: (taskId: string) => void | Promise<void>;
  /** Permanently delete one generation batch. Omit when the host cannot guarantee physical cleanup. */
  onDeleteBatch?: (batchId: string) => void | Promise<void>;
  onGenerate: (request: GenerateRequest) => void | Promise<void>;
  /** Host uploads each selected reference immediately and returns a stable file reference. */
  onUploadReference?: (file: File, context: UploadContext) => Promise<MediaInput>;
  /** Replace the local file chooser with a host-owned asset picker. Paste and drop keep using the upload adapter. */
  renderReferencePicker?: (props: MediaReferencePickerProps) => ReactNode;
  onRetry?: (batchId: string, resultId: string) => void;
  onCancel?: (batchId: string, resultId: string) => void;
  onRegenerate?: (batchId: string, resultId: string) => void;
  onFavoriteChange?: (batchId: string, resultId: string, favorited: boolean) => void;
  accentColor?: string;
  className?: string;
}
