// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { createFrameSheet, extractVideoFrames } from '../scripts/video-frames.mjs';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { VideoRedraw, parseModelJson, validateRedrawDraft } from '../examples/agent-chat/server/video-redraw';
import { AgentFailure } from '../examples/agent-chat/server/errors';
import { analysisFrameSheets, composeVideo, prepareVideo, probeVideo, videoCommand, withVideoFiles, type SourceSegment } from '../examples/agent-chat/server/video-processing';

let directory: string, files: FileStore, studio: StudioStore, service: VideoRedraw, projectId: string;
const signal = () => AbortSignal.timeout(30_000);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'redraw-test-'));
  const storage = new LocalStorage(directory);
  files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projectId = String(projects.create({ name: '转绘边界验证', description: null, aspect_ratio: '16:9', style_catalog_id: 4 }).project_id);
  studio = new StudioStore(projects);
  service = new VideoRedraw(studio, {
    model: () => { throw new Error('本测试不调用外部模型'); },
    instructions: async () => '',
    transcribe: async () => { throw new Error('本测试不调用外部转写'); },
  });
});
afterEach(async () => { service.dispose(); await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const path = join(directory, 'source.mp4');
  await videoCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=24:d=0.6', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=24:d=0.6',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], signal());
  return files.put(await readFile(path), 'video/mp4', '实际编码的切镜测试.mp4');
}
async function projectWithSource() {
  const video = await fixture(), prepared = await prepareVideo(files, video.id, signal(), () => {});
  const project = studio.snapshot().projects[0];
  studio.apply('source', [
    { resource: 'projects', id: projectId, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: prepared } },
    { resource: 'episodes', id: 'episode', op: 'create', values: { projectId, scenes: [{ id: 'scene', location: '色卡', setting: '内', time: '日', content: '', suggestedDuration: '' }] } },
  ]);
  return prepared;
}

