import { randomUUID } from 'node:crypto';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

type Asset = { key: string; existingId?: string; name: string; type: string; description?: string; appearance?: string; costume?: string; prompt?: string; variants?: Array<{ name: string; description?: string; prompt?: string }>; shotIds: string[] };

export function saveExtractedAssets(studio: StudioStore, project: StudioRecord, episode: StudioRecord, raw: unknown, versions: Record<string, number>, jobId: string) {
  const assets = (raw as { assets?: Asset[] })?.assets;
  if (!Array.isArray(assets) || assets.length > 200) throw new Error('模型返回的资产列表无效');
  const state = studio.snapshot();
  const currentProject = state.projects.find(item => item.id === project.id);
  const currentEpisode = state.episodes.find(item => item.id === episode.id);
  const existing = state.assets.filter(item => item.projectId === project.id);
  const shots = state.shots.filter(item => item.episodeId === episode.id);
  if (!currentProject || currentProject._version !== project._version || !currentEpisode || currentEpisode._version !== episode._version || [...existing.map(a => `assets:${a.id}`), ...shots.map(s => `shots:${s.id}`)].some(key => versions[key] === undefined) || Object.entries(versions).some(([key, version]) => {
    const [resource, id] = key.split(':');
    if (resource === 'assets') return !existing.some(item => item.id === id && item._version === version);
    if (resource === 'shots') return !shots.some(item => item.id === id && item._version === version);
    return false;
  })) throw new StudioConflict('项目、分镜或资产在提取期间发生变化，结果未保存，请重试');
  const changes: StudioChange[] = [], names = new Set(existing.map(a => `${a.type}:${a.name}`)), keys = new Set<string>(), seen = new Set<string>();
  const links = new Map<string, Set<string>>();
  for (const asset of assets) {
    if (!asset || typeof asset.key !== 'string' || !asset.key || keys.has(asset.key) || typeof asset.name !== 'string' || !asset.name.trim() || !['角色','场景','道具'].includes(asset.type) || !Array.isArray(asset.shotIds) || !asset.shotIds.length || asset.shotIds.some(id => !shots.some(shot => shot.id === id)) || (asset.variants !== undefined && !Array.isArray(asset.variants))) throw new Error('模型返回的资产或镜头关联无效');
    keys.add(asset.key);
    const prior = asset.existingId ? existing.find(item => item.id === asset.existingId) : undefined;
    if (asset.existingId && (!prior || prior.type !== asset.type || seen.has(prior.id))) throw new Error(`已有资产 ID 无效或重复：${asset.existingId}`);
    if (!prior && names.has(`${asset.type}:${asset.name.trim()}`)) throw new Error(`资产 ${asset.name} 已存在，请复用其 ID`);
    const id = prior?.id || randomUUID(); seen.add(id); names.add(`${asset.type}:${asset.name.trim()}`);
    const variants = ((prior?.variants || []) as Array<Record<string, unknown>>).map(item => ({ ...item }));
    let variantsChanged = false;
    for (const variant of asset.variants || []) {
      if (!variant || typeof variant.name !== 'string' || !variant.name.trim()) throw new Error(`资产 ${asset.name} 状态无效`);
      const existingVariant = variants.find(item => item.name === variant.name.trim());
      if (!existingVariant) {
        if (typeof variant.prompt !== 'string' || !variant.prompt.trim()) throw new Error(`资产 ${asset.name} 的衍生状态 ${variant.name} 缺少生图提示词`);
        variants.push({ id: randomUUID(), name: variant.name.trim(), description: String(variant.description || ''), prompt: variant.prompt.trim(), image: '', history: [] });
        variantsChanged = true;
      } else if (!(typeof existingVariant.prompt === 'string' && existingVariant.prompt.trim()) && typeof variant.prompt === 'string' && variant.prompt.trim()) {
        existingVariant.prompt = variant.prompt.trim(); variantsChanged = true;
      }
    }
    for (const variant of variants) if (!(typeof variant.prompt === 'string' && variant.prompt.trim())) throw new Error(`资产 ${asset.name} 的衍生状态 ${variant.name} 缺少生图提示词，请重试资产提取`);
    if (prior) {
      const values: Record<string, unknown> = {};
      const episodeIds = (prior.episodeIds || []) as string[];
      if (!episodeIds.includes(episode.id)) values.episodeIds = [...episodeIds, episode.id];
      for (const field of ['description', 'appearance', 'costume', 'prompt'] as const) if (!prior[field] && typeof asset[field] === 'string' && asset[field]!.trim()) values[field] = asset[field];
      if (variantsChanged) values.variants = variants;
      if (Object.keys(values).length) changes.push({ resource: 'assets', id, op: 'update', version: prior._version, values });
    }
    else {
      const shot = shots.find(item => item.id === asset.shotIds[0])!;
      const source = shot.source as Record<string, unknown> | undefined;
      changes.push({ resource: 'assets', id, op: 'create', values: { projectId: project.id, episodeIds: [episode.id], name: asset.name.trim(), type: asset.type, description: String(asset.description || ''), appearance: String(asset.appearance || ''), costume: String(asset.costume || ''), prompt: String(asset.prompt || ''), variants, ...(source?.fileId && Number.isFinite(source.start) && Number.isFinite(source.end) ? { source: { fileId: source.fileId, start: source.start, end: source.end, frames: [], name: asset.name.trim(), description: String(asset.description || ''), confirmed: false } } : {}) } });
    }
    for (const shotId of asset.shotIds) { const ids = links.get(shotId) || new Set<string>(); ids.add(id); links.set(shotId, ids); }
  }
  for (const asset of existing) {
    const relevant = (asset.episodeIds as string[] || []).includes(episode.id) || shots.some(shot => (shot.assetIds as string[] || []).includes(asset.id));
    if (relevant && !seen.has(asset.id) && (asset.variants as Array<{ name: string; prompt?: string }> || []).some(variant => !variant.prompt?.trim())) throw new Error(`资产 ${asset.name} 的衍生状态缺少生图提示词，请重试资产提取`);
  }
  for (const [shotId, ids] of links) { const shot = shots.find(item => item.id === shotId)!; const assetIds = [...new Set([...(shot.assetIds as string[] || []), ...ids])]; if (assetIds.length !== (shot.assetIds as string[] || []).length) changes.push({ resource: 'shots', id: shotId, op: 'update', version: shot._version, values: { assetIds } }); }
  if (changes.length > 500) throw new Error('资产与镜头关联数量超过单次保存限制');
  if (changes.length) studio.apply(`redraw-assets-${jobId}`, changes);
  return { assets: assets.length, created: changes.filter(change => change.resource === 'assets' && change.op === 'create').length, linkedShots: links.size };
}
