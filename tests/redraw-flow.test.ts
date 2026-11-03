// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { VideoRedraw } from '../examples/agent-chat/server/video-redraw';
import { contextSummary, redrawFlow } from '../examples/agent-chat/client/studio/redraw-flow';
import { scriptFlow } from '../examples/agent-chat/client/studio/script-flow';

const data = (episode: Record<string, unknown> = {}) => ({
  projects: [{ id: 'p', creationMode: 'video-redraw', sourceVideo: { fileId: 'f1', name: 'a.mp4', duration: 12.34, width: 1920, height: 1080, segments: [{}, {}] } }],
  episodes: [{ id: 'e1', projectId: 'p', number: 1, stage: 4, script: '第一场', scenes: [{ id: 's1', content: '正文' }, { id: 's2', content: '' }], ...episode }],
  shots: [{ id: 'sh2', episodeId: 'e1', duration: 3.5, dialogue: [], _position: 1 }, { id: 'sh1', episodeId: 'e1', duration: 2, dialogue: [{}], _position: 0 }],
  assets: [{ id: 'a1', projectId: 'p', type: '角色', image: '/x.png', variants: [{ id: 'v1', image: '' }] }, { id: 'a2', projectId: 'p', type: '场景', image: '', variants: [] }],
  clips: [{ id: 'c1', episodeId: 'e1', duration: 5, videos: ['/v.mp4'], currentVideo: '/v.mp4' }, { id: 'c2', episodeId: 'e1', duration: 5, videos: [], currentVideo: '' }],
  films: [],
});
const jobs = [
  { id: 'j-assets', kind: 'extract-assets', status: 'running', phase: '整理页面字段', sourceFileId: 'f1' },
  { id: 'j-script', kind: 'write-script', status: 'completed', sourceFileId: 'f1' },
  { id: 'j-analyze-2', kind: 'analyze', status: 'failed', error: '接口超时', failureStage: '原始分析', sourceFileId: 'f1' },
  { id: 'j-analyze', kind: 'analyze', status: 'completed', sourceFileId: 'f1' },
  { id: 'old-prompts', kind: 'video-prompts', status: 'completed', sourceFileId: 'replaced-source' },
];
const mediaJobs = [
  { type: 'image', status: 'running', options: { studioTarget: { resource: 'assets', id: 'a2' } } },
  { type: 'video', status: 'completed', options: { studioTarget: { resource: 'clips', id: 'c1' } } },
];
const details = { 'j-script': { handoff: [{ kind: 'analyze', jobId: 'j-analyze' }] }, 'j-assets': { handoff: [{ kind: 'analyze', jobId: 'j-analyze' }, { kind: 'write-script', jobId: 'j-script' }] } };
const node = (flow: ReturnType<typeof redrawFlow>, id: string) => flow.nodes.find(item => item.id === id)!;

it('shows script project stages and their actual jobs without adding redraw reports', () => {
  const current = data();
  Object.assign(current.projects[0], { creationMode: 'script', outline: { premise: '故事' } });
  Object.assign(current.clips[0], { prompt: '视频描述', mode: '分镜图', storyboardPrompt: '分镜描述', image: '/story.png' });
  const flow = scriptFlow({ data: current, jobs: [{ id: 'script-job', kind: 'script-storyboard', status: 'running', phase: '编写分镜' }], projectId: 'p', episodeId: 'e1' });
  expect(flow.nodes.map(item => item.id)).toEqual(['outline', 'novel-script', 'script-assets', 'asset-images', 'script-storyboard', 'storyboard-images', 'video-generation', 'film']);
  expect(flow.nodes.find(item => item.id === 'script-storyboard')).toMatchObject({ jobId: 'script-job', status: 'running', output: ['片段 2 个', '视频提示词 1/2'] });
  expect(flow.edges.some(edge => edge.id === 'script-storyboard->video-generation')).toBe(true);
  expect(flow.edges.some(edge => edge.type === 'report')).toBe(false);
  expect(flow.nodes.find(item => item.id === 'script-assets')?.input).toContain('已选视觉风格或可用风格目录');
  expect(flow.nodes.find(item => item.id === 'script-assets')?.output).toContain('视觉风格待美术资产 Agent 确定');
  Object.assign(current.projects[0], { style_catalog_id: 4 });
  const styled = scriptFlow({ data: current, projectId: 'p', episodeId: 'e1' });
  expect(styled.nodes.find(item => item.id === 'script-assets')?.output).toContain('已确定项目视觉风格');
});