it('detects actual cuts, persists real frames, and composes playable silent footage with an audio track', async () => {
  const video = await fixture(), segments: SourceSegment[] = [];
  const prepared = await prepareVideo(files, video.id, signal(), segment => segments.push(segment));
  expect(prepared.hasAudio).toBe(false);
  expect(segments.length).toBe(2);
  expect(segments[0].start).toBe(0);
  expect(segments.at(-1)!.end).toBe(prepared.duration);
  expect(segments[0].frames).toHaveLength(1);
  expect(segments[0].frames[0].time).toBeCloseTo(0, 3);
  expect(segments[1].frames).toHaveLength(1);
  expect(segments[1].frames[0].time).toBeCloseTo(1, 3);
  for (const segment of segments) {
    for (const frame of segment.frames) {
      expect(frame.time).toBeGreaterThanOrEqual(segment.start);
      expect(frame.time).toBeLessThan(segment.end);
      expect((await files.getBytes(frame.fileId))!.bytes.length).toBeGreaterThan(100);
    }
  }
  const [sheet] = await analysisFrameSheets(files, segments, signal());
  expect(sheet.frames.map(frame => [frame.segmentId, frame.frameIndex])).toEqual(segments.flatMap(segment => segment.frames.map((_, index) => [segment.id, index])));
  expect(sheet.frames.map(frame => frame.time)).toEqual(segments.flatMap(segment => segment.frames.map(frame => frame.time)));
  const { data, info } = await sharp(sheet.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(960);
  expect(info.height).toBe(296);
  // Actual red and blue shot pixels stay in separate cells, beneath their own source mappings.
  for (const [column, channel] of [[0, 0], [1, 2]]) {
    const offset = (100 * info.width + column * 480 + 100) * info.channels;
    expect(data[offset + channel]).toBeGreaterThan(200);
    expect(data[offset + (channel === 0 ? 2 : 0)]).toBeLessThan(50);
  }
  await expect(analysisFrameSheets(files, [{ ...segments[0], frames: [{ fileId: 'missing', time: 0, url: '' }] }], signal())).rejects.toThrow('已丢失');
  const result = await composeVideo(files, [{ fileId: video.id, start: 0, end: 0.5 }, { fileId: video.id, start: 0.65, end: 1.1 }], '16:9', signal());
  expect(result.duration).toBeGreaterThan(0.85);
  expect(result.duration).toBeLessThan(1.3);
  expect(result.hasAudio).toBe(true);
  await withVideoFiles(files, [result.fileId], async ([path]) => expect((await probeVideo(path, signal())).width).toBe(854));
  await expect(composeVideo(files, [{ fileId: video.id, start: 0, end: 10 }], '16:9', signal())).rejects.toThrow('实际时长');
}, 30_000);

it('keeps every second of long shots across sheets with stable shot numbers and frame indices', async () => {
  const path = join(directory, 'long-shots.mp4');
  await videoCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=5:d=13.2', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=5:d=2.2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], signal());
  const video = await files.put(await readFile(path), 'video/mp4', '长镜头.mp4');
  const prepared = await prepareVideo(files, video.id, signal(), () => {});
  expect(prepared.segments).toHaveLength(2);
  expect(prepared.segments.flatMap(segment => segment.frames.map(frame => frame.time))).toEqual(Array.from({ length: 16 }, (_, second) => second));
  const sheets = await analysisFrameSheets(files, prepared.segments, signal());
  expect(sheets.map(sheet => sheet.frames.length)).toEqual([12, 4]);
  expect(sheets[1].frames.map(frame => frame.label)).toEqual(['S1-F12', 'S1-F13', 'S2-F0', 'S2-F1']);
  expect(sheets.flatMap(sheet => sheet.frames.map(frame => [frame.segmentId, frame.frameIndex, frame.time]))).toEqual(
    prepared.segments.flatMap(segment => segment.frames.map((frame, index) => [segment.id, index, frame.time])));
}, 30_000);

it('adds an in-shot reference when a low-frame-rate short shot falls between second samples', async () => {
  const path = join(directory, 'short-shots.mp4');
  await videoCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=5:d=0.4', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=5:d=0.2',
    '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=5:d=0.6', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], signal());
  const video = await files.put(await readFile(path), 'video/mp4', '短镜头.mp4');
  const prepared = await prepareVideo(files, video.id, signal(), () => {});
  expect(prepared.segments).toHaveLength(3);
  for (const segment of prepared.segments) {
    expect(segment.frames.length).toBeGreaterThan(0);
    for (const frame of segment.frames) {
      expect(frame.time).toBeGreaterThanOrEqual(segment.start);
      expect(frame.time).toBeLessThan(segment.end);
    }
  }
  expect(prepared.segments[1].frames[0].time).toBeCloseTo(0.4, 3);
}, 30_000);

it('batch extraction preserves order and shared-frame timestamps, and rejects missing or cancelled samples', async () => {
  await fixture();
  const frames = await extractVideoFrames(join(directory, 'source.mp4'), directory, [0.7, 0.01, 0.02, 0.7], signal());
  expect(frames[0]).toEqual(frames[3]);
  expect(frames[1]).toEqual(frames[2]);
  expect(frames[0].time).toBeGreaterThanOrEqual(0.7);
  expect(frames[1].time).toBeCloseTo(1 / 24, 5);
  await expect(extractVideoFrames(join(directory, 'source.mp4'), directory, [10], signal())).rejects.toThrow('无法提取');
  await expect(extractVideoFrames(join(directory, 'source.mp4'), directory, [NaN], signal())).rejects.toThrow('非负');
  await expect(extractVideoFrames(join(directory, 'source.mp4'), directory, [0], AbortSignal.abort())).rejects.toThrow();
  await expect(createFrameSheet([], signal())).rejects.toThrow('1–12');
  const image = await sharp({ create: { width: 90, height: 160, channels: 3, background: 'red' } }).png().toBuffer();
  const sheet = await createFrameSheet([{ image, segmentId: 'portrait', frameIndex: 0, time: 0 }], signal());
  expect((await sharp(sheet.bytes).metadata()).width).toBe(270);
  expect(sheet.frames[0]).toMatchObject({ row: 0, column: 0, label: 'S1-F0' });
});

