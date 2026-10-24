// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore, STUDIO_TOOLS } from '../examples/agent-chat/server/studio';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { removeEpisode } from '../examples/agent-chat/client/studio/scenes';
import { assetImageRequest, canBatchGenerate } from '../examples/agent-chat/client/studio/art';
import { MediaJobStore } from '../examples/agent-chat/server/media-job-store';
import { clipMediaReferences, videoDuration } from '../examples/agent-chat/client/studio/storyboard';
import { defaultModelConfiguration, toMediaModels } from '../src/components/settings/model-config';
import { studioPositions, type StudioChange } from '../examples/agent-chat/studio-schema';
import { studioAgentContent } from '../examples/agent-chat/client/studio/agent-task';

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
  it('drops obsolete batch snapshots without losing records or safe retries', () => {
    const changes = shots(1);
    const saved = store.apply('persistent-request', changes);
    const db = store.projects.db;
    db.exec("ALTER TABLE studio_batches ADD COLUMN inverse TEXT NOT NULL DEFAULT '[]'; ALTER TABLE studio_batches ADD COLUMN entry_source TEXT NOT NULL DEFAULT 'ui'");
    const reopened = new StudioStore(store.projects);
    const columns = db.prepare('PRAGMA table_info(studio_batches)').all().map(item => item.name);
    expect(columns).not.toContain('inverse');
    expect(columns).not.toContain('entry_source');
    expect(reopened.snapshot().shots).toHaveLength(1);
    expect(reopened.apply('persistent-request', changes)).toEqual(saved);
    expect(reopened.snapshot().shots).toHaveLength(1);
  });
  it('keeps screenplay dialogue in the visible scene body and rejects unsupported scene fields', () => {
    const schema = new AjvJsonSchemaValidator().getValidator(STUDIO_TOOLS[1].parameters);
    const content = 'Chloe 嘴唇微动。\n\n**May（平静）**\nWe are not biological siblings.\n\nChloe 抱紧画册。';
    const scene = { id: 'scene-1', location: '草坪', setting: '外', time: '日', content, suggestedDuration: 52 };
    const change: StudioChange = { resource: 'episodes', op: 'update', id: 'episode-1', version: 1, values: { scenes: [scene], script: content } };
    expect(schema({ requestId: 'script-body', changes: [change] }).valid).toBe(true);
    const invalid = { ...change, values: { scenes: [{ ...scene, dialogue: [{ speaker: 'May', text: '不可见的台词' }] }] } };
    expect(schema({ requestId: 'hidden-dialogue', changes: [invalid] }).valid).toBe(false);
    expect(() => store.apply('hidden-dialogue', [invalid])).toThrow('episodes.scenes[0].dialogue 不受支持');
    expect(store.snapshot().episodes[0]._version).toBe(1);
    store.apply('script-body', [change]);
    expect(new StudioStore(store.projects).snapshot().episodes[0]).toMatchObject({ script: content, scenes: [{ content }] });
    expect(store.query({ resource: 'episodes', describe: true })).toMatchObject({ valuesSchema: { properties: { scenes: { items: { properties: { content: { description: expect.stringContaining('不可把对白从正文拆走') } } } } } } });
  });
  it('keeps adaptation settings and outline prop rows in the shared studio schema', () => {
    expect(store.snapshot().projects[0]).toMatchObject({ adaptation: '抽核', outline: { props: [] } });
    expect(store.query({ resource: 'projects', describe: true })).toMatchObject({
      fields: expect.arrayContaining(['adaptation']),
      defaults: { adaptation: '抽核', outline: { props: [] } },
      valuesSchema: { properties: { adaptation: { enum: ['忠实', '抽核', '借壳'] } } },
      structures: { outline: expect.arrayContaining(['props:[{id,name,purpose,involvement}]']) },
    });
    store.apply('outline-prop', [{ resource: 'projects', id: projectId, op: 'update', version: 1, values: {
      adaptation: '忠实',
      outline: { core: '', story: '', keep: '', remove: '', merge: '', risks: '', episodes: '', roles: [], scenes: [], props: [{ id: 'P01', name: '旧皮夹', purpose: '触发重逢并承载暗号', involvement: 'Chloe / Ethan' }] },
    } }]);
    expect(store.snapshot().projects[0]).toMatchObject({ adaptation: '忠实', outline: { props: [{ id: 'P01', name: '旧皮夹' }] } });
  });
  it('keeps agent tasks human-readable and lets tools read project context', () => {
    expect(studioAgentContent({ action: 'outline', projectId: '6', modelPreferences: { text: 'model' }, prompt: '生成项目大纲' })).toBe('生成项目大纲');
    expect(studioAgentContent({ action: 'rewrite-script', projectId: '6', notes: '加强冲突', prompt: '改写剧本' })).toBe('改写剧本\n\n补充要求：加强冲突');
    expect(studioAgentContent({ action: 'voice', projectId: '6', assetId: 'character', assetName: '萧炎', description: '少年音', prompt: '配置音色' })).toBe('配置音色\n\n描述：少年音\n目标资产：萧炎');
  });
  it('refreshes default prompt text without overwriting a custom prompt', () => {
    store.apply('custom-prompt', [{ resource: 'prompts', op: 'update', id: '0-0', version: 1, values: { mode: 'replace', text: '我的大纲提示词' } }]);
    const restored = new StudioStore(store.projects).snapshot().prompts.find(item => item.id === '0-0');
    expect(restored).toMatchObject({ mode: 'replace', text: '我的大纲提示词' });
    expect(restored?.defaultText).toContain('网站上下文');
  });
  it('rounds shot duration up to supported whole seconds without shortening an overlong clip', () => {
    const model = toMediaModels(defaultModelConfiguration()).find(model => model.type === 'video');
    expect(videoDuration(11.1, model)).toBe(12);
    expect(videoDuration(14.8, model)).toBe(15);
    expect(videoDuration(11, model)).toBe(11);
    expect(videoDuration(2.5, model)).toBe(4);
    expect(() => videoDuration(15.1, model)).toThrow('上限 15 秒');
    expect(() => videoDuration(0, model)).toThrow('有效时长');
  });
  it('normalizes URL references, excludes missing pictures and removes copies of linked assets', () => {
    const data = { assets: [{ id: 'character', name: '角色', image: '/api/files/main' }, { id: 'scene', name: '场景', image: '' }] };
    const clip = { id: 'clip', assetIds: ['character', 'scene'], references: ['/api/files/main', '/api/files/main?width=320', '', { id: 'missing', kind: 'image', name: '未生成', url: '' }, { id: 'extra', kind: 'image', url: '/api/files/extra' }] };
    const refs = clipMediaReferences(clip, data);
    expect(refs.images.map(ref => ref.url)).toEqual(['/api/files/main', '/api/files/extra']);
    expect(refs.additional).toEqual([{ id: 'extra', kind: 'image', url: '/api/files/extra', name: '图片 5' }]);
    expect(refs.frames).toEqual([]);
    expect(refs.assets).toHaveLength(2);
  });
  it('discovers required fields and reports the invalid query field with available choices', () => {
    expect(store.query({ resource: 'assets', describe: true })).toMatchObject({ requiredOnCreate: ['projectId', 'name'], valuesSchema: { properties: { projectId: { type: 'string', minLength: 1 } } } });
    expect(() => store.query({ resource: 'episodes', fields: ['plannedEpisodes'] })).toThrow('episodes.fields=["plannedEpisodes"]');
    expect(() => store.query({ resource: 'episodes', fields: ['plannedEpisodes'] })).toThrow('projectId, number');
  });

  it('rejects missing associations in the tool schema before execution, while permitting partial updates', () => {
    const validate = new AjvJsonSchemaValidator().getValidator(STUDIO_TOOLS[1].parameters);
    const change = { resource: 'assets', op: 'create', id: 'character', values: { name: '角色' } };
    const check = (changes: unknown[]) => validate({ requestId: 'schema-check', changes });
    const missingProject = check([change]);
    expect(missingProject.valid).toBe(false);
    expect(missingProject.errorMessage).toContain('projectId');
    expect(check([{ ...change, values: { ...change.values, projectId } }]).valid).toBe(true);
    const shot = { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode-1', sceneId: 'scene-1', dialogue: [{ type: '角色', text: '你好' }] } };
    expect(check([shot]).valid).toBe(false);
    expect(check([shot]).errorMessage).toContain('assetId');
    expect(check([{ ...shot, values: { ...shot.values, dialogue: [{ type: '旁白', text: '门开了' }] } }]).valid).toBe(true);
    expect(check([{ resource: 'shots', op: 'update', id: 'shot', version: 1, values: { duration: 4 } }]).valid).toBe(true);
    expect(check([{ resource: 'shots', op: 'delete', id: 'shot', version: 1 }]).valid).toBe(true);
    expect(check([{ resource: 'shots', op: 'update', id: 'shot', values: { duration: 4 } }]).valid).toBe(false);
    expect(check([{ resource: 'shots', op: 'update', id: 'shot', version: 1, values: { projectId } }]).valid).toBe(false);
    expect(validate({ requestId: 'obsolete-operation', undoBatchId: 'prior' }).valid).toBe(false);
    expect(validate({ requestId: 'missing-changes' }).valid).toBe(false);
  });

  it('locates missing references and saves character assets with their shots in one atomic batch', () => {
    const shot: StudioChange = { ...shots(1)[0], values: { ...shots(1)[0].values, dialogue: [{ type: '角色', text: '你好' }] } };
    expect(() => store.apply('missing-character', [shot])).toThrow('shots[shot-0].dialogue[0].assetId 必填');
    expect(store.snapshot().shots).toHaveLength(0);
    expect(() => store.apply('missing-project', [{ resource: 'assets', id: 'character', op: 'create', values: { name: '角色' } }])).toThrow('assets[character].projectId 必填');
    const boundShot = { ...shot, values: { ...shot.values, dialogue: [{ type: '角色', assetId: 'character', text: '你好' }, { type: '旁白', text: '门开了' }] } };
    expect(() => store.apply('unknown-character', [boundShot])).toThrow('shots[shot-0].dialogue[0].assetId：引用的 assets 记录 character 不存在');
    const changes: StudioChange[] = [boundShot, { resource: 'assets', id: 'character', op: 'create', values: { projectId, name: '角色' } }];
    store.apply('character-and-shot', changes);
    expect(store.snapshot().shots[0].dialogue).toEqual(boundShot.values.dialogue);
    expect(store.snapshot().assets[0].projectId).toBe(projectId);
    expect(store.apply('character-and-shot', changes).changed).toHaveLength(2);
  });

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
  it('creates and archives projects through the same batch service', () => {
    const result = store.apply('new-project', [{ resource: 'projects', op: 'create', id: 'new-project', values: { title: '第二个项目', summary: '', ratio: '16:9', style_catalog_id: 4 } }]);
    const id = result.changed.find(item => item.resource === 'projects')!.id;
    expect(id).not.toBe('new-project');
    expect(store.projects.get(Number(id))?.name).toBe('第二个项目');
    const version = store.snapshot().projects.find(item => item.id === id)!._version;
    store.apply('archive-project', [{ resource: 'projects', op: 'delete', id, version }]);
    expect(store.projects.get(Number(id))).toBeNull();
    expect(store.snapshot().projects.some(item => item.id === id)).toBe(false);
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
  });
  it('includes appearance and selected costume, while image edits use only the requested source and change', () => {
    const asset = { type: '角色', description: '插画师', appearance: '短发，圆脸', costume: '米色风衣', prompt: '', image: '/api/files/main', variants: [{ id: 'rain', description: '黄色雨衣' }] };
    const request = assetImageRequest(asset, { variantId: 'rain' });
    expect(request.prompt).toContain('短发，圆脸');
    expect(request.prompt).toContain('黄色雨衣');
    expect(request.prompt).not.toContain('米色风衣');
    expect(request.references).toEqual(['/api/files/main']);
    const edit = assetImageRequest(asset, { editPrompt: '只减淡阴影', image: '/api/files/history' });
    expect(edit.references).toEqual(['/api/files/history']);
    expect(edit.prompt).toContain('只减淡阴影');
    expect(edit.prompt).not.toContain('米色风衣');
    expect(() => assetImageRequest(asset, { view: '自定义' })).toThrow('自定义提示词');
  });
  it('continues variants after an active main job without duplicating active variants or standalone images', () => {
    const jobs = new MediaJobStore(join(directory, 'data.sqlite'), files);
    const asset = { id: 'asset-1', variants: [{ id: 'rain' }] };
    const main = jobs.create({ modelId: 'gpt-image-2', type: 'image', prompt: '白纸折叠的小船', options: { studioTarget: { resource: 'assets', id: asset.id, field: 'image' } }, providerId: 'test', upstreamModelId: 'gpt-image-2', baseUrl: 'https://example.invalid' });
    expect(canBatchGenerate(asset, jobs.list())).toBe(true);
    expect(canBatchGenerate({ ...asset, variants: [] }, jobs.list())).toBe(false);
    const variant = jobs.create({ ...main, options: { studioTarget: { resource: 'assets', id: asset.id, field: 'image', variantId: 'rain' } } });
    expect(canBatchGenerate(asset, jobs.list())).toBe(false);
    variant.status = 'cancelled'; jobs.put(variant);
    expect(canBatchGenerate(asset, jobs.list())).toBe(true);
    main.status = 'failed'; jobs.put(main);
    expect(canBatchGenerate({ ...asset, variants: [] }, jobs.list())).toBe(true);
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
