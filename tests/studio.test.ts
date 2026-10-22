// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { removeEpisode } from '../examples/agent-chat/client/studio/scenes';
import { assetImageRequest } from '../examples/agent-chat/client/studio/art';
import { studioPositions, type StudioChange } from '../examples/agent-chat/studio-schema';

let directory: string, store: StudioStore, projectId: string, files: FileStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'darl-studio-'));
  const storage = new LocalStorage(directory);
  files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projectId = String(projects.create({ name: '批量操作验收', description: null, aspect_ratio: '9:16', style_catalog_id: 4 }).project_id);
  store = new StudioStore(projects);
  store.apply('initial-episode', [{ resource: 'episodes', op: 'create', id: 'episode-1', values: { projectId, scenes: [{ id: 'scene-1', location: '书房', setting: '内', time: '日', content: '门被推开。', suggestedDuration: '' }, { id: 'scene-2', location: '走廊', setting: '外', time: '日', content: '脚步远去。', suggestedDuration: '' }] } }]);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const shots = (count = 40): StudioChange[] => Array.from({ length: count }, (_, index) => ({ resource: 'shots', op: 'create', id: `shot-${index}`, position: index, values: { episodeId: 'episode-1', sceneId: 'scene-1', description: `动作 ${index}`, duration: 3 } }));

