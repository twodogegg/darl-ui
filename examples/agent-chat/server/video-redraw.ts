import { sendRevalidatedJson } from './http-cache';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentModelConfig } from '../../../src/index';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioStore, StudioConflict } from './studio';
import { generate, safeError, type StoredProvider } from './models';
import { Output } from 'ai';
import { AgentFailure } from './errors';
import type { TimedTranscript } from './voice';
import { REDRAW_LIMITS, composeVideo, detectVideoCuts, videoCommand, withVideoFiles, type SourceSegment } from './video-processing';
import { isLocalOrLanAddress } from './local-access';
import { saveRedrawStoryboard } from './redraw-storyboard';
import { saveExtractedAssets } from './redraw-asset-extraction';
import { saveRedrawVideoPrompts } from './redraw-video-prompts';
import { defaultWorkflowAgents, workflowContracts, type WorkflowAgent, type WorkflowKind } from './workflow-agents';
import { runTextWorkflow, runVideoWorkflow, workflowExecution, workflowInstructions, type WorkflowDependencies, type WorkflowStep } from './workflow-runtime';
import type { AgentSkill } from '../../../src/components/agent-sidebar/types';
import { mentionedAssets } from '../asset-mentions.js';

type DraftAsset = { key: string; type: string; name: string; description: string; targetName: string; targetDescription: string; targetAppearance?: string; targetCostume?: string; targetVoiceDescription?: string; targetPrompt?: string; evidenceSegmentId: string; frameIndex: number };
type DraftShot = { segmentId: string; sceneKey: string; description: string; dialogue: string; scale: string; camera: string; transition: string; effects: string; assetKeys: string[]; targetDescription: string; targetDuration?: number; targetDialogue: Array<{ assetKey: string; text: string; description: string }>; notes: string };
export type RedrawDraft = { assets: DraftAsset[]; shots: DraftShot[] };
type WorkflowRun = { config: WorkflowAgent; skills: AgentSkill[]; steps: WorkflowStep[]; context?: unknown; outputs: Array<{ output_type: 'raw' | 'structured'; content: string; incomplete?: boolean }> };
type Job = { id: string; projectId: string; episodeId?: string; sourceFileId?: string; kind: 'prepare' | 'breakdown' | 'transcribe' | 'analyze' | 'revise-storyboard' | 'extract-assets' | 'video-prompts' | 'export'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; createdAt: string; error?: string; input: Record<string, unknown>; fingerprint: string; workflow?: WorkflowRun;
  versions: Record<string, number>; projectVersion: number; draft: RedrawDraft; segments: SourceSegment[]; transcript?: TimedTranscript; result?: Record<string, unknown>; applied?: string[] };
type Dependencies = WorkflowDependencies & {
  model?: (modelId: string) => { provider: StoredProvider; model: AgentModelConfig };
  videoDurations?: () => { modelId: string; seconds: number[] };
  instructions?: (agentId: string) => Promise<string>;
  analysisCredentials?: () => { baseUrl: string; apiKey: string; videoUrlFormat?: string } | undefined;
  transcribe?: (bytes: Buffer, language: string, signal: AbortSignal) => Promise<TimedTranscript>;
  workflowAgent?: (kind: WorkflowKind) => WorkflowAgent;
  workflowSkills?: (ids: string[]) => AgentSkill[];
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];
const text = (value: unknown, label: string) => { if (typeof value !== 'string' || value.length > 16_000) throw new Error(`${label} 须为文本且不超过16000字`); return value; };
const recordKey = (resource: string, id: string) => `${resource}:${id}`;
type RevisionValues = { description?: string; scale?: string; effects?: string; sourceDescription?: string; sourceDialogue?: string; dialogue?: Array<{ id?: string; type: string; assetId?: string; speaker?: string; text: string; description?: string }> };
type Revision = { changes: Array<{ shotId: string; reason: string; values: RevisionValues }>; notes: string };
export function validateRevision(value: unknown, shots: StudioRecord[]): Revision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('调整结果无效');
  const revision = value as Revision;
  if (!Array.isArray(revision.changes) || revision.changes.length > shots.length || typeof revision.notes !== 'string' || revision.notes.length > 16000) throw new Error('调整建议列表无效');
  const seen = new Set<string>();
  for (const change of revision.changes) {
    if (!change || typeof change.shotId !== 'string' || !shots.some(shot => shot.id === change.shotId) || seen.has(change.shotId) || typeof change.reason !== 'string' || !change.values || typeof change.values !== 'object' || Array.isArray(change.values)) throw new Error('调整建议引用的镜头无效或重复');
    seen.add(change.shotId);
    const entries = Object.entries(change.values);
    if (!entries.length || entries.some(([key, item]) => key === 'dialogue' ? !Array.isArray(item) || item.length > 100 || item.some(line => !line || typeof line !== 'object' || !['角色', '旁白'].includes(line.type) || typeof line.text !== 'string' || (line.id !== undefined && typeof line.id !== 'string') || (line.assetId !== undefined && typeof line.assetId !== 'string') || (line.speaker !== undefined && typeof line.speaker !== 'string') || (line.description !== undefined && typeof line.description !== 'string')) : !['description', 'scale', 'effects', 'sourceDescription', 'sourceDialogue'].includes(key) || typeof item !== 'string' || item.length > 16000)) throw new Error('调整建议包含不支持的字段或无效内容');
  }
  return revision;
}

/** Accept the shapes models actually emit: fenced blocks, leading commentary, trailing prose. */
export function parseModelJson(source: string) {
  const trimmed = source.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try { return JSON.parse(candidate) as unknown; }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentFailure('model', 'REDRAW_ANALYSIS_JSON_INVALID', '模型返回的分镜结果不是有效 JSON，本批未采用。', true,
      '重新点击“生成改编策略”或继续分析会从当前批次重试；若反复出现，请更换视觉分析模型。', { cause: new Error(`${detail}\n输出片段：${candidate.slice(0, 500)}`) });
  }
}

function workflowFailureStage(job: Job) {
  if (!job.workflow || !['failed', 'cancelled', 'interrupted'].includes(job.status)) return undefined;
  if (job.phase.includes('校验并保存')) return '校验与保存';
  if (job.phase === '整理页面字段') {
    const structured = job.workflow.outputs.find(output => output.output_type === 'structured')?.content;
    if (structured) { try { parseModelJson(structured); return '校验与保存'; } catch { /* 无效 JSON 属于整理阶段 */ } }
  }
  return job.phase.includes('整理') ? '页面字段整理' : '原始分析';
}

