export interface BaseCapabilities {
  aspectRatios?: string[];
  resolutions?: string[];
  maxOutputs?: number;
}
export interface BaseDefaults { aspectRatio?: string; resolution?: string; count?: number }
export interface ImageModel {
  id: string;
  name: string;
  type: 'image';
  capabilities: BaseCapabilities & { images?: number };
  defaults?: BaseDefaults;
}
export interface VideoModel {
  id: string;
  name: string;
  type: 'video';
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
export type MediaInput = File | { id: string; url: string };
export interface MediaReferences {
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
}
export interface GenerateRequest {
  taskId: string;
  modelId: string;
  prompt: string;
  references?: MediaReferences;
  options: { aspectRatio?: string; resolution?: string; duration?: number; count: number; generateAudio?: boolean };
}
export interface MediaResult {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  url?: string;
  error?: string;
  favorited?: boolean;
}
export interface MediaBatch {
  id: string;
  modelId: string;
  /** Save the output type if a historical model may be removed from the model list. */
  type?: MediaModel['type'];
  prompt: string;
  options: GenerateRequest['options'];
  references?: MediaReferences;
  results: MediaResult[];
}
export interface MediaTask { id: string; title: string; batches: MediaBatch[] }
export interface MediaWorkspaceProps {
  models: MediaModel[];
  tasks: MediaTask[];
  activeTaskId?: string;
  onTaskChange?: (taskId: string) => void;
  onCreateTask?: () => void;
  onRenameTask?: (taskId: string, title: string) => void;
  onGenerate: (request: GenerateRequest) => void | Promise<void>;
  onRetry?: (batchId: string, resultId: string) => void;
  onCancel?: (batchId: string, resultId: string) => void;
  onRegenerate?: (batchId: string, resultId: string) => void;
  onFavoriteChange?: (batchId: string, resultId: string, favorited: boolean) => void;
  accentColor?: string;
  className?: string;
}
