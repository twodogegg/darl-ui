// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { VideoRedraw, parseModelJson, validateRedrawDraft, validateRevision } from '../examples/agent-chat/server/video-redraw';
import { AgentFailure } from '../examples/agent-chat/server/errors';
import { saveExtractedAssets, unconfirmedCharacterLinks, validateAssetPromptFidelity } from '../examples/agent-chat/server/redraw-asset-extraction';
import { saveRedrawVideoPrompts } from '../examples/agent-chat/server/redraw-video-prompts';
import { saveRedrawStoryboard } from '../examples/agent-chat/server/redraw-storyboard';
import { saveScriptStoryboard } from '../examples/agent-chat/server/script-storyboard';

let directory: string, files: FileStore, studio: StudioStore, service: VideoRedraw;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'redraw-test-'));
  const storage = new LocalStorage(directory);
  files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projects.create({ name: '转绘边界验证', description: null, aspect_ratio: '16:9', style_catalog_id: 4 });
  studio = new StudioStore(projects);
  service = new VideoRedraw(studio, {
    model: () => { throw new Error('本测试不调用外部模型'); },
    instructions: async () => '',
    transcribe: async () => { throw new Error('本测试不调用外部转写'); },
  });
});
afterEach(async () => { service.dispose(); await rm(directory, { recursive: true, force: true }); });
type ChangeItem = { id: number; batchId: string; source: string; kind?: string; jobId?: string; agentName?: string; restoreOf?: number; count: number; resources: Record<string, number>; restoredCount: number };
type ChangeEntry = { index: number; resource: string; id: string; op: string; status: string; reason?: string; fields?: Record<string, string>; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
const changePage = (input: Record<string, unknown>) => studio.changeLog(input) as unknown as { items: ChangeItem[]; nextCursor: string | null };
const changeDetail = (projectId: string, id: number) => studio.changeLog({ projectId, id }) as unknown as ChangeItem & { entries: ChangeEntry[] };
const restore = (input: Record<string, unknown>) => studio.restoreChanges(input, { source: 'page' }) as { restored: number; repeated?: boolean; skipped: Array<{ index: number; reason: string; fields?: string[] }> };
it('rejects fabricated evidence and out-of-project speaker keys in structured analysis', () => {
  const segment = { id: 's', start: 0, end: 1, frames: [{ fileId: 'f', time: 0.5, url: '/api/files/f' }] };
  expect(() => validateRedrawDraft({ assets: [{ key: 'scene', type: '场景', name: '场景', description: '', targetName: '场景', targetDescription: '', evidenceSegmentId: 'missing', frameIndex: 0 }], shots: [{}] }, [segment], [])).toThrow('来源证据');
  expect(() => validateRedrawDraft({ assets: [], shots: [{ segmentId: 's', sceneKey: 'unknown', assetKeys: [], targetDialogue: [] }] }, [segment], [])).toThrow('关联无效');
});

it('accepts model output wrapped in fences or prose and reports invalid JSON as a retryable failure with context', () => {
  expect(parseModelJson('```json\n{"assets":[],"shots":[]}\n```')).toEqual({ assets: [], shots: [] });
  expect(parseModelJson('分析结果如下：{"assets":[],"shots":[]} 以上。')).toEqual({ assets: [], shots: [] });
  const error = (() => { try { parseModelJson('{"assets":[{"key":"人物A", "type":"角色"}]'); } catch (reason) { return reason; } })();
  expect(error).toBeInstanceOf(AgentFailure);
  expect((error as InstanceType<typeof AgentFailure>).retryable).toBe(true);
  expect((error as InstanceType<typeof AgentFailure>).suggestion).toContain('重试');
  expect((error as Error).message).toContain('不是有效 JSON');
  expect(String((error as Error).cause)).toContain('{"assets"');
  // The raw V8 wording is what reached users before; keep it inside the cause, not the message.
  expect((error as Error).message).not.toContain('after property value');
  expect((error as Error).message).not.toContain('at position');
  expect(String((error as Error).cause)).toContain('at position');
});

it('preserves shot order when a scene returns after an intercut', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0];
  const source = { fileId: file.id, duration: 3 };
  studio.apply('intercut-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: source } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, title: '第1集', scenes: [] } },
  ]);
  const state = studio.snapshot();
  const shots = ['a', 'b', 'a'].map((sceneKey, index) => ({ sceneKey, start: index, end: index + 1, scale: '中景', description: `镜头 ${index + 1}`, dialogue: [], effects: '', assets: [] }));
  saveRedrawStoryboard(studio, state.projects[0], state.episodes[0], source, {
    assets: [{ name: '车内', type: '场景' }, { name: '街道', type: '场景' }],
    scenes: [{ key: 'a', location: '车内', setting: '内', time: '夜', asset: '车内' }, { key: 'b', location: '街道', setting: '外', time: '夜', asset: '街道' }], shots,
  }, 'intercut');
  const result = studio.snapshot(), scenes = result.episodes[0].scenes as Array<{ id: string; assetId: string; location: string }>;
  expect(scenes.map(scene => scene.location)).toEqual(['车内', '街道', '车内']);
  expect(scenes[0].assetId).toBe(scenes[2].assetId);
  expect(result.shots.map(shot => shot.sceneId)).toEqual(scenes.map(scene => scene.id));
});

it('saves camera movement from the analysis and leaves it empty when none was observed', async () => {
  const file = await files.put(Buffer.from('camera reference'), 'video/mp4', 'camera.mp4');
  const project = studio.snapshot().projects[0];
  const source = { fileId: file.id, duration: 2 };
  studio.apply('camera-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: source } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, title: '第1集', scenes: [] } },
  ]);
  const state = studio.snapshot();
  saveRedrawStoryboard(studio, state.projects[0], state.episodes[0], source, {
    assets: [{ name: '车内', type: '场景' }],
    scenes: [{ key: 'a', location: '车内', setting: '内', time: '夜', asset: '车内' }],
    shots: [
      { sceneKey: 'a', start: 0, end: 1, scale: '特写', camera: '缓慢前推', description: '镜头 1', dialogue: [], effects: '', assets: [] },
      { sceneKey: 'a', start: 1, end: 2, scale: '中景', description: '镜头 2', dialogue: [], effects: '', assets: [] },
    ],
  }, 'camera');
  expect(studio.snapshot().shots.map(shot => [shot.scale, shot.camera])).toEqual([['特写', '缓慢前推'], ['中景', '']]);
});

