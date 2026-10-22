import { readFileSync } from 'node:fs';
import { toAgentModels, toMediaModels, type ModelConfiguration } from '../../../src/components/settings/model-config';
import { isH3Model, generationModes, normalizeOptions } from '../../../src/components/media-workspace/model';
import type { GenerateRequest } from '../../../src/components/media-workspace/types';
import type { LocalStorage } from './storage';
import type { FileStore } from './file-storage';

export type OptimizationModels = { general: string; h3: string };
const promptFiles = { optimization: 'optimize-prompt.md', h3Optimization: 'optimize-h3-prompt.md' } as const;
export type OptimizationPromptKey = keyof typeof promptFiles;

export function createPromptOptimization(storage: LocalStorage, files: FileStore) {
  const defaults = () => Object.fromEntries(Object.entries(promptFiles).map(([key, file]) => [key, readFileSync(new URL(`../prompts/${file}`, import.meta.url), 'utf8').trim()])) as Record<OptimizationPromptKey, string>;
  const prompts = () => Object.fromEntries(Object.entries(defaults()).map(([key, value]) => [key, storage.getConfig<string>(key) ?? value])) as Record<OptimizationPromptKey, string>;
  const models = (configuration: ModelConfiguration): OptimizationModels => {
    const available = toAgentModels(configuration).filter(model => model.type === 'text');
    const fallback = available.find(model => model.upstreamModelId === 'deepseek-v4.1-flash')?.id || available[0]?.id || '';
    return storage.getConfig<OptimizationModels>('promptOptimizationModels') || { general: fallback, h3: fallback };
  };
  const saveModels = (value: unknown, configuration: ModelConfiguration) => {
    const input = value as OptimizationModels | null;
    const available = toAgentModels(configuration).filter(model => model.type === 'text');
    if (!input || !available.some(model => model.id === input.general) || !available.some(model => model.id === input.h3)) throw new Error('请选择已启用的文本模型');
    const next = { general: input.general, h3: input.h3 };
    storage.setConfig('promptOptimizationModels', next);
    return next;
  };
  const context = (body: Record<string, unknown>, configuration: ModelConfiguration) => {
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 16000) throw new Error('请填写不超过 16000 字符的提示词');
    if (body.optimization !== 'general' && body.optimization !== 'h3') throw new Error('提示词优化方式无效');
    const model = toMediaModels(configuration).find(model => model.id === body.modelId);
    if (!model) throw new Error('请选择已启用的生成模型');
    if (body.optimization === 'h3' && !isH3Model(model)) throw new Error('H3 提示优化只适用于 H3 视频模型');
    const modes = generationModes(model);
    if (typeof body.mode !== 'string' || !modes.includes(body.mode as never)) throw new Error('当前生成方式无效');
    const options = body.options as GenerateRequest['options'] | undefined;
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('当前生成参数无效');
    const generationCount = body.generationCount ?? 1;
    if (typeof generationCount !== 'number' || !Number.isInteger(generationCount) || generationCount < 1 || generationCount > 4) throw new Error('生成次数无效');
    const reference = (value: unknown, label: string) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参考素材参数无效');
      const item = value as Record<string, unknown>;
      const file = typeof item.fileId === 'string' ? files.get(item.fileId) : undefined;
      if (item.fileId && !file) throw new Error('参考素材文件不存在');
      return { label, ...(file ? { fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size } : {
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
        ...(typeof item.url === 'string' && !item.url.startsWith('data:') ? { url: item.url } : {}),
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      }) };
    };
    const references: Record<string, unknown> = {};
    if (body.references && typeof body.references === 'object' && !Array.isArray(body.references)) {
      const refs = body.references as Record<string, unknown>;
      for (const [kind, label] of [['images', 'Picture'], ['videos', 'Video'], ['audios', 'Audio']]) {
        if (refs[kind] === undefined) continue;
        if (!Array.isArray(refs[kind]) || refs[kind].length > 20) throw new Error('参考素材数量无效');
        references[kind] = refs[kind].map((value, index) => reference(value, `<${label} ${index + 1}>`));
      }
      if (refs.firstFrame) references.firstFrame = reference(refs.firstFrame, '<Picture 1>');
      if (refs.lastFrame) references.lastFrame = reference(refs.lastFrame, refs.firstFrame ? '<Picture 2>' : '<Picture 1>');
    }
    const style = body.style as Record<string, unknown> | undefined;
    return { prompt: body.prompt.trim(), model, mode: body.mode, options: normalizeOptions(model, options), generationCount,
      ...(style && typeof style.name === 'string' ? { style: { id: style.id, name: style.name, description: style.description } } : {}), references };
  };
  return { defaults, prompts, models, saveModels, context };
}