describe('shared short drama business service', () => {
  it('starts without invented projects/assets/results and persists real batches with field filtering and pagination', () => {
    expect(store.snapshot().assets).toEqual([]);
    expect(store.snapshot().clips).toEqual([]);
    store.apply('forty-shots', shots());
    const page = store.query({ resource: 'shots', projectId, fields: ['description', 'duration'], limit: 25 }) as { items: Record<string, unknown>[]; total: number; nextCursor: string };
    expect(page.total).toBe(40);
    expect((store.query({ resource: 'shots', sceneId: 'scene-2' }) as { total: number }).total).toBe(0);
    expect((store.query({ resource: 'shots', sceneId: 'scene-1' }) as { total: number }).total).toBe(40);
    expect(page.items).toHaveLength(25);
    expect(page.items[0]).toEqual({ id: 'shot-0', _version: 1, description: '动作 0', duration: 3 });
    expect((store.query({ resource: 'shots', cursor: page.nextCursor, limit: 25 }) as { items: unknown[] }).items).toHaveLength(15);
    expect(new StudioStore(store.projects).snapshot().shots).toHaveLength(40);
  });
  it('keeps bulk list edits small while preserving insert, delete and move order', () => {
    const before = Array.from({ length: 1000 }, (_, index) => ({ id: `item-${index}`, _position: index }));
    const next = [{ id: 'new' }, before[999], ...before.slice(1, 999)];
    const positions = studioPositions(before, next);
    expect([...positions.values()].every((value, index, values) => !index || value > values[index - 1])).toBe(true);
    expect(before.filter(item => positions.has(item.id) && positions.get(item.id) !== item._position)).toHaveLength(1);
    expect(positions.get('new')).toBeLessThan(positions.get('item-999')!);
    expect(positions.has('item-0')).toBe(false);
  });
  it('saves a selected voice with its character atomically and preserves the binding after reload', () => {
    store.apply('character', [{ resource: 'assets', op: 'create', id: 'character-1', values: { projectId, name: '林舟', type: '角色' } }]);
    store.apply('apply-voice', [
      { resource: 'voices', op: 'create', id: 'voice-1', values: { name: '角色音色', url: '', language: 'zh', gender: '男声', favorite: true } },
      { resource: 'assets', op: 'update', id: 'character-1', version: 1, values: { voiceId: 'voice-1' } },
    ]);
    const saved = new StudioStore(store.projects).snapshot();
    expect(saved.assets.find(item => item.id === 'character-1')?.voiceId).toBe('voice-1');
    expect(saved.voices[0]).toMatchObject({ id: 'voice-1', favorite: true });
    expect(() => store.apply('stale-voice', [
      { resource: 'voices', op: 'create', id: 'voice-2', values: { name: '另一音色', url: '' } },
      { resource: 'assets', op: 'update', id: 'character-1', version: 1, values: { voiceId: 'voice-2' } },
    ])).toThrow('已发生变化');
    expect(store.snapshot().voices).toHaveLength(1);
    expect(store.snapshot().assets.find(item => item.id === 'character-1')?.voiceId).toBe('voice-1');
  });
  it('rolls the entire batch back on a stale version, rejects unknown fields, and retries without duplicating records', () => {
    const changes = shots(2);
    const result = store.apply('same-request', changes);
    expect(store.apply('same-request', changes)).toEqual(result);
    expect(store.snapshot().shots).toHaveLength(2);
    expect(() => store.apply('same-request', shots(3))).toThrow('请求编号');
    expect(() => store.apply('conflict', [
      { resource: 'shots', id: 'shot-0', op: 'update', version: 1, values: { duration: 5 } },
      { resource: 'shots', id: 'shot-1', op: 'update', version: 99, values: { duration: 7 } },
    ])).toThrow('已发生变化');
    expect(store.snapshot().shots[0].duration).toBe(3);
    expect(() => store.apply('forbidden', [{ resource: 'shots', id: 'shot-0', op: 'update', version: 1, values: { apiKey: 'invalid' } }])).toThrow('不允许');
  });
  it('persists sort order, derives clip duration, releases deleted shots and protects cross-scene associations', () => {
    store.apply('shots', shots(3));
    store.apply('clip', [{ resource: 'clips', op: 'create', id: 'clip-1', values: { episodeId: 'episode-1', sceneId: 'scene-1', shotIds: ['shot-0', 'shot-1'], duration: 6 } }]);
    store.apply('time', [{ resource: 'shots', op: 'update', id: 'shot-0', version: 1, values: { duration: 7 }, position: 9 }]);
    expect(store.snapshot().clips[0].duration).toBe(10);
    expect(store.snapshot().shots.at(-1)?.id).toBe('shot-0');
    expect(() => store.apply('cross-scene', [{ resource: 'clips', op: 'update', id: 'clip-1', version: 2, values: { sceneId: 'scene-2' } }])).toThrow('本场');
    store.apply('delete-shot', [{ resource: 'shots', op: 'delete', id: 'shot-0', version: 2 }]);
    expect(store.snapshot().clips[0]).toMatchObject({ shotIds: ['shot-1'], duration: 3 });
  });
  it('undoes a batch only while its saved records still match', () => {
    store.apply('shots', shots(2));
    store.apply('edit', [{ resource: 'shots', op: 'update', id: 'shot-0', version: 1, values: { description: '新动作' } }]);
    store.undo('edit', 'undo-edit');
    expect(store.snapshot().shots[0].description).toBe('动作 0');
    expect(() => store.undo('edit', 'undo-twice')).toThrow('已发生变化');
  });
  it('creates projects through the same batch service and restores archived records without reusing old versions', () => {
    const result = store.apply('new-project', [{ resource: 'projects', op: 'create', id: 'new-project', values: { title: '第二个项目', summary: '', ratio: '16:9', style_catalog_id: 4 } }]);
    const id = result.changed.find(item => item.resource === 'projects')!.id;
    expect(id).not.toBe('new-project');
    expect(store.projects.get(Number(id))?.name).toBe('第二个项目');
    const version = store.snapshot().projects.find(item => item.id === id)!._version;
    store.apply('archive-project', [{ resource: 'projects', op: 'delete', id, version }]);
    expect(store.projects.get(Number(id))).toBeNull();
    store.undo('archive-project', 'restore-project');
    expect(store.projects.get(Number(id))?.name).toBe('第二个项目');
    expect(store.snapshot().projects.find(item => item.id === id)!._version).toBeGreaterThan(version);
  });
  it('removes an episode and its owned records atomically while preserving shared assets', () => {
    store.apply('episode-content', [
      ...shots(1),
      { resource: 'episodes', op: 'create', id: 'episode-2', values: { projectId, number: 2 } },
      { resource: 'assets', op: 'create', id: 'shared-asset', values: { projectId, name: '纸船', type: '道具', episodeIds: ['episode-1', 'episode-2'] } },
      { resource: 'clips', op: 'create', id: 'clip-1', values: { episodeId: 'episode-1', sceneId: 'scene-1', shotIds: ['shot-0'], assetIds: ['shared-asset'] } },
      { resource: 'films', op: 'create', id: 'film-1', values: { projectId, episodeId: 'episode-1', title: '成片记录', url: '' } },
    ]);
    const before = store.snapshot(), next = structuredClone(before);
    removeEpisode(next, 'episode-1');
    const changes: StudioChange[] = [];
    for (const resource of ['episodes', 'shots', 'clips', 'films', 'history', 'assets'] as const) {
      for (const item of before[resource]) {
        const after = next[resource].find(candidate => candidate.id === item.id);
        if (!after) changes.push({ resource, id: item.id, op: 'delete', version: item._version });
        else if (JSON.stringify(item) !== JSON.stringify(after)) changes.push({ resource, id: item.id, op: 'update', version: item._version, values: { episodeIds: after.episodeIds } });
      }
    }
    store.apply('delete-episode', changes);
    const result = store.snapshot();
    expect(result.episodes.map(item => item.id)).toEqual(['episode-2']);
    expect(result.shots).toEqual([]);
    expect(result.clips).toEqual([]);
    expect(result.films).toEqual([]);
    expect(result.assets[0].episodeIds).toEqual(['episode-2']);
    store.undo('delete-episode', 'restore-episode');
    expect(store.snapshot().clips[0].assetIds).toEqual(['shared-asset']);
    expect(store.snapshot().assets[0].episodeIds).toEqual(['episode-1', 'episode-2']);
  });
  it('includes appearance and selected costume, while image edits use only the requested source and change', () => {
    const asset = { type: '角色', description: '插画师', appearance: '短发，圆脸', costume: '米色风衣', prompt: '', image: '/api/files/main', variants: [{ id: 'rain', description: '黄色雨衣' }] };
    const request = assetImageRequest(asset, { variantId: 'rain' });
    expect(request.prompt).toContain('短发，圆脸');
    expect(request.prompt).toContain('黄色雨衣');
    expect(request.prompt).not.toContain('米色风衣');
    const edit = assetImageRequest(asset, { editPrompt: '只减淡阴影', image: '/api/files/history' });
    expect(edit.references).toEqual(['/api/files/history']);
    expect(edit.prompt).toContain('只减淡阴影');
    expect(edit.prompt).not.toContain('米色风衣');
    expect(() => assetImageRequest(asset, { view: '自定义' })).toThrow('自定义提示词');
  });
  it('attaches completed outputs exactly once and preserves current selection if a target changed', async () => {
    store.apply('asset', [{ resource: 'assets', op: 'create', id: 'asset-1', values: { projectId, name: '纸船', type: '道具', description: '白纸折叠的小船' } }]);
    const target = store.mediaTarget({ resource: 'assets', id: 'asset-1', version: 1, field: 'image' }, 'image');
    store.apply('edit-asset', [{ resource: 'assets', op: 'update', id: 'asset-1', version: 1, values: { description: '蓝纸折叠的小船' } }]);
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const file = await files.put(png, 'image/png', 'fixture.png');
    const { MediaJobStore } = await import('../examples/agent-chat/server/media-job-store');
    const jobs = new MediaJobStore(join(directory, 'data.sqlite'), files);
    const job = jobs.create({ modelId: 'gpt-image-2', type: 'image', prompt: 'fixture', options: { studioTarget: target }, providerId: 'test', upstreamModelId: 'test', baseUrl: 'http://localhost' });
    job.status = 'completed'; job.resultFileIds = [file.id];
    store.attachMedia(job); store.attachMedia(job);
    const item = store.snapshot().assets[0];
    expect(item.image).toBe('');
    expect(item.history).toEqual([`/api/files/${file.id}`]);
    expect(files.references(file.id)).toBe(true);
  });
});