it('shows the project outline task before any episodes exist', () => {
  const current = data();
  Object.assign(current.projects[0], { creationMode: 'script', outline: { core: '开端' } });
  current.episodes = [];
  const flow = scriptFlow({ data: current, jobs: [{ id: 'outline-job', kind: 'novel-outline', status: 'running', phase: '根据小说编写大纲' }], projectId: 'p' });
  expect(flow.nodes.find(item => item.id === 'outline')).toMatchObject({ kind: 'agent', jobId: 'outline-job', status: 'running' });
  expect(flow.nodes.find(item => item.id === 'novel-script')?.status).toBe('idle');
});

it('does not mark copied source text as an analyzed outline without a job', () => {
  const current = data();
  Object.assign(current.projects[0], { creationMode: 'script', sourceScript: '原始素材', outline: { core: '原始素材', story: '' } });
  current.episodes = [];
  const flow = scriptFlow({ data: current, jobs: [], projectId: 'p' });
  expect(flow.nodes.find(item => item.id === 'outline')).toMatchObject({ status: 'idle', output: ['尚未保存大纲'] });
});

it('derives every node status and its input/output summary from real records and jobs', () => {
  const flow = redrawFlow({ data: data(), jobs, mediaJobs, details, projectId: 'p', episodeId: 'e1' });
  // The source video is the analysis input; the latest run decides the status even when an earlier run completed.
  expect(node(flow, 'analyze')).toMatchObject({ status: 'failed', jobId: 'j-analyze-2', error: '接口超时', failureStage: '原始分析', input: ['原片 12.3 秒 · 1920×1080', '候选切镜 2 段'], output: ['镜头 2 条 · 场次 2 个'] });
  expect(node(flow, 'analyze').runs.map((run: { id: string }) => run.id)).toEqual(['j-analyze-2', 'j-analyze']);
  expect(node(flow, 'shots')).toMatchObject({ status: 'done', output: ['镜头 2 条 · 台词 1 句', '目标时长 5.5 秒'] });
  expect(node(flow, 'write-script')).toMatchObject({ status: 'done', output: ['剧本 3 字', '场次正文 1/2'] });
  expect(node(flow, 'write-script').input).toContain('目标时长未设置');
  expect(node(redrawFlow({ data: data({ duration: 194 }), jobs, mediaJobs, details, projectId: 'p', episodeId: 'e1' }), 'write-script').input).toContain('目标时长 194 秒');
  expect(node(flow, 'extract-assets')).toMatchObject({ status: 'running', phase: '整理页面字段', output: ['资产 2 项', '角色 1 · 场景 1 · 道具 0', '资产设定与生图提示词'] });
  expect(node(flow, 'extract-assets').input).toContain('目标时长未设置');
  expect(node(flow, 'asset-images')).toMatchObject({ status: 'running', output: ['已出图 1/3（不含仅声音角色）'] });
  // Jobs for a replaced source are ignored; clips written without a job still count as produced.
  expect(node(flow, 'video-prompts')).toMatchObject({ status: 'idle', runs: [], output: ['视频提示词 0/2'] });
  expect(node(flow, 'video-prompts').input).toContain('上游报告、视频模型、生成方式与要求');
  expect(node(flow, 'video-generation')).toMatchObject({ status: 'partial', output: ['已生成 1/2', '已选用 1'] });
  expect(node(flow, 'film')).toMatchObject({ status: 'idle', output: ['成片 0 个'] });
  expect(flow.shots.map((shot: { id: string }) => shot.id)).toEqual(['sh1', 'sh2']);
  expect(flow.edges.find(edge => edge.id === 'video-generation->film')?.data.active).toBe(true);
  expect(flow.edges.find(edge => edge.id === 'video-prompts->video-generation')?.data.active).toBe(false);
  expect(flow.edges.filter(edge => edge.type === 'report').map(edge => [edge.id, edge.data.stale])).toEqual([
    ['report:analyze->write-script', false], ['report:analyze->extract-assets', false], ['report:write-script->extract-assets', false],
  ]);
});

