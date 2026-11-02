import { randomUUID } from 'node:crypto';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

type Asset = { key: string; existingId?: string; name: string; type: string; description?: string; appearance?: string; costume?: string; voiceDescription?: string; prompt?: string; variants?: Array<{ name: string; description?: string; prompt?: string }>; shotIds: string[] };
export type SkippedLink = { assetId: string; name: string; shotId: string };
/** Formatters often re-wrap long prompts; line breaks and spacing are not content. */
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

export function validateAssetPromptFidelity(raw: string, result: unknown, existing: StudioRecord[]) {
  const assets = (result as { assets?: Asset[] })?.assets;
  if (!Array.isArray(assets)) throw new Error('模型返回的资产列表无效');
  const source = compact(raw);
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') throw new Error('模型返回的资产无效');
    const prior = existing.find(item => item.id === asset.existingId);
    if (typeof asset.prompt === 'string' && asset.prompt.trim() && asset.prompt !== prior?.prompt && !source.includes(compact(asset.prompt))) throw new Error(`资产 ${asset.name} 的生图提示词与原始分析不一致，请保留原文`);
    for (const variant of asset.variants || []) {
      const old = ((prior?.variants || []) as Array<{ name: string; prompt?: string }>).find(item => item.name === variant.name);
      if (typeof variant.prompt === 'string' && variant.prompt.trim() && variant.prompt !== old?.prompt && !source.includes(compact(variant.prompt))) throw new Error(`资产 ${asset.name} 的状态 ${variant.name} 生图提示词与原始分析不一致，请保留原文`);
    }
  }
}

