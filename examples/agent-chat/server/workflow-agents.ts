import redrawConfig from '../prompts/video-redraw.json';
import type { LocalStorage } from './storage';
import { readFileSync } from 'node:fs';
import { enabledBindings, type ModelConfiguration } from '../../../src/components/settings/model-config';
import type { StoredProvider } from './models';

export type WorkflowKind = 'analyze' | 'write-script' | 'extract-assets' | 'storyboard' | 'video-prompts' | 'novel-outline' | 'novel-script' | 'script-assets' | 'script-storyboard';
export type WorkflowAgent = { kind: WorkflowKind; model: string; formatterModel: string; instructions: string; skillIds: string[]; toolNames: string[] };

/** Text workflows use logical IDs; video analysis sends the upstream ID to its dedicated endpoint. */
export function workflowModelOptions(configuration: ModelConfiguration, providers: StoredProvider[], analysisBaseUrl?: string) {
  const text = configuration.models.flatMap(model => {
    if (model.type !== 'text' || model.enabled === false) return [];
    const first = enabledBindings(configuration, model)[0];
    const provider = providers.find(item => item.id === first?.providerId);
    return provider?.apiKey ? [{ id: model.id, name: model.displayName }] : [];
  });
  const normalize = (url: string) => url.trim().replace(/\/+$/, '');
  const matches = providers.filter(provider => analysisBaseUrl && normalize(provider.baseUrl) === normalize(analysisBaseUrl));
  const video = new Map<string, string>();
  for (const model of configuration.models) {
    if (model.type !== 'text' || model.enabled === false) continue;
    for (const binding of enabledBindings(configuration, model)) {
      if (binding.protocolKey === 'openai-completions' && matches.some(provider => provider.id === binding.providerId)) video.set(binding.upstreamModelId, model.displayName);
    }
  }
  for (const provider of matches) for (const model of provider.models) if (model.type === 'text' && model.enabled !== false && !video.has(model.id)) video.set(model.id, model.name);
  return { text, videoAnalysis: [...video].map(([id, name]) => ({ id, name })), analysisConfigured: !!analysisBaseUrl };
}

export function defaultWorkflowAgents(): WorkflowAgent[] {
  return (['analyze', 'write-script', 'extract-assets', 'storyboard', 'video-prompts', 'novel-outline', 'novel-script', 'script-assets', 'script-storyboard'] as const).map(kind => ({
    kind,
    model: kind === 'analyze' ? redrawConfig.videoAnalysisModel : kind === 'video-prompts' ? redrawConfig.videoPromptModel : redrawConfig.assetExtractionModel,
    formatterModel: redrawConfig.assetExtractionModel,
    instructions: ['novel-outline', 'novel-script', 'script-assets', 'script-storyboard'].includes(kind) ? readFileSync(new URL(`../prompts/${kind}.md`, import.meta.url), 'utf8') : '', skillIds: [], toolNames: [],
  }));
}
export function validateWorkflowAgents(value: unknown): WorkflowAgent[] {
  if (!Array.isArray(value) || value.length !== 9) throw new Error('工作流 Agent 配置必须包含九个阶段');
  const defaults = defaultWorkflowAgents();
  return defaults.map(({ kind }) => {
    const matches = value.filter(item => item && typeof item === 'object' && item.kind === kind);
    if (matches.length !== 1) throw new Error(`工作流 Agent 阶段 ${kind} 配置无效`);
    const item = matches[0];
    for (const key of ['model', 'formatterModel', 'instructions']) if (typeof item[key] !== 'string' || (key !== 'instructions' && !item[key].trim()) || item[key].length > 100_000) throw new Error(`${kind} 的 ${key} 无效`);
    for (const key of ['skillIds', 'toolNames']) if (!Array.isArray(item[key]) || item[key].length > 50 || item[key].some((entry: unknown) => typeof entry !== 'string' || !entry.trim() || entry.length > 200) || new Set(item[key]).size !== item[key].length) throw new Error(`${kind} 的 ${key} 无效`);
    return { kind, model: item.model.trim(), formatterModel: item.formatterModel.trim(), instructions: item.instructions, skillIds: [...item.skillIds], toolNames: [...item.toolNames] };
  });
}
export function loadWorkflowAgents(storage: LocalStorage) {
  const saved = storage.getConfig<WorkflowAgent[]>('workflowAgents');
  const migrated = Array.isArray(saved) && [3, 4, 5, 6, 7, 8].includes(saved.length) ? [...saved, ...defaultWorkflowAgents().filter(item => ['write-script', 'storyboard', 'novel-outline', 'novel-script', 'script-assets', 'script-storyboard'].includes(item.kind) && !saved.some(old => old.kind === item.kind))] : saved;
  return validateWorkflowAgents(migrated || defaultWorkflowAgents());
}
