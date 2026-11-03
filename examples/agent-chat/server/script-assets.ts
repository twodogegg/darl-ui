import { randomUUID } from 'node:crypto';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';
import { validateAssetPromptFidelity } from './redraw-asset-extraction';

export function saveScriptAssets(studio: StudioStore, project: StudioRecord, versions: Record<string, number>, raw: string, value: unknown, jobId: string, requirements = '') {
  const state = studio.snapshot(), episodes = state.episodes.filter(item => item.projectId === project.id), existing = state.assets.filter(item => item.projectId === project.id);
  const matchesVersions = (resource: string, records: StudioRecord[]) => records.length === Object.keys(versions).filter(key => key.startsWith(`${resource}:`)).length && records.every(item => versions[`${resource}:${item.id}`] === item._version);
  if (state.projects.find(item => item.id === project.id)?._version !== project._version || !matchesVersions('episodes', episodes) || !matchesVersions('assets', existing)) throw new StudioConflict('项目、剧集或资产在提取期间发生变化，结果未保存，请核对后重试');
  const result = value as { assets?: Array<Record<string, unknown>>; openItems?: unknown[]; removedAssetIds?: unknown[]; styleCatalogId?: unknown };
  if (!result || !Array.isArray(result.assets) || !result.assets.length || result.assets.length > 200 || !Array.isArray(result.openItems) || result.openItems.some(item => typeof item !== 'string' || item.length > 16000)) throw new Error('资产清单或待确认事项无效');
  if (existing.length && !Array.isArray(result.removedAssetIds)) throw new Error('请列出按用户要求删除的已有资产 ID；没有时填空数组');
  const removed = result.removedAssetIds || [];
  if (!Array.isArray(removed) || removed.some(id => typeof id !== 'string' || !existing.some(item => item.id === id)) || new Set(removed).size !== removed.length || (removed.length && !requirements.trim())) throw new Error('待删除资产 ID 无效、重复或缺少用户修改要求');
  validateAssetPromptFidelity(raw, value, existing);
  const changes: StudioChange[] = [], seen = new Set<string>();
  if (project.style_catalog_id == null) {
    if (!Number.isSafeInteger(result.styleCatalogId) || !studio.projects.hasStyle(result.styleCatalogId as number)) throw new Error('项目未指定视觉风格，请从 availableStyles 中选择真实风格 ID 并填写 styleCatalogId');
    changes.push({ resource: 'projects', id: project.id, op: 'update', version: project._version, values: { style_catalog_id: result.styleCatalogId } });
  }
  const names = new Set(existing.map(item => `${item.type}:${String(item.name).trim()}`));
  for (const asset of result.assets) {
    if (!asset || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 200 || !['角色', '场景', '道具'].includes(String(asset.type)) || (asset.existingId !== undefined && typeof asset.existingId !== 'string') || !Array.isArray(asset.episodeIds) || asset.episodeIds.some(id => typeof id !== 'string' || !episodes.some(episode => episode.id === id)) || !Array.isArray(asset.variants)) throw new Error('资产名称、类型或剧集关联无效');
    const prior = asset.existingId ? existing.find(item => item.id === asset.existingId) : undefined;
    if (asset.visualMode !== undefined && !['visual', 'voice-only'].includes(String(asset.visualMode))) throw new Error(`资产 ${asset.name} 的形象需求无效`);
    const visualMode = asset.type === '角色' ? asset.visualMode || prior?.visualMode || 'visual' : 'visual';
    if (asset.existingId && (!prior || prior.type !== asset.type || seen.has(prior.id) || removed.includes(asset.existingId))) throw new Error(`已有资产 ID 无效或重复：${asset.existingId}`);
    const name = asset.name.trim(), key = `${asset.type}:${name}`, oldKey = prior && `${prior.type}:${String(prior.name).trim()}`;
    if (key !== oldKey && names.has(key)) throw new Error(`资产 ${name} 已存在，请复用其 ID`);
    if (oldKey) names.delete(oldKey);
    names.add(key);
    if (prior) seen.add(prior.id);
    for (const field of ['description', 'appearance', 'costume', 'voiceDescription', 'prompt']) if (asset[field] !== undefined && (typeof asset[field] !== 'string' || (asset[field] as string).length > 16000)) throw new Error(`资产 ${name} 的 ${field} 无效`);
    if (visualMode !== 'voice-only' && !(typeof asset.prompt === 'string' && asset.prompt.trim()) && !(typeof prior?.prompt === 'string' && prior.prompt.trim())) throw new Error(`资产 ${name} 缺少生图提示词`);
    const variants = ((prior?.variants || []) as Array<Record<string, unknown>>).map(item => ({ ...item })), variantNames = new Set<string>();
    for (const variant of asset.variants as Array<Record<string, unknown>>) {
      if (!variant || typeof variant.name !== 'string' || !variant.name.trim() || variantNames.has(variant.name.trim()) || (variant.prompt !== undefined && typeof variant.prompt !== 'string') || (variant.description !== undefined && typeof variant.description !== 'string')) throw new Error(`资产 ${name} 的衍生状态无效`);
      const variantName = variant.name.trim(), old = variants.find(item => item.name === variantName);
      variantNames.add(variantName);
      if (old) {
        for (const field of ['description', 'prompt']) if (typeof variant[field] === 'string' && variant[field].trim()) old[field] = variant[field];
      } else {
        if (typeof variant.prompt !== 'string' || !variant.prompt.trim()) throw new Error(`资产 ${name} 的衍生状态 ${variantName} 缺少生图提示词`);
        variants.push({ id: randomUUID(), name: variantName, description: variant.description || '', prompt: variant.prompt, image: '', history: [] });
      }
    }
    if (prior) {
      const values: Record<string, unknown> = { name, episodeIds: [...new Set([...(prior.episodeIds as string[] || []), ...asset.episodeIds as string[]])], variants };
      if (asset.visualMode) values.visualMode = visualMode;
      for (const field of ['description', 'appearance', 'costume', 'voiceDescription', 'prompt']) if (typeof asset[field] === 'string' && asset[field].trim()) values[field] = asset[field];
      changes.push({ resource: 'assets', id: prior.id, op: 'update', version: prior._version, values });
    } else {
      changes.push({ resource: 'assets', id: randomUUID(), op: 'create', values: { projectId: project.id, name, type: asset.type, episodeIds: [...new Set(asset.episodeIds as string[])], description: asset.description || '', appearance: asset.appearance || '', costume: asset.costume || '', voiceDescription: asset.voiceDescription || '', visualMode, prompt: asset.prompt || '', variants } });
    }
  }
  if (removed.length) {
    const episodeIds = new Set(episodes.map(item => item.id));
    const shots = state.shots.filter(item => episodeIds.has(String(item.episodeId)));
    const clips = state.clips.filter(item => episodeIds.has(String(item.episodeId)));
    if (!matchesVersions('shots', shots) || !matchesVersions('clips', clips)) throw new StudioConflict('分镜或视频片段在提取期间发生变化，结果未保存，请核对后重试');
    if (shots.some(shot => ((shot.dialogue || []) as Array<{ assetId?: string }>).some(line => removed.includes(line.assetId))) || episodes.some(episode => ((episode.scenes || []) as Array<{ assetId?: string }>).some(scene => removed.includes(scene.assetId))) || existing.some(asset => !removed.includes(asset.id) && ((asset.dependencies || []) as Array<{ assetId?: string }>).some(dependency => removed.includes(dependency.assetId)))) throw new Error('待移除的资产仍被对白、场次或其他资产引用，请先解除关联');
    for (const [resource, records] of [['shots', shots], ['clips', clips]] as const) for (const record of records) {
      const assetIds = (record.assetIds || []) as string[];
      const kept = assetIds.filter(id => !removed.includes(id));
      if (kept.length !== assetIds.length) changes.push({ resource, id: record.id, op: 'update', version: record._version, values: { assetIds: kept } });
    }
  }
  for (const id of removed) {
    const asset = existing.find(item => item.id === id)!;
    changes.push({ resource: 'assets', id: asset.id, op: 'delete', version: asset._version });
  }
  studio.apply(`script-assets-${jobId}`, changes, { source: 'workflow', kind: 'script-assets', jobId });
  return { assets: result.assets.length, created: changes.filter(change => change.op === 'create').length, removed: removed.length, openItems: result.openItems };
}
