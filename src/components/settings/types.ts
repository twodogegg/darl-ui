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
  /** Host supplied media capabilities shared with MediaWorkspace. */
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[] | { min: number; max: number };
  maxOutputs?: number;
  referenceImages?: number;
  referenceVideos?: number;
  referenceAudios?: number;
  generationModes?: string[];
  firstLastFrame?: boolean;
  referenceEdit?: boolean;
  textToImage?: boolean;
  qualities?: string[];
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  /** Legacy provider adapter default; ModelManagementCard hosts resolve protocol from each model binding. */
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

export type AgentChildContextMode = 'task-only' | 'selected-context';
export type AgentHistoryMode = 'recent' | 'summary' | 'full';
export type AgentToolResultMode = 'brief' | 'standard' | 'detailed';
export type AgentType = 'main_agent' | 'sub_agent';
export type AgentSource = 'system_default' | 'user_created' | 'imported';
export type AgentContextStrategy = 'isolated' | 'inherit_filtered' | 'inherit_full';

export interface AgentContextPolicy {
  childContext: AgentChildContextMode;
  historyMode: AgentHistoryMode;
  toolResultMode: AgentToolResultMode;
}

/** A server-managed assistant configuration. Credentials are kept on the host. */
export interface AgentConfig {
  id: string;
  name: string;
  type?: AgentType;
  source?: AgentSource;
  selectable?: boolean;
  callable?: boolean;
  contextStrategy?: AgentContextStrategy;
  /** Wire-format alias accepted when integrating with snake_case Agent APIs. */
  context_strategy?: AgentContextStrategy;
  /** Optional MCP application allow-list; omitted means the host default. */
  applicationIds?: string[];
  builtIn?: boolean;
  /** Emoji, short label, or a host-managed image URL. */
  avatar?: string;
  description?: string;
  instructions: string;
  skillIds?: string[];
  contextPolicy?: AgentContextPolicy;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface AgentsSettingsCardProps {
  agents: AgentConfig[];
  skills?: Array<{ id: string; name: string; enabled?: boolean }>;
  applications?: Array<{ id: string; name: string }>;
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

export interface ModelManagementCardProps {
  configuration: import('./model-config').ModelConfiguration;
  providers?: ModelProvider[];
  onSave?: (configuration: import('./model-config').ModelConfiguration) => void | Promise<void>;
  onProviderSave?: (provider: ModelProvider, apiKey?: string) => void | Promise<void>;
  onProviderDelete?: (providerId: string) => void | Promise<void>;
  onTestConnection?: (provider: ModelProvider) => void | Promise<void>;
  onFetchModels?: (provider: ModelProvider, apiKey?: string) => Promise<AgentModelConfig[]>;
}

export type {
  AudioCapabilities,
  CapabilityOverride,
  CapabilityTemplate,
  CapabilityTemplateType,
  CapabilityValues,
  FirstLastFrameSupport,
  ImageCapabilities,
  LogicalModel,
  ModelBinding,
  ModelConfiguration,
  ModelConfigurationError,
  ProtocolAdapterDefinition,
  TextCapabilities,
  VideoCapabilities,
  VideoGenerationMode,
} from './model-config';

export interface AgentSettingsCardProps {
  systemPrompt: string;
  onSave: (systemPrompt: string) => void | Promise<void>;
}

export type PromptKey = 'system' | 'voice' | 'optimization' | 'h3Optimization';
export interface PromptSettingsPrompts {
  system: string;
  voice: string;
  optimization?: string;
  h3Optimization?: string;
  defaults?: Partial<Record<PromptKey, string>>;
}
export interface PromptSettingsCardProps {
  prompts: PromptSettingsPrompts;
  onSave: (patch: Partial<Record<PromptKey, string>>) => void | Promise<void>;
  onReset?: (prompts: PromptSettingsPrompts) => void | Promise<void>;
}