it('accepts only supported updates for real, unique shots', () => {
  const shots = [{ id: 'shot-1' }] as ReturnType<StudioStore['snapshot']>['shots'];
  const valid = { changes: [{ shotId: 'shot-1', reason: '核对画面', values: { description: '正确画面', dialogue: [{ type: '旁白', text: '原句' }] } }], notes: '' };
  expect(validateRevision(valid, shots)).toEqual(valid);
  expect(validateRevision({ ...valid, changes: [{ ...valid.changes[0], values: { camera: '手持微晃' } }] }, shots).changes[0].values).toEqual({ camera: '手持微晃' });
  expect(() => validateRevision({ ...valid, changes: [valid.changes[0], valid.changes[0]] }, shots)).toThrow();
  expect(() => validateRevision({ ...valid, changes: [{ ...valid.changes[0], shotId: 'unknown' }] }, shots)).toThrow();
  expect(() => validateRevision({ ...valid, changes: [{ ...valid.changes[0], values: { sceneId: 'unknown' } }] }, shots)).toThrow();
});

it('refuses to apply a revision if a shot changed after analysis', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0];
  studio.apply('revision-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 3 } } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, title: '第1集', scenes: [{ id: 'scene', location: '车内', setting: '内', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'shots', id: 'shot', op: 'create', values: { episodeId: 'episode', sceneId: 'scene', description: '旧画面', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
  ]);
  const state = studio.snapshot();
  const job = { id: 'revision-job', projectId: project.id, episodeId: 'episode', sourceFileId: file.id, kind: 'revise-storyboard', status: 'completed', phase: '完成', projectVersion: state.projects[0]._version, versions: { 'episodes:episode': state.episodes[0]._version, 'shots:shot': state.shots[0]._version }, input: {}, fingerprint: '', segments: [], draft: { assets: [], shots: [] }, result: { readyToApply: true }, workflow: { outputs: [{ output_type: 'structured', content: JSON.stringify({ changes: [{ shotId: 'shot', reason: '核对', values: { description: '模型建议' } }], notes: '' }) }] } };
  studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, job.projectId, JSON.stringify(job));
  studio.apply('user-edit', [{ resource: 'shots', id: 'shot', op: 'update', version: state.shots[0]._version, values: { description: '用户的新内容' } }]);
  await expect(service.edit({ action: 'apply-revision', projectId: project.id, episodeId: 'episode', jobId: job.id })).rejects.toThrow('资产或分镜在运行期间发生变化');
  expect(studio.snapshot().shots[0].description).toBe('用户的新内容');
});

it('updates existing variant text while preserving images and logs the prior values', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('variant-setup', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, title: '第1集', scenes: [{ id: 'scene', location: '路口', setting: '外', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'asset', values: { projectId, episodeIds: ['episode'], type: '道具', name: '测试仪', prompt: '测试仪主形象', variants: [
      { id: 'red', name: '红灯', description: '红色背光', prompt: '', image: '/api/files/red', history: ['/api/files/red'] },
      { id: 'green', name: '绿灯', description: '绿色背光', prompt: '用户原有提示词', image: '', history: [] },
    ] } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: '测试仪', assetIds: ['asset'] } },
  ]);
  const state = studio.snapshot(), project = state.projects[0], episode = state.episodes[0];
  const versions = { 'assets:asset': state.assets[0]._version, 'shots:shot': state.shots[0]._version, 'episodes:episode': episode._version };
  expect(() => saveExtractedAssets(studio, project, episode, { assets: [] }, versions, 'missing')).toThrow('衍生状态缺少生图提示词');
  expect((studio.snapshot().assets[0].variants as Array<{ prompt: string }>)[0].prompt).toBe('');
  const extraction = { assets: [{ key: 'asset', existingId: 'asset', name: '测试仪', type: '道具', shotIds: ['shot'], variants: [
    { name: '红灯', description: '替换描述', prompt: 'A breathalyzer with a red warning light.' },
    { name: '绿灯', prompt: '新的绿色提示词' },
  ] }] };
  expect(() => saveExtractedAssets(studio, project, episode, { assets: [{ ...extraction.assets[0], shotIds: [] }] }, versions, 'no-shot')).toThrow('资产 测试仪 缺少镜头关联 shotIds');
  saveExtractedAssets(studio, project, episode, extraction, versions, 'backfill');
  expect(studio.snapshot().assets[0].variants).toMatchObject([
    { id: 'red', description: '替换描述', prompt: 'A breathalyzer with a red warning light.', image: '/api/files/red', history: ['/api/files/red'] },
    { id: 'green', prompt: '新的绿色提示词' },
  ]);
  const [batch] = changePage({ projectId }).items;
  expect(batch).toMatchObject({ source: 'workflow', kind: 'extract-assets', jobId: 'backfill', count: 1, resources: { assets: 1 } });
  const [entry] = changeDetail(projectId, batch.id).entries;
  expect(entry).toMatchObject({ resource: 'assets', id: 'asset', op: 'update', status: 'restorable' });
  expect(entry.before!.variants).toMatchObject([{ description: '红色背光', prompt: '' }, { prompt: '用户原有提示词' }]);
  expect(entry.after!.variants).toMatchObject([{ description: '替换描述' }, { prompt: '新的绿色提示词' }]);
});

