import { randomUUID } from 'node:crypto';
import type { StudioRecord, StudioChange } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

type ModelAsset = { name: string; type: string; description?: string; appearance?: string; costume?: string; variants?: Array<{ name: string; description?: string }> };
type ModelLine = { speaker?: string; type: string; text: string; sourceText?: string; description?: string };
type ModelShot = { sceneKey: string; start: number; end: number; scale: string; description: string; originalDescription?: string; dialogue: ModelLine[]; effects: string; assets: string[] };

export function saveRedrawStoryboard(studio: StudioStore, project: StudioRecord, episode: StudioRecord, source: Record<string, unknown>, raw: unknown, jobId: string) {
  if (!raw || typeof raw !== 'object') throw new Error('视频模型没有返回结构化分镜');
  const value = raw as { assets?: ModelAsset[]; scenes?: Array<{ key: string; location: string; setting: string; time: string; asset?: string; variant?: string }>; shots?: ModelShot[] };
  if (!Array.isArray(value.assets) || !Array.isArray(value.shots) || !value.shots.length || value.shots.length > 200 || value.assets.length > 200) throw new Error('分镜或资产列表无效');
  const snapshot = studio.snapshot(), liveProject = snapshot.projects.find(item => item.id === project.id), liveEpisode = snapshot.episodes.find(item => item.id === episode.id);
  if (!liveProject || !liveEpisode) throw new StudioConflict('项目或剧集已删除');
  if (snapshot.shots.some(item => item.episodeId === episode.id)) throw new StudioConflict('本集已有分镜，保留现有内容；请先检查后再调整');
  const liveSource = (liveEpisode.sourceVideo || (snapshot.episodes.find(item => item.projectId === project.id)?.id === episode.id ? liveProject.sourceVideo : undefined)) as Record<string, unknown> | undefined;
  if (!liveSource || liveSource.fileId !== source.fileId || !Number.isFinite(liveSource.duration)) throw new StudioConflict('原片已变更或缺少时长');
  const names = new Map<string, { id: string; type: string; variants: Set<string> }>(), changes: StudioChange[] = [];
  for (const asset of value.assets) {
    if (!asset || typeof asset.name !== 'string' || !asset.name.trim() || /[<>|\n]/.test(asset.name) || !['角色','场景','道具'].includes(asset.type)) throw new Error('模型返回的资产名称或类型无效');
    const name = asset.name.trim();
    if (names.has(name)) throw new Error(`模型返回的资产名称重复：${name}`);
    const existing = snapshot.assets.filter(item => item.projectId === project.id && item.name === name);
    if (existing.length > 1 || (existing.length && existing[0].type !== asset.type)) throw new Error(`已有资产 ${name} 类型不符或名称有歧义`);
    const id = existing[0]?.id || randomUUID();
    if (asset.variants !== undefined && !Array.isArray(asset.variants)) throw new Error(`资产 ${name} 的衍生状态无效`);
    const priorVariants = (existing[0]?.variants || []) as Array<{ id: string; name: string; [key: string]: unknown }>;
    const variants = [...priorVariants], variantNames = new Set(priorVariants.map(item => item.name));
    for (const variant of asset.variants || []) {
      if (!variant || typeof variant.name !== 'string' || !variant.name.trim() || /[<>|\n]/.test(variant.name)) throw new Error(`资产 ${name} 的衍生状态名称无效`);
      const variantName = variant.name.trim();
      if (!variantNames.has(variantName)) { variants.push({ id: randomUUID(), name: variantName, description: typeof variant.description === 'string' ? variant.description : '', prompt: '', image: '', history: [] }); variantNames.add(variantName); }
    }
    names.set(name, { id, type: asset.type, variants: variantNames });
    if (!existing.length) changes.push({ resource: 'assets', id, op: 'create', values: { projectId: project.id, episodeIds: [episode.id], name, type: asset.type, description: typeof asset.description === 'string' ? asset.description : '', appearance: typeof asset.appearance === 'string' ? asset.appearance : '', costume: typeof asset.costume === 'string' ? asset.costume : '', variants, source: { fileId: source.fileId, start: 0, end: Number(liveSource.duration), frames: [], name, description: typeof asset.description === 'string' ? asset.description : '', confirmed: false } } });
    else if (variants.length !== priorVariants.length) changes.push({ resource: 'assets', id, op: 'update', version: existing[0]._version, values: { variants } });
  }
  if (!Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 200) throw new Error('模型未返回有效场次');
  const scenes = structuredClone(liveEpisode.scenes) as Array<Record<string, unknown>>;
  const sceneIds = new Map<string, string>();
  for (const scene of value.scenes) {
    if (!scene || typeof scene.key !== 'string' || !scene.key.trim() || sceneIds.has(scene.key) || typeof scene.location !== 'string' || !scene.location.trim() || !['内', '外', '内外'].includes(scene.setting) || typeof scene.time !== 'string') throw new Error('模型返回的场次字段无效');
    const asset = scene.asset ? names.get(scene.asset) : undefined;
    if (scene.asset && (!asset || asset.type !== '场景')) throw new Error(`场次 ${scene.location} 的场景资产不存在`);
    if (scene.variant && (!asset || !asset.variants.has(scene.variant))) throw new Error(`场次 ${scene.location} 的场景状态不存在`);
    const id = randomUUID(); sceneIds.set(scene.key, id);
    const definition = value.assets.find(item => item.name === scene.asset);
    const variantId = scene.variant && definition ? (changes.find(change => change.resource === 'assets' && change.id === asset?.id)?.values?.variants as Array<{ id: string; name: string }> | undefined || (snapshot.assets.find(item => item.id === asset?.id)?.variants as Array<{ id: string; name: string }> | undefined))?.find(item => item.name === scene.variant)?.id : undefined;
    scenes.push({ id, location: scene.location, setting: scene.setting, time: scene.time, content: '', suggestedDuration: '', ...(asset ? { assetId: asset.id } : {}), ...(variantId ? { variantId } : {}) });
  }
  changes.push({ resource: 'episodes', id: episode.id, op: 'update', version: liveEpisode._version, values: { scenes } });
  const visitedScenes = new Set<string>(); let currentScene = '';
  let previousEnd = 0;
  for (const [index, shot] of value.shots.entries()) {
    if (!shot || !Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.start < 0 || shot.end <= shot.start || shot.end > Number(liveSource.duration) + .05 || (index > 0 && Math.abs(shot.start - previousEnd) > .05) || !Array.isArray(shot.assets) || !Array.isArray(shot.dialogue) || typeof shot.description !== 'string') throw new Error(`模型返回的第 ${index + 1} 镜时间或字段无效`);
    const sceneId = sceneIds.get(shot.sceneKey);
    if (!sceneId) throw new Error(`第 ${index + 1} 镜场次不存在`);
    if (currentScene !== sceneId) { if (visitedScenes.has(sceneId)) throw new Error(`第 ${index + 1} 镜场次不连续`); visitedScenes.add(sceneId); currentScene = sceneId; }
    const start = Math.max(previousEnd, shot.start), end = Math.min(shot.end, Number(liveSource.duration));
    if (end <= start) throw new Error(`第 ${index + 1} 镜时间无效`);
    previousEnd = end;
    const selected = shot.assets.map(reference => { const [name, variant, ...extra] = String(reference).split('|'); const found = names.get(name); if (!found || extra.length || (variant && !found.variants.has(variant))) throw new Error(`第 ${index + 1} 镜引用了不存在的资产或状态 ${reference}`); return found.id; });
    let description = shot.description;
    for (const reference of shot.assets) { const [name, variant] = String(reference).split('|'); if (variant) { description = description.replaceAll(`<${name}>`, `<${name}|${variant}>`).replaceAll(`@${name}|${variant}`, `<${name}|${variant}>`); } }
    const orderedNames = [...names.keys()].sort((a,b) => b.length - a.length);
    for (const name of orderedNames) description = description.replaceAll(`@${name}`, `<${name}>`);
    if (orderedNames.length) {
      const pattern = new RegExp(orderedNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
      description = description.split(/(<[^<>]+>)/g).map(part => part.startsWith('<') && part.endsWith('>') ? part : part.replace(pattern, name => `<${name}>`)).join('');
    }
    for (const match of description.matchAll(/<([^<>|]+)(?:\|([^<>]+))?>/g)) { const asset = names.get(match[1]); if (!asset || (match[2] && !asset.variants.has(match[2]))) throw new Error(`第 ${index + 1} 镜画面标签引用了不存在的资产或状态 ${match[0]}`); selected.push(asset.id); }
    const lines = shot.dialogue.map(line => {
      if (!line || !['角色','旁白'].includes(line.type) || typeof line.text !== 'string') throw new Error(`第 ${index + 1} 镜对白无效`);
      const speaker = line.type === '角色' ? names.get(String(line.speaker || '')) : undefined;
      if (line.type === '角色' && speaker?.type !== '角色') throw new Error(`第 ${index + 1} 镜对白角色无法关联`);
      return { id: randomUUID(), type: line.type, ...(speaker ? { assetId: speaker.id, speaker: line.speaker } : {}), text: line.text, description: typeof line.description === 'string' ? line.description : '' };
    });
    const sourceDialogue = shot.dialogue.map(line => line.sourceText || '').filter(Boolean).join('\n');
    changes.push({ resource: 'shots', id: randomUUID(), op: 'create', position: index, values: { episodeId: episode.id, sceneId, duration: end - start, scale: String(shot.scale || ''), description, dialogue: lines, effects: String(shot.effects || ''), assetIds: [...new Set(selected)], source: { fileId: source.fileId, start, end, frames: [], description: String(shot.originalDescription || ''), dialogue: sourceDialogue, confirmed: false } } });
  }
  if (Number(value.shots[0].start) > .2 || Number(liveSource.duration) - previousEnd > .2) throw new Error('模型分镜没有覆盖完整原视频，请重新分析');
  if (changes.length > 500) throw new Error('分镜与资产数量超过单次保存限制');
  studio.apply(`redraw-storyboard-${jobId}`, changes);
  return { shots: value.shots.length, assets: value.assets.length };
}
