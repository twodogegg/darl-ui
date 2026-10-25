import type { ReactNode } from 'react';
import type { AgentModelCapabilities, AgentModelType } from '../settings/types';

export type AgentMessageRole = 'user' | 'assistant';
export type AgentToolStatus = 'pending' | 'running' | 'retrying' | 'success' | 'error' | 'confirmation' | 'cancelled';

/** Fixed streaming protocol values used to render generic Agent activity. */
export type AgentExecutionSource = 'agent' | 'tool' | 'commentary';
export type AgentExecutionStatus = 'pending' | 'started' | 'running' | 'retrying' | 'confirmation' | 'success' | 'error' | 'cancelled' | 'timeout';

export interface AgentExecutionEvent {
  id: string;
  source: AgentExecutionSource;
  status: AgentExecutionStatus;
  /** Dynamic Agent / tool display name supplied by the host. */
  name: string;
  summary?: string;
  timestamp: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  runId?: string;
  parentRunId?: string;
  agentId?: string | null;
  toolCallId?: string;
  requestId?: string;
  attempt?: number;
  error?: AgentErrorInfo;
}

export type AgentErrorStage = 'model' | 'mcp-connection' | 'mcp-tool' | 'runtime' | 'delegation' | 'tool-validation' | 'validation' | 'cancellation' | 'timeout';

export interface AgentErrorInfo {
  code: string;
  stage: AgentErrorStage;
  message: string;
  requestId?: string;
  runId?: string;
  parentRunId?: string;
  retryable: boolean;
  suggestion: string;
}

export interface AgentTool {
  name: string;
  title?: string;
  description?: string;
  risk?: 'read' | 'write' | 'dangerous';
}

export interface AgentApplication {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  status?: 'connected' | 'disconnected' | 'needs-auth';
  tools?: AgentTool[];
}

export interface AgentSkill {
  id: string;
  /** Display name, which can differ from the package name. */
  name: string;
  description?: string;
  version?: string;
  /** Original name from SKILL.md frontmatter; also used for @ matching. */
  slug?: string;
  /** Original YAML metadata, preserved when exporting SKILL.md. */
  frontmatter?: string;
  category?: string;
  /** OpenAI Skills policy. Defaults to true when omitted. */
  allowImplicitInvocation?: boolean;
  /** @deprecated Skills are always available; kept for persisted data compatibility. */
  enabled?: boolean;
  scope?: 'builtin' | 'custom';
  favorite?: boolean;
  instructions?: string;
  resources?: AgentSkillResource[];
  updatedAt?: string;
}

export interface AgentSkillResource {
  path: string;
  content: string;
  encoding?: 'base64';
}

export type AgentSkillDraft = Omit<AgentSkill, 'id' | 'version' | 'updatedAt'> & {
  id?: string;
  version?: string;
};

export interface AgentModel {
  id: string;
  name: string;
  /** Logical model identity and the selected host routing binding. */
  logicalModelId?: string;
  bindingId?: string;
  upstreamModelId?: string;
  providerName?: string;
  description?: string;
  providerId?: string;
  type?: AgentModelType;
  reasoningEfforts?: string[];
  /** Preferred level when the host has no saved user choice; must be one of `reasoningEfforts`. */
  defaultReasoningEffort?: string;
  capabilities?: AgentModelCapabilities;
  enabled?: boolean;
}

export interface AgentToolCall {
  id: string;
  appId: string;
  appName: string;
  toolName: string;
  toolTitle?: string;
  risk?: 'read' | 'write' | 'dangerous';
  input?: unknown;
  output?: unknown;
  error?: string;
  status: AgentToolStatus;
  agentId?: string | null;
  parentRunId?: string;
  runId?: string;
  requestId?: string;
  errorInfo?: AgentErrorInfo;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  attempt?: number;
}

export interface AgentAttachment {
  name: string;
  type?: string;
  url?: string;
  size?: number;
  /** Host-stored file identity; stable after refresh and safe to resend. */
  fileId?: string;
}

export interface AgentImageAttachment {
  name: string;
  type: string;
  data: string;
  size?: number;
  /** Host-stored file identity. When present, data may be omitted by hosts that persist attachments. */
  fileId?: string;
}

export interface AgentOutput {
  output_type: 'text' | 'speech';
  content: string;
}

export interface AgentVoiceOption {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  languages?: string[];
  /** Existing sample audio from the host; no synthesis is requested for previews. */
  previewUrl?: string;
}

export interface AgentVoiceFilters {
  language?: string;
  tags?: string[];
  sort?: string;
}

