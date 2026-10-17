import type { AgentModelCapabilities, AgentModelType } from '../settings/types';

export type AgentMessageRole = 'user' | 'assistant';
export type AgentToolStatus = 'pending' | 'running' | 'retrying' | 'success' | 'error' | 'confirmation';

/** Fixed streaming protocol values used to render generic Agent activity. */
export type AgentExecutionSource = 'agent' | 'tool';
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

export type AgentErrorStage = 'model' | 'mcp-connection' | 'mcp-tool' | 'delegation' | 'tool-validation' | 'validation' | 'cancellation' | 'timeout';

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
  name: string;
  description?: string;
  version?: string;
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
}

export interface AgentImageAttachment {
  name: string;
  type: string;
  data: string;
  size?: number;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
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
  title: string;
  updatedAt?: string;
  messages: AgentMessage[];
}

export interface AgentSendRequest {
  files?: File[];
  attachments?: AgentImageAttachment[];
  sessionId: string;
  content: string;
  applicationIds: string[];
  skillIds: string[];
  modelId?: string;
  reasoningEffort?: string;
  agentId?: string | null;
}

export interface AgentSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AgentSession[];
  activeSessionId?: string;
  onSessionChange?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, title: string) => void | Promise<void>;
  onNewSession?: () => void;
  onSend?: (request: AgentSendRequest) => void | Promise<void>;
  isGenerating?: boolean;
  onStop?: () => void;
  onRegenerate?: (messageId: string) => void;
  /** Host confirms or rejects a pending tool call. The host must enforce the decision. */
  onToolConfirm?: (toolCallId: string, approved: boolean) => void | Promise<void>;
  applications?: AgentApplication[];
  skills?: AgentSkill[];
  onSkillUpload?: (file: File) => void | Promise<void>;
  onSkillImport?: (skill: AgentSkill) => void | Promise<void>;
  onFileUpload?: (files: File[]) => void | Promise<void>;
  models?: AgentModel[];
  selectedApplicationIds?: string[];
  onSelectedApplicationIdsChange?: (ids: string[]) => void;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (ids: string[]) => void;
  selectedModelId?: string;
  onSelectedModelIdChange?: (id: string) => void;
  selectedReasoningEffort?: string;
  onSelectedReasoningEffortChange?: (effort: string) => void;
  agents?: Array<{ id: string; name: string; avatar?: string; description?: string; enabled?: boolean; isDefault?: boolean; builtIn?: boolean; reasoningEfforts?: string[] }>;
  selectedAgentId?: string | null;
  onSelectedAgentIdChange?: (id: string) => void;
  pageContext?: string;
  className?: string;
}
