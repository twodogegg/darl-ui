import type { ReactNode } from 'react';

export type AgentModelType = 'text' | 'image' | 'video' | 'audio';
export type ModelProviderProtocol = 'openai-completions' | 'openai-responses';
export type ModelProviderStatus = 'connected' | 'error' | 'unknown';

export interface AgentModelCapabilities {
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  files?: boolean;
  audioInput?: boolean;
  audioOutput?: boolean;
  contextWindow?: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ModelProviderProtocol;
  hasApiKey?: boolean;
  status?: ModelProviderStatus;
  models: AgentModelConfig[];
}

export interface AgentModelConfig {
  id: string;
  name: string;
  type: AgentModelType;
  providerId: string;
  description?: string;
  reasoningEfforts?: string[];
  capabilities?: AgentModelCapabilities;
  enabled?: boolean;
}

/** A server-managed assistant configuration. Credentials are kept on the host. */
export interface AgentConfig {
  id: string;
  name: string;
  builtIn?: boolean;
  /** Emoji, short label, or a host-managed image URL. */
  avatar?: string;
  description?: string;
  instructions: string;
  providerId: string;
  modelId: string;
  reasoningEfforts?: string[];
  skillIds?: string[];
  applicationIds?: string[];
  /** Optional per-application tool allow-list. Omitted means all discovered tools. */
  applicationTools?: Record<string, string[]>;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface AgentsSettingsCardProps {
  agents: AgentConfig[];
  models?: AgentModelConfig[];
  applications?: Array<{ id: string; name: string; tools?: Array<{ name: string; title?: string }> }>;
  skills?: Array<{ id: string; name: string; enabled?: boolean }>;
  onSave?: (agent: AgentConfig) => void | Promise<void>;
  onDelete?: (agentId: string) => void | Promise<void>;
}

export interface SettingsSection {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export interface SettingsPageProps {
  activeSection?: string;
  onSectionChange?: (sectionId: string) => void;
  sections?: SettingsSection[];
  title?: string;
  children?: ReactNode;
  className?: string;
}

export interface ModelSettingsCardProps {
  providers: ModelProvider[];
  onProviderSave?: (provider: ModelProvider, apiKey?: string) => void | Promise<void>;
  onProviderDelete?: (providerId: string) => void | Promise<void>;
  onTestConnection?: (provider: ModelProvider) => void | Promise<void>;
  onFetchModels?: (provider: ModelProvider) => void | Promise<AgentModelConfig[]>;
}

export interface AgentSettingsCardProps {
  systemPrompt: string;
  onSave: (systemPrompt: string) => void | Promise<void>;
}
