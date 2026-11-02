import { randomUUID } from 'node:crypto';
import type { StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';
import { validateAssetPromptFidelity } from './redraw-asset-extraction';

export function saveScriptAssets(studio: StudioStore, project: StudioRecord, versions: Record<string, number>, raw: string, value: unknown, jobId: string) {
  const state = studio.snapshot(), episodes = state.episodes.filter(item => item.projectId === project.id);
  if (state.projects.find(item => item.id === project.id)?._version !== project._version || state.assets.some(item => item.projectId === project.id) || episodes.length !== Object.keys(versions).filter(key => key.startsWith('episodes:')).length || episodes.some(item => versions[`episodes:${item.id}`] !== item._version)) throw new StudioConflict('项目、剧集或资产在提取期间发生变化，结果未保存，请核对后重试');
  const result = value as { assets?: Array<Record<string, unknown>>; openItems?: unknown[] };
  if (!result || !Array.isArray(result.assets) || !result.assets.length || result.assets.length > 200 || !Array.isArray(result.openItems) || result.openItems.some(item => typeof item !== 'string' || item.length > 16000)) throw new Error('资产清单或待确认事项无效');
  validateAssetPromptFidelity(raw, value, []);
  const names = new Set<string>();
  const changes = result.assets.map(asset => {
    if (!asset || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 200 || !['角色', '场景', '道具'].includes(String(asset.type)) || typeof asset.prompt !== 'string' || !asset.prompt.trim() || !Array.isArray(asset.episodeIds) || asset.episodeIds.some(id => typeof id !== 'string' || !episodes.some(episode => episode.id === id)) || !Array.isArray(asset.variants)) throw new Error('资产名称、类型、提示词或剧集关联无效');
    const key = `${asset.type}:${asset.name.trim()}`;
    if (names.has(key)) throw new Error(`资产 ${asset.name} 重复，请合并同一主体`);
    names.add(key);
    for (const field of ['description', 'appearance', 'costume', 'voiceDescription']) if (asset[field] !== undefined && (typeof asset[field] !== 'string' || (asset[field] as string).length > 16000)) throw new Error(`资产 ${asset.name} 的 ${field} 无效`);
    const variantNames = new Set<string>();
    const variants = (asset.variants as Array<Record<string, unknown>>).map(variant => {
      if (!variant || typeof variant.name !== 'string' || !variant.name.trim() || variantNames.has(variant.name.trim()) || typeof variant.prompt !== 'string' || !variant.prompt.trim() || (variant.description !== undefined && typeof variant.description !== 'string')) throw new Error(`资产 ${asset.name} 的衍生状态无效`);
      variantNames.add(variant.name.trim());
      return { id: randomUUID(), name: variant.name.trim(), description: variant.description || '', prompt: variant.prompt, image: '', history: [] };
    });
    return { resource: 'assets' as const, id: randomUUID(), op: 'create' as const, values: { projectId: project.id, name: asset.name.trim(), type: asset.type, episodeIds: [...new Set(asset.episodeIds as string[])], description: asset.description || '', appearance: asset.appearance || '', costume: asset.costume || '', voiceDescription: asset.voiceDescription || '', prompt: asset.prompt, variants } };
  });
  studio.apply(`script-assets-${jobId}`, changes, { source: 'workflow', kind: 'script-assets', jobId });
  return { assets: changes.length, created: changes.length, openItems: result.openItems };
}
