import { randomUUID } from 'node:crypto';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

type ModelClip = { sceneId: string; title: string; globalStart: number; globalEnd: number; duration: number; prompt: string; assetIds: string[]; shotIds: string[] };
export function saveRedrawVideoPrompts(studio: StudioStore, project: StudioRecord, episode: StudioRecord, versions: Record<string, number>, raw: unknown, mode: string, jobId: string, supportedDurations?: number[], modelId?: string) {
  const conflicts = (raw as { conflicts?: unknown })?.conflicts;
  if (conflicts !== undefined && !Array.isArray(conflicts)) throw new Error('模型返回的冲突信息无效');
  if (Array.isArray(conflicts) && conflicts.length) throw new Error(`视频提示词存在待解决的冲突：${conflicts.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('；')}`);
  const clips = (raw as { clips?: ModelClip[] })?.clips;
  if (!Array.isArray(clips) || !clips.length || clips.length > 200) throw new Error('模型返回的视频片段列表无效');
  const state = studio.snapshot();
  const liveProject = state.projects.find(item => item.id === project.id), liveEpisode = state.episodes.find(item => item.id === episode.id);
  const shots = state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0));
  const assets = state.assets.filter(item => item.projectId === project.id);
  if (!liveProject || liveProject._version !== project._version || !liveEpisode || liveEpisode._version !== episode._version || state.clips.some(item => item.episodeId === episode.id) || [...assets.map(a => `assets:${a.id}`), ...shots.map(s => `shots:${s.id}`)].some(key => versions[key] === undefined) || Object.entries(versions).some(([key, version]) => {
    const [resource, id] = key.split(':');
    return resource === 'assets' ? !assets.some(item => item.id === id && item._version === version) : resource === 'shots' ? !shots.some(item => item.id === id && item._version === version) : false;
  })) throw new StudioConflict('项目、分镜、资产或片段在生成期间发生变化，结果未保存，请重新检查');
  const scenes = liveEpisode.scenes as Array<{ id: string; assetId?: string; variantId?: string }>;
  const htmlBreaksAreAsset = assets.some(asset => String(asset.name).toLowerCase() === 'br');
  const cleanPrompt = (prompt: string) => prompt.replace(htmlBreaksAreAsset ? /<br\s+\/?>|<br\/>/gi : /<br\s*\/?>/gi, '\n').trim();
  const visited = new Set<string>(); let lastIndex = -1;
  const plan: Array<{ clipId: string; globalStart: number; globalEnd: number; duration: number; shotIds: string[] }> = [];
  const changes: StudioChange[] = clips.map((clip, index) => {
    const scene = scenes.find(item => item.id === clip?.sceneId);
    if (!scene || typeof clip.title !== 'string' || !clip.title.trim() || typeof clip.prompt !== 'string' || !clip.prompt.trim() || !Number.isInteger(clip.duration) || clip.duration <= 0 || clip.duration > 15 || !Array.isArray(clip.shotIds) || !clip.shotIds.length || new Set(clip.shotIds).size !== clip.shotIds.length || !Array.isArray(clip.assetIds) || clip.assetIds.some(id => !assets.some(asset => asset.id === id))) throw new Error(`第 ${index + 1} 个片段字段或资产无效；片段时长须为 1–15 的整数秒`);
    if (supportedDurations && !supportedDurations.includes(clip.duration)) throw new Error(`第 ${index + 1} 个片段时长不受默认视频模型支持：${clip.duration} 秒`);
    for (const id of clip.shotIds) {
      const at = shots.findIndex(shot => shot.id === id);
      if (at < 0 || shots[at].sceneId !== scene.id || at < lastIndex) throw new Error(`第 ${index + 1} 个片段引用的镜头或顺序无效`);
      lastIndex = at; visited.add(id);
    }
    if (!Number.isFinite(clip.globalStart) || !Number.isFinite(clip.globalEnd) || clip.globalStart < 0 || clip.globalEnd <= clip.globalStart || (index > 0 && Math.abs(clip.globalStart - clips[index - 1].globalEnd) > 0.1)) throw new Error(`第 ${index + 1} 个片段的原视频时间范围无效或不连续`);
    const assetIds = [...new Set([...clip.assetIds, ...(scene.assetId ? [scene.assetId] : [])])];
    const clipId = randomUUID();
    plan.push({ clipId, globalStart: clip.globalStart, globalEnd: clip.globalEnd, duration: clip.duration, shotIds: clip.shotIds });
    return { resource: 'clips', id: clipId, op: 'create', position: index, values: { episodeId: episode.id, sceneId: scene.id, title: clip.title.trim(), duration: clip.duration, prompt: cleanPrompt(clip.prompt), assetIds, shotIds: clip.shotIds, mode, ...(modelId ? { model: modelId } : {}) } };
  });
  if (shots.some(shot => !visited.has(shot.id))) throw new Error('模型生成的片段遗漏了原片镜头，本批未保存');
  const firstSource = shots[0]?.source as { start?: number } | undefined, lastSource = shots.at(-1)?.source as { end?: number } | undefined;
  if ((typeof firstSource?.start === 'number' && Math.abs(clips[0].globalStart - firstSource.start) > 0.1) || (typeof lastSource?.end === 'number' && Math.abs(clips.at(-1)!.globalEnd - lastSource.end) > 0.1)) throw new Error('模型生成的片段未覆盖原片分镜首尾，本批未保存');
  const prompts = clips.map(clip => cleanPrompt(clip.prompt)).join('\n'); let dialogueCursor = 0;
  for (const shot of shots) for (const line of Array.isArray(shot.dialogue) ? shot.dialogue as Array<{ text?: unknown }> : []) {
    const text = typeof line.text === 'string' ? line.text.trim() : '';
    if (!text) continue;
    const found = prompts.indexOf(text, dialogueCursor);
    if (found < 0) throw new Error('模型生成的提示词遗漏或改动了已确认台词，本批未保存');
    dialogueCursor = found + text.length;
  }
  studio.apply(`redraw-video-prompts-${jobId}`, changes);
  return { clips: clips.length, shots: visited.size, plan };
}
