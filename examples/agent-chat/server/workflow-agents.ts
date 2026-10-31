import redrawConfig from '../prompts/video-redraw.json';
import type { LocalStorage } from './storage';

export type WorkflowKind = 'analyze' | 'write-script' | 'extract-assets' | 'storyboard' | 'video-prompts';
export type WorkflowAgent = { kind: WorkflowKind; model: string; formatterModel: string; instructions: string; skillIds: string[]; toolNames: string[] };

const freeInstructions = (prompt: string) => prompt
  .replace(/只输出 JSON 对象，字段如下：[\s\S]*?。时间使用秒/, '时间使用秒')
  .replace(/只输出 JSON 对象，字段如下：[\s\S]*?。不要输出无实际叙事用途的资产。/, '不要输出无实际叙事用途的资产。')
  .replace(/# 返回合同[\s\S]*$/, '');
const defaultInstructions: Record<WorkflowKind, string> = {
  analyze: redrawConfig.storyboardAnalysisPrompt,
  'write-script': redrawConfig.scriptWritingPrompt,
  'extract-assets': redrawConfig.assetExtractionPrompt,
  storyboard: redrawConfig.storyboardPlanningPrompt,
  'video-prompts': redrawConfig.videoPromptWritingPrompt,
};
export function defaultWorkflowAgents(): WorkflowAgent[] {
  return (['analyze', 'write-script', 'extract-assets', 'storyboard', 'video-prompts'] as const).map(kind => ({
    kind,
    model: kind === 'analyze' ? redrawConfig.videoAnalysisModel : kind === 'video-prompts' ? redrawConfig.videoPromptModel : redrawConfig.assetExtractionModel,
    formatterModel: redrawConfig.assetExtractionModel,
    instructions: freeInstructions(defaultInstructions[kind]), skillIds: [], toolNames: [],
  }));
}
export function validateWorkflowAgents(value: unknown): WorkflowAgent[] {
  if (!Array.isArray(value) || value.length !== 5) throw new Error('工作流 Agent 配置必须包含五个阶段');
  const defaults = defaultWorkflowAgents();
  return defaults.map(({ kind }) => {
    const matches = value.filter(item => item && typeof item === 'object' && item.kind === kind);
    if (matches.length !== 1) throw new Error(`工作流 Agent 阶段 ${kind} 配置无效`);
    const item = matches[0];
    for (const key of ['model', 'formatterModel', 'instructions']) if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 100_000) throw new Error(`${kind} 的 ${key} 无效`);
    for (const key of ['skillIds', 'toolNames']) if (!Array.isArray(item[key]) || item[key].length > 50 || item[key].some((entry: unknown) => typeof entry !== 'string' || !entry.trim() || entry.length > 200) || new Set(item[key]).size !== item[key].length) throw new Error(`${kind} 的 ${key} 无效`);
    return { kind, model: item.model.trim(), formatterModel: item.formatterModel.trim(), instructions: item.instructions, skillIds: [...item.skillIds], toolNames: [...item.toolNames] };
  });
}
export function loadWorkflowAgents(storage: LocalStorage) {
  const saved = storage.getConfig<WorkflowAgent[]>('workflowAgents');
  const migrated = Array.isArray(saved) && [3, 4].includes(saved.length) ? [...saved, ...defaultWorkflowAgents().filter(item => ['write-script', 'storyboard'].includes(item.kind) && !saved.some(old => old.kind === item.kind))] : saved;
  return validateWorkflowAgents(migrated || defaultWorkflowAgents());
}