it('keeps known costume and voice when extraction is uncertain, and accepts a concrete replacement', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('character-details', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, scenes: [{ id: 'scene', location: '房间', setting: '内', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'person', values: { projectId, name: '张奕', type: '角色', costume: '旧外套', voiceDescription: '低沉声音', prompt: '主形象' } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: '张奕', assetIds: ['person'] } },
  ]);
  const save = (costume: string, voiceDescription: string, jobId: string) => {
    const state = studio.snapshot();
    saveExtractedAssets(studio, state.projects[0], state.episodes[0], { assets: [{ key: 'person', existingId: 'person', name: '张奕', type: '角色', costume, voiceDescription, shotIds: ['shot'] }] }, { 'assets:person': state.assets[0]._version, 'shots:shot': state.shots[0]._version, 'episodes:episode': state.episodes[0]._version }, jobId);
  };
  save('待确认', '不适用', 'uncertain');
  expect(studio.snapshot().assets[0]).toMatchObject({ costume: '旧外套', voiceDescription: '低沉声音' });
  save('黑色大衣', '清亮声音', 'replacement');
  expect(studio.snapshot().assets[0]).toMatchObject({ costume: '黑色大衣', voiceDescription: '清亮声音' });
});

it('rejects missing main prompts without partially saving the extraction', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('main-prompt-setup', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, scenes: [{ id: 'scene', location: '办公室', setting: '内', time: '夜', content: '' }] } },
    { resource: 'assets', op: 'create', id: 'person', values: { projectId, episodeIds: ['episode'], name: 'Evelyn', type: '角色', prompt: '' } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: 'Evelyn', assetIds: ['person'] } },
  ]);
  const state = studio.snapshot(), project = state.projects[0], episode = state.episodes[0];
  const versions = { 'assets:person': state.assets[0]._version, 'shots:shot': state.shots[0]._version };
  const item = { key: 'person', existingId: 'person', name: 'Evelyn', type: '角色', description: '更新', shotIds: ['shot'] };
  expect(() => saveExtractedAssets(studio, project, episode, { assets: [item] }, versions, 'missing-main')).toThrow('Evelyn 的主形象缺少生图提示词');
  expect(() => saveExtractedAssets(studio, project, episode, { assets: [] }, versions, 'omitted-main')).toThrow('Evelyn 的主形象缺少生图提示词');
  expect(studio.snapshot().assets[0]).toMatchObject({ prompt: '', description: '' });
  saveExtractedAssets(studio, project, episode, { assets: [{ ...item, prompt: '完整主形象提示词' }] }, versions, 'complete-main');
  expect(studio.snapshot().assets[0]).toMatchObject({ prompt: '完整主形象提示词', description: '更新' });
});

it('rejects changed asset prompts that omit words from the original analysis', () => {
  const assets = [{ id: 'david', _version: 1, prompt: '旧提示词' }] as ReturnType<StudioStore['snapshot']>['assets'];
  const analysis = '生图提示：a dark modern traffic police uniform';
  const draft = { assets: [{ name: 'David', existingId: 'david', prompt: 'a modern traffic police uniform', shotIds: [] }] };
  expect(() => validateAssetPromptFidelity(analysis, draft, assets)).toThrow('与原始分析不一致');
  draft.assets[0].prompt = 'a dark modern traffic police uniform';
  expect(() => validateAssetPromptFidelity(analysis, draft, assets)).not.toThrow();
  // Formatters re-wrap long prompts; line breaks and repeated spaces are not content.
  expect(() => validateAssetPromptFidelity('生图提示：a dark modern\n  traffic police uniform', draft, assets)).not.toThrow();
});

it('restores logged AI changes field by field and keeps content changed later', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const initial = studio.snapshot().projects[0], projectId = initial.id;
  studio.apply('ai-history-setup', [
    { resource: 'projects', id: projectId, op: 'update', version: initial._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 3 } } },
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, scenes: [{ id: 'scene', location: '路口', setting: '外', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'asset', values: { projectId, name: '测试仪', type: '道具', description: '旧说明', prompt: '旧提示词', image: '/api/files/image', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: '测试仪', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
  ]);
  const before = studio.snapshot(), project = before.projects[0], episode = before.episodes[0];
  const versions = { 'assets:asset': before.assets[0]._version, 'shots:shot': before.shots[0]._version, 'episodes:episode': episode._version };
  // The write and its log row share one transaction: a rejected log leaves no write behind.
  expect(() => studio.apply('bad-origin', [{ resource: 'assets', id: 'asset', op: 'update', version: before.assets[0]._version, values: { prompt: '不应写入' } }], { source: 'unknown' } as never)).toThrow('变更来源无效');
  expect(studio.snapshot().assets[0].prompt).toBe('旧提示词');
  saveExtractedAssets(studio, project, episode, { assets: [
    { key: 'asset', existingId: 'asset', name: '测试仪', type: '道具', description: 'AI 新说明', prompt: 'AI 新提示词', shotIds: ['shot'] },
    { key: 'light', name: '警灯', type: '道具', description: '警灯', prompt: 'a warning light', shotIds: ['shot'] },
  ] }, versions, 'asset-job');
  const ai = changePage({ projectId, sources: ['agent', 'workflow'] }).items;
  expect(ai).toHaveLength(1);
  expect(ai[0]).toMatchObject({ source: 'workflow', kind: 'extract-assets', jobId: 'asset-job', count: 3, resources: { assets: 2, shots: 1 } });
  let current = studio.snapshot();
  const light = current.assets.find(asset => asset.name === '警灯')!;
  expect(current.assets[0]).toMatchObject({ prompt: 'AI 新提示词', image: '/api/files/image' });
  expect(current.shots[0].assetIds).toEqual(['asset', light.id]);
  const index = (id: string) => changeDetail(projectId, ai[0].id).entries.find(entry => entry.id === id)!.index;

  studio.apply('manual-later-edit', [{ resource: 'assets', id: 'asset', op: 'update', version: current.assets[0]._version, values: { prompt: '人工后续修改', costume: '人工服装' } }], { source: 'page' });
  expect(changeDetail(projectId, ai[0].id).entries[index('asset')]).toMatchObject({ status: 'partial', fields: { description: 'restorable', prompt: 'conflict' } });
  expect(restore({ requestId: 'restore-asset-entry', projectId, id: ai[0].id, entries: [index('asset')] })).toMatchObject({ restored: 1, skipped: [{ reason: 'partial', fields: ['prompt'] }] });
  current = studio.snapshot();
  expect(current.assets[0]).toMatchObject({ description: '旧说明', prompt: '人工后续修改', costume: '人工服装', image: '/api/files/image' });

  // A clip created later still uses the new asset, so the whole-batch restore keeps it and says why.
  studio.apply('later-clip-reference', [{ resource: 'clips', id: 'clip', op: 'create', values: { episodeId: episode.id, sceneId: 'scene', assetIds: [light.id], shotIds: [], duration: 3 } }]);
  const batch = restore({ requestId: 'restore-asset-batch', projectId, id: ai[0].id });
  expect(batch.restored).toBe(1);
  expect(batch.skipped.map(item => [item.index, item.reason]).sort()).toEqual([[index('asset'), 'already-restored'], [index(light.id), 'in-use']].sort());
  current = studio.snapshot();
  expect(current.shots[0].assetIds).toEqual([]);
  expect(current.assets.some(asset => asset.id === light.id)).toBe(true);
  expect(restore({ requestId: 'restore-asset-batch', projectId, id: ai[0].id })).toMatchObject({ repeated: true });
  studio.apply('remove-test-clip', [{ resource: 'clips', id: 'clip', op: 'delete', version: current.clips[0]._version }]);
  expect(restore({ requestId: 'restore-asset-rest', projectId, id: ai[0].id })).toMatchObject({ restored: 1 });
  expect(studio.snapshot().assets.some(asset => asset.id === light.id)).toBe(false);
  expect(changeDetail(projectId, ai[0].id).entries.map(entry => entry.status)).toEqual(['restored', 'restored', 'restored']);

  // Restores are logged against the original batch and can themselves be undone.
  const restores = changePage({ projectId, sources: ['restore'] }).items;
  expect(restores.map(item => item.batchId)).toEqual(['restore-restore-asset-rest', 'restore-restore-asset-batch', 'restore-restore-asset-entry']);
  expect(restores.every(item => item.restoreOf === ai[0].id && item.kind === 'extract-assets')).toBe(true);
  expect(restore({ requestId: 'undo-asset-entry', projectId, id: restores[2].id })).toMatchObject({ restored: 1, skipped: [] });
  expect(studio.snapshot().assets[0]).toMatchObject({ description: 'AI 新说明', prompt: '人工后续修改', episodeIds: ['episode'] });
  // Undoing a restore makes the original entry restorable again; the entries it did not touch stay restored.
  const entries = changeDetail(projectId, ai[0].id).entries;
  expect(entries[index('asset')]).toMatchObject({ status: 'partial', fields: { description: 'restorable', prompt: 'conflict' } });
  expect(entries.filter(entry => entry.status === 'restored')).toHaveLength(2);
  expect(changeDetail(projectId, restores[2].id).entries[0].status).toBe('restored');
  expect(restore({ requestId: 'restore-asset-again', projectId, id: ai[0].id, entries: [index('asset')] })).toMatchObject({ restored: 1, skipped: [{ reason: 'partial', fields: ['prompt'] }] });
  expect(studio.snapshot().assets[0]).toMatchObject({ description: '旧说明', prompt: '人工后续修改' });
});

