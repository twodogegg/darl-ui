export type RequestModelType = 'text' | 'image' | 'audio' | 'video';
export type RequestRecordStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled' | 'timeout' | 'uncertain';

export interface RequestRecordMedia {
  type: Exclude<RequestModelType, 'text'>;
  name: string;
  fileId?: string;
  url?: string;
  thumbnailUrl?: string;
  unavailable?: boolean;
}

export interface RequestRecord {
  id: string;
  type: RequestModelType;
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  status: RequestRecordStatus;
  createdAt: string;
  endedAt?: string;
  durationMs?: number;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  taskId?: string;
  upstreamTaskId?: string;
  url?: string;
  method?: string;
  parameters?: unknown;
  response?: unknown;
  text?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  references?: RequestRecordMedia[];
  results?: RequestRecordMedia[];
  /** Lightweight first result used for list thumbnails; may be omitted when unavailable. */
  thumbnail?: RequestRecordMedia;
}

export interface RequestRecordFilters {
  type?: RequestModelType;
  status?: RequestRecordStatus;
  modelId?: string;
  providerId?: string;
  query?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface RequestRecordPage {
  items: RequestRecord[];
  total: number;
  models: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; name: string }>;
}

export interface RequestRecordRetention { enabled: boolean; days: number }

export interface RequestRecordsProps {
  loadRecords: (filters: RequestRecordFilters, signal: AbortSignal) => Promise<RequestRecordPage>;
  loadRecord: (id: string, signal: AbortSignal) => Promise<RequestRecord>;
  loadRetention: (signal: AbortSignal) => Promise<RequestRecordRetention>;
  saveRetention: (value: RequestRecordRetention) => Promise<RequestRecordRetention>;
  onOpenSession?: (sessionId: string) => void;
  onOpenTask?: (taskId: string) => void;
  className?: string;
}