export interface AgentVoice {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  voiceId: string;
  voiceName?: string;
  onVoiceChange: (voice: AgentVoiceOption) => void;
  /** Optional host-defined catalog controls; filters are applied by loadVoices. */
  catalogFilters?: {
    languages: Array<{ value: string; label: string }>;
    defaultLanguage?: string;
    sorts: Array<{ value: string; label: string }>;
    tagGroups: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
  };
  loadVoices: (query: string, page: number, signal: AbortSignal, filters?: AgentVoiceFilters) => Promise<{ voices: AgentVoiceOption[]; hasMore: boolean }>;
  /** Streaming signed 16-bit little-endian mono PCM. Credentials stay in the host. */
  synthesize: (text: string, voiceId: string, signal: AbortSignal) => Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }>;
  transcribe?: (file: File, signal: AbortSignal) => Promise<string>;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  outputs?: AgentOutput[];
  createdAt?: string;
  streaming?: boolean;
  attachments?: Array<string | AgentAttachment>;
  toolCalls?: AgentToolCall[];
  agentId?: string | null;
  requestId?: string;
  runId?: string;
  error?: AgentErrorInfo;
  /** Ordered execution events. Raw tool inputs/results are deliberately excluded. */
  timeline?: AgentExecutionEvent[];
}

export interface AgentSession {
  id: string;
  /** Fixed when the host starts a conversation from its Agent directory. */
  agentId?: string;
  title: string;
  updatedAt?: string;
  /** Lightweight history preview supplied by hosts that load messages on selection. */
  messagePreview?: string;
  /** Number of saved messages when a host supplies only session metadata. */
  messageCount?: number;
  messages: AgentMessage[];
}

export interface AgentSendRequest {
  voiceMode?: boolean;
  files?: File[];
  attachments?: AgentImageAttachment[];
  /** Uploaded non-image attachments. Hosts may persist these without pretending the model can read them. */
  uploadedAttachments?: AgentAttachment[];
  sessionId: string;
  content: string;
  applicationIds: string[];
  skillIds: string[];
  modelId?: string;
  reasoningEffort?: string;
  agentId?: string | null;
}

export type AgentApprovalMode = 'ask' | 'auto' | 'full';

export interface AgentSidebarProps {
  /** Embed the same chat inside a host panel or canvas node. */
  embedded?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
  references?: Array<{ id: string; name: string; description?: string }>;
  onReference?: (id: string) => void;
  composerHeader?: ReactNode;
  composerFooter?: ReactNode;
  messageHeader?: ReactNode;
  renderMessageActions?: (message: AgentMessage) => ReactNode;
  voice?: AgentVoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AgentSession[];
  /** Hide unsent local drafts from the history list. */
  hideEmptySessions?: boolean;
  activeSessionId?: string;
  onSessionChange?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, title: string) => void | Promise<void>;
  /** Host removes the session and should switch the active session itself. */
  onSessionDelete?: (sessionId: string) => void | Promise<void>;
  onNewSession?: () => void;
  onSend?: (request: AgentSendRequest) => void | Promise<void>;
  isGenerating?: boolean;
  onStop?: () => void;
  onRegenerate?: (messageId: string) => void;
  /** Host confirms or rejects a pending tool call. The host must enforce the decision. */
  onToolConfirm?: (toolCallId: string, approved: boolean) => void | Promise<void>;
  /** Controlled by the host, which must persist and enforce this policy server-side. */
  approvalMode?: AgentApprovalMode;
  onApprovalModeChange?: (mode: AgentApprovalMode) => void | Promise<void>;
  /** Blocks sending while the host loads or saves the approval policy. */
  approvalModePending?: boolean;
  applications?: AgentApplication[];
  skills?: AgentSkill[];
  onSkillUpload?: (file: File) => void | Promise<void>;
  onSkillImport?: (skill: AgentSkill) => void | Promise<void>;
  /** Opens the host's conversation-based Skill creation flow. */
  onSkillCreate?: () => void | Promise<void>;
  onFileUpload?: (files: File[]) => void | Promise<void>;
  /** Host stores attachment bytes and returns a stable reference. When supplied, the file picker also accepts non-image files. */
  uploadAttachment?: (file: File) => Promise<AgentAttachment>;
  models?: AgentModel[];
  selectedApplicationIds?: string[];
  onSelectedApplicationIdsChange?: (ids: string[]) => void;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (ids: string[]) => void;
  selectedModelId?: string;
  onSelectedModelIdChange?: (id: string) => void;
  selectedReasoningEffort?: string;
  onSelectedReasoningEffortChange?: (effort: string) => void;
  agents?: Array<{ id: string; name: string; avatar?: string; description?: string; type?: 'main_agent' | 'sub_agent'; selectable?: boolean; callable?: boolean; enabled?: boolean; isDefault?: boolean; builtIn?: boolean }>;
  selectedAgentId?: string | null;
  /** @deprecated Select an Agent before opening the conversation; the sidebar only displays it. */
  onSelectedAgentIdChange?: (id: string) => void;
  pageContext?: string;
  className?: string;
}