it('keeps global resource changes in their own scope and skips records changed later', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('folder-create', [{ resource: 'folders', id: 'folder', op: 'create', values: { name: '参考图' } }], { source: 'page' });
  const folder = studio.snapshot().folders.find(item => item.id === 'folder')!;
  studio.apply('folder-rename', [{ resource: 'folders', id: 'folder', op: 'update', version: folder._version, values: { name: '角色参考' } }], { source: 'agent', agentId: 'agent', agentName: '测试 Agent' });
  expect(changePage({ projectId }).items.some(item => item.resources.folders)).toBe(false);
  const page = changePage({ limit: 1 });
  expect(page.items[0]).toMatchObject({ source: 'agent', agentName: '测试 Agent', count: 1 });
  const created = changePage({ limit: 1, cursor: page.nextCursor }).items[0];
  expect(created).toMatchObject({ source: 'page', batchId: 'folder-create' });
  expect(restore({ requestId: 'restore-folder-create', id: created.id })).toMatchObject({ restored: 0, skipped: [{ reason: 'changed-later' }] });
  expect(studio.snapshot().folders.find(item => item.id === 'folder')?.name).toBe('角色参考');
  expect(() => restore({ requestId: 'short', id: created.id })).toThrow('requestId');
  expect(() => changePage({ projectId, sources: ['unknown'] })).toThrow('变更来源筛选无效');
});

it('reports character links without shot evidence and saves the rest of the result', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('character-link-setup', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, scenes: [{ id: 'scene', location: '牢房', setting: '内', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'helen', values: { projectId, name: 'Helen', type: '角色', prompt: 'Helen 的主形象' } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: 'Clara 走出牢房。' } },
  ]);
  const state = studio.snapshot(), result = { assets: [{ key: 'helen', existingId: 'helen', name: 'Helen', type: '角色', shotIds: ['shot'] }] };
  expect(unconfirmedCharacterLinks(result, state.assets, state.shots)).toEqual([{ assetId: 'helen', name: 'Helen', shotId: 'shot' }]);
  state.shots[0].description = 'helen 在牢房门口。';
  expect(unconfirmedCharacterLinks(result, state.assets, state.shots)).toEqual([]);
  state.shots[0].description = '牢房门口。';
  state.shots[0].assetIds = ['helen'];
  expect(unconfirmedCharacterLinks(result, state.assets, state.shots)).toEqual([]);
  const fresh = studio.snapshot(), project = fresh.projects[0], episode = fresh.episodes[0];
  const versions = { 'assets:helen': fresh.assets[0]._version, 'shots:shot': fresh.shots[0]._version, 'episodes:episode': episode._version };
  const saved = saveExtractedAssets(studio, project, episode, { assets: [...result.assets, { key: 'key', name: '牢房钥匙', type: '道具', prompt: 'an old iron key', shotIds: ['shot'] }] }, versions, 'skip-links');
  expect(saved).toMatchObject({ created: 1, linkedShots: 1, skippedLinks: [{ assetId: 'helen', shotId: 'shot' }] });
  const after = studio.snapshot(), key = after.assets.find(asset => asset.name === '牢房钥匙')!;
  expect(after.shots[0].assetIds).toEqual([key.id]);
  expect(after.assets.find(asset => asset.id === 'helen')?.episodeIds).toEqual([]);
});

