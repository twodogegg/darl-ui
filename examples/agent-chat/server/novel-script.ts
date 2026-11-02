import { randomUUID } from 'node:crypto';
import type { StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

export function saveNovelScript(studio: StudioStore, episode: StudioRecord, raw: unknown, jobId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('小说剧本整理结果无效');
  const result = raw as { scenes?: Array<Record<string, unknown>>; openItems?: unknown[] };
  const existing = Array.isArray(episode.scenes) ? episode.scenes as Array<Record<string, unknown>> : [];
  if (String(episode.script || '').trim() || existing.some(scene => String(scene.content || '').trim())) throw new StudioConflict('本集已有剧本，未覆盖现有内容');
  if (!Array.isArray(result.scenes) || !result.scenes.length || result.scenes.length > 200 || !Array.isArray(result.openItems) || result.openItems.some(item => typeof item !== 'string' || item.length > 16000)) throw new Error('小说剧本场次或待确认事项无效');
  const used = new Set<string>();
  const scenes = result.scenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object' || !(scene.sceneId == null || typeof scene.sceneId === 'string') || typeof scene.location !== 'string' || !scene.location.trim() || scene.location.length > 100 || !['内', '外', '内外'].includes(String(scene.setting)) || typeof scene.time !== 'string' || !scene.time.trim() || scene.time.length > 100 || typeof scene.content !== 'string' || !scene.content.trim() || scene.content.length > 100000 || !(scene.suggestedDuration == null || (Number.isInteger(scene.suggestedDuration) && Number(scene.suggestedDuration) > 0 && Number(scene.suggestedDuration) <= 3600))) throw new Error(`第 ${index + 1} 场字段无效`);
    const prior = scene.sceneId == null || scene.sceneId === '' ? undefined : existing.find(item => item.id === scene.sceneId);
    if (existing.length && scene.sceneId && (!prior || used.has(String(scene.sceneId)))) throw new Error(`第 ${index + 1} 场引用了不存在或重复的场次 ID`);
    if (prior) used.add(String(prior.id));
    return { ...(prior || {}), id: prior?.id || randomUUID(), location: prior?.location || scene.location, setting: prior?.setting || scene.setting, time: prior?.time || scene.time, suggestedDuration: scene.suggestedDuration ?? '', content: scene.content };
  });
  if (existing.some(scene => !used.has(String(scene.id)))) throw new Error('整理结果遗漏了已有场次');
  const script = scenes.map((scene, index) => `第${index + 1}场 · ${scene.location} · ${scene.setting} · ${scene.time}\n\n${scene.content}`).join('\n\n');
  studio.apply(`novel-script-${jobId}`, [{ resource: 'episodes', op: 'update', id: episode.id, version: episode._version, values: { scenes, script } }], { source: 'workflow', kind: 'novel-script', jobId });
  return { scenes: scenes.length, openItems: result.openItems };
}