it('keeps script projects compatible and rejects invalid source intervals and foreign asset links atomically', async () => {
  expect(studio.snapshot().projects[0].creationMode).toBe('script');
  const source = await projectWithSource(), frame = source.segments[0].frames[0];
  expect(() => studio.apply('invalid-time', [{ resource: 'shots', id: 'shot', op: 'create', values: { episodeId: 'episode', sceneId: 'scene', source: { fileId: source.fileId, start: 2, end: 1, frames: [frame] } } }])).toThrow('原片来源区间无效');
  expect(studio.snapshot().shots).toHaveLength(0);
  expect(() => studio.apply('invalid-link', [{ resource: 'shots', id: 'shot', op: 'create', values: { episodeId: 'episode', sceneId: 'scene', assetIds: ['missing'] } }])).toThrow('引用的 assets');
});

it('updates source cuts, splits without duplicating dialogue, merges while keeping the left ID, and blocks stale versions', async () => {
  const source = await projectWithSource(), segment = source.segments[0];
  studio.apply('shot', [{ resource: 'shots', id: segment.id, op: 'create', values: { episodeId: 'episode', sceneId: 'scene', duration: segment.end - segment.start,
    dialogue: [{ id: 'line', type: '旁白', text: '目标对白' }], source: { fileId: source.fileId, start: segment.start, end: segment.end, frames: segment.frames } } }]);
  const shot = studio.snapshot().shots[0];
  await service.edit({ projectId, action: 'edit-shot', shotId: shot.id, shotVersion: shot._version, start: segment.start, end: segment.end, split: 0.3 });
  let shots = studio.snapshot().shots;
  expect(shots).toHaveLength(2);
  expect(shots[0].id).toBe(shot.id);
  expect(shots[1].dialogue).toEqual([]);
  await expect(service.edit({ projectId, action: 'edit-shot', shotId: shot.id, shotVersion: shot._version, start: 0, end: 0.3 })).rejects.toThrow('镜头已修改');
  await service.edit({ projectId, action: 'merge-shots', fromId: shots[0].id, fromVersion: shots[0]._version, toId: shots[1].id, toVersion: shots[1]._version });
  shots = studio.snapshot().shots;
  expect(shots).toHaveLength(1); expect(shots[0].id).toBe(shot.id);
  expect((studio.snapshot().projects[0].sourceVideo as { segments: SourceSegment[] }).segments).toHaveLength(2);
  expect(files.references(segment.frames[0].fileId)).toBe(true);
});

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

it('isolates shot IDs when two regional projects share the same prepared source segments', async () => {
  const source = await projectWithSource(), firstProject = projectId;
  const secondProject = String(studio.projects.create({ name: '同原片另一地区', description: null, aspect_ratio: '16:9', style_catalog_id: 4 }).project_id);
  const second = studio.snapshot().projects.find(item => item.id === secondProject)!;
  studio.apply('second-project', [
    { resource: 'projects', id: secondProject, op: 'update', version: second._version, values: { creationMode: 'video-redraw', targetRegion: 'western', targetLanguage: 'en', sourceVideo: source } },
    { resource: 'episodes', id: 'episode-2', op: 'create', values: { projectId: secondProject, scenes: [] } },
  ]);
  const seed = (id: string) => {
    const state = studio.snapshot(), project = state.projects.find(item => item.id === id)!;
    const draft = { assets: [{ key: 'scene', type: '场景', name: '原色卡', description: '实际视频色卡', targetName: '目标色卡', targetDescription: '色卡', targetAppearance: '红蓝两种实际颜色', targetCostume: '', targetVoiceDescription: '', targetPrompt: '单独呈现色卡，不加人物', evidenceSegmentId: source.segments[0].id, frameIndex: 0 }],
      shots: source.segments.map(segment => ({ segmentId: segment.id, sceneKey: 'scene', assetKeys: ['scene'], targetDialogue: [], description: '实际编码的色卡', dialogue: '', scale: '全景', camera: '固定', transition: '硬切', effects: '', targetDescription: '保留色卡', notes: '' })) };
    const job = { id: `analysis-${id}`, projectId: id, projectVersion: project._version, kind: 'analyze', status: 'completed', phase: '完成', input: {}, fingerprint: '', createdAt: new Date().toISOString(),
      segments: source.segments, draft, versions: Object.fromEntries(state.episodes.map(item => [`episodes:${item.id}`, item._version])) };
    studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, id, JSON.stringify(job));
    return job.id;
  };
  await service.edit({ projectId: firstProject, action: 'apply', jobId: seed(firstProject) });
  expect(studio.snapshot().assets.find(asset => asset.projectId === firstProject)).toMatchObject({ appearance: '红蓝两种实际颜色', costume: '', voiceDescription: '', prompt: '单独呈现色卡，不加人物' });
  const before = studio.snapshot().shots.filter(shot => shot.episodeId === 'episode');
  await service.edit({ projectId: secondProject, action: 'apply', jobId: seed(secondProject) });
  const after = studio.snapshot();
  expect(after.shots.filter(shot => shot.episodeId === 'episode')).toEqual(before);
  expect(after.shots.filter(shot => shot.episodeId === 'episode-2')).toHaveLength(source.segments.length);
  expect(new Set(after.shots.map(shot => shot.id)).size).toBe(source.segments.length * 2);
});