it('retries saving stored asset fields without calling a model and reports skipped links', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const initial = studio.snapshot().projects[0], projectId = initial.id;
  studio.apply('retry-save-setup', [
    { resource: 'projects', id: projectId, op: 'update', version: initial._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 3 } } },
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, scenes: [{ id: 'scene', location: '牢房', setting: '内', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'roxy', values: { projectId, name: 'Roxy', type: '角色', description: '囚犯', appearance: '短发', costume: '囚服', voiceDescription: '待确认', prompt: '旧提示词', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
    { resource: 'shots', op: 'create', id: 'shot', values: { episodeId: 'episode', sceneId: 'scene', description: '狱警打开牢门。', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
  ]);
  const state = studio.snapshot(), project = state.projects[0];
  // The structured output re-wraps the report's prompt onto one line; fidelity ignores whitespace.
  const raw = '## 道具\n\n牢门钥匙\n\n生图提示：an old iron key,\n  hanging on a ring';
  const structured = JSON.stringify({ assets: [
    { key: 'roxy', existingId: 'roxy', name: 'Roxy', type: '角色', shotIds: ['shot'] },
    { key: 'key', name: '牢门钥匙', type: '道具', description: '打开牢门', appearance: '旧铁钥匙', prompt: 'an old iron key, hanging on a ring', shotIds: ['shot'] },
  ] });
  const job = { id: 'failed-assets', projectId, episodeId: 'episode', sourceFileId: file.id, kind: 'extract-assets', status: 'failed', phase: '校验并保存资产', error: '保存中断', createdAt: new Date().toISOString(), input: {}, fingerprint: '', projectVersion: project._version, versions: { 'episodes:episode': state.episodes[0]._version, 'assets:roxy': state.assets[0]._version, 'shots:shot': state.shots[0]._version }, segments: [], draft: { assets: [], shots: [] }, workflow: { config: { kind: 'extract-assets', model: 'text', formatterModel: 'text', instructions: '', skillIds: [], toolNames: [] }, skills: [], steps: [], formatErrors: ['第一次整理缺少 shotIds'], outputs: [{ output_type: 'raw', content: raw }, { output_type: 'structured', content: structured }] } };
  studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, projectId, JSON.stringify(job));
  expect(service.read({ projectId, episodeId: 'episode', jobId: job.id })).toMatchObject({ failureStage: '校验与保存' });
  await service.edit({ action: 'retry-save', projectId, episodeId: 'episode', jobId: job.id, requestId: 'retry-save-assets', version: project._version });
  const result = await service.wait({ projectId, episodeId: 'episode', jobId: 'retry-save-assets' }, new AbortController().signal);
  expect(result).toMatchObject({ status: 'completed', created: 1, skippedLinks: [{ assetId: 'roxy', name: 'Roxy', shotId: 'shot' }], formatErrors: ['第一次整理缺少 shotIds'] });
  const key = studio.snapshot().assets.find(asset => asset.name === '牢门钥匙')!;
  expect(studio.snapshot().shots[0].assetIds).toEqual([key.id]);
  expect(changePage({ projectId, sources: ['workflow'] }).items[0]).toMatchObject({ kind: 'extract-assets', jobId: 'retry-save-assets', resources: { assets: 1, shots: 1 } });
});

it('keeps source ranges for traceability while allowing independently adjusted clip durations', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('clip-setup', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, title: '第1集', scenes: [{ id: 'scene', location: '路口', setting: '外', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'shots', op: 'create', id: 'shot1', position: 0, values: { episodeId: 'episode', sceneId: 'scene', description: '第一镜' } },
    { resource: 'shots', op: 'create', id: 'shot2', position: 1, values: { episodeId: 'episode', sceneId: 'scene', description: '第二镜' } },
  ]);
  const state = studio.snapshot(), project = state.projects[0], episode = state.episodes[0];
  const versions = Object.fromEntries(state.shots.map(shot => [`shots:${shot.id}`, shot._version]));
  const clips = [
    { sceneId: 'scene', title: '第一段', globalStart: 0, globalEnd: 4, duration: 7, prompt: '重新安排<br>第一段节奏', assetIds: [], shotIds: ['shot1'] },
    { sceneId: 'scene', title: '第二段', globalStart: 4, globalEnd: 9, duration: 3, prompt: '重新安排第二段节奏', assetIds: [], shotIds: ['shot2'] },
  ];
  expect(() => saveRedrawVideoPrompts(studio, project, episode, versions, { clips: [clips[0], { ...clips[1], globalStart: 5 }] }, '参考生成', 'invalid')).toThrow('不连续');
  expect(() => saveRedrawVideoPrompts(studio, project, episode, versions, { clips: [{ ...clips[0], duration: 7.5 }, clips[1]] }, '参考生成', 'fractional')).toThrow('整数秒');
  expect(() => saveRedrawVideoPrompts(studio, project, episode, versions, { clips }, '参考生成', 'unsupported', [4, 7, 10])).toThrow('不受默认视频模型支持');
  const result = saveRedrawVideoPrompts(studio, project, episode, versions, { clips }, '参考生成', 'adjusted');
  expect(result.plan.map(({ globalStart, globalEnd, duration }) => ({ globalStart, globalEnd, duration }))).toEqual([{ globalStart: 0, globalEnd: 4, duration: 7 }, { globalStart: 4, globalEnd: 9, duration: 3 }]);
  expect(studio.snapshot().clips.map(clip => clip.duration)).toEqual([7, 3]);
  expect(studio.snapshot().clips[0].prompt).toBe('重新安排\n第一段节奏');
});

