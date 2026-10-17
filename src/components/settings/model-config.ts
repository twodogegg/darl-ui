import type { AgentModel } from '../agent-sidebar/types';
import type { MediaModel } from '../media-workspace/types';
import type { AgentModelCapabilities, AgentModelType, ModelProvider } from './types';

export type CapabilityTemplateType = AgentModelType;
export type VideoGenerationMode = 'text-to-video' | 'first-last-frame' | 'reference';
export type FirstLastFrameSupport = 'supported' | 'unverified' | 'unsupported';

export interface TextCapabilities {
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
  vision?: boolean;
  tools?: boolean;
  contextWindow?: number;
}

export interface ImageCapabilities {
  supportsTextToImage?: boolean;
  supportsReferenceEdit?: boolean;
  maxReferenceImages: number;
  maxOutputs?: number;
  sizes?: string[];
  aspectRatios?: string[];
  qualities?: string[];
  formats?: string[];
  transparentBackground?: boolean;
}

export interface VideoCapabilities {
  modes: VideoGenerationMode[];
  firstLastFrame?: FirstLastFrameSupport;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  aspectRatios: string[];
  resolutions: string[];
  durations: number[] | { min: number; max: number };
  generateAudio?: boolean;
  maxOutputs?: number;
}

export interface AudioCapabilities {
  modes?: string[];
  maxReferenceAudios?: number;
  maxOutputs?: number;
}

export type CapabilityValues = TextCapabilities | ImageCapabilities | VideoCapabilities | AudioCapabilities;

export interface CapabilityTemplate<T extends CapabilityTemplateType = CapabilityTemplateType> {
  id: string;
  name: string;
  type: T;
  description?: string;
  capabilities: T extends 'text' ? TextCapabilities : T extends 'image' ? ImageCapabilities : T extends 'video' ? VideoCapabilities : AudioCapabilities;
  defaults?: Record<string, string | number | boolean>;
  updatedAt?: string;
}

export type CapabilityOverride = Partial<TextCapabilities & ImageCapabilities & VideoCapabilities & AudioCapabilities>;

export interface ModelBinding {
  id: string;
  providerId: string;
  upstreamModelId: string;
  protocolKey: string;
  capabilityOverrides?: CapabilityOverride;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  /** Maximum number of in-flight generations for this model's single provider. */
  maxConcurrency?: number;
}

export interface LogicalModel {
  id: string;
  displayName: string;
  type: AgentModelType;
  capabilityTemplateId: string;
  enabled?: boolean;
  bindings: ModelBinding[];
  description?: string;
}

export interface ProtocolAdapterDefinition {
  key: string;
  label: string;
  types: AgentModelType[];
  implemented?: boolean;
  description?: string;
}

export interface ModelConfiguration {
  version: 1;
  templates: CapabilityTemplate[];
  models: LogicalModel[];
  protocols: ProtocolAdapterDefinition[];
}

export interface ModelConfigurationError {
  path: string;
  message: string;
}

export const BUILTIN_PROTOCOLS: ProtocolAdapterDefinition[] = [
  { key: 'openai-completions', label: 'OpenAI Chat Completions', types: ['text'], implemented: true },
  { key: 'openai-responses', label: 'OpenAI Responses', types: ['text'], implemented: true },
  { key: 'openai-images', label: 'OpenAI Images', types: ['image'], implemented: true, description: '宿主接入 GPT Image 2' },
  { key: 'darl-h3-flash-unified', label: 'Darl H3 Flash（新版统一视频）', types: ['video'], implemented: true, description: '宿主接入 H3 Flash；首尾帧尚未验证' },
];