it('marks a handoff stale once the upstream completes a newer run', () => {
  const rerun = [{ id: 'j-analyze-3', kind: 'analyze', status: 'completed', sourceFileId: 'f1' }, ...jobs];
  const flow = redrawFlow({ data: data(), jobs: rerun, mediaJobs, details, projectId: 'p', episodeId: 'e1' });
  expect(flow.edges.filter(edge => edge.type === 'report').map(edge => [edge.id, edge.data.stale])).toEqual([
    ['report:analyze->write-script', true], ['report:analyze->extract-assets', true], ['report:write-script->extract-assets', false],
  ]);
});

it('shows storyboard image inputs and selected images separately from video generation', () => {
  const current = data();
  Object.assign(current.clips[0], { mode: '分镜图', storyboardPrompt: '四宫格', image: '/storyboard.png' });
  Object.assign(current.clips[1], { mode: '分镜图', storyboardPrompt: '四宫格' });
  const flow = redrawFlow({ data: current, jobs, mediaJobs, projectId: 'p', episodeId: 'e1' });
  expect(node(flow, 'storyboard-images')).toMatchObject({ status: 'partial', input: ['分镜提示词', '资产图片与其他参考图'], output: ['已选分镜图 1/2'] });
  expect(node(flow, 'storyboard-prompts')).toMatchObject({ status: 'done', output: ['片段 2 个', '分镜提示词 2/2'] });
  expect(node(flow, 'video-prompts').status).toBe('idle');
  expect(flow.edges.find(edge => edge.id === 'storyboard-prompts->storyboard-images')?.data.active).toBe(true);
  expect(flow.edges.find(edge => edge.id === 'storyboard-images->video-prompts')).toBeUndefined();
  expect(flow.edges.some(edge => edge.id === 'video-prompts->storyboard-prompts')).toBe(true);
  expect(flow.edges.find(edge => edge.id === 'storyboard-images->video-generation')?.data.active).toBe(true);
});

it('preserves a failed latest extraction while showing that all existing asset images are ready', () => {
  const current = data();
  current.assets[0].variants[0].image = '/variant.png';
  current.assets[1].image = '/scene.png';
  const failed = [{ id: 'failed', kind: 'extract-assets', status: 'failed', error: '保存失败', sourceFileId: 'f1' }];
  const flow = redrawFlow({ data: current, jobs: failed, projectId: 'p', episodeId: 'e1' });
  expect(node(flow, 'extract-assets')).toMatchObject({ status: 'done', note: '资产图片已齐；最近一次提取失败', jobId: 'failed', error: '保存失败' });
  expect(node(flow, 'asset-images').status).toBe('done');
  expect(flow.edges.filter(edge => edge.target === 'video-prompts' && edge.type === 'data').map(edge => edge.source)).toEqual(expect.arrayContaining(['analyze', 'shots', 'write-script', 'extract-assets']));
});

it('keeps shot review waiting until it is confirmed and reports missing projects as empty', () => {
  const waiting = redrawFlow({ data: data({ stage: 1, script: '', scenes: [] }), jobs: [], projectId: 'p', episodeId: 'e1' });
  expect(node(waiting, 'shots').status).toBe('waiting');
  expect(node(waiting, 'write-script').status).toBe('idle');
  expect(waiting.edges.find(edge => edge.id === 'write-script->extract-assets')?.data.active).toBe(false);
  expect(redrawFlow({ data: data(), projectId: 'missing', episodeId: 'e1' }).nodes).toEqual([]);
  expect([contextSummary([1, 2]), contextSummary({ a: 1 }), contextSummary(''), contextSummary('剧本'), contextSummary(3)]).toEqual(['2 项', '1 个字段', '空', '2 字', '3']);
});