it('writes a script into existing scenes only when target dialogue is preserved in order', async () => {
  const { saveRedrawScript } = await import('../examples/agent-chat/server/redraw-script');
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('script-setup', [
    { resource: 'episodes', op: 'create', id: 'script-episode', values: { projectId, title: '第1集', scenes: [{ id: 'script-scene', location: '车内', setting: '内', time: '夜', content: '' }] } },
    { resource: 'assets', op: 'create', id: 'script-role', values: { projectId, type: '角色', name: 'A' } },
    { resource: 'shots', op: 'create', id: 'script-shot', values: { episodeId: 'script-episode', sceneId: 'script-scene', description: 'A 看向前方', dialogue: [{ id: 'line-1', type: '角色', assetId: 'script-role', text: 'Hello.' }, { id: 'line-2', type: '角色', assetId: 'script-role', text: 'Wait!' }] } },
  ]);
  const episode = studio.snapshot().episodes.find(item => item.id === 'script-episode')!;
  expect(() => saveRedrawScript(studio, episode, { scenes: [{ sceneId: 'script-scene', content: 'A: Wait! Hello.' }], openItems: [] }, 'bad-order')).toThrow('未按顺序保留');
  expect(() => saveRedrawScript(studio, episode, { scenes: [{ sceneId: 'other', content: 'A: Hello. Wait!' }], openItems: [] }, 'bad-id')).toThrow('场次 ID');
  saveRedrawScript(studio, episode, { scenes: [{ sceneId: 'script-scene', content: 'A: Hello.\nA: Wait!' }], openItems: ['确认发声方式'] }, 'good');
  const saved = studio.snapshot().episodes.find(item => item.id === episode.id)!;
  expect((saved.scenes as Array<{ id: string; content: string }>)[0]).toMatchObject({ id: 'script-scene', content: 'A: Hello.\nA: Wait!' });
  expect(saved.script).toContain('Hello.');
  expect(() => saveRedrawScript(studio, saved, { scenes: [{ sceneId: 'script-scene', content: 'A: Hello. Wait!' }], openItems: [] }, 'overwrite')).toThrow('已有剧本');
});


it('validates formal storyboard suggestions without changing dialogue or source facts', () => {
  const shots = [{ id: 'shot-1' }] as ReturnType<StudioStore['snapshot']>['shots'];
  const make = (values: Record<string, unknown>) => ({ changes: [{ shotId: 'shot-1', reason: '调整节奏', values }], notes: '' });
  expect(validateRevision(make({ camera: '缓慢推近', duration: 2.3 }), shots, true).changes[0].values).toEqual({ camera: '缓慢推近', duration: 2.3 });
  expect(() => validateRevision(make({ duration: 2.34 }), shots, true)).toThrow();
  expect(() => validateRevision(make({ sourceDialogue: '改写' }), shots, true)).toThrow();
  expect(() => validateRevision(make({ dialogue: [] }), shots, true)).toThrow();
});

it('applies approved camera and target duration without changing original timing or dialogue', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0];
  studio.apply('formal-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 5 } } },
    { resource: 'episodes', id: 'formal-episode', op: 'create', values: { projectId: project.id, title: '第1集', script: '原剧本', scenes: [{ id: 'formal-scene', location: '车内', setting: '内', time: '夜', content: '原剧本' }] } },
    { resource: 'shots', id: 'formal-shot', op: 'create', values: { episodeId: 'formal-episode', sceneId: 'formal-scene', description: '画面', duration: 2.067, dialogue: [{ id: 'line', type: '旁白', text: '原台词' }], source: { fileId: file.id, start: 0, end: 2.067, frames: [] } } },
  ]);
  const state = studio.snapshot(), shot = state.shots.find(item => item.id === 'formal-shot')!;
  expect(shot.camera).toBe('');
  const job = { id: 'formal-job', projectId: project.id, episodeId: 'formal-episode', sourceFileId: file.id, kind: 'plan-storyboard', status: 'completed', phase: '完成', projectVersion: state.projects[0]._version, versions: { 'episodes:formal-episode': state.episodes.find(item => item.id === 'formal-episode')!._version, 'shots:formal-shot': shot._version }, input: {}, fingerprint: '', segments: [], draft: { assets: [], shots: [] }, result: { readyToApply: true }, workflow: { outputs: [{ output_type: 'structured', content: JSON.stringify({ changes: [{ shotId: 'formal-shot', reason: '表演节奏', values: { camera: '缓慢推近', duration: 2.5 } }], notes: '' }) }] } };
  studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, job.projectId, JSON.stringify(job));
  await service.edit({ action: 'apply-revision', projectId: project.id, episodeId: 'formal-episode', jobId: job.id });
  const saved = studio.snapshot().shots.find(item => item.id === 'formal-shot')!;
  expect(saved).toMatchObject({ camera: '缓慢推近', duration: 2.5, source: { start: 0, end: 2.067 }, dialogue: [{ id: 'line', type: '旁白', text: '原台词' }] });
});

it('does not invent fixed camera movement when editing a legacy redraw shot', async () => {
  const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0];
  studio.apply('legacy-camera-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 5 } } },
    { resource: 'episodes', id: 'legacy-episode', op: 'create', values: { projectId: project.id, title: '第1集', scenes: [{ id: 'legacy-scene', location: '车内', setting: '内', time: '夜', content: '' }] } },
    { resource: 'shots', id: 'legacy-shot', op: 'create', values: { episodeId: 'legacy-episode', sceneId: 'legacy-scene', source: { fileId: file.id, start: 0, end: 3, frames: [] } } },
  ]);
  studio.projects.db.prepare("UPDATE studio_records SET data=json_remove(data,'$.camera') WHERE resource='shots' AND id=?").run('legacy-shot');
  const legacy = studio.snapshot().shots.find(item => item.id === 'legacy-shot')!;
  studio.apply('legacy-camera-edit', [{ resource: 'shots', op: 'update', id: legacy.id, version: legacy._version, values: { duration: 2.5 } }]);
  expect(studio.snapshot().shots.find(item => item.id === legacy.id)?.camera).toBe('');
});