export const BUILTIN_TEMPLATES: CapabilityTemplate[] = [
  {
    id: 'deepseek-thinking', name: 'DeepSeek Thinking', type: 'text',
    capabilities: { reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high', vision: false, tools: true, contextWindow: 1_000_000 },
  },
  {
    id: 'gpt-reasoning', name: 'GPT Reasoning', type: 'text',
    capabilities: { reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium', vision: true, tools: true, contextWindow: 1_000_000 },
  },
  {
    id: 'gemini-thinking', name: 'Gemini Thinking', type: 'text',
    capabilities: { reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', vision: true, tools: true, contextWindow: 1_000_000 },
  },
  {
    id: 'gpt-image-2', name: 'GPT Image 2', type: 'image',
    capabilities: {
      supportsTextToImage: true, supportsReferenceEdit: true, maxReferenceImages: 16, maxOutputs: 10,
      sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'], aspectRatios: ['1:1', '3:2', '2:3'], qualities: ['auto', 'low', 'medium', 'high'], formats: ['png', 'jpeg', 'webp'], transparentBackground: true,
    },
    defaults: { size: 'auto', quality: 'auto', count: 1 },
  },
  {
    id: 'h3-flash', name: 'MiniMax H3 Flash（新版统一视频）', type: 'video',
    capabilities: {
      modes: ['text-to-video', 'first-last-frame', 'reference'], firstLastFrame: 'unverified',
      maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3,
      aspectRatios: ['16:9', '9:16'], resolutions: ['480', '768'], durations: { min: 4, max: 15 }, maxOutputs: 1,
    },
    defaults: { resolution: '768', aspectRatio: '9:16', duration: 10 },
  },
];

export const BUILTIN_MODELS: LogicalModel[] = [
  { id: 'deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash', type: 'text', capabilityTemplateId: 'deepseek-thinking', bindings: [{ id: 'deepseek-darl', providerId: 'darl', upstreamModelId: 'deepseek-v4.1-flash', protocolKey: 'openai-completions', enabled: true }] },
  { id: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', type: 'text', capabilityTemplateId: 'gpt-reasoning', bindings: [{ id: 'gpt-sol-darl', providerId: 'darl', upstreamModelId: 'gpt-6.1-sol', protocolKey: 'openai-responses', enabled: true }] },
  { id: 'gemini-4-argon', displayName: 'Gemini 4 Argon', type: 'text', capabilityTemplateId: 'gemini-thinking', bindings: [{ id: 'gemini-darl', providerId: 'darl', upstreamModelId: 'gemini-4-argon', protocolKey: 'openai-completions', enabled: true }] },
  { id: 'gpt-6-astra', displayName: 'GPT-6 Astra', type: 'text', capabilityTemplateId: 'gpt-reasoning', bindings: [{ id: 'gpt-astra-darl', providerId: 'darl', upstreamModelId: 'gpt-6-astra', protocolKey: 'openai-responses', enabled: true }] },
  { id: 'gpt-image-2', displayName: 'GPT Image 2', type: 'image', capabilityTemplateId: 'gpt-image-2', bindings: [{ id: 'gpt-image-darl', providerId: 'darl', upstreamModelId: 'gpt-image-2', protocolKey: 'openai-images', enabled: true }] },
  { id: 'minimax-h3-flash', displayName: 'MiniMax H3 Flash', type: 'video', capabilityTemplateId: 'h3-flash', bindings: [{ id: 'h3-darl', providerId: 'darl', upstreamModelId: 'minimax-h3-flash', protocolKey: 'darl-h3-flash-unified', enabled: true }] },
];

export const defaultModelConfiguration = (): ModelConfiguration => ({ version: 1, templates: BUILTIN_TEMPLATES.map((template) => ({ ...template, capabilities: { ...template.capabilities } as CapabilityValues })), models: BUILTIN_MODELS.map((model) => ({ ...model, bindings: model.bindings.map((binding) => ({ ...binding })) })), protocols: BUILTIN_PROTOCOLS.map((protocol) => ({ ...protocol })) });

function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return [...value] as T;
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) } as T;
  return value;
}

/** Resolve a binding without using truthiness, so 0 and false remain valid overrides. */
export function resolveCapabilities(template: CapabilityTemplate, overrides?: CapabilityOverride): CapabilityValues {
  const result = { ...(template.capabilities as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value !== undefined) result[key] = copyValue(value);
  }
  return result as CapabilityValues;
}

export function effectiveCapabilities(configuration: ModelConfiguration, model: LogicalModel, binding?: ModelBinding): CapabilityValues | undefined {
  const template = configuration.templates.find((item) => item.id === model.capabilityTemplateId);
  if (!template || template.type !== model.type) return undefined;
  return resolveCapabilities(template, binding?.capabilityOverrides);
}

export function enabledBindings(configuration: ModelConfiguration, model: LogicalModel): ModelBinding[] {
  return model.bindings.filter((binding) => binding.enabled !== false && configuration.protocols.some((protocol) => protocol.key === binding.protocolKey && protocol.implemented !== false && protocol.types.includes(model.type)));
}

export function toAgentModels(configuration: ModelConfiguration, providers: ModelProvider[] = []): AgentModel[] {
  return configuration.models.filter((model) => model.enabled !== false).flatMap((model) => {
    return enabledBindings(configuration, model).flatMap((binding) => {
    const provider = providers.find((item) => item.id === binding.providerId);
    if (providers.length && !provider) return [];
    const capabilities = effectiveCapabilities(configuration, model, binding);
    const text = model.type === 'text' && capabilities && 'reasoningEfforts' in capabilities ? capabilities : undefined;
    const media = capabilities && !('reasoningEfforts' in capabilities) ? capabilities : undefined;
    return [{
      id: `${binding.providerId}/${encodeURIComponent(binding.upstreamModelId)}`,
      logicalModelId: model.id,
      bindingId: binding.id,
      upstreamModelId: binding.upstreamModelId,
      name: model.displayName,
      description: model.description,
      providerId: binding.providerId,
      type: model.type,
      enabled: true,
      reasoningEfforts: text?.reasoningEfforts.filter((effort) => effort !== 'none'),
      capabilities: {
        ...(text ? { vision: text.vision, tools: text.tools, contextWindow: text.contextWindow } : {}),
        ...(media ? mediaCapabilities(media) : {}),
      },
      providerName: provider?.name,
    } as AgentModel];
    });
  });
}

export function mediaCapabilities(value: CapabilityValues): AgentModelCapabilities {
  if ('maxReferenceImages' in value && 'modes' in value) {
    const durations = value.durations;
    return {
      ...(value.maxReferenceImages !== undefined ? { files: value.maxReferenceImages > 0 } : {}),
      ...(value.maxOutputs !== undefined ? { maxOutputs: value.maxOutputs } : {}),
      ...(value.aspectRatios ? { aspectRatios: value.aspectRatios } : {}),
      ...(value.resolutions ? { resolutions: value.resolutions } : {}),
      ...(durations ? { durations } : {}),
      ...(value.generateAudio !== undefined ? { audioOutput: value.generateAudio } : {}),
      referenceImages: value.maxReferenceImages,
      referenceVideos: value.maxReferenceVideos,
      referenceAudios: value.maxReferenceAudios,
      generationModes: value.modes,
      firstLastFrame: value.firstLastFrame === 'supported',
    } as AgentModelCapabilities;
  }
  if ('maxReferenceImages' in value) {
    return {
      referenceImages: value.maxReferenceImages,
      aspectRatios: value.aspectRatios,
      resolutions: value.sizes,
      qualities: value.qualities,
      maxOutputs: value.maxOutputs,
      referenceEdit: value.supportsReferenceEdit,
      textToImage: value.supportsTextToImage,
      generationModes: [
        ...(value.supportsTextToImage ? ['text-to-image'] : []),
        ...(value.supportsReferenceEdit ? ['reference-edit'] : []),
      ],
    } as AgentModelCapabilities;
  }
  return {};
}

/** Convert configured image/video bindings into the generic MediaWorkspace contract. */
export function toMediaModels(configuration: ModelConfiguration, includeUnimplemented = false): MediaModel[] {
  return configuration.models.filter((model) => model.enabled !== false && (model.type === 'image' || model.type === 'video')).flatMap<MediaModel>((model): MediaModel[] => {
    const binding = model.bindings.find((item) => item.enabled !== false && (includeUnimplemented || configuration.protocols.some((protocol) => protocol.key === item.protocolKey && protocol.implemented !== false && protocol.types.includes(model.type))));
    if (!binding) return [];
    const capabilities = effectiveCapabilities(configuration, model, binding);
    if (!capabilities) return [];
    if (model.type === 'image' && 'maxReferenceImages' in capabilities && 'sizes' in capabilities) return [{
      id: model.id, logicalModelId: model.id, bindingId: binding.id, providerId: binding.providerId, upstreamModelId: binding.upstreamModelId, protocolKey: binding.protocolKey, name: model.displayName, type: 'image',
      capabilities: { images: capabilities.maxReferenceImages, generationModes: [
        ...('supportsTextToImage' in capabilities && capabilities.supportsTextToImage ? ['text-to-image' as const] : []),
        ...('supportsReferenceEdit' in capabilities && capabilities.supportsReferenceEdit ? ['reference-edit' as const] : []),
      ], ...(capabilities.sizes ? { resolutions: capabilities.sizes } : {}), ...(capabilities.aspectRatios ? { aspectRatios: capabilities.aspectRatios } : {}), ...(capabilities.maxOutputs !== undefined ? { maxOutputs: capabilities.maxOutputs } : {}) },
      ...(modelTemplateDefaults(configuration, model) ? { defaults: modelTemplateDefaults(configuration, model) } : {}),
    }];
    if (model.type === 'video' && 'maxReferenceVideos' in capabilities && 'modes' in capabilities && Array.isArray(capabilities.modes)) return [{
      id: model.id, logicalModelId: model.id, bindingId: binding.id, providerId: binding.providerId, upstreamModelId: binding.upstreamModelId, protocolKey: binding.protocolKey, name: model.displayName, type: 'video',
      capabilities: { images: capabilities.maxReferenceImages, videos: capabilities.maxReferenceVideos, audios: capabilities.maxReferenceAudios, generationModes: capabilities.modes, firstLastFrame: capabilities.firstLastFrame === 'supported', aspectRatios: capabilities.aspectRatios, resolutions: capabilities.resolutions, durations: capabilities.durations, ...(capabilities.generateAudio !== undefined ? { generateAudio: capabilities.generateAudio } : {}), ...(capabilities.maxOutputs !== undefined ? { maxOutputs: capabilities.maxOutputs } : {}) },
      ...(modelTemplateDefaults(configuration, model) ? { defaults: modelTemplateDefaults(configuration, model) } : {}),
    }];
    return [];
  });
}

function modelTemplateDefaults(configuration: ModelConfiguration, model: LogicalModel) {
  const value = configuration.templates.find((template) => template.id === model.capabilityTemplateId)?.defaults;
  if (!value) return undefined;
  return value as never;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
}

export function validateModelConfiguration(configuration: ModelConfiguration): ModelConfigurationError[] {
  const errors: ModelConfigurationError[] = [];
  if (!configuration || configuration.version !== 1) return [{ path: 'version', message: '配置版本不受支持' }];
  if (!Array.isArray(configuration.templates) || !Array.isArray(configuration.models) || !Array.isArray(configuration.protocols)) return [{ path: 'configuration', message: '模型配置结构无效' }];
  const validTemplates = configuration.templates.filter((item): item is CapabilityTemplate => Boolean(item) && typeof item === 'object' && typeof item.id === 'string' && typeof item.type === 'string');
  const validProtocols = configuration.protocols.filter((item): item is ProtocolAdapterDefinition => Boolean(item) && typeof item === 'object' && typeof item.key === 'string');
  if (validTemplates.length !== configuration.templates.length) errors.push({ path: 'templates', message: '能力模板结构无效' });
  if (validProtocols.length !== configuration.protocols.length) errors.push({ path: 'protocols', message: '协议注册结构无效' });
  const templates = new Map(validTemplates.map((item) => [item.id, item]));
  const protocols = new Map(validProtocols.map((item) => [item.key, item]));
  const modelIds = new Set<string>();
  for (const [index, model] of configuration.models.entries()) {
    const path = `models[${index}]`;
    if (!model || typeof model !== 'object') { errors.push({ path, message: '逻辑模型结构无效' }); continue; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model.id)) errors.push({ path: `${path}.id`, message: '逻辑模型 ID 格式无效' });
    if (modelIds.has(model.id)) errors.push({ path: `${path}.id`, message: '逻辑模型 ID 必须唯一' });
    modelIds.add(model.id);
    const template = templates.get(model.capabilityTemplateId);
    if (!template) { errors.push({ path: `${path}.capabilityTemplateId`, message: '能力模板不存在' }); continue; }
    const templateMatches = template.type === model.type;
    if (!templateMatches) errors.push({ path: `${path}.capabilityTemplateId`, message: '能力模板类型与模型不一致' });
    const bindingIds = new Set<string>();
    if ((model.type === 'image' || model.type === 'video') && model.bindings.filter((b) => b.enabled !== false).length > 1)
      errors.push({ path: path + '.bindings', message: '图片和视频模型只能配置一个有效供应商' });
    if (!Array.isArray(model.bindings)) { errors.push({ path: `${path}.bindings`, message: '渠道绑定必须是数组' }); continue; }
    for (const [bindingIndex, binding] of model.bindings.entries()) {
      const bindingPath = `${path}.bindings[${bindingIndex}]`;
      if (!binding || typeof binding !== 'object') { errors.push({ path: bindingPath, message: '渠道绑定结构无效' }); continue; }
      if (bindingIds.has(binding.id)) errors.push({ path: `${bindingPath}.id`, message: '渠道绑定 ID 必须唯一' });
      bindingIds.add(binding.id);
      if (binding.maxConcurrency !== undefined && (!Number.isSafeInteger(binding.maxConcurrency) || binding.maxConcurrency < 1 || binding.maxConcurrency > 100000))
        errors.push({ path: bindingPath + '.maxConcurrency', message: '最大并发必须为 1-100000 的整数' });
      const protocol = protocols.get(binding.protocolKey);
      if (!protocol) errors.push({ path: `${bindingPath}.protocolKey`, message: '协议未安装或尚未由宿主注册' });
      else if (!protocol.types.includes(model.type)) errors.push({ path: `${bindingPath}.protocolKey`, message: '协议与模型类型不匹配' });
      if (!binding.providerId?.trim() || !binding.upstreamModelId?.trim()) errors.push({ path: bindingPath, message: '供应商和上游模型 ID 不能为空' });
      if (!templateMatches) continue;
      const effective = resolveCapabilities(template, binding.capabilityOverrides);
      const configuredDefaults = template.defaults || {};
      if (model.type === 'text') {
        const text = effective as TextCapabilities;
        if (!isStringArray(text.reasoningEfforts) || text.reasoningEfforts.includes('none')) errors.push({ path: `${bindingPath}.capabilityOverrides.reasoningEfforts`, message: '文本模型必须提供思考等级，且不能包含 none' });
        if (!text.reasoningEfforts.includes(text.defaultReasoningEffort)) errors.push({ path: `${bindingPath}.defaultReasoningEffort`, message: '默认思考等级必须属于最终有效能力' });
      }
      if (model.type === 'image') {
        const image = effective as ImageCapabilities;
        if (!Number.isInteger(image.maxReferenceImages) || image.maxReferenceImages < 0) errors.push({ path: `${bindingPath}.maxReferenceImages`, message: '参考图上限必须是非负整数' });
        if (image.maxOutputs !== undefined && (!Number.isInteger(image.maxOutputs) || image.maxOutputs < 1)) errors.push({ path: `${bindingPath}.maxOutputs`, message: '输出数量必须是正整数' });
        const size = configuredDefaults.size || configuredDefaults.resolution;
        if (typeof size === 'string' && image.sizes && !image.sizes.includes(size)) errors.push({ path: `${bindingPath}.defaults.size`, message: '默认尺寸必须属于最终有效能力' });
        if (typeof configuredDefaults.aspectRatio === 'string' && image.aspectRatios && !image.aspectRatios.includes(configuredDefaults.aspectRatio)) errors.push({ path: `${bindingPath}.defaults.aspectRatio`, message: '默认画幅必须属于最终有效能力' });
      }
      if (model.type === 'video') {
        const video = effective as VideoCapabilities;
        for (const key of ['maxReferenceImages', 'maxReferenceVideos', 'maxReferenceAudios'] as const) if (!Number.isInteger(video[key]) || video[key] < 0) errors.push({ path: `${bindingPath}.${key}`, message: '素材上限必须是非负整数' });
        if (!isStringArray(video.resolutions)) errors.push({ path: `${bindingPath}.resolutions`, message: '分辨率不能为空' });
        if (model.id === 'minimax-h3-flash' && video.resolutions.some((value) => value !== '480' && value !== '768')) errors.push({ path: `${bindingPath}.resolutions`, message: 'H3 Flash 只支持 480 或 768' });
        if (model.id === 'minimax-h3-flash' && video.aspectRatios.some((value) => value !== '16:9' && value !== '9:16')) errors.push({ path: `${bindingPath}.aspectRatios`, message: 'H3 Flash 只支持 16:9 或 9:16' });
        if (video.modes.includes('first-last-frame') && video.firstLastFrame === 'supported' && !protocol?.implemented) errors.push({ path: `${bindingPath}.firstLastFrame`, message: '首尾帧协议尚未实现' });
        const resolution = configuredDefaults.resolution;
        if (typeof resolution === 'string' && !video.resolutions.includes(resolution)) errors.push({ path: `${bindingPath}.defaults.resolution`, message: '默认分辨率必须属于最终有效能力' });
        if (typeof configuredDefaults.aspectRatio === 'string' && !video.aspectRatios.includes(configuredDefaults.aspectRatio)) errors.push({ path: `${bindingPath}.defaults.aspectRatio`, message: '默认画幅必须属于最终有效能力' });
        if (typeof configuredDefaults.duration === 'number') {
          const valid = Array.isArray(video.durations) ? video.durations.includes(configuredDefaults.duration) : configuredDefaults.duration >= video.durations.min && configuredDefaults.duration <= video.durations.max;
          if (!valid) errors.push({ path: `${bindingPath}.defaults.duration`, message: '默认时长必须属于最终有效能力' });
        }
      }
    }
  }
  return errors;
}
