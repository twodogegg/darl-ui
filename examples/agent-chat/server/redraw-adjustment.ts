import { randomUUID } from 'node:crypto';
import { studioPositions, type StudioChange, type StudioRecord } from '../studio-schema';

type ProposedShot = { id?: string; sceneId: string; start: number; end: number; duration: number; scale: string; camera: string; description: string; sourceDescription: string; sourceDialogue: string; effects: string; assetIds: string[]; dialogue: Array<Record<string, unknown>> };

/** Build a versioned, atomic replacement; existing IDs retain their media and other fields. */
export function planShotAdjustment(raw: unknown, episode: StudioRecord, source: Record<string, unknown>, existing: StudioRecord[], clips: StudioRecord[]): StudioChange[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('镜头调整结果无效');
  const result = raw as { shots?: ProposedShot[]; notes?: string };
  if (!Array.isArray(result.shots) || !result.shots.length || result.shots.length > 200 || typeof result.notes !== 'string') throw new Error('镜头调整列表无效');
  const scenes = new Set(((episode.scenes || []) as Array<{ id: string }>).map(scene => scene.id));
  const prior = new Map(existing.map(shot => [shot.id, shot]));
  const used = new Set<string>(), changes: StudioChange[] = [], order: string[] = [];
  const segments: Array<{ id: string; start: number; end: number }> = [];
  let previousIndex = -1;
  let end = 0;
  for (const [index, item] of result.shots.entries()) {
    if (!item || !scenes.has(item.sceneId) || !Number.isFinite(item.start) || !Number.isFinite(item.end) || Math.abs(item.start - end) > .05 || item.end <= item.start || item.end > Number(source.duration) + .05 || !Number.isFinite(item.duration) || item.duration < .1 || !Array.isArray(item.assetIds) || !Array.isArray(item.dialogue) || ['scale', 'camera', 'description', 'sourceDescription', 'sourceDialogue', 'effects'].some(key => typeof item[key as keyof ProposedShot] !== 'string')) throw new Error(`第 ${index + 1} 镜字段或时间无效`);
    const old = item.id ? prior.get(item.id) : undefined;
    if (item.id && (!old || used.has(item.id))) throw new Error(`第 ${index + 1} 镜引用了不存在或重复的镜头`);
    if (old) {
      const oldIndex = existing.findIndex(shot => shot.id === old.id);
      if (oldIndex <= previousIndex) throw new Error('已有镜头顺序不能改变');
      previousIndex = oldIndex; used.add(old.id);
    }
    const oldSource = old?.source as Record<string, unknown> | undefined;
    const changedRange = !old || Number(oldSource?.start) !== item.start || Number(oldSource?.end) !== item.end;
    if (old && changedRange && (old.image || (old.imageHistory as unknown[])?.length)) throw new Error(`镜头 ${old.id} 已关联图片，不能直接修改时间`);
    const values = { episodeId: episode.id, sceneId: item.sceneId, duration: item.duration, scale: item.scale, camera: item.camera, description: item.description, effects: item.effects, assetIds: item.assetIds, dialogue: item.dialogue.map(line => ({ ...line, id: line.id || randomUUID() })), source: { ...(oldSource || {}), fileId: source.fileId, start: item.start, end: item.end, frames: changedRange ? [] : (oldSource?.frames || []), ...(changedRange ? { confirmed: false } : {}), description: item.sourceDescription, dialogue: item.sourceDialogue } };
    const id = old?.id || randomUUID(); order.push(id); segments.push({ id, start: item.start, end: item.end });
    changes.push({ resource: 'shots', id, op: old ? 'update' : 'create', ...(old ? { version: old._version } : {}), values });
    end = item.end;
  }
  if (Math.abs(end - Number(source.duration)) > .2) throw new Error('调整后的镜头没有覆盖完整原片');
  for (const shot of existing) if (!used.has(shot.id)) {
    if (shot.image || (shot.imageHistory as unknown[])?.length) throw new Error(`镜头 ${shot.id} 已关联图片，不能删除`);
    changes.push({ resource: 'shots', id: shot.id, op: 'delete', version: shot._version });
  }
  const positions = studioPositions(existing, order.map(id => ({ id })));
  for (const change of changes) if (change.op !== 'delete') change.position = positions.get(change.id);
  const owners = new Map<string, string>();
  for (const clip of clips) {
    const ids = (clip.shotIds || []) as string[];
    if (!ids.length) continue;
    const ranges = ids.map(id => prior.get(id)?.source as { start?: number; end?: number } | undefined);
    if (ranges.some(range => !range || !Number.isFinite(range.start) || !Number.isFinite(range.end))) throw new Error('片段关联的镜头来源不完整，不能自动调整关联');
    const nextIds = segments.filter(segment => ranges.some(range => segment.end > Number(range!.start) + .001 && segment.start < Number(range!.end) - .001)).map(segment => segment.id);
    for (const id of nextIds) {
      if (owners.has(id) && owners.get(id) !== clip.id) throw new Error('新镜头跨越多个视频片段，请先调整片段边界');
      owners.set(id, clip.id);
    }
    if (JSON.stringify(ids) !== JSON.stringify(nextIds)) changes.push({ resource: 'clips', id: clip.id, op: 'update', version: clip._version, values: { shotIds: nextIds } });
  }
  if (changes.length > 500) throw new Error('镜头调整超过单次保存限制');
  return changes;
}
