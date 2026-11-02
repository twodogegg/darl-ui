import { randomUUID } from 'node:crypto';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

export function saveScriptStoryboard(studio: StudioStore, project: StudioRecord, episode: StudioRecord, versions: Record<string, number>, value: unknown, jobId: string, videoModel: { modelId: string; seconds: number[] }, mode = '参考生成') {
  const state = studio.snapshot(), liveEpisode = state.episodes.find(item => item.id === episode.id);
  const assets = state.assets.filter(item => item.projectId === project.id);
  if (state.projects.find(item => item.id === project.id)?._version !== project._version || liveEpisode?._version !== episode._version || state.clips.some(item => item.episodeId === episode.id) || assets.length !== Object.keys(versions).filter(key => key.startsWith('assets:')).length || assets.some(item => versions[`assets:${item.id}`] !== item._version)) throw new StudioConflict('项目、剧本、资产或片段在生成期间发生变化，结果未保存');
  const result = value as { clips?: Array<Record<string, unknown>>; openItems?: unknown[] };
  if (!result || !Array.isArray(result.clips) || !result.clips.length || result.clips.length > 200 || !Array.isArray(result.openItems) || result.openItems.some(item => typeof item !== 'string' || item.length > 16000)) throw new Error('分镜片段或待确认事项无效');
  const scenes = episode.scenes as Array<{ id: string; content?: string }>;
  const covered = new Set<string>();
  const changes: StudioChange[] = result.clips.map((clip, index) => {
    const at = scenes.findIndex(scene => scene.id === clip?.sceneId);
    const label = `第 ${index + 1} 个片段`;
    if (at < 0) throw new Error(`${label}的场次 ID 不存在：${String(clip?.sceneId || '未填写')}`);
    if (typeof clip.title !== 'string' || !clip.title.trim() || clip.title.length > 200) throw new Error(`${label}的名称为空或超过 200 字`);
    if (typeof clip.prompt !== 'string' || !clip.prompt.trim() || clip.prompt.length > 16000) throw new Error(`${label}的视频提示词为空或超过 16000 字`);
    if (mode === '分镜图' && (typeof clip.storyboardPrompt !== 'string' || !clip.storyboardPrompt.trim() || clip.storyboardPrompt.length > 16000)) throw new Error(`${label}的分镜图提示词为空或超过 16000 字`);
    if (typeof clip.duration !== 'number' || !videoModel.seconds.includes(clip.duration)) throw new Error(`${label}的时长 ${String(clip.duration)} 不受模型支持，允许 ${videoModel.seconds.join('、')} 秒`);
    if (!Array.isArray(clip.assetIds)) throw new Error(`${label}的资产关联须为数组`);
    const invalidAsset = clip.assetIds.findIndex(id => typeof id !== 'string' || !assets.some(asset => asset.id === id));
    if (invalidAsset >= 0) throw new Error(`${label}的资产 ID 不存在：${String(clip.assetIds[invalidAsset])}`);
    covered.add(String(clip.sceneId));
    return { resource: 'clips', id: randomUUID(), op: 'create', position: index, values: { episodeId: episode.id, sceneId: clip.sceneId, title: clip.title.trim(), duration: clip.duration, prompt: clip.prompt.trim(), storyboardPrompt: mode === '分镜图' ? (clip.storyboardPrompt as string).trim() : '', assetIds: [...new Set(clip.assetIds as string[])], mode, model: videoModel.modelId } };
  });
  if (scenes.some(scene => String(scene.content || '').trim() && !covered.has(scene.id))) throw new Error('分镜遗漏了有正文的场次，结果未保存');
  studio.apply(`script-storyboard-${jobId}`, changes, { source: 'workflow', kind: 'script-storyboard', jobId });
  return { clips: changes.length, openItems: result.openItems };
}