export function validateRedrawDraft(value: unknown, segments: SourceSegment[], existing: StudioRecord[]): RedrawDraft {
  if (!value || typeof value !== 'object') throw new Error('分析结果不是对象');
  const draft = value as RedrawDraft;
  if (!Array.isArray(draft.assets) || !Array.isArray(draft.shots) || draft.assets.length > 160 || draft.shots.length !== segments.length) throw new Error('分析结果资产或镜头数量无效');
  const keys = new Map(existing.map(asset => [asset.id, String(asset.type)]));
  const newKeys = new Set<string>();
  for (const asset of draft.assets) {
    if (!asset || typeof asset.key !== 'string' || !/^[\w:.-]{1,160}$/.test(asset.key) || newKeys.has(asset.key) || !['角色', '场景', '道具'].includes(asset.type)) throw new Error('资产 key、类型或重复主体无效');
    if (keys.has(asset.key) && keys.get(asset.key) !== asset.type) throw new Error('已有资产类型不能改变');
    for (const field of ['name', 'description', 'targetName', 'targetDescription'] as const) text(asset[field], field);
    for (const field of ['targetAppearance', 'targetCostume', 'targetVoiceDescription', 'targetPrompt'] as const) if (asset[field] !== undefined) text(asset[field], field);
    if (!asset.name.trim() || !asset.targetName.trim() || !Number.isInteger(asset.frameIndex) || asset.frameIndex < 0 || !segments.find(segment => segment.id === asset.evidenceSegmentId)?.frames[asset.frameIndex]) throw new Error('资产名称或来源证据无效');
    newKeys.add(asset.key); keys.set(asset.key, asset.type);
  }
  const shotIds = new Set<string>();
  for (const shot of draft.shots) {
    if (!shot || !segments.some(segment => segment.id === shot.segmentId) || shotIds.has(shot.segmentId) || keys.get(shot.sceneKey) !== '场景'
      || !Array.isArray(shot.assetKeys) || shot.assetKeys.some(key => !keys.has(key)) || !Array.isArray(shot.targetDialogue)) throw new Error('镜头来源、场景或资产关联无效');
    for (const field of ['description', 'dialogue', 'scale', 'camera', 'transition', 'effects', 'targetDescription', 'notes'] as const) text(shot[field], field);
    if (shot.targetDuration !== undefined && (!Number.isFinite(shot.targetDuration) || shot.targetDuration <= 0 || shot.targetDuration > 120)) throw new Error('目标表演预计时长无效');
    for (const line of shot.targetDialogue) {
      if (line.assetKey && keys.get(line.assetKey) !== '角色') throw new Error('目标对白必须引用真实角色');
      text(line.text, '目标对白'); text(line.description, '语气');
    }
    shotIds.add(shot.segmentId);
  }
  return draft;
}

