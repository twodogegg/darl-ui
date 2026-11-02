import type { StudioRecord } from '../studio-schema';
import { StudioConflict, StudioStore } from './studio';

export function saveRedrawScript(studio: StudioStore, episode: StudioRecord, raw: unknown, jobId: string, options: { replace?: boolean; validateOnly?: boolean } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('剧本整理结果无效');
  const result = raw as { scenes?: Array<{ sceneId: string; content: string }>; openItems?: string[] };
  const scenes = episode.scenes as Array<{ id: string; location: string; setting: string; time: string; content: string }>;
  if (!Array.isArray(scenes) || !scenes.length || !Array.isArray(result.scenes) || result.scenes.length !== scenes.length || !Array.isArray(result.openItems) || result.openItems.some(item => typeof item !== 'string' || item.length > 16000)) throw new Error('剧本场次或待确认事项无效');
  if (!options.replace && (String(episode.script || '').trim() || scenes.some(scene => scene.content.trim()))) throw new StudioConflict('本集已有剧本，未覆盖现有内容');
  const shots = studio.snapshot().shots.filter(shot => shot.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0));
  const updated = scenes.map((scene, index) => {
    const output = result.scenes![index];
    if (!output || output.sceneId !== scene.id || typeof output.content !== 'string' || (!output.content.trim() && shots.some(shot => shot.sceneId === scene.id)) || output.content.length > 100000) throw new Error(`第 ${index + 1} 场正文或场次 ID 无效`);
    let position = 0;
    for (const shot of shots.filter(item => item.sceneId === scene.id)) {
      for (const line of (shot.dialogue || []) as Array<{ text: string }>) {
        if (!line.text) continue;
        const found = output.content.indexOf(line.text, position);
        if (found < 0) throw new Error(`第 ${index + 1} 场未按顺序保留已确认对白：${line.text}`);
        position = found + line.text.length;
      }
    }
    return { ...scene, content: output.content };
  });
  const script = updated.map((scene, index) => `第${index + 1}场 · ${scene.location || '地点待填写'} · ${scene.setting} · ${scene.time || '待定'}\n\n${scene.content}`).join('\n\n');
  if (!options.validateOnly) studio.apply(`redraw-script-${jobId}`, [{ resource: 'episodes', op: 'update', id: episode.id, version: episode._version, values: { scenes: updated, script } }], { source: 'workflow', kind: options.replace ? 'revise-script' : 'write-script', jobId });
  return { scenes: updated.length, openItems: result.openItems };
}
