// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { VideoRedraw, parseModelJson, validateRedrawDraft } from '../examples/agent-chat/server/video-redraw';
import { AgentFailure } from '../examples/agent-chat/server/errors';
import { saveExtractedAssets } from '../examples/agent-chat/server/redraw-asset-extraction';
import { saveRedrawVideoPrompts } from '../examples/agent-chat/server/redraw-video-prompts';

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

it('fills missing existing variant prompts without replacing user content or images', () => {
  const projectId = studio.snapshot().projects[0].id;
  studio.apply('variant-setup', [
    { resource: 'episodes', op: 'create', id: 'episode', values: { projectId, title: '第1集', scenes: [{ id: 'scene', location: '路口', setting: '外', time: '夜', content: '', suggestedDuration: '' }] } },
    { resource: 'assets', op: 'create', id: 'asset', values: { projectId, episodeIds: ['episode'], type: '道具', name: '测试仪', variants: [
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
    { name: '绿灯', prompt: '不应覆盖' },
  ] }] };
  saveExtractedAssets(studio, project, episode, extraction, versions, 'backfill');
  expect(studio.snapshot().assets[0].variants).toMatchObject([
    { id: 'red', description: '红色背光', prompt: 'A breathalyzer with a red warning light.', image: '/api/files/red', history: ['/api/files/red'] },
    { id: 'green', prompt: '用户原有提示词' },
  ]);
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
