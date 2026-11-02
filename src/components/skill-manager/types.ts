import type { AgentModelCapabilities, AgentModelType } from '../settings/types';


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