export class VideoRedraw {
  private running = new Map<string, AbortController>();
  private waiters = new Map<string, Set<(job: Job) => void>>();
  private disposed = false;
  private get db() { return this.studio.projects.db; }
  private get files() { return this.studio.projects.files; }
  constructor(readonly studio: StudioStore, private dependencies: Dependencies) {
    this.db.exec('CREATE TABLE IF NOT EXISTS video_redraw_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL)');
    for (const job of this.jobs()) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.error = '服务已重启；已完成阶段保留，请手动继续，避免重复提交'; this.save(job); }
  }
  jobs(projectId?: string): Job[] {
    const rows = projectId ? this.db.prepare('SELECT data FROM video_redraw_jobs WHERE project_id=? ORDER BY rowid DESC').all(projectId) : this.db.prepare('SELECT data FROM video_redraw_jobs ORDER BY rowid DESC').all();
    return rows.map(row => JSON.parse(String(row.data)));
  }
  private save(job: Job) {
    this.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, job.projectId, JSON.stringify(job));
    if (!['queued', 'running'].includes(job.status)) for (const waiter of this.waiters.get(job.id) || []) waiter(job);
  }
  async wait(input: Record<string, unknown>, signal: AbortSignal) {
    const project = this.project(String(input.projectId || ''));
    const episode = this.episode(project, input.episodeId);
    const job = this.job(String(input.jobId || ''));
    if (job.projectId !== project.id || (job.episodeId || this.episode(project).id) !== episode.id) throw new Error('任务不属于当前剧集');
    if (!['analyze', 'revise-storyboard', 'extract-assets', 'video-prompts'].includes(job.kind)) throw new Error('该等待工具仅支持视频分析、分镜调整、资产提取和视频提示词任务');
    signal.throwIfAborted();
    const finished = !['queued', 'running'].includes(job.status) ? job : await new Promise<Job>((resolve, reject) => {
      const listeners = this.waiters.get(job.id) || new Set<(job: Job) => void>();
      const cleanup = () => { listeners.delete(done); if (!listeners.size) this.waiters.delete(job.id); signal.removeEventListener('abort', aborted); };
      const done = (value: Job) => { cleanup(); resolve(value); };
      const aborted = () => { cleanup(); reject(signal.reason || new Error('等待已取消')); };
      listeners.add(done); this.waiters.set(job.id, listeners);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    if (finished.status !== 'completed') return { jobId: finished.id, kind: finished.kind, status: finished.status, phase: finished.phase, error: finished.error };
    return { status: finished.status, ...this.read({ ...input, jobId: finished.id }) };
  }
  async clip(projectId: string, episodeId: string | undefined, shotId: string, signal: AbortSignal) {
    const project = this.project(projectId), episode = this.episode(project, episodeId);
    const source = this.source(project, episode);
    const shot = this.studio.snapshot().shots.find(item => item.id === shotId && item.episodeId === episode.id);
    const range = shot?.source as Record<string, unknown> | undefined;
    if (!range || range.fileId !== source.fileId || !Number.isFinite(range.start) || !Number.isFinite(range.end) || Number(range.start) < 0 || Number(range.end) <= Number(range.start) || Number(range.end) > Number(source.duration) + .05) throw new Error('原片镜头来源或时间无效');
    return withVideoFiles(this.files, [String(source.fileId)], async ([path], root) => {
      const output = join(root, 'clip.mp4');
      await videoCommand('ffmpeg', ['-y', '-ss', String(range.start), '-i', path, '-t', String(Number(range.end) - Number(range.start)), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output], signal);
      return readFile(output);
    });
  }
  private project(id: string) {
    const project = this.studio.snapshot().projects.find(item => item.id === id);
    if (!project || project.creationMode !== 'video-redraw') throw new Error('视频转绘项目不存在');
    return project;
  }
  private episode(project: StudioRecord, id?: unknown) {
    const episodes = this.studio.snapshot().episodes.filter(item => item.projectId === project.id);
    const episode = id ? episodes.find(item => item.id === id) : episodes[0];
    if (!episode) throw new Error('请选择属于当前项目的剧集');
    return episode;
  }
  private source(project: StudioRecord, episode: StudioRecord) {
    const first = this.episode(project);
    return (episode.sourceVideo || (episode.id === first.id ? project.sourceVideo : {}) || {}) as Record<string, unknown>;
  }
  private sourceChange(project: StudioRecord, episode: StudioRecord, sourceVideo: Record<string, unknown>): StudioChange {
    return episode.sourceVideo ? { resource: 'episodes', id: episode.id, op: 'update', version: episode._version, values: { sourceVideo } }
      : { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { sourceVideo } };
  }
  private job(id: string) { const job = this.jobs().find(job => job.id === id); if (!job) throw new Error('解析任务不存在'); return job; }
  describe() { return { limits: REDRAW_LIMITS, regions: { japan: 'ja', western: 'en' }, operations: REDRAW_TOOLS.map(tool => tool.parameters), supportsVideoReference: false }; }
  read(input: Record<string, unknown>) {
    if (input.describe === true) return this.describe();
    const projectId = String(input.projectId || ''), project = this.project(projectId), episode = this.episode(project, input.episodeId);
    if (input.jobId) {
      const job = this.job(String(input.jobId));
      if (job.projectId !== projectId || (job.episodeId || this.episode(project).id) !== episode.id) throw new Error('任务不属于当前剧集');
      if (job.workflow) {
        if (job.sourceFileId !== this.source(project, episode).fileId) throw new Error('原片已更换，该分析结果已过期');
        return { jobId: job.id, kind: job.kind, status: job.status, phase: job.phase, failureStage: workflowFailureStage(job), error: job.error, sourceFileId: job.sourceFileId, model: job.workflow.config.model, formatterModel: job.workflow.config.formatterModel, steps: job.workflow.steps, outputs: job.workflow.outputs, ...(job.result || {}) };
      }
      if (job.status !== 'completed') return { jobId: job.id, kind: job.kind, status: job.status, phase: job.phase, error: job.error };
      const offset = Number(input.cursor || 0), limit = Number(input.limit || 100);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('分页参数无效');
      if (['analyze', 'extract-assets', 'video-prompts'].includes(job.kind) && typeof job.result?.analysis === 'string') {
        if (job.sourceFileId !== this.source(project, episode).fileId) throw new Error('原片已更换，该分析结果已过期');
        return { jobId: job.id, kind: job.kind, sourceFileId: job.sourceFileId, ...job.result };
      }
      if (job.kind === 'transcribe' || (input.detail !== undefined && job.transcript)) {
        if (!job.transcript) throw new Error('该任务没有原声转写，请查询本集的 transcribe 任务');
        const { segments, speakerTurns = [], ...metadata } = job.transcript;
        const words = input.detail === 'words' || !speakerTurns.length;
        const items = words ? segments : speakerTurns;
        return { jobId: job.id, kind: job.kind, sourceFileId: job.sourceFileId, language: metadata.language, ...(offset === 0 ? { text: metadata.text } : {}), items: items.slice(offset, offset + limit), total: items.length, nextCursor: offset + limit < items.length ? String(offset + limit) : null, timing: words ? 'segments' : 'speaker_turns' };
      }
      if (input.detail !== undefined) throw new Error(`任务 ${job.id} 是 ${job.kind}，没有原声转写；请查询本集的 transcribe 任务`);
      if (job.kind === 'breakdown' && job.result) {
        const { shots, sheets, ...metadata } = job.result as { shots: unknown[]; sheets: unknown[]; [key: string]: unknown };
        return { jobId: job.id, kind: job.kind, ...metadata, items: shots.slice(offset, offset + limit), total: shots.length, nextCursor: offset + limit < shots.length ? String(offset + limit) : null, sheets };
      }
      if (job.kind === 'prepare' && job.result) {
        const { segments, ...metadata } = job.result as { segments: unknown[]; [key: string]: unknown };
        return { jobId: job.id, kind: job.kind, sourceFileId: job.sourceFileId, ...metadata, items: segments.slice(offset, offset + limit), total: segments.length, nextCursor: offset + limit < segments.length ? String(offset + limit) : null };
      }
      throw new Error(`任务 ${job.id} 是 ${job.kind}，没有可分页读取的切镜或转写结果`);
    }
    return { jobs: this.jobs(projectId).filter(job => (job.episodeId || this.episode(project).id) === episode.id).map(full => { const { transcript, workflow, result, ...job } = full; return { ...job, ...(workflow ? { hasWorkflow: true, failureStage: workflowFailureStage(full) } : job.kind !== 'analyze' ? { result } : {}), hasTranscript: !!transcript }; }), source: this.source(project, episode) };
  }
  async edit(input: Record<string, unknown>) {
    const allowed = new Set([...Object.keys(properties), 'action']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('转绘请求包含未知参数');
    const projectId = String(input.projectId || ''), project = this.project(projectId);
    const action = String(input.action), episode = this.episode(project, input.episodeId);
    if (input.requirements !== undefined && (!['extract-assets', 'video-prompts', 'revise-storyboard'].includes(action) || typeof input.requirements !== 'string' || input.requirements.length > 2000)) throw new Error('补充要求无效或超过 2000 字');
    if (input.mode !== undefined && (action !== 'video-prompts' || !['参考生成', '分镜图'].includes(String(input.mode)))) throw new Error('视频生成方式无效');
    if (action === 'cancel') {
      const job = this.job(String(input.jobId));
      if ((job.projectId !== projectId || (job.episodeId || this.episode(project).id) !== episode.id)) throw new Error('任务不属于当前剧集');
      if (['queued', 'running'].includes(job.status)) { job.status = 'cancelled'; this.running.get(job.id)?.abort(); this.save(job); }
      return { id: job.id, kind: job.kind, status: job.status, phase: job.phase };
    }
    if (action === 'apply') return this.apply(String(input.jobId), project, episode, asList<string>(input.shotIds));
    if (action === 'apply-revision') return this.applyRevision(String(input.jobId), project, episode);
    if (action === 'merge-assets') return this.mergeAssets(input, project);
    if (['prepare', 'breakdown', 'transcribe'].includes(action)) throw new Error('视频转绘已改用视频分析接口，不支持通过旧流程自动切镜或转写。请检查分析接口错误后重试。');
    if (!['analyze', 'revise-storyboard', 'extract-assets', 'video-prompts', 'retry-format', 'retry-save', 'export'].includes(action)) throw new Error('不支持的转绘操作');
    const requestId = String(input.requestId || '');
    if (!/^[\w-]{8,160}$/.test(requestId)) throw new Error('提交任务须提供唯一 requestId，原样重试沿用');
    const fingerprint = hash(input), prior = this.jobs().find(job => job.id === requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('同一 requestId 不能用于不同请求'); return { id: prior.id, kind: prior.kind, status: prior.status, phase: prior.phase, sourceFileId: prior.sourceFileId }; }
    if (this.jobs(projectId).some(job => ['running', 'queued'].includes(job.status))) throw new Error('本项目已有任务运行，请完成或取消后再提交');
    if (this.running.size >= 2) throw new Error('当前有两个转绘任务运行，请稍后提交');
    if (input.version !== project._version) throw new StudioConflict('项目设置已变化，请重新读取');
    const source = this.source(project, episode);
    if (!source.fileId) throw new Error('请先上传原视频');
    if (action === 'retry-format' || action === 'retry-save') {
      const original = this.job(String(input.jobId || ''));
      if (original.projectId !== projectId || original.episodeId !== episode.id || original.sourceFileId !== source.fileId || !['failed', 'interrupted', 'cancelled'].includes(original.status) || !original.workflow?.outputs.some(item => item.output_type === 'raw' && !item.incomplete)) throw new Error('该任务没有可重新整理的完整原始输出');
      if (action === 'retry-save' && !original.workflow.outputs.some(item => item.output_type === 'structured')) throw new Error('该任务没有可重新写入的整理结果');
      const job: Job = { ...structuredClone(original), id: requestId, status: 'queued', phase: '排队', createdAt: new Date().toISOString(), error: undefined, fingerprint, input: { ...original.input, retryFormat: action === 'retry-format', retrySave: action === 'retry-save' }, workflow: { ...structuredClone(original.workflow), outputs: original.workflow.outputs.filter(item => action === 'retry-save' || item.output_type === 'raw'), steps: [...original.workflow.steps] } };
      if (action === 'retry-format') job.workflow!.config.formatterModel = this.dependencies.workflowAgent?.(original.workflow.config.kind).formatterModel || original.workflow.config.formatterModel;
      this.save(job);
      const controller = new AbortController(); this.running.set(job.id, controller);
      void this.run(job, controller).finally(() => this.running.delete(job.id));
      return { id: job.id, kind: job.kind, status: job.status, phase: job.phase };
    }
    if (action === 'analyze' && this.studio.snapshot().shots.some(shot => shot.episodeId === episode.id)) throw new Error('本集已有分镜，请直接编辑，避免覆盖现有内容');
    const state = this.studio.snapshot();
    if (['extract-assets', 'video-prompts', 'revise-storyboard'].includes(action) && !state.shots.some(shot => shot.episodeId === episode.id)) throw new Error('请先确认本集分镜');
    if (action === 'video-prompts' && state.clips.some(clip => clip.episodeId === episode.id)) throw new Error('本集已有视频片段，请在页面或通过 Agent 调整，避免覆盖已有内容');
    const job: Job = { id: requestId, projectId, episodeId: episode.id, sourceFileId: String(source.fileId), kind: action as Job['kind'], status: 'queued', phase: '排队', createdAt: new Date().toISOString(), input, fingerprint,
      projectVersion: project._version, versions: Object.fromEntries(['assets', 'shots', 'episodes'].flatMap(resource => state[resource as 'assets'].filter(item => resource === 'assets' ? item.projectId === projectId : resource === 'shots' ? item.episodeId === episode.id : item.id === episode.id).map(item => [recordKey(resource, item.id), item._version]))),
      segments: [], draft: { assets: [], shots: [] } };
    if (['analyze', 'revise-storyboard', 'extract-assets', 'video-prompts'].includes(action)) {
      const kind = (action === 'revise-storyboard' ? 'analyze' : action) as WorkflowKind;
      const config = structuredClone(this.dependencies.workflowAgent?.(kind) || defaultWorkflowAgents().find(item => item.kind === kind)!);
      const skills = structuredClone(this.dependencies.workflowSkills?.(config.skillIds) || []);
      if (skills.length !== config.skillIds.length) throw new Error('工作流 Skill 配置不可用');
      job.workflow = { config, skills, steps: [], outputs: [] };
    }
    this.save(job);
    const controller = new AbortController(); this.running.set(job.id, controller);
    void this.run(job, controller).finally(() => this.running.delete(job.id));
    return { id: job.id, kind: job.kind, status: job.status, phase: job.phase, sourceFileId: job.sourceFileId };
  }
  private async formatWorkflow(job: Job, signal: AbortSignal) {
    const workflow = job.workflow;
    const raw = workflow?.outputs.find(output => output.output_type === 'raw' && !output.incomplete)?.content;
    if (!workflow || !raw) throw new Error('没有可整理的原始输出');
    const selected = this.dependencies.model?.(workflow.config.formatterModel);
    if (!selected) throw new Error('请配置工作流整理模型');
    job.phase = '整理页面字段'; this.save(job);
    const guide = await readFile(new URL('../prompts/workflow-formatter.md', import.meta.url), 'utf8');
    let structured = '';
    const contract = job.kind === 'revise-storyboard' ? await readFile(new URL('../prompts/redraw-revision-formatter.md', import.meta.url), 'utf8') : workflowContracts[workflow.config.kind];
    for await (const chunk of generate(selected.provider, selected.model, [{ role: 'user', content: JSON.stringify({ context: workflow.context, raw }) }], `${guide}\n\n${contract}`, undefined, signal, undefined, Output.json())) structured += chunk;
    if (!structured.trim()) throw new Error('整理模型未返回内容');
    workflow.outputs = workflow.outputs.filter(output => output.output_type !== 'structured');
    workflow.outputs.push({ output_type: 'structured', content: structured }); this.save(job);
    job.phase = '校验整理结果'; this.save(job);
    return parseModelJson(structured);
  }
  private assertWorkflowVersions(job: Job) {
    const state = this.studio.snapshot(), project = state.projects.find(item => item.id === job.projectId), episode = state.episodes.find(item => item.id === job.episodeId);
    if (!project || project._version !== job.projectVersion || !episode || episode._version !== job.versions[recordKey('episodes', episode.id)]) throw new StudioConflict('项目或剧集在运行期间发生变化，结果未写入，请重新检查');
    const relevant = [...state.assets.filter(item => item.projectId === job.projectId).map(item => recordKey('assets', item.id)), ...state.shots.filter(item => item.episodeId === job.episodeId).map(item => recordKey('shots', item.id))];
    if (relevant.some(key => job.versions[key] === undefined) || Object.entries(job.versions).some(([key, version]) => {
      const [resource, id] = key.split(':');
      return resource === 'assets' ? !state.assets.some(item => item.id === id && item._version === version) : resource === 'shots' ? !state.shots.some(item => item.id === id && item._version === version) : false;
    })) throw new StudioConflict('资产或分镜在运行期间发生变化，结果未写入，请重新检查');
  }
  private async run(job: Job, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    try {
      job.status = 'running'; this.save(job);
      const project = this.project(job.projectId), episode = this.episode(project, job.episodeId), source = this.source(project, episode);
      if (job.sourceFileId && source.fileId !== job.sourceFileId) throw new StudioConflict('本集原片已改变，请重新提交');
      const workflow = job.workflow;
      const execution = workflow && job.input.retryFormat !== true && job.input.retrySave !== true ? workflowExecution(workflow.config, workflow.skills, job.id, this.dependencies, workflow.steps, () => this.save(job)) : undefined;
      const instructions = workflow && workflowInstructions(workflow.config, workflow.skills);
      const savePartial = (content: string) => { if (workflow) { workflow.outputs.push({ output_type: 'raw', content, incomplete: true }); this.save(job); } };
      if (job.input.retryFormat === true || job.input.retrySave === true) {
        this.assertWorkflowVersions(job);
        const saved = workflow?.outputs.find(output => output.output_type === 'structured')?.content;
        const structured = job.input.retrySave === true ? parseModelJson(saved || '') : await this.formatWorkflow(job, signal);
        job.phase = '校验并保存结果'; this.save(job);
        this.assertWorkflowVersions(job);
        if (job.kind === 'revise-storyboard') { validateRevision(structured, this.studio.snapshot().shots.filter(item => item.episodeId === episode.id)); job.result = { readyToApply: true }; }
        else if (job.kind === 'analyze') job.result = { analysis: workflow!.outputs[0].content, ...saveRedrawStoryboard(this.studio, project, episode, source, structured, job.id) };
        else if (job.kind === 'extract-assets') job.result = { analysis: workflow!.outputs[0].content, ...saveExtractedAssets(this.studio, project, episode, structured, job.versions, job.id) };
        else if (job.kind === 'video-prompts') {
          const videoModel = (workflow?.context as { videoModel?: { seconds: number[]; modelId: string } })?.videoModel;
          if (!videoModel?.seconds?.length) throw new Error('原任务缺少视频模型时长配置');
          job.result = { analysis: workflow!.outputs[0].content, ...saveRedrawVideoPrompts(this.studio, project, episode, job.versions, structured, String(job.input.mode || '参考生成'), job.id, videoModel.seconds, videoModel.modelId) };
        } else throw new Error('任务类型不能重新整理');
      } else if (job.kind === 'revise-storyboard') {
        const analysis = this.dependencies.analysisCredentials?.();
        if (!analysis?.apiKey || !analysis.baseUrl) throw new Error('请先配置视频分析接口地址与 API Key');
        if (analysis.videoUrlFormat && !['object', 'string'].includes(analysis.videoUrlFormat)) throw new Error('视频分析地址格式配置无效');
        this.assertWorkflowVersions(job);
        const state = this.studio.snapshot();
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, requirements: job.input.requirements || '', scenes: episode.scenes, shots: state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0)), assets: state.assets.filter(item => item.projectId === project.id) };
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        workflow.context = context; this.save(job);
        job.phase = '准备原片地址'; this.save(job);
        const videoUrl = await this.files.ensureCosUrl(String(source.fileId), signal);
        const revisionInstructions = await readFile(new URL('../prompts/redraw-revision.md', import.meta.url), 'utf8');
        job.phase = '对照原片调整分镜'; this.save(job);
        const raw = await runVideoWorkflow(analysis.baseUrl, analysis.apiKey, workflow.config.model, `${instructions}\n\n${revisionInstructions}`, [{ type: 'text', text: JSON.stringify(context) }, { type: 'video_url', video_url: analysis.videoUrlFormat === 'string' ? videoUrl : { url: videoUrl } }], signal, execution, savePartial);
        workflow.outputs.push({ output_type: 'raw', content: raw }); this.save(job);
        const structured = await this.formatWorkflow(job, signal);
        validateRevision(structured, state.shots.filter(item => item.episodeId === episode.id));
        this.assertWorkflowVersions(job);
        job.result = { readyToApply: true };
      } else if (job.kind === 'analyze') {
        const analysis = this.dependencies.analysisCredentials?.();
        if (!analysis?.apiKey || !analysis.baseUrl) throw new Error('请先配置视频分析接口地址与 API Key');
        if (analysis.videoUrlFormat && !['object', 'string'].includes(analysis.videoUrlFormat)) throw new Error('视频分析地址格式配置无效，请使用 object 或 string');
        const analysisApi = new URL(analysis.baseUrl);
        if (!['http:', 'https:'].includes(analysisApi.protocol) || analysisApi.username || analysisApi.password || analysisApi.search || analysisApi.hash) throw new Error('视频分析接口地址无效');
        job.phase = '检测候选切镜'; this.save(job);
        const { segments: candidates, ...info } = await detectVideoCuts(this.files, String(source.fileId), signal);
        job.segments = candidates; this.save(job);
        if (info.duration > REDRAW_LIMITS.maxDuration) throw new Error('原视频不能超过 300 秒');
        signal.throwIfAborted();
        const liveProject = this.project(job.projectId), liveEpisode = this.episode(liveProject, job.episodeId);
        const liveSource = this.source(liveProject, liveEpisode);
        if (liveSource.fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，请重新提交');
        if (liveProject._version !== job.projectVersion || liveEpisode._version !== job.versions[recordKey('episodes', liveEpisode.id)]) throw new StudioConflict('项目或剧集在检测期间发生变化，请重新提交');
        this.studio.apply(`redraw-metadata-${hash(job.id).slice(0, 24)}`, [this.sourceChange(liveProject, liveEpisode, { ...liveSource, ...info, segments: candidates })]);
        job.projectVersion = this.project(job.projectId)._version as number;
        job.versions[recordKey('episodes', episode.id)] = this.episode(this.project(job.projectId), job.episodeId)._version as number;
        job.phase = '准备原片 COS 地址'; this.save(job);
        const videoUrl = await this.files.ensureCosUrl(String(source.fileId), signal);
        if (!/^https?:\/\//i.test(videoUrl)) throw new Error('原片没有可供模型读取的 COS 地址');
        signal.throwIfAborted();
        job.phase = '分析视频画面与声音'; this.save(job);
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, duration: info.duration, assets: this.studio.snapshot().assets.filter(item => item.projectId === project.id).map(({ id, name, type, alias, description, appearance, costume, variants }) => ({ id, name, type, alias, description, appearance, costume, variants })), candidates: candidates.map(({ id, start, end }) => ({ id, start, end })) };
        workflow.context = context; this.save(job);
        const raw = await runVideoWorkflow(analysisApi.toString(), analysis.apiKey, workflow.config.model, instructions, [{ type: 'text', text: JSON.stringify(context) }, { type: 'video_url', video_url: analysis.videoUrlFormat === 'string' ? videoUrl : { url: videoUrl } }], signal, execution, savePartial);
        workflow.outputs.push({ output_type: 'raw', content: raw }); this.save(job);
        if (this.source(this.project(job.projectId), this.episode(this.project(job.projectId), job.episodeId)).fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，分析结果未应用');
        const structured = await this.formatWorkflow(job, signal);
        job.phase = '校验并保存分镜'; this.save(job);
        this.assertWorkflowVersions(job);
        const summary = saveRedrawStoryboard(this.studio, project, episode, source, structured, job.id);
        job.result = { analysis: raw, ...summary };
      } else if (job.kind === 'extract-assets') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用资产提取文本模型');
        const state = this.studio.snapshot();
        const shots = state.shots.filter(item => item.episodeId === episode.id);
        const assets = state.assets.filter(item => item.projectId === project.id);
        const prior = this.jobs(project.id).find(item => item.kind === 'analyze' && item.episodeId === episode.id && item.status === 'completed' && item.sourceFileId === source.fileId);
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, extractionRequirements: job.input.requirements || '', scenes: episode.scenes, shots, assets, sourceAnalysis: prior?.result?.analysis || '' };
        job.phase = '提取并核对美术资产'; this.save(job);
        workflow.context = context; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, context, instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('资产提取接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const structured = await this.formatWorkflow(job, signal);
        job.phase = '校验并保存资产'; this.save(job);
        const summary = saveExtractedAssets(this.studio, project, episode, structured, job.versions, job.id);
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'video-prompts') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用视频提示词文本模型');
        const state = this.studio.snapshot();
        const shots = state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0));
        const assets = state.assets.filter(item => item.projectId === project.id);
        const videoModel = this.dependencies.videoDurations?.();
        if (!videoModel?.seconds.length) throw new Error('请在模型设置中配置默认视频模型支持的整数时长（不超过 15 秒）');
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, mode: job.input.mode || '参考生成', requirements: job.input.requirements || '', videoModel, scenes: episode.scenes, shots, assets };
        job.phase = '编写视频片段提示词'; this.save(job);
        workflow.context = context; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, context, instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('视频提示词接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const structured = await this.formatWorkflow(job, signal);
        job.phase = '校验并保存视频提示词'; this.save(job);
        const summary = saveRedrawVideoPrompts(this.studio, project, episode, job.versions, structured, String(job.input.mode || '参考生成'), job.id, videoModel.seconds, videoModel.modelId);
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'export') {
        job.phase = '合成实际片段'; this.save(job);
        const selections = asList<{ clipId: string; start?: number; end?: number }>(job.input.selections);
        const state = this.studio.snapshot();
        const inputs = selections.map(selection => {
          const clip = state.clips.find(clip => clip.id === selection.clipId), episode = state.episodes.find(episode => episode.id === clip?.episodeId);
          if (!clip || episode?.id !== job.episodeId || typeof clip.currentVideo !== 'string') throw new Error('所选片段不属于项目或尚未选用视频');
          const fileId = this.files.fromUrl(clip.currentVideo)?.id;
          if (!fileId) throw new Error('请先将生成结果保存到文件服务并选用');
          return { fileId, start: selection.start ?? 0, ...(selection.end === undefined ? {} : { end: selection.end }) };
        });
        const result = await composeVideo(this.files, inputs, String(project.ratio), signal);
        signal.throwIfAborted();
        this.project(project.id);
        this.studio.apply(`redraw-${job.id}`, [{ resource: 'films', id: job.id, op: 'create', values: { projectId: project.id, episodeId: episode.id, title: `第${episode.number}集成片`, url: result.url } }]);
        job.result = result;
      } else { throw new Error('历史分析任务无法继续，请在聊天中查看原片分析'); }
      signal.throwIfAborted(); job.status = 'completed'; job.phase = '完成'; this.save(job);
    } catch (error) {
      job.status = this.disposed ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = safeError(error); this.save(job);
    }
  }
  private applyRevision(jobId: string, project: StudioRecord, episode: StudioRecord) {
    const job = this.job(jobId);
    if (job.projectId !== project.id || job.episodeId !== episode.id || job.kind !== 'revise-storyboard' || job.status !== 'completed' || !job.result?.readyToApply || job.result.applied) throw new Error('没有可应用的调整结果');
    if (this.source(project, episode).fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，不能应用调整');
    this.assertWorkflowVersions(job);
    const state = this.studio.snapshot(), shots = state.shots.filter(item => item.episodeId === episode.id);
    const output = job.workflow?.outputs.find(item => item.output_type === 'structured')?.content;
    const revision = validateRevision(parseModelJson(output || ''), shots);
    const changes: StudioChange[] = revision.changes.map(({ shotId, values }) => {
      const shot = shots.find(item => item.id === shotId)!;
      const { sourceDescription, sourceDialogue, dialogue, ...fields } = values;
      const assetIds = values.description === undefined && !dialogue ? undefined : [...new Set([...asList<string>(shot.assetIds), ...mentionedAssets(values.description || '', state.assets.filter(asset => asset.projectId === project.id)).map((asset: { assetId: string }) => asset.assetId), ...(dialogue || []).flatMap(line => line.assetId ? [line.assetId] : [])])];
      return { resource: 'shots', op: 'update', id: shotId, version: shot._version, values: { ...fields, ...(assetIds ? { assetIds } : {}), ...(dialogue ? { dialogue: dialogue.map(line => ({ ...line, id: line.id || randomUUID() })) } : {}), ...(sourceDescription !== undefined || sourceDialogue !== undefined ? { source: { ...(shot.source as object), ...(sourceDescription !== undefined ? { description: sourceDescription } : {}), ...(sourceDialogue !== undefined ? { dialogue: sourceDialogue } : {}) } } : {}) } };
    });
    if (changes.length) this.studio.apply(`redraw-revision-${job.id}`, changes);
    job.result = { ...job.result, applied: true, appliedCount: changes.length }; this.save(job);
    return { applied: true, count: changes.length };
  }
  private apply(jobId: string, project: StudioRecord, episode: StudioRecord, selected: string[]) {
    const job = this.job(jobId);
    if (job.projectId !== project.id || (job.episodeId || this.episode(project).id) !== episode.id || job.kind !== 'analyze' || !job.draft.shots.length) throw new Error('没有可应用的分析草稿');
    if (project._version !== job.projectVersion) throw new StudioConflict('项目地区/语言或设置已变化，请重新分析');
    const state = this.studio.snapshot();
    if (job.sourceFileId && this.source(project, episode).fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，请重新分析');
    const chosen = selected.length ? job.draft.shots.filter(shot => selected.includes(shot.segmentId)) : job.draft.shots;
    if (!chosen.length) throw new Error('请选择需要应用的镜头');
    const changes: StudioChange[] = [], keyMap = new Map(state.assets.filter(asset => asset.projectId === project.id).map(asset => [asset.id, asset.id]));
    for (const asset of job.draft.assets) {
      const match = state.assets.filter(existing => existing.projectId === project.id && existing.type === asset.type && String(existing.name).trim() === asset.targetName.trim());
      if (match.length > 1) throw new Error(`资产名称 ${asset.targetName} 存在歧义，请先核对`);
      keyMap.set(asset.key, keyMap.get(asset.key) || match[0]?.id || `redraw-${hash([project.id, episode.id, asset.key]).slice(0, 24)}`);
    }
    const needed = new Set(chosen.flatMap(shot => [shot.sceneKey, ...shot.assetKeys, ...shot.targetDialogue.map(line => line.assetKey).filter(Boolean)]));
    for (const asset of job.draft.assets.filter(asset => needed.has(asset.key))) {
      const id = keyMap.get(asset.key)!, prior = state.assets.find(item => item.id === id);
      if (prior) continue; // Existing assets are shared and their accepted settings are preserved.
      const segment = job.segments.find(segment => segment.id === asset.evidenceSegmentId)!;
      changes.push({ resource: 'assets', id, op: 'create', values: { projectId: project.id, episodeIds: [episode.id], type: asset.type, name: asset.targetName, description: asset.targetDescription,
        appearance: asset.targetAppearance || '', costume: asset.targetCostume || '', voiceDescription: asset.targetVoiceDescription || '', prompt: asset.targetPrompt || '',
        source: { fileId: this.source(project, episode).fileId, start: segment.start, end: segment.end, frames: [segment.frames[asset.frameIndex]], name: asset.name, description: asset.description, confirmed: false } } });
    }
    for (const id of new Set([...needed].map(key => keyMap.get(key)).filter(Boolean))) {
      const asset = state.assets.find(item => item.id === id);
      if (asset && !(asset.episodeIds as string[]).includes(episode.id)) changes.push({ resource: 'assets', id: asset.id, op: 'update', version: asset._version, values: { episodeIds: [...asset.episodeIds as string[], episode.id] } });
    }
    const scenes = structuredClone(episode.scenes) as Array<Record<string, unknown>>;
    for (const shot of chosen) {
      const segment = job.segments.find(segment => segment.id === shot.segmentId)!;
      const sceneId = `redraw-scene-${keyMap.get(shot.sceneKey)}`;
        if (!scenes.some(scene => scene.id === sceneId)) scenes.push({ id: sceneId, location: job.draft.assets.find(asset => asset.key === shot.sceneKey)?.targetName || String(state.assets.find(asset => asset.id === shot.sceneKey)?.name || '待确认地点'), setting: '内外', time: '待确认', content: '', suggestedDuration: '' });
      const legacy = state.shots.find(item => item.id === segment.id && item.episodeId === episode.id);
      const shotId = legacy?.id || `redraw-shot-${hash([project.id, episode.id, segment.id]).slice(0, 24)}`;
      const prior = state.shots.find(item => item.id === shotId);
      if (prior && job.applied?.includes(segment.id)) continue;
      if (prior && prior._version !== job.versions[recordKey('shots', prior.id)]) throw new StudioConflict('镜头已被人工修改，保留当前内容；请重新分析该区间');
        const values = { episodeId: episode.id, sceneId, description: shot.targetDescription, scale: shot.scale, camera: shot.camera, transition: shot.transition, effects: shot.effects, duration: shot.targetDuration || segment.end - segment.start,
        assetIds: [...new Set([shot.sceneKey, ...shot.assetKeys].map(key => keyMap.get(key)!))],
        dialogue: shot.targetDialogue.map(line => ({ id: randomUUID(), type: line.assetKey ? '角色' : '旁白', ...(line.assetKey ? { assetId: keyMap.get(line.assetKey), speaker: job.draft.assets.find(asset => asset.key === line.assetKey)?.targetName || state.assets.find(asset => asset.id === line.assetKey)?.name } : {}), text: line.text, description: line.description })),
        source: { fileId: this.source(project, episode).fileId, segmentId: segment.id, start: segment.start, end: segment.end, frames: segment.frames, description: shot.description, dialogue: shot.dialogue, notes: shot.notes, confirmed: false } };
      changes.push({ resource: 'shots', id: shotId, op: prior ? 'update' : 'create', ...(prior ? { version: prior._version } : {}), position: prior?._position ?? job.segments.indexOf(segment), values });
    }
    if (JSON.stringify(scenes) !== JSON.stringify(episode.scenes)) {
      if (episode._version !== job.versions[recordKey('episodes', episode.id)] && !job.applied?.length) throw new StudioConflict('场次已修改，请重新分析');
      changes.push({ resource: 'episodes', id: episode.id, op: 'update', version: episode._version, values: { scenes } });
    }
    const result = changes.length ? this.studio.apply(randomUUID(), changes) : { changed: [] };
    job.applied = [...new Set([...(job.applied || []), ...chosen.map(shot => shot.segmentId)])]; this.save(job);
    return result;
  }
  private mergeAssets(input: Record<string, unknown>, project: StudioRecord) {
    const state = this.studio.snapshot(), from = state.assets.find(asset => asset.id === input.fromId), to = state.assets.find(asset => asset.id === input.toId);
    if (!from || !to || from.id === to.id || from.projectId !== project.id || to.projectId !== project.id || from.type !== to.type || input.fromVersion !== from._version || input.toVersion !== to._version) throw new StudioConflict('合并主体、类型或版本无效');
    if ((from.variants as unknown[]).length) throw new Error('请先整理源资产的衍生形态再合并');
    const changes: StudioChange[] = [];
    for (const resource of ['shots', 'clips'] as const) for (const item of state[resource]) {
      const assetIds = asList<string>(item.assetIds), dialogue = asList<Record<string, unknown>>(item.dialogue);
      if (!assetIds.includes(from.id) && !dialogue.some(line => line.assetId === from.id)) continue;
      changes.push({ resource, id: item.id, op: 'update', version: item._version, values: { assetIds: [...new Set(assetIds.map(id => id === from.id ? to.id : id))], ...(resource === 'shots' ? { dialogue: dialogue.map(line => line.assetId === from.id ? { ...line, assetId: to.id, speaker: to.name } : line) } : {}) } });
    }
    const a = to.source as Record<string, unknown> | undefined, b = from.source as Record<string, unknown> | undefined;
    if (a && b && a.fileId !== b.fileId) throw new Error('不同集的资产来源不能直接合并，请保留两条记录以免丢失原片证据');
    changes.push({ resource: 'assets', id: to.id, op: 'update', version: to._version, values: { episodeIds: [...new Set([...asList<string>(to.episodeIds), ...asList<string>(from.episodeIds)])], history: [...new Set([...asList<string>(to.history), String(from.image || ''), ...asList<string>(from.history)].filter(Boolean))],
      ...(a && b ? { source: { ...a, start: Math.min(Number(a.start), Number(b.start)), end: Math.max(Number(a.end), Number(b.end)), frames: [...asList(a.frames), ...asList(b.frames)].slice(0, 12), description: [a.description, b.description].filter(Boolean).join('\n') } } : {}),
      references: [...asList(to.references), ...asList(from.references)] } },
    { resource: 'assets', id: from.id, op: 'delete', version: from._version });
    return this.studio.apply(randomUUID(), changes);
  }
  dispose() { this.disposed = true; for (const controller of this.running.values()) controller.abort(); }
}

const properties = {
  mode: { type: 'string', enum: ['参考生成', '分镜图'] }, requirements: { type: 'string', maxLength: 2000, description: '资产提取、分镜调整或视频提示词生成的补充要求。' }, projectId: { type: 'string' }, episodeId: { type: 'string' }, jobId: { type: 'string' }, requestId: { type: 'string' }, version: { type: 'integer' },
  start: { type: 'number' }, end: { type: 'number' }, shotId: { type: 'string' }, shotVersion: { type: 'integer' }, split: { type: 'number' },
  shotIds: { type: 'array', items: { type: 'string' } }, fromId: { type: 'string' }, toId: { type: 'string' }, fromVersion: { type: 'integer' }, toVersion: { type: 'integer' },
  selections: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number' } }, required: ['clipId'], additionalProperties: false } },
} as const;
export const REDRAW_TOOLS = [
  { name: 'builtin_wait_video_redraw', title: '等待视频转绘任务', description: '等待指定项目与剧集的视频分析、分镜调整、资产提取或视频提示词任务结束；完成后返回分析结果，失败、中断或取消时返回真实状态和错误。停止等待不会取消后台任务。', risk: 'read' as const, approval: 'workspace' as const, waitForCompletion: true as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId }, required: ['projectId', 'jobId'], additionalProperties: false } },
  { name: 'builtin_read_video_redraw', title: '查询视频转绘', description: 'describe=true 查询转绘能力和限制；否则以 projectId 和 episodeId 查询该集原片、持久化任务、可应用草稿和错误；传 jobId 读取 analyze、extract-assets、video-prompts 的状态、failureStage 失败阶段、工具步骤和 outputs（raw 原始输出、structured 页面字段），失败任务也可读取已保存输出，或用 cursor、limit 分页读取历史切镜结果或原声转写；detail=turns/words 只读取该任务已有转写。省略 episodeId 兼容第一集。查询不触发生成。', risk: 'read' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 }, detail: { type: 'string', enum: ['turns', 'words'] }, describe: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'builtin_edit_video_redraw', title: '操作视频转绘', description: '按 episodeId 操作对应剧集，省略则使用第一集。analyze 复用原片 COS 地址调用视频模型分析画面与声音，本地原片先通过现有 COS 配置上传；revise-storyboard 将原片和现有分镜发给视频分析 Agent 生成待审核建议；apply-revision 传 jobId，校验版本后应用建议；extract-assets 使用文本模型补充资产并关联镜头；video-prompts 根据已确认分镜与用户 mode、requirements 调用文本模型创建视频片段和提示词，已有片段不覆盖；retry-format 使用失败任务 jobId、最新项目 version 和新的 requestId 从原始输出重新整理；retry-save 使用已保存的整理结果重试校验与保存，不调用模型；完成后用等待工具取得结果；分析失败时报告真实错误，不自动改用其他分析方式；cancel 取消；merge-assets 合并重复资产，export 按 selections 的 clipId 顺序合成已选用视频，保留生成音轨。提交长任务须 requestId、最新项目 version，返回任务后查询。失败后使用新 requestId 重新提交。', risk: 'write' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId, requestId: properties.requestId, version: properties.version, requirements: properties.requirements, mode: properties.mode, fromId: properties.fromId, toId: properties.toId, fromVersion: properties.fromVersion, toVersion: properties.toVersion, selections: properties.selections, action: { type: 'string', enum: ['analyze', 'revise-storyboard', 'apply-revision', 'extract-assets', 'video-prompts', 'retry-format', 'retry-save', 'cancel', 'merge-assets', 'export'] } }, required: ['projectId', 'action'], additionalProperties: false } },
] as const;

