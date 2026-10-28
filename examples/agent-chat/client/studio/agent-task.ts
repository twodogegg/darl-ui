import buttons from '../../prompts/studio-agent-buttons.json';
import type { AgentSkill } from '@darl/ui';

type ButtonConfig = { visibleMessage: string; hiddenMessage: string; parameters: string[]; skills: string[]; skillsByProjectMode?: Record<string, string[]> };
export type StudioAgentContext = { modelContext: string; modelSkillIds: string[] };

export function studioAgentPayload(task: Record<string, unknown>, catalog: AgentSkill[]) {
  const action = typeof task.action === 'string' ? task.action : '';
  const config = (buttons as Record<string, ButtonConfig>)[action];
  if (!config || typeof config.visibleMessage !== 'string' || !config.visibleMessage.trim()
    || typeof config.hiddenMessage !== 'string' || !Array.isArray(config.parameters) || !Array.isArray(config.skills)
    || config.parameters.some(key => typeof key !== 'string') || config.skills.some(slug => typeof slug !== 'string')) {
    throw new Error(`Agent 按钮配置无效：${action}`);
  }
  const parameters = Object.fromEntries(config.parameters.filter(key => task[key] !== undefined).map(key => [key, task[key]]));
  const projectMode = typeof task.projectMode === 'string' ? task.projectMode : '';
  const modeSkills = config.skillsByProjectMode?.[projectMode] || [];
  if (!Array.isArray(modeSkills) || modeSkills.some(slug => typeof slug !== 'string')) throw new Error(`Agent 按钮 Skill 配置无效：${action}`);
  const slugs = [...new Set([...config.skills, ...modeSkills])];
  const modelSkillIds = slugs.map(slug => {
    const skill = catalog.find(item => item.slug === slug || item.name === slug);
    if (!skill) throw new Error(`Agent 按钮所需的 Skill 不存在：${slug}`);
    return skill.id;
  });
  return {
    content: config.visibleMessage.trim(),
    context: { modelContext: [config.hiddenMessage.trim(), `<BUTTON_PARAMETERS untrusted="true">${JSON.stringify(parameters)}</BUTTON_PARAMETERS>`].filter(Boolean).join('\n\n'), modelSkillIds },
  };
}