/** New links for existing characters need the name, alias or ID in the shot text; the rest are reported, not written. */
export function unconfirmedCharacterLinks(raw: unknown, assets: StudioRecord[], shots: StudioRecord[]): SkippedLink[] {
  const skipped: SkippedLink[] = [];
  for (const asset of (raw as { assets?: Asset[] })?.assets || []) {
    const existing = assets.find(item => item.id === asset?.existingId && item.type === '角色');
    if (!existing || !Array.isArray(asset.shotIds)) continue;
    const names = [existing.name, existing.alias].filter((name): name is string => typeof name === 'string' && !!name.trim()).map(name => name.toLowerCase());
    for (const shotId of asset.shotIds) {
      const shot = shots.find(item => item.id === shotId);
      if (!shot || (shot.assetIds as string[] || []).includes(existing.id)) continue;
      const evidence = JSON.stringify({ description: shot.description, dialogue: shot.dialogue, source: shot.source }).toLowerCase();
      if (!evidence.includes(existing.id.toLowerCase()) && !names.some(name => evidence.includes(name))) skipped.push({ assetId: existing.id, name: String(existing.name), shotId });
    }
  }
  return skipped;
}

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
  const skippedLinks = unconfirmedCharacterLinks(raw, existing, shots), skipped = new Set(skippedLinks.map(link => `${link.assetId}:${link.shotId}`));
  for (const asset of assets) {
    if (!asset || typeof asset.key !== 'string' || !asset.key || keys.has(asset.key) || typeof asset.name !== 'string' || !asset.name.trim() || !['角色','场景','道具'].includes(asset.type) || (asset.variants !== undefined && !Array.isArray(asset.variants))) throw new Error('模型返回的资产字段无效或标识重复');
    if (!Array.isArray(asset.shotIds) || !asset.shotIds.length) throw new Error(`资产 ${asset.name} 缺少镜头关联 shotIds，请根据原片证据填写本集真实镜头 ID`);
    if (asset.shotIds.some(id => !shots.some(shot => shot.id === id))) throw new Error(`资产 ${asset.name} 引用了不存在的本集镜头，请核对 shotIds`);
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
      } else {
        for (const field of ['description', 'prompt'] as const) if (typeof variant[field] === 'string' && variant[field]!.trim() && variant[field] !== existingVariant[field]) {
          existingVariant[field] = variant[field]; variantsChanged = true;
        }
      }
    }
    for (const variant of variants) if (!(typeof variant.prompt === 'string' && variant.prompt.trim())) throw new Error(`资产 ${asset.name} 的衍生状态 ${variant.name} 缺少生图提示词，请重试资产提取`);
    if (!(typeof asset.prompt === 'string' && asset.prompt.trim()) && !(typeof prior?.prompt === 'string' && prior.prompt.trim())) throw new Error(`资产 ${asset.name} 的主形象缺少生图提示词；请核对原始报告，必要时重新提取`);
    const shotIds = asset.shotIds.filter(shotId => !skipped.has(`${id}:${shotId}`));
    if (prior) {
      const values: Record<string, unknown> = {};
      const episodeIds = (prior.episodeIds || []) as string[];
      if (!episodeIds.includes(episode.id) && shotIds.length) values.episodeIds = [...episodeIds, episode.id];
      for (const field of ['description', 'appearance', 'costume', 'voiceDescription', 'prompt'] as const) {
        const next = asset[field], previous = prior[field];
        if (typeof next !== 'string' || !next.trim() || next === previous) continue;
        if (/^(待确认|不适用)$/.test(next.trim()) && typeof previous === 'string' && previous.trim() && !/^(待确认|不适用)$/.test(previous.trim())) continue;
        values[field] = next;
      }
      if (variantsChanged) values.variants = variants;
      if (Object.keys(values).length) changes.push({ resource: 'assets', id, op: 'update', version: prior._version, values });
    }
    else {
      const shot = shots.find(item => item.id === asset.shotIds[0])!;
      const source = shot.source as Record<string, unknown> | undefined;
      changes.push({ resource: 'assets', id, op: 'create', values: { projectId: project.id, episodeIds: [episode.id], name: asset.name.trim(), type: asset.type, description: String(asset.description || ''), appearance: String(asset.appearance || ''), costume: String(asset.costume || ''), voiceDescription: String(asset.voiceDescription || ''), prompt: String(asset.prompt || ''), variants, ...(source?.fileId && Number.isFinite(source.start) && Number.isFinite(source.end) ? { source: { fileId: source.fileId, start: source.start, end: source.end, frames: [], name: asset.name.trim(), description: String(asset.description || ''), confirmed: false } } : {}) } });
    }
    for (const shotId of shotIds) { const ids = links.get(shotId) || new Set<string>(); ids.add(id); links.set(shotId, ids); }
  }
  for (const asset of existing) {
    const relevant = (asset.episodeIds as string[] || []).includes(episode.id) || shots.some(shot => (shot.assetIds as string[] || []).includes(asset.id));
    if (relevant && !seen.has(asset.id) && (asset.variants as Array<{ name: string; prompt?: string }> || []).some(variant => !variant.prompt?.trim())) throw new Error(`资产 ${asset.name} 的衍生状态缺少生图提示词，请重试资产提取`);
    if (relevant && !seen.has(asset.id) && !(typeof asset.prompt === 'string' && asset.prompt.trim())) throw new Error(`资产 ${asset.name} 的主形象缺少生图提示词；请核对原始报告，必要时重新提取`);
  }
  for (const [shotId, ids] of links) { const shot = shots.find(item => item.id === shotId)!; const assetIds = [...new Set([...(shot.assetIds as string[] || []), ...ids])]; if (assetIds.length !== (shot.assetIds as string[] || []).length) changes.push({ resource: 'shots', id: shotId, op: 'update', version: shot._version, values: { assetIds } }); }
  if (changes.length > 500) throw new Error('资产与镜头关联数量超过单次保存限制');
  if (changes.length) studio.apply(`redraw-assets-${jobId}`, changes, { source: 'workflow', kind: 'extract-assets', jobId });
  return { assets: assets.length, created: changes.filter(change => change.resource === 'assets' && change.op === 'create').length, linkedShots: links.size, ...(skippedLinks.length ? { skippedLinks } : {}) };
}