it('plans shot splits without losing unrelated media and rejects stale or unsafe replacements', async () => {
  const { planShotAdjustment } = await import('../examples/agent-chat/server/redraw-adjustment');
  const episode = { id: 'ep', _version: 1, scenes: [{ id: 'scene' }] };
  const source = { fileId: 'file', duration: 2 };
  const existing = [{ id: 'shot', _version: 3, episodeId: 'ep', sceneId: 'scene', source: { fileId: 'file', start: 0, end: 2, frames: [] }, image: '', imageHistory: [] }];
  const shot = { id: 'shot', sceneId: 'scene', start: 0, end: 1, duration: 1, scale: '中景', camera: '', description: '画面', sourceDescription: '原片', sourceDialogue: '', effects: '', assetIds: [], dialogue: [] };
  const proposal = { notes: '', shots: [shot, { ...shot, id: '', start: 1, end: 2 }] };
  const changes = planShotAdjustment(proposal, episode, source, existing, []);
  expect(changes.map(item => item.op)).toEqual(['update', 'create']);
  expect(changes[0]).toMatchObject({ id: 'shot', version: 3, values: { source: { start: 0, end: 1, frames: [], confirmed: false } } });
  const linked = planShotAdjustment(proposal, episode, source, existing, [{ id: 'clip', _version: 1, shotIds: ['shot'] }]);
  expect(linked.find(item => item.resource === 'clips')?.values?.shotIds).toEqual(linked.filter(item => item.resource === 'shots').map(item => item.id));
  expect(() => planShotAdjustment(proposal, episode, source, [{ ...existing[0], image: '/image' }], [])).toThrow('已关联图片');
  expect(() => planShotAdjustment({ ...proposal, shots: [shot, { ...shot, id: '', start: 1.5, end: 2 }] }, episode, source, existing, [])).toThrow('时间无效');
  expect(() => planShotAdjustment({ ...proposal, shots: [shot, { ...shot, start: 1, end: 2 }] }, episode, source, existing, [])).toThrow('重复');
  const adjacent = [{ ...existing[0], source: { fileId: 'file', start: 0, end: 1, frames: [] } }, { ...existing[0], id: 'other', source: { fileId: 'file', start: 1, end: 2, frames: [] } }];
  expect(() => planShotAdjustment({ notes: '', shots: [{ ...shot, end: 2 }] }, episode, source, adjacent, [{ id: 'clip-a', _version: 1, shotIds: ['shot'] }, { id: 'clip-b', _version: 1, shotIds: ['other'] }])).toThrow('跨越多个视频片段');
});

it('records a split as one reversible batch and preserves existing shot ordering', async () => {
  const { planShotAdjustment } = await import('../examples/agent-chat/server/redraw-adjustment');
  const file = await files.put(Buffer.from('source'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0];
  const source = { fileId: file.id, duration: 2 };
  studio.apply('adjust-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: source } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, scenes: [{ id: 'scene', location: '室内', setting: '内', time: '日', content: '', suggestedDuration: '' }] } },
    { resource: 'shots', id: 'shot', op: 'create', position: 12, values: { episodeId: 'episode', sceneId: 'scene', duration: 2, description: '原画面', source: { ...source, start: 0, end: 2, frames: [] } } },
    { resource: 'clips', id: 'clip', op: 'create', values: { episodeId: 'episode', sceneId: 'scene', duration: 2, shotIds: ['shot'] } },
  ]);
  const state = studio.snapshot(), shot = state.shots.find(item => item.id === 'shot')!;
  const first = { id: shot.id, sceneId: 'scene', start: 0, end: 1, duration: 1, scale: '中景', camera: '', description: '原画面', sourceDescription: '', sourceDialogue: '', effects: '', assetIds: [], dialogue: [] };
  const changes = planShotAdjustment({ notes: '', shots: [first, { ...first, id: '', start: 1, end: 2 }] }, state.episodes.find(item => item.id === 'episode')!, source, [shot], state.clips.filter(item => item.episodeId === 'episode'));
  studio.apply('redraw-adjust-adjust-job', changes, { source: 'workflow', kind: 'revise-cuts', jobId: 'adjust-job' });
  const job = { id: 'adjust-job', projectId: project.id, episodeId: 'episode', sourceFileId: file.id, kind: 'revise-cuts', status: 'completed', phase: '完成', result: { applied: true }, input: {}, workflow: { config: { model: 'model', formatterModel: 'formatter' }, skills: [], steps: [], outputs: [] } };
  studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, project.id, JSON.stringify(job));
  expect(service.read({ projectId: project.id, episodeId: 'episode', jobId: job.id })).toMatchObject({ applied: true, restored: false });
  expect(studio.snapshot().shots.filter(item => item.episodeId === 'episode')).toHaveLength(2);
  const batch = changePage({ projectId: project.id, sources: ['workflow'] }).items[0];
  expect(restore({ requestId: 'restore-adjust-result', projectId: project.id, id: batch.id })).toMatchObject({ restored: 3, skipped: [] });
  const restored = studio.snapshot().shots.filter(item => item.episodeId === 'episode');
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({ id: 'shot', _position: 12, duration: 2, source: { start: 0, end: 2 } });
  expect(studio.snapshot().clips.find(item => item.id === 'clip')?.shotIds).toEqual(['shot']);
  expect(service.read({ projectId: project.id, episodeId: 'episode', jobId: job.id })).toMatchObject({ applied: true, restored: true });
});

