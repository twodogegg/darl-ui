import type { AgentModelCapabilities, AgentModelType } from '../settings/types';

export type AgentMessageRole = 'user' | 'assistant';
export type AgentToolStatus = 'pending' | 'running' | 'success' | 'error' | 'confirmation';

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
  input?: unknown;
  output?: unknown;
  error?: string;
  status: AgentToolStatus;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt?: string;
  streaming?: boolean;
  attachments?: string[];
  toolCalls?: AgentToolCall[];
}

export interface AgentSession {
  id: string;
  title: string;
  updatedAt?: string;
  messages: AgentMessage[];
}

export interface AgentSendRequest {
  files?: File[];
  sessionId: string;
  content: string;
  applicationIds: string[];
  skillIds: string[];
  modelId?: string;
  reasoningEffort?: string;
}

export interface AgentSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AgentSession[];
  activeSessionId?: string;
  onSessionChange?: (sessionId: string) => void;
  onNewSession?: () => void;
  onSend?: (request: AgentSendRequest) => void | Promise<void>;
  isGenerating?: boolean;
  onStop?: () => void;
  onRegenerate?: (messageId: string) => void;
  applications?: AgentApplication[];
  skills?: AgentSkill[];
  onSkillUpload?: (file: File) => void | Promise<void>;
  onSkillImport?: (skill: AgentSkill) => void | Promise<void>;
  onSkillSave?: (skill: AgentSkill) => void | Promise<void>;
  onSkillDelete?: (skillId: string) => void | Promise<void>;
  onSkillFavoriteChange?: (skillId: string, favorite: boolean) => void | Promise<void>;
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
  pageContext?: string;
  className?: string;
}
