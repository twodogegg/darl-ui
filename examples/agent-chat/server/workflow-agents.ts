import redrawConfig from '../prompts/video-redraw.json';
import type { LocalStorage } from './storage';

export type WorkflowKind = 'analyze' | 'extract-assets' | 'video-prompts';
export type WorkflowAgent = { kind: WorkflowKind; model: string; formatterModel: string; instructions: string; skillIds: string[]; toolNames: string[] };

// The format contract remains the authority for the second, structured pass.
const freeInstructions = (prompt: string) => prompt
  .replace(/只输出 JSON 对象，字段如下：[\s\S]*?。时间使用秒/, '时间使用秒')
  .replace(/只输出 JSON 对象，字段如下：[\s\S]*?。不要输出无实际叙事用途的资产。/, '不要输出无实际叙事用途的资产。')
  .replace(/# 返回合同[\s\S]*$/, '');
export const workflowContracts: Record<WorkflowKind, string> = {
  analyze: redrawConfig.storyboardAnalysisPrompt,
  'extract-assets': redrawConfig.assetExtractionPrompt,
  'video-prompts': redrawConfig.videoPromptWritingPrompt,
};
export function defaultWorkflowAgents(): WorkflowAgent[] {
  return (['analyze', 'extract-assets', 'video-prompts'] as const).map(kind => ({
    kind,
    model: kind === 'analyze' ? redrawConfig.videoAnalysisModel : kind === 'extract-assets' ? redrawConfig.assetExtractionModel : redrawConfig.videoPromptModel,
    formatterModel: redrawConfig.assetExtractionModel,
    instructions: freeInstructions(workflowContracts[kind]), skillIds: [], toolNames: [],
  }));
}
export function validateWorkflowAgents(value: unknown): WorkflowAgent[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('工作流 Agent 配置必须包含三个阶段');
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
export function loadWorkflowAgents(storage: LocalStorage) { return validateWorkflowAgents(storage.getConfig('workflowAgents') || defaultWorkflowAgents()); }