export async function handleRedrawRequest(req: IncomingMessage, res: ServerResponse, service: VideoRedraw) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/video-redraw/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '仅允许本机或局域网' }); return true; }
  try {
    if (req.method === 'GET' && url.pathname === '/api/video-redraw/wait') {
      const controller = new AbortController(); res.once('close', () => controller.abort());
      send(200, await service.wait({ projectId: url.searchParams.get('projectId'), episodeId: url.searchParams.get('episodeId') || undefined, jobId: url.searchParams.get('jobId') }, controller.signal));
    } else if (req.method === 'GET' && url.pathname === '/api/video-redraw/clip') {
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const bytes = await service.clip(String(url.searchParams.get('projectId') || ''), url.searchParams.get('episodeId') || undefined, String(url.searchParams.get('shotId') || ''), controller.signal);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
    } else if (req.method === 'GET') sendRevalidatedJson(req, res, service.read({ projectId: url.searchParams.get('projectId'), episodeId: url.searchParams.get('episodeId') || undefined, jobId: url.searchParams.get('jobId') || undefined, cursor: url.searchParams.get('cursor') || undefined, limit: url.searchParams.get('limit') || undefined, detail: url.searchParams.get('detail') || undefined, describe: url.searchParams.has('describe') }));
    else if (req.method === 'POST' && url.pathname === '/api/video-redraw/action') {
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('请求超过1MB'); }
      send(200, await service.edit(JSON.parse(body)));
    } else send(405, { error: '不支持的操作' });
  } catch (error) { send(error instanceof StudioConflict ? 409 : 422, { error: safeError(error) }); }
  return true;
}