it('recovers acknowledged running tasks as interrupted and reuses request IDs without starting duplicate work', async () => {
  const source = await projectWithSource(), project = studio.snapshot().projects[0];
  // A real queued export fails validation on missing clips; its persisted receipt must still be idempotent.
  const request = { projectId, action: 'export', requestId: 'export-idempotent', version: project._version, selections: [{ clipId: 'missing' }] };
  const first = await service.edit(request);
  expect((await service.edit(request) as { id: string }).id).toBe((first as { id: string }).id);
  await expect(service.edit({ ...request, selections: [] })).rejects.toThrow('不同请求');
  const interrupted = { ...(first as object), id: 'interrupted', status: 'running', projectId, result: undefined, segments: source.segments };
  studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run('interrupted', projectId, JSON.stringify(interrupted));
  const restored = new VideoRedraw(studio, { model: () => { throw new Error(); }, instructions: async () => '', transcribe: async () => { throw new Error(); } });
  expect(restored.jobs(projectId).find(job => job.id === 'interrupted')?.status).toBe('interrupted');
  restored.dispose();
});

it('keeps each episode source separate and reuses project assets when applying a second episode', async () => {
  const source = await projectWithSource();
  studio.apply('second-episode', [{ resource: 'episodes', id: 'episode-two', op: 'create', values: { projectId, number: 2, sourceVideo: source, scenes: [] } }]);
  const seed = (episodeId: string, id: string) => {
    const state = studio.snapshot(), project = state.projects.find(item => item.id === projectId)!;
    const draft = { assets: [{ key: 'scene', type: '场景', name: '色卡', description: '色卡', targetName: '共享场景', targetDescription: '场景', evidenceSegmentId: source.segments[0].id, frameIndex: 0 }],
      shots: source.segments.map(segment => ({ segmentId: segment.id, sceneKey: 'scene', assetKeys: ['scene'], targetDialogue: [], description: '画面', dialogue: '', scale: '全景', camera: '固定', transition: '硬切', effects: '', targetDescription: '画面', notes: '' })) };
    const job = { id, projectId, episodeId, sourceFileId: source.fileId, projectVersion: project._version, kind: 'analyze', status: 'completed', phase: '完成', input: {}, fingerprint: '', createdAt: new Date().toISOString(), segments: source.segments, draft, versions: Object.fromEntries(state.episodes.map(item => [`episodes:${item.id}`, item._version])) };
    studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(id, projectId, JSON.stringify(job));
  };
  seed('episode', 'episode-one-analysis');
  await service.edit({ projectId, episodeId: 'episode', action: 'apply', jobId: 'episode-one-analysis' });
  seed('episode-two', 'episode-two-analysis');
  await service.edit({ projectId, episodeId: 'episode-two', action: 'apply', jobId: 'episode-two-analysis' });
  const state = studio.snapshot();
  expect(state.assets).toHaveLength(1);
  expect(state.assets[0].episodeIds).toEqual(['episode', 'episode-two']);
  expect(state.shots.filter(shot => shot.episodeId === 'episode-two')).toHaveLength(source.segments.length);
  expect(new Set(state.shots.map(shot => shot.id)).size).toBe(source.segments.length * 2);
  expect((service.read({ projectId, episodeId: 'episode-two' }) as { jobs: Array<{ id: string }> }).jobs.map(job => job.id)).toEqual(['episode-two-analysis']);
  await expect(service.edit({ projectId, episodeId: 'episode', action: 'apply', jobId: 'episode-two-analysis' })).rejects.toThrow();
});