it('returns the execution input only when the page asks for it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'redraw-flow-test-'));
  const storage = new LocalStorage(directory);
  const files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projects.create({ name: '流程视图', description: null, aspect_ratio: '16:9', style_catalog_id: 4 });
  const studio = new StudioStore(projects);
  const service = new VideoRedraw(studio, { model: () => { throw new Error('本测试不调用外部模型'); }, instructions: async () => '' });
  try {
    const file = await files.put(Buffer.from('video reference'), 'video/mp4', 'source.mp4');
    const project = studio.snapshot().projects[0];
    studio.apply('flow-setup', [
      { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { creationMode: 'video-redraw', sourceVideo: { fileId: file.id, duration: 3 } } },
      { resource: 'episodes', id: 'episode', op: 'create', values: { projectId: project.id, title: '第1集' } },
    ]);
    const context = { requirements: '保留原片节奏', shots: [{ id: 'shot', description: '推门' }] };
    const job = { id: 'script-job', projectId: project.id, episodeId: 'episode', sourceFileId: file.id, kind: 'write-script', status: 'completed', phase: '完成', createdAt: new Date().toISOString(), input: {}, fingerprint: '', projectVersion: 1, versions: {}, segments: [], draft: { assets: [], shots: [] },
      workflow: { config: { kind: 'write-script', model: 'text', formatterModel: 'formatter', instructions: '按镜头写剧本', skillIds: ['skill'], toolNames: ['builtin_read_studio'] }, skills: [{ id: 'skill', name: '剧本 Skill', instructions: '不应返回的完整 Skill 正文' }], steps: [], context, handoff: [{ kind: 'analyze', jobId: 'analysis', createdAt: '2026-10-31T00:00:00.000Z' }], outputs: [{ output_type: 'raw', content: '完整报告' }] } };
    studio.projects.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id, project.id, JSON.stringify(job));
    expect(service.read({ projectId: project.id, episodeId: 'episode', jobId: job.id })).not.toHaveProperty('executionInput');
    expect(service.read({ projectId: project.id, episodeId: 'episode', jobId: job.id, includeInput: true })).toMatchObject({
      handoff: job.workflow.handoff, outputs: job.workflow.outputs,
      executionInput: { context, instructions: '按镜头写剧本', skills: [{ id: 'skill', name: '剧本 Skill' }], tools: ['builtin_read_studio'] },
    });
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

it('shows running feedback while using the latest applied result as the upstream report', () => {
  const revised = [
    { id: 'pending-feedback', kind: 'revise-cuts', status: 'running', applied: false, sourceFileId: 'f1' },
    { id: 'applied-feedback', kind: 'revise-cuts', status: 'completed', applied: true, sourceFileId: 'f1' },
    ...jobs,
  ];
  const flow = redrawFlow({ data: data(), jobs: revised, mediaJobs, details, projectId: 'p', episodeId: 'e1' });
  expect(node(flow, 'analyze')).toMatchObject({ jobId: 'pending-feedback', status: 'running' });
  expect(node(flow, 'shots').input).toContain('向原片分析 Agent 反馈并直接应用');
  expect(node(flow, 'write-script').input).toContain('向剧本 Agent 反馈并直接应用');
  expect(flow.edges.find(edge => edge.id === 'report:analyze->write-script')?.data.stale).toBe(true);
  const restored = revised.map(job => job.id === 'applied-feedback' ? { ...job, restored: true } : job).filter(job => job.id !== 'pending-feedback');
  const afterUndo = redrawFlow({ data: data(), jobs: restored, mediaJobs, details, projectId: 'p', episodeId: 'e1' });
  expect(node(afterUndo, 'analyze').runs.some((job: { id: string }) => job.id === 'applied-feedback')).toBe(false);
  expect(afterUndo.edges.find(edge => edge.id === 'report:analyze->write-script')?.data.stale).toBe(false);
});
