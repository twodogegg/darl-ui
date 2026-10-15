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