it('restores a merged shot and its clip references together', async () => {
  const { planShotAdjustment } = await import('../examples/agent-chat/server/redraw-adjustment');
  const file = await files.put(Buffer.from('source'), 'video/mp4', 'source.mp4');
  const project = studio.snapshot().projects[0], source = { fileId: file.id, duration: 2 };
  studio.apply('merge-adjust-setup', [
    { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: source } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, scenes: [{ id: 'scene', location: '室内', setting: '内', time: '日', content: '', suggestedDuration: '' }] } },
    { resource: 'shots', id: 'a', op: 'create', position: 10, values: { episodeId: 'episode', sceneId: 'scene', duration: 1, source: { fileId: file.id, start: 0, end: 1, frames: [] } } },
    { resource: 'shots', id: 'b', op: 'create', position: 11, values: { episodeId: 'episode', sceneId: 'scene', duration: 1, source: { fileId: file.id, start: 1, end: 2, frames: [] } } },
    { resource: 'clips', id: 'clip', op: 'create', values: { episodeId: 'episode', sceneId: 'scene', duration: 2, shotIds: ['a', 'b'] } },
  ]);
  const state = studio.snapshot();
  const merged = { id: 'a', sceneId: 'scene', start: 0, end: 2, duration: 2, scale: '', camera: '', description: '', sourceDescription: '', sourceDialogue: '', effects: '', assetIds: [], dialogue: [] };
  const changes = planShotAdjustment({ notes: '', shots: [merged] }, state.episodes.find(item => item.id === 'episode')!, source, state.shots.filter(item => item.episodeId === 'episode'), state.clips.filter(item => item.episodeId === 'episode'));
  studio.apply('redraw-adjust-merge-job', changes, { source: 'workflow', kind: 'revise-cuts', jobId: 'merge-job' });
  expect(studio.snapshot().clips.find(item => item.id === 'clip')?.shotIds).toEqual(['a']);
  const batch = changePage({ projectId: project.id, sources: ['workflow'] }).items[0];
  expect(restore({ requestId: 'restore-merge-result', projectId: project.id, id: batch.id })).toMatchObject({ restored: 3, skipped: [] });
  expect(studio.snapshot().shots.filter(item => item.episodeId === 'episode').map(item => item.id)).toEqual(['a', 'b']);
  expect(studio.snapshot().clips.find(item => item.id === 'clip')?.shotIds).toEqual(['a', 'b']);
});

it('saves script storyboard clips against real scenes and assets without overwriting existing work', () => {
  const project = studio.snapshot().projects[0];
  studio.apply('script-storyboard-setup', [
    { resource: 'episodes', id: 'script-episode', op: 'create', values: { projectId: project.id, title: '第一集', script: '小雨走进车站。', scenes: [{ id: 'script-scene', location: '车站', setting: '内', time: '日', content: '小雨走进车站。', suggestedDuration: '' }] } },
    { resource: 'assets', id: 'script-asset', op: 'create', values: { projectId: project.id, name: '小雨', type: '角色' } },
  ]);
  const state = studio.snapshot(), episode = state.episodes[0], versions = { 'assets:script-asset': state.assets[0]._version };
  const clip = { sceneId: 'script-scene', title: '进站', duration: 5, prompt: '小雨走进车站', storyboardPrompt: '小雨进站四宫格', assetIds: ['script-asset'] };
  const model = { modelId: 'video', seconds: [5, 10] };
  expect(() => saveScriptStoryboard(studio, project, episode, versions, { clips: [{ ...clip, assetIds: ['missing'] }], openItems: [] }, 'bad', model)).toThrow();
  expect(studio.snapshot().clips).toHaveLength(0);
  expect(saveScriptStoryboard(studio, project, episode, versions, { clips: [clip], openItems: [] }, 'good', model, '分镜图').clips).toBe(1);
  expect(studio.snapshot().clips[0]).toMatchObject({ sceneId: 'script-scene', prompt: clip.prompt, storyboardPrompt: clip.storyboardPrompt, assetIds: ['script-asset'] });
  expect(() => saveScriptStoryboard(studio, project, episode, versions, { clips: [clip], openItems: [] }, 'repeat', model)).toThrow('未保存');
});

it('requires a storyboard prompt only for storyboard mode and ignores it for reference generation', () => {
  const project = studio.snapshot().projects[0];
  studio.apply('storyboard-mode-setup', [
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, scenes: [{ id: 'scene', location: '客厅', setting: '内', time: '日', content: '进入客厅。', suggestedDuration: '' }] } },
    { resource: 'assets', id: 'person', op: 'create', values: { projectId: project.id, name: '角色', type: '角色' } },
  ]);
  const state = studio.snapshot(), episode = state.episodes[0], versions = { 'assets:person': state.assets[0]._version };
  const clip = { sceneId: 'scene', title: '片段', duration: 5, prompt: '进入客厅', assetIds: ['person'] };
  const model = { modelId: 'video', seconds: [5] };
  expect(() => saveScriptStoryboard(studio, project, episode, versions, { clips: [clip], openItems: [] }, 'storyboard', model, '分镜图')).toThrow('分镜图提示词');
  saveScriptStoryboard(studio, project, episode, versions, { clips: [{ ...clip, storyboardPrompt: '模型额外输出' }], openItems: [] }, 'reference', model, '参考生成');
  expect(studio.snapshot().clips[0]).toMatchObject({ mode: '参考生成', prompt: '进入客厅', storyboardPrompt: '' });
});

it('preserves story order when clips return to a previously used scene', () => {
  const project = studio.snapshot().projects[0];
  studio.apply('return-to-scene-setup', [
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, scenes: [
      { id: 'home', location: '客厅', setting: '内', time: '日', content: '回到客厅。', suggestedDuration: '' },
      { id: 'space', location: '空间', setting: '内', time: '日', content: '进入空间。', suggestedDuration: '' },
    ] } },
    { resource: 'assets', id: 'person', op: 'create', values: { projectId: project.id, name: '角色', type: '角色' } },
  ]);
  const state = studio.snapshot(), episode = state.episodes[0], versions = { 'assets:person': state.assets[0]._version };
  const clip = (sceneId: string, title: string) => ({ sceneId, title, duration: 5, prompt: title, storyboardPrompt: title, assetIds: ['person'] });
  const model = { modelId: 'video', seconds: [5] };
  expect(() => saveScriptStoryboard(studio, project, episode, versions, { clips: [clip('home', '一'), clip('missing', '二')], openItems: [] }, 'invalid-scene', model)).toThrow('场次 ID 不存在');
  expect(() => saveScriptStoryboard(studio, project, episode, versions, { clips: [clip('home', '一')], openItems: [] }, 'missing-scene', model)).toThrow('遗漏了有正文的场次');
  expect(studio.snapshot().clips).toHaveLength(0);
  saveScriptStoryboard(studio, project, episode, versions, { clips: [clip('home', '一'), clip('space', '二'), clip('home', '三')], openItems: [] }, 'return', model);
  expect(studio.snapshot().clips.map(item => [item.title, item.sceneId])).toEqual([['一', 'home'], ['二', 'space'], ['三', 'home']]);
});
