import { sendRevalidatedJson } from './http-cache';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentModelConfig } from '../../../src/index';
import type { StudioChange, StudioRecord } from '../studio-schema';
import { StudioStore, StudioConflict, type ChangeOrigin } from './studio';
import { generate, safeError, type StoredProvider } from './models';
import { Output } from 'ai';
import { AgentFailure } from './errors';
import type { TimedTranscript } from './voice';
import { REDRAW_LIMITS, composeVideo, detectVideoCuts, videoCommand, withVideoFiles, type SourceSegment } from './video-processing';
import { isLocalOrLanAddress } from './local-access';
import { saveRedrawStoryboard } from './redraw-storyboard';
import { saveRedrawScript } from './redraw-script';
import { saveNovelScript } from './novel-script';
import { validateNovelOutline, validateNovelOutlineAdjustment } from './novel-outline';
import { saveScriptAssets } from './script-assets';
import { saveScriptStoryboard } from './script-storyboard';
import { planShotAdjustment } from './redraw-adjustment';
import { saveExtractedAssets, validateAssetPromptFidelity } from './redraw-asset-extraction';
import { saveRedrawVideoPrompts } from './redraw-video-prompts';
import { validateWorkflowFields } from './workflow-fields';
import { parseBatchPromptResults, validatePromptTiming } from './prompt-adjustment';
import { defaultWorkflowAgents, type WorkflowAgent, type WorkflowKind } from './workflow-agents';
import { runTextWorkflow, runVideoWorkflow, workflowExecution, workflowInstructions, workflowSkillResources, type WorkflowDependencies, type WorkflowStep } from './workflow-runtime';
import { logWorkflowDebug, runWithWorkflowDebug } from './workflow-debug';
import type { AgentSkill } from '../../../src/components/skill-manager/types';
import { mentionedAssets } from '../asset-mentions.js';

type DraftAsset = { key: string; type: string; name: string; description: string; targetName: string; targetDescription: string; targetAppearance?: string; targetCostume?: string; targetVoiceDescription?: string; targetPrompt?: string; evidenceSegmentId: string; frameIndex: number };
type DraftShot = { segmentId: string; sceneKey: string; description: string; dialogue: string; scale: string; camera: string; transition: string; effects: string; assetKeys: string[]; targetDescription: string; targetDuration?: number; targetDialogue: Array<{ assetKey: string; text: string; description: string }>; notes: string };
export type RedrawDraft = { assets: DraftAsset[]; shots: DraftShot[] };
/** handoff lists the upstream reports given to the execution model; formatMode only marks legacy asset tasks. */
type WorkflowRun = { config: WorkflowAgent; skills: AgentSkill[]; skillResourcesLoaded?: boolean; adjustmentInstructions?: string; steps: WorkflowStep[]; context?: unknown; handoff?: Array<{ kind: string; jobId: string; createdAt: string }>; formatErrors?: string[]; formatMode?: 'asset-tools'; outputs: Array<{ output_type: 'raw' | 'structured'; content: string; incomplete?: boolean }> };
const workflowSkillSummary = (workflow: WorkflowRun) => workflow.skills.map(skill => ({ id: skill.id, name: skill.name, ...(workflow.skillResourcesLoaded ? { resources: workflowSkillResources(skill).map(file => file.path) } : {}) }));
type Job = { id: string; projectId: string; episodeId?: string; sourceFileId?: string; kind: 'prepare' | 'breakdown' | 'transcribe' | 'analyze' | 'revise-storyboard' | 'revise-cuts' | 'revise-script' | 'plan-storyboard' | 'write-script' | 'novel-outline' | 'novel-script' | 'script-assets' | 'script-storyboard' | 'extract-assets' | 'video-prompts' | 'export'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; createdAt: string; error?: string; input: Record<string, unknown>; fingerprint: string; workflow?: WorkflowRun;
  versions: Record<string, number>; projectVersion: number; draft: RedrawDraft; segments: SourceSegment[]; transcript?: TimedTranscript; result?: Record<string, unknown>; applied?: string[] };
type Dependencies = WorkflowDependencies & {
  debugLog?: (entry: Record<string, unknown>) => void;
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
const rawOutput = (workflow?: WorkflowRun) => workflow?.outputs.find(output => output.output_type === 'raw' && !output.incomplete)?.content;
/** Upstream nodes whose full reports are handed to each downstream execution model, in pipeline order. */
const UPSTREAM: Partial<Record<Job['kind'], Job['kind'][]>> = { 'write-script': ['analyze'], 'extract-assets': ['analyze', 'write-script'], 'plan-storyboard': ['analyze', 'write-script', 'extract-assets'], 'video-prompts': ['analyze', 'write-script', 'extract-assets', 'plan-storyboard'] };
type RevisionValues = { description?: string; scale?: string; camera?: string; duration?: number; effects?: string; sourceDescription?: string; sourceDialogue?: string; dialogue?: Array<{ id?: string; type: string; assetId?: string; speaker?: string; text: string; description?: string }> };
type Revision = { changes: Array<{ shotId: string; reason: string; values: RevisionValues }>; notes: string };
export function validateRevision(value: unknown, shots: StudioRecord[], formal = false): Revision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('调整结果无效');
  const revision = value as Revision;
  if (!Array.isArray(revision.changes) || revision.changes.length > shots.length || typeof revision.notes !== 'string' || revision.notes.length > 16000) throw new Error('调整建议列表无效');
  const seen = new Set<string>();
  for (const change of revision.changes) {
    if (!change || typeof change.shotId !== 'string' || !shots.some(shot => shot.id === change.shotId) || seen.has(change.shotId) || typeof change.reason !== 'string' || !change.values || typeof change.values !== 'object' || Array.isArray(change.values)) throw new Error('调整建议引用的镜头无效或重复');
    seen.add(change.shotId);
    const entries = Object.entries(change.values);
    if (!entries.length || entries.some(([key, item]) => key === 'duration' ? !formal || typeof item !== 'number' || !Number.isFinite(item) || item < 0.1 || Math.abs(item * 10 - Math.round(item * 10)) > 1e-7 : key === 'dialogue' ? formal || !Array.isArray(item) || item.length > 100 || item.some(line => !line || typeof line !== 'object' || !['角色', '旁白'].includes(line.type) || typeof line.text !== 'string' || (line.id !== undefined && typeof line.id !== 'string') || (line.assetId !== undefined && typeof line.assetId !== 'string') || (line.speaker !== undefined && typeof line.speaker !== 'string') || (line.description !== undefined && typeof line.description !== 'string')) : !(formal ? ['description', 'scale', 'camera', 'effects'] : ['description', 'scale', 'camera', 'effects', 'sourceDescription', 'sourceDialogue']).includes(key) || typeof item !== 'string' || item.length > 16000)) throw new Error('调整建议包含不支持的字段或无效内容');
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
  if (job.phase.includes('校验并保存') || job.phase.includes('应用调整') || job.phase.includes('校验调整结果')) return '校验与保存';
  if (job.phase.endsWith('整理页面字段')) {
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
  /** Project-level outline runs do not require a pre-existing episode. */
  readOutline(projectId: string, jobId?: string, includeInput = false) {
    this.project(projectId);
    const job = jobId ? this.job(jobId) : this.jobs(projectId).find(item => item.kind === 'novel-outline');
    if (!job) return { job: null };
    if (job.projectId !== projectId || job.kind !== 'novel-outline') throw new Error('大纲任务不属于当前项目');
    return { job: { id: job.id, kind: job.kind, status: job.status, phase: job.phase, createdAt: job.createdAt, projectVersion: job.projectVersion, error: job.error, requirements: job.input.requirements, failureStage: workflowFailureStage(job), model: job.workflow?.config.model, formatterModel: job.workflow?.config.formatterModel, formatErrors: job.workflow?.formatErrors, ...(includeInput ? { outputs: job.workflow?.outputs, steps: job.workflow?.steps, executionInput: { context: job.workflow?.context, instructions: [job.workflow?.config.instructions, job.workflow?.adjustmentInstructions].filter(Boolean).join('\n\n'), skills: job.workflow ? workflowSkillSummary(job.workflow) : [], tools: job.workflow?.config.toolNames } } : {}), ...(job.result || {}) } };
  }
  startOutline(input: Record<string, unknown>) {
    const projectId = String(input.projectId || ''), project = this.project(projectId), requestId = String(input.requestId || '');
    if (project.creationMode === 'video-redraw') throw new Error('小说转大纲仅适用于剧本项目');
    if (!/^[\w-]{8,160}$/.test(requestId)) throw new Error('提交任务须提供唯一 requestId');
    const fingerprint = hash(input), prior = this.jobs().find(job => job.id === requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('同一 requestId 不能用于不同请求'); return this.readOutline(projectId, prior.id); }
    if (input.version !== project._version) throw new StudioConflict('项目已变化，请刷新后重试');
    if (input.autoApply !== undefined && typeof input.autoApply !== 'boolean') throw new Error('自动保存参数无效');
    if (input.requirements !== undefined && (typeof input.requirements !== 'string' || !input.requirements.trim() || input.requirements.length > 2000)) throw new Error('修改意见不能为空或超过 2000 字');
    if (!String(project.sourceScript || '').trim()) throw new Error('请先添加小说原文');
    if (this.jobs(projectId).some(job => ['running', 'queued'].includes(job.status))) throw new Error('本项目已有任务运行，请完成或取消后再提交');
    if (this.running.size >= 2) throw new Error('当前已有两个工作流任务运行，请稍后提交');
    const config = structuredClone(this.dependencies.workflowAgent?.('novel-outline') || defaultWorkflowAgents().find(item => item.kind === 'novel-outline')!);
    if (!config.instructions.trim()) throw new Error('请先配置小说转大纲 Agent 指令');
    const skills = structuredClone(this.dependencies.workflowSkills?.(config.skillIds) || []);
    if (skills.length !== config.skillIds.length) throw new Error('工作流 Skill 配置不可用');
    const previous = input.requirements ? this.jobs(projectId).find(item => item.kind === 'novel-outline' && item.status === 'completed' && rawOutput(item.workflow)) : undefined;
    const job: Job = { id: requestId, projectId, kind: 'novel-outline', status: 'queued', phase: '排队', createdAt: new Date().toISOString(), input, fingerprint, projectVersion: project._version, versions: {}, draft: { assets: [], shots: [] }, segments: [], workflow: { config, skills, steps: [], outputs: [], context: { project: { sourceScript: project.sourceScript, outline: project.outline, adaptation: project.adaptation, planned: project.planned, durationMin: project.durationMin, durationMax: project.durationMax, duration: project.duration, requirements: project.requirements, ratio: project.ratio }, ...(input.requirements ? { feedback: input.requirements, originalReport: previous && rawOutput(previous.workflow) } : {}) } } };
    this.save(job);
    const controller = new AbortController(); this.running.set(job.id, controller);
    void this.runOutline(job, controller).finally(() => this.running.delete(job.id));
    return this.readOutline(projectId, job.id);
  }
  cancelOutline(projectId: string, jobId: string) {
    const job = this.job(jobId);
    if (job.projectId !== projectId || job.kind !== 'novel-outline') throw new Error('大纲任务不属于当前项目');
    if (['queued', 'running'].includes(job.status)) { job.status = 'cancelled'; job.error = '已取消'; this.running.get(job.id)?.abort(); this.save(job); }
    return this.readOutline(projectId, job.id);
  }
  retryOutline(input: Record<string, unknown>) {
    const projectId = String(input.projectId || ''), project = this.project(projectId), original = this.job(String(input.jobId || ''));
    const requestId = String(input.requestId || ''), fingerprint = hash(input), prior = this.jobs().find(job => job.id === requestId);
    if (!/^[\w-]{8,160}$/.test(requestId)) throw new Error('提交任务须提供唯一 requestId');
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('同一 requestId 不能用于不同请求'); return this.readOutline(projectId, prior.id); }
    if (original.projectId !== projectId || original.kind !== 'novel-outline' || !['failed', 'cancelled', 'interrupted'].includes(original.status) || !rawOutput(original.workflow)) throw new Error('该任务没有可重新整理的完整报告');
    if (input.version !== project._version || original.projectVersion !== project._version) throw new StudioConflict('项目已变化，请重新提交修改意见');
    if (input.action === 'retry-save' && !original.workflow?.outputs.some(item => item.output_type === 'structured')) throw new Error('该任务没有可重新写入的整理结果');
    if (this.jobs(projectId).some(job => ['running', 'queued'].includes(job.status)) || this.running.size >= 2) throw new Error('已有工作流任务运行，请稍后重试');
    const workflow = structuredClone(original.workflow!);
    if (input.action === 'retry-format') { workflow.outputs = workflow.outputs.filter(item => item.output_type === 'raw'); workflow.formatErrors = []; workflow.config.formatterModel = this.dependencies.workflowAgent?.('novel-outline').formatterModel || workflow.config.formatterModel; }
    const job: Job = { ...structuredClone(original), id: requestId, status: 'queued', phase: '排队', createdAt: new Date().toISOString(), error: undefined, result: undefined, fingerprint, input: { ...original.input, retryFormat: input.action === 'retry-format', retrySave: input.action === 'retry-save' }, workflow };
    this.save(job);
    const controller = new AbortController(); this.running.set(job.id, controller);
    void this.runOutline(job, controller).finally(() => this.running.delete(job.id));
    return this.readOutline(projectId, job.id);
  }
  private async runOutline(job: Job, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]), workflow = job.workflow!;
    let secret = '';
    try {
      job.status = 'running'; job.phase = job.input.requirements ? '根据修改意见调整大纲' : '根据小说编写大纲'; this.save(job);
      if (!job.input.retryFormat && !job.input.retrySave) {
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置小说转大纲执行模型');
        secret = selected.provider.apiKey;
        const execution = workflowExecution(workflow.config, workflow.skills, job.id, this.dependencies, workflow.steps, () => this.save(job));
        if (job.input.requirements) workflow.adjustmentInstructions = await readFile(new URL('../prompts/novel-outline-adjustment.md', import.meta.url), 'utf8');
        const instructions = [workflowInstructions(workflow.config, workflow.skills), workflow.adjustmentInstructions].filter(Boolean).join('\n\n');
        workflow.skillResourcesLoaded = true; this.save(job);
        const raw = await runTextWorkflow(selected.provider, selected.model, workflow.context, instructions, signal, execution, partial => { workflow.outputs.push({ output_type: 'raw', content: partial, incomplete: true }); this.save(job); });
        if (!raw.trim()) throw new Error('小说转大纲 Agent 未返回内容');
        workflow.outputs.push({ output_type: 'raw', content: raw }); this.save(job);
      }
      secret = this.dependencies.model?.(workflow.config.formatterModel)?.provider.apiKey || '';
      let correction: { previous: string; error: string } | undefined;
      for (let attempt = 0; ; attempt++) {
        const structured = job.input.retrySave && !correction ? workflow.outputs.find(item => item.output_type === 'structured')!.content : await this.formatWorkflow(job, signal, correction);
        job.phase = '校验并保存'; this.save(job);
        try { job.result = { outline: job.input.requirements ? validateNovelOutlineAdjustment(parseModelJson(structured), (workflow.context as { project: { outline: unknown } }).project.outline) : validateNovelOutline(parseModelJson(structured)) }; break; }
        catch (error) {
          if (attempt >= 2 || signal.aborted || job.input.retrySave || error instanceof StudioConflict) throw error;
          const message = safeError(error, secret).slice(0, 1200); (workflow.formatErrors ||= []).push(message); this.save(job); correction = { previous: structured, error: message };
        }
      }
      signal.throwIfAborted();
      if (job.input.autoApply === true && this.project(job.projectId)._version === job.projectVersion) {
        this.studio.apply(`outline-${job.id}`, [{ resource: 'projects', id: job.projectId, op: 'update', version: job.projectVersion, values: { outline: job.result!.outline } }], { source: 'workflow', kind: 'novel-outline', jobId: job.id });
        job.result!.applied = true;
      }
      job.status = 'completed'; job.phase = job.result!.applied ? '大纲已生成并保存' : '大纲草稿已生成'; this.save(job);
    } catch (error) { job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = safeError(error, secret); this.save(job); }
  }
  async wait(input: Record<string, unknown>, signal: AbortSignal) {
    const project = this.project(String(input.projectId || ''));
    const episode = this.episode(project, input.episodeId);
    const job = this.job(String(input.jobId || ''));
    if (job.projectId !== project.id || (job.episodeId || this.episode(project).id) !== episode.id) throw new Error('任务不属于当前剧集');
    if (!['analyze', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard', 'write-script', 'novel-script', 'script-assets', 'script-storyboard', 'extract-assets', 'video-prompts'].includes(job.kind)) throw new Error('该任务不支持等待');
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
    if (!project) throw new Error('项目不存在');
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
  private adjustmentRestored(job: Job) {
    if (!job.result?.applied || !['revise-cuts', 'revise-script'].includes(job.kind)) return false;
    const batch = `${job.kind === 'revise-cuts' ? 'redraw-adjust' : 'redraw-script'}-${job.id}`;
    const row = this.db.prepare('SELECT restored FROM studio_change_log WHERE project_id=? AND batch_id=?').get(job.projectId, batch) as { restored: string } | undefined;
    return !!row && Object.keys(JSON.parse(row.restored)).length > 0;
  }
  describe() { return { limits: REDRAW_LIMITS, regions: { japan: 'ja', western: 'en' }, operations: REDRAW_TOOLS.map(tool => tool.parameters), supportsVideoReference: false }; }
  read(input: Record<string, unknown>) {
    if (input.describe === true) return this.describe();
    const projectId = String(input.projectId || ''), project = this.project(projectId), episode = this.episode(project, input.episodeId);
    if (input.jobId) {
      const job = this.job(String(input.jobId));
      if (job.projectId !== projectId || (job.episodeId || this.episode(project).id) !== episode.id) throw new Error('任务不属于当前剧集');
      if (job.workflow) {
        if (job.sourceFileId !== this.source(project, episode).fileId) throw new Error('原片已更换，该分析结果已过期');
        return { jobId: job.id, kind: job.kind, status: job.status, phase: job.phase, createdAt: job.createdAt, failureStage: workflowFailureStage(job), error: job.error, sourceFileId: job.sourceFileId, requirements: job.input.requirements, ...(['script-storyboard', 'video-prompts'].includes(job.kind) ? { mode: job.input.mode || (job.workflow.context as { mode?: string } | undefined)?.mode } : {}), parentJobId: ['revise-cuts', 'revise-script'].includes(job.kind) ? job.input.jobId : undefined, model: job.workflow.config.model, formatterModel: job.workflow.config.formatterModel, formatMode: job.workflow.formatMode, formatErrors: job.workflow.formatErrors, handoff: job.workflow.handoff, steps: job.workflow.steps, outputs: job.workflow.outputs,
          ...(input.includeInput === true ? { executionInput: { context: job.workflow.context, instructions: [job.workflow.config.instructions, job.workflow.adjustmentInstructions].filter(Boolean).join('\n\n'), skills: workflowSkillSummary(job.workflow), tools: job.workflow.config.toolNames } } : {}), ...(job.result || {}), ...(['revise-cuts', 'revise-script'].includes(job.kind) ? { restored: this.adjustmentRestored(job) } : {}) };
      }
      if (job.status !== 'completed') return { jobId: job.id, kind: job.kind, status: job.status, phase: job.phase, error: job.error };
      const offset = Number(input.cursor || 0), limit = Number(input.limit || 100);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('分页参数无效');
      if (['analyze', 'write-script', 'extract-assets', 'plan-storyboard', 'video-prompts'].includes(job.kind) && typeof job.result?.analysis === 'string') {
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
    return { jobs: this.jobs(projectId).filter(job => (job.episodeId || this.episode(project).id) === episode.id).map(full => { const { transcript, workflow, result, ...job } = full; return { ...job, ...(workflow ? { hasWorkflow: true, failureStage: workflowFailureStage(full), ...(['revise-cuts', 'revise-script'].includes(full.kind) ? { applied: result?.applied === true, restored: this.adjustmentRestored(full) } : {}) } : job.kind !== 'analyze' ? { result } : {}), hasTranscript: !!transcript }; }), source: this.source(project, episode) };
  }
  async edit(input: Record<string, unknown>, origin: ChangeOrigin = { source: 'page' }) {
    const allowed = new Set([...Object.keys(properties), 'action']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('转绘请求包含未知参数');
    const projectId = String(input.projectId || ''), project = this.project(projectId);
    const action = String(input.action), episode = this.episode(project, input.episodeId);
    if (project.creationMode === 'video-redraw' ? ['novel-script', 'script-assets', 'script-storyboard'].includes(action) : !['novel-script', 'script-assets', 'script-storyboard', 'cancel', 'retry-format', 'retry-save'].includes(action)) throw new Error('该操作不适用于当前项目模式');
    if (input.requirements !== undefined && (!['novel-script', 'script-assets', 'script-storyboard', 'write-script', 'extract-assets', 'video-prompts', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard'].includes(action) || typeof input.requirements !== 'string' || input.requirements.length > 2000)) throw new Error('补充要求无效或超过 2000 字');
    if (input.mode !== undefined && (!['video-prompts', 'script-storyboard'].includes(action) || !['参考生成', '分镜图'].includes(String(input.mode)))) throw new Error('视频生成方式无效');
    if (action === 'cancel') {
      const job = this.job(String(input.jobId));
      if ((job.projectId !== projectId || (job.episodeId || this.episode(project).id) !== episode.id)) throw new Error('任务不属于当前剧集');
      if (['queued', 'running'].includes(job.status)) { job.status = 'cancelled'; this.running.get(job.id)?.abort(); this.save(job); }
      return { id: job.id, kind: job.kind, status: job.status, phase: job.phase };
    }
    if (action === 'apply') return this.apply(String(input.jobId), project, episode, asList<string>(input.shotIds), origin);
    if (action === 'apply-revision') return this.applyRevision(String(input.jobId), project, episode);
    if (action === 'merge-assets') return this.mergeAssets(input, project, origin);
    if (['prepare', 'breakdown', 'transcribe'].includes(action)) throw new Error('视频转绘已改用视频分析接口，不支持通过旧流程自动切镜或转写。请检查分析接口错误后重试。');
    if (!['analyze', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard', 'write-script', 'novel-script', 'script-assets', 'script-storyboard', 'extract-assets', 'video-prompts', 'retry-format', 'retry-save', 'export'].includes(action)) throw new Error('不支持的工作流操作');
    const requestId = String(input.requestId || '');
    if (!/^[\w-]{8,160}$/.test(requestId)) throw new Error('提交任务须提供唯一 requestId，原样重试沿用');
    const fingerprint = hash(input), prior = this.jobs().find(job => job.id === requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('同一 requestId 不能用于不同请求'); return { id: prior.id, kind: prior.kind, status: prior.status, phase: prior.phase, sourceFileId: prior.sourceFileId }; }
    if (this.jobs(projectId).some(job => ['running', 'queued'].includes(job.status))) throw new Error('本项目已有任务运行，请完成或取消后再提交');
    if (this.running.size >= 2) throw new Error('当前有两个转绘任务运行，请稍后提交');
    if (input.version !== project._version) throw new StudioConflict('项目设置已变化，请重新读取');
    const source = this.source(project, episode);
    if (project.creationMode === 'video-redraw' && !source.fileId) throw new Error('请先上传原视频');
    if (action === 'novel-script' && !String(project.sourceScript || '').trim()) throw new Error('请先添加小说原文');
    if (action === 'retry-format' || action === 'retry-save') {
      const original = this.job(String(input.jobId || ''));
      if (original.projectId !== projectId || original.episodeId !== episode.id || original.sourceFileId !== source.fileId || !['failed', 'interrupted', 'cancelled'].includes(original.status) || !original.workflow?.outputs.some(item => item.output_type === 'raw' && !item.incomplete)) throw new Error('该任务没有可重新整理的完整原始输出');
      if (action === 'retry-save' && !original.workflow.outputs.some(item => item.output_type === 'structured')) throw new Error('该任务没有可重新写入的整理结果');
      // Legacy asset-tools tasks are re-formatted by the formatter model like every other node.
      const { formatMode: _legacy, formatErrors, ...workflow } = structuredClone(original.workflow);
      const job: Job = { ...structuredClone(original), id: requestId, status: 'queued', phase: '排队', createdAt: new Date().toISOString(), error: undefined, fingerprint, input: { ...original.input, retryFormat: action === 'retry-format', retrySave: action === 'retry-save' }, workflow: { ...workflow, ...(action === 'retry-save' && formatErrors ? { formatErrors } : {}), outputs: original.workflow.outputs.filter(item => action === 'retry-save' || item.output_type === 'raw'), steps: [...original.workflow.steps] } };
      if (action === 'retry-format') job.workflow!.config.formatterModel = this.dependencies.workflowAgent?.(original.workflow.config.kind).formatterModel || original.workflow.config.formatterModel;
      this.save(job);
      const controller = new AbortController(); this.running.set(job.id, controller);
      void this.run(job, controller).finally(() => this.running.delete(job.id));
      return { id: job.id, kind: job.kind, status: job.status, phase: job.phase };
    }
    if (action === 'analyze' && this.studio.snapshot().shots.some(shot => shot.episodeId === episode.id)) throw new Error('本集已有分镜，请直接编辑，避免覆盖现有内容');
    const state = this.studio.snapshot();
    if (['write-script', 'extract-assets', 'video-prompts', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard'].includes(action) && !state.shots.some(shot => shot.episodeId === episode.id)) throw new Error('请先确认本集分镜');
    if (['revise-cuts', 'revise-script'].includes(action)) {
      if (typeof input.requirements !== 'string' || !input.requirements.trim()) throw new Error('请填写调整意见');
      const parent = input.jobId ? this.job(String(input.jobId)) : this.jobs(projectId).find(item => item.kind === (action === 'revise-cuts' ? 'analyze' : 'write-script') && (item.episodeId || this.episode(project).id) === episode.id && item.sourceFileId === source.fileId && item.status === 'completed');
      if (!parent || parent.projectId !== projectId || (parent.episodeId || this.episode(project).id) !== episode.id || parent.sourceFileId !== source.fileId || ![action, action === 'revise-cuts' ? 'analyze' : 'write-script'].includes(parent.kind) || parent.status !== 'completed' || !rawOutput(parent.workflow) || this.adjustmentRestored(parent)) throw new Error('没有可继续的原工作流任务，或该轮调整已被还原');
      input = { ...input, jobId: parent.id };
    }
    if (action === 'plan-storyboard' && (!String(episode.script || '').trim() || asList<{ id: string; content: string }>(episode.scenes).some(scene => state.shots.some(shot => shot.episodeId === episode.id && shot.sceneId === scene.id) && !String(scene.content || '').trim()))) throw new Error('请先完成本集剧本和相关场次正文');
    if (['write-script', 'novel-script'].includes(action) && (String(episode.script || '').trim() || asList<{ content: string }>(episode.scenes).some(scene => String(scene.content || '').trim()))) throw new Error('本集已有剧本，请直接编辑，避免覆盖已有内容');
    if (action === 'script-assets' && state.assets.some(item => item.projectId === project.id)) throw new Error('项目已有美术资产，未自动覆盖');
    if (action === 'script-assets' && !state.episodes.some(item => item.projectId === project.id && (String(item.script || '').trim() || asList<{ content: string }>(item.scenes).some(scene => String(scene.content || '').trim())))) throw new Error('请先编写项目剧本');
    if (action === 'script-storyboard' && (!Array.isArray(episode.scenes) || !(episode.scenes as Array<{ content?: string }>).some(scene => String(scene.content || '').trim()))) throw new Error('请先完成本集场次剧本');
    if (action === 'script-storyboard' && !state.assets.some(item => item.projectId === projectId)) throw new Error('请先完成美术资产提取');
    if (action === 'script-storyboard' && state.clips.some(clip => clip.episodeId === episode.id)) throw new Error('本集已有视频片段，不自动覆盖');
    if (action === 'video-prompts' && state.clips.some(clip => clip.episodeId === episode.id)) throw new Error('本集已有视频片段，请在页面或通过 Agent 调整，避免覆盖已有内容');
    const job: Job = { id: requestId, projectId, episodeId: episode.id, ...(source.fileId ? { sourceFileId: String(source.fileId) } : {}), kind: action as Job['kind'], status: 'queued', phase: '排队', createdAt: new Date().toISOString(), input, fingerprint,
      projectVersion: project._version, versions: Object.fromEntries(['assets', 'shots', 'episodes', ...(['revise-cuts', 'revise-script'].includes(action) ? ['clips'] : [])].flatMap(resource => state[resource as 'assets'].filter(item => resource === 'assets' ? item.projectId === projectId : resource === 'shots' || resource === 'clips' ? item.episodeId === episode.id : action === 'script-assets' ? item.projectId === projectId : item.id === episode.id).map(item => [recordKey(resource, item.id), item._version]))),
      segments: [], draft: { assets: [], shots: [] } };
    if (['analyze', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard', 'write-script', 'novel-script', 'script-assets', 'script-storyboard', 'extract-assets', 'video-prompts'].includes(action)) {
      const kind = (action === 'revise-storyboard' || action === 'revise-cuts' ? 'analyze' : action === 'revise-script' ? 'write-script' : action === 'plan-storyboard' ? 'storyboard' : action) as WorkflowKind;
      const parent = ['revise-cuts', 'revise-script'].includes(action) ? this.job(String(input.jobId)) : undefined;
      const config = structuredClone(parent?.workflow?.config || this.dependencies.workflowAgent?.(kind) || defaultWorkflowAgents().find(item => item.kind === kind)!);
      if (!config.instructions.trim()) throw new Error('请先在设置 → 工作流 Agents 中配置并保存该阶段的系统提示词');
      const skills = structuredClone(parent?.workflow?.skills || this.dependencies.workflowSkills?.(config.skillIds) || []);
      if (skills.length !== config.skillIds.length) throw new Error('工作流 Skill 配置不可用');
      job.workflow = { config, skills, steps: [], outputs: [] };
    }
    this.save(job);
    const controller = new AbortController(); this.running.set(job.id, controller);
    void this.run(job, controller).finally(() => this.running.delete(job.id));
    return { id: job.id, kind: job.kind, status: job.status, phase: job.phase, sourceFileId: job.sourceFileId };
  }
  /** The formatter only sees context and raw; a correction adds its previous JSON and the validation error. */
  private async formatWorkflow(job: Job, signal: AbortSignal, correction?: { previous: string; error: string }) {
    const workflow = job.workflow;
    const raw = rawOutput(workflow);
    if (!workflow || !raw) throw new Error('没有可整理的原始输出');
    const selected = this.dependencies.model?.(workflow.config.formatterModel);
    if (!selected) throw new Error('请配置工作流整理模型');
    job.phase = correction ? '重新整理页面字段' : '整理页面字段'; this.save(job);
    const guide = await readFile(new URL('../prompts/workflow-formatter.md', import.meta.url), 'utf8');
    let structured = '';
    const contractPath = job.kind === 'novel-outline' ? (job.input.requirements ? '../prompts/novel-outline-adjustment-formatter.md' : '../prompts/novel-outline-formatter.md') : job.kind === 'script-storyboard' ? '../prompts/script-storyboard-formatter.md' : job.kind === 'script-assets' ? '../prompts/script-assets-formatter.md' : job.kind === 'novel-script' ? '../prompts/novel-script-formatter.md' : job.kind === 'revise-cuts' ? '../prompts/redraw-cuts-adjust-formatter.md' : job.kind === 'revise-script' ? '../prompts/redraw-script-adjust-formatter.md' : job.kind === 'plan-storyboard' ? '../prompts/redraw-storyboard-formatter.md' : job.kind === 'write-script' ? '../prompts/redraw-script-formatter.md' : job.kind === 'revise-storyboard' ? '../prompts/redraw-revision-formatter.md' : job.kind === 'extract-assets' ? '../prompts/redraw-assets-formatter.md' : job.kind === 'analyze' ? '../prompts/redraw-analysis-formatter.md' : '../prompts/redraw-video-prompts-formatter.md';
    const contract = await readFile(new URL(contractPath, import.meta.url), 'utf8');
    for await (const chunk of generate(selected.provider, selected.model, [{ role: 'user', content: JSON.stringify({ context: workflow.context, raw, ...correction }) }], `${guide}\n\n${contract}`, undefined, signal, undefined, Output.json())) structured += chunk;
    if (!structured.trim()) throw new Error('整理模型未返回内容');
    if (job.kind === 'script-storyboard' && (job.input.mode || (workflow.context as { mode?: string } | undefined)?.mode || '参考生成') === '参考生成') {
      try {
        const result = parseModelJson(structured) as { clips?: Array<Record<string, unknown>> };
        if (Array.isArray(result?.clips)) { for (const clip of result.clips) if (clip && typeof clip === 'object') delete clip.storyboardPrompt; structured = JSON.stringify(result); }
      } catch { /* Invalid JSON remains available for the normal correction path. */ }
    }
    workflow.outputs = workflow.outputs.filter(output => output.output_type !== 'structured');
    workflow.outputs.push({ output_type: 'structured', content: structured }); this.save(job);
    job.phase = '校验整理结果'; this.save(job);
    return structured;
  }
  /** Format, validate and save; failed checks return to the formatter at most twice. Saves are atomic. */
  private async formatAndSave<T>(job: Job, signal: AbortSignal, phase: string, save: (structured: unknown) => T): Promise<T> {
    const workflow = job.workflow!;
    workflow.formatErrors = [];
    let correction: { previous: string; error: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      const structured = await this.formatWorkflow(job, signal, correction);
      try {
        const value = parseModelJson(structured);
        job.phase = phase; this.save(job);
        return save(value);
      } catch (error) {
        if (attempt >= 2 || error instanceof StudioConflict || signal.aborted) throw error;
        const message = (error instanceof AgentFailure && error.cause instanceof Error ? error.cause.message : safeError(error)).slice(0, 1200);
        workflow.formatErrors.push(message); this.save(job);
        logWorkflowDebug('format.correction', { error: message });
        correction = { previous: structured, error: message };
      }
    }
  }
  /** Validate and write one node's page fields; every save is a single atomic studio batch. */
  private saveWorkflowResult(job: Job, project: StudioRecord, episode: StudioRecord, source: Record<string, unknown>, structured: unknown): Record<string, unknown> {
    validateWorkflowFields(job.kind, structured, job.kind === 'extract-assets' ? this.studio.snapshot().assets.filter(item => item.projectId === project.id) : [], String(job.input.mode || (job.workflow?.context as { mode?: string } | undefined)?.mode || '参考生成'));
    if (job.kind === 'revise-cuts') { const state = this.studio.snapshot(); planShotAdjustment(structured, episode, source, state.shots.filter(item => item.episodeId === episode.id), state.clips.filter(item => item.episodeId === episode.id)); return { readyToApply: true }; }
    if (job.kind === 'revise-script') { saveRedrawScript(this.studio, episode, structured, job.id, { replace: true, validateOnly: true }); return { readyToApply: true }; }
    if (job.kind === 'revise-storyboard' || job.kind === 'plan-storyboard') { validateRevision(structured, this.studio.snapshot().shots.filter(item => item.episodeId === episode.id), job.kind === 'plan-storyboard'); return { readyToApply: true }; }
    if (job.kind === 'analyze') return saveRedrawStoryboard(this.studio, project, episode, source, structured, job.id);
    if (job.kind === 'write-script') return saveRedrawScript(this.studio, episode, structured, job.id);
    if (job.kind === 'novel-script') return saveNovelScript(this.studio, episode, structured, job.id);
    if (job.kind === 'script-storyboard') {
      const videoModel = (job.workflow?.context as { videoModel?: { modelId: string; seconds: number[] } })?.videoModel;
      if (!videoModel?.seconds.length) throw new Error('原任务缺少视频模型时长配置');
      return saveScriptStoryboard(this.studio, project, episode, job.versions, structured, job.id, videoModel, String(job.input.mode || (job.workflow?.context as { mode?: string } | undefined)?.mode || '参考生成'));
    }
    if (job.kind === 'script-assets') return saveScriptAssets(this.studio, project, job.versions, rawOutput(job.workflow) || '', structured, job.id);
    if (job.kind === 'extract-assets') return this.saveAssetWorkflow(job, project, episode, structured);
    if (job.kind === 'video-prompts') {
      const videoModel = (job.workflow?.context as { videoModel?: { seconds: number[]; modelId: string } })?.videoModel;
      if (!videoModel?.seconds?.length) throw new Error('原任务缺少视频模型时长配置');
      return saveRedrawVideoPrompts(this.studio, project, episode, job.versions, structured, String(job.input.mode || '参考生成'), job.id, videoModel.seconds, videoModel.modelId);
    }
    throw new Error('任务类型不能重新整理');
  }
  /** Latest completed upstream reports for this episode and source; page records stay authoritative. */
  private upstreamReports(job: Job, project: StudioRecord, episode: StudioRecord, source: Record<string, unknown>) {
    const jobs = this.jobs(project.id);
    return (UPSTREAM[job.kind] || []).flatMap(kind => {
      const adjustmentKind = kind === 'analyze' ? 'revise-cuts' : kind === 'write-script' ? 'revise-script' : '';
      const prior = jobs.find(item => (item.kind === kind || (item.kind === adjustmentKind && item.result?.applied === true && !this.adjustmentRestored(item))) && (item.episodeId || this.episode(project).id) === episode.id && item.status === 'completed' && item.sourceFileId === source.fileId && (kind !== 'plan-storyboard' || item.result?.applied === true));
      const original = (prior?.workflow?.context as { originalReport?: string } | undefined)?.originalReport;
      const latest = typeof prior?.result?.analysis === 'string' && prior.result.analysis.trim() ? prior.result.analysis : rawOutput(prior?.workflow);
      const report = original && latest ? `${original}\n\n${latest}` : latest;
      return prior && report ? [{ kind, jobId: prior.id, createdAt: prior.createdAt, report }] : [];
    });
  }
  /** Use the video-prompt workflow's current configuration and handoff for existing clips. */
  async adjustVideoPrompts(projectId: string, episodeId: string, items: unknown[], requirements: string, signal: AbortSignal) {
    const project = this.project(projectId), episode = this.episode(project, episodeId), source = this.source(project, episode);
    const kind: WorkflowKind = project.creationMode === 'video-redraw' ? 'video-prompts' : 'script-storyboard';
    const config = this.dependencies.workflowAgent?.(kind) || defaultWorkflowAgents().find(item => item.kind === kind)!;
    if (!config.instructions.trim()) throw new Error('请先在设置 → 工作流 Agents 中配置并保存视频提示词系统提示词');
    const skills = this.dependencies.workflowSkills?.(config.skillIds) || [];
    if (skills.length !== config.skillIds.length) throw new Error('工作流 Skill 配置不可用');
    const selected = this.dependencies.model?.(config.model), formatter = this.dependencies.model?.(config.formatterModel);
    if (!selected || !formatter) throw new Error('请配置视频提示词工作流的执行模型和整理模型');
    const videoModel = this.dependencies.videoDurations?.();
    if (!videoModel?.seconds.length) throw new Error('请在模型设置中配置默认视频模型支持的整数时长（不超过 15 秒）');
    const state = this.studio.snapshot();
    const context = {
      projectId, episodeId, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, outline: project.outline, adaptation: project.adaptation, requirements: project.requirements },
      videoModel, script: episode.script, scenes: episode.scenes, shots: state.shots.filter(item => item.episodeId === episodeId).sort((a, b) => Number(a._position || 0) - Number(b._position || 0)),
      assets: state.assets.filter(item => item.projectId === projectId), items, requirements,
    };
    const job = { projectId, episodeId, kind: 'video-prompts' } as Job;
    const reports = project.creationMode === 'video-redraw' ? this.upstreamReports(job, project, episode, source) : [];
    const [formal, handoff, adjustment, formatterGuide, formatterContract] = await Promise.all([
      readFile(new URL('../prompts/redraw-formal-video-handoff.md', import.meta.url), 'utf8'),
      readFile(new URL('../prompts/workflow-handoff.md', import.meta.url), 'utf8'),
      readFile(new URL('../prompts/redraw-video-adjustment.md', import.meta.url), 'utf8'),
      readFile(new URL('../prompts/workflow-formatter.md', import.meta.url), 'utf8'),
      readFile(new URL('../prompts/redraw-video-adjustment-formatter.md', import.meta.url), 'utf8'),
    ]);
    const execution = workflowExecution(config, skills, randomUUID(), this.dependencies, [], () => {});
    const input = { ...context, upstreamReports: reports.map(({ kind, report }) => ({ kind, report })) };
    let raw: string;
    try { raw = await runTextWorkflow(selected.provider, selected.model, input, [workflowInstructions(config, skills), ...(project.creationMode === 'video-redraw' ? [formal, handoff] : []), adjustment].join('\n\n'), signal, execution); }
    catch (error) { signal.throwIfAborted(); throw new Error(safeError(error, selected.provider.apiKey)); }
    if (!raw.trim()) throw new Error('视频提示词工作流未返回调整结果');
    let correction: { previous: string; error: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      let result = '';
      try {
        for await (const chunk of generate(formatter.provider, formatter.model, [{ role: 'user', content: JSON.stringify({ context, raw, ...correction }) }], `${formatterGuide}\n\n${formatterContract}`, undefined, signal, undefined, Output.json())) result += chunk;
      } catch (error) {
        signal.throwIfAborted();
        if (!result.trim()) throw new Error(safeError(error, formatter.provider.apiKey));
      }
      if (!result.trim()) throw new Error('视频提示词整理模型未返回结果');
      const output = parseBatchPromptResults(result) as Array<{ clipId?: unknown; prompt?: unknown; error?: unknown }>;
      const errors: string[] = [];
      for (const item of items as Array<{ clip: { id: string; duration?: number } }>) {
        const matches = output.filter(entry => entry?.clipId === item.clip.id);
        if (matches.length !== 1) { errors.push(`片段 ${item.clip.id} 的结果${matches.length ? '重复' : '缺失'}`); continue; }
        const entry = matches[0];
        if (typeof entry.error === 'string' && entry.error.trim()) continue;
        if (typeof entry.prompt !== 'string' || !entry.prompt.trim() || entry.prompt.length > 16000) { errors.push(`片段 ${item.clip.id} 的视频提示词缺失或过长`); continue; }
        try { validatePromptTiming(entry.prompt, 'prompt', item.clip.duration); } catch (error) { errors.push(`片段 ${item.clip.id}：${safeError(error)}`); }
      }
      if (!errors.length || attempt >= 2) return result;
      correction = { previous: result, error: errors.join('；').slice(0, 1200) };
    }
  }
  /** Execution input: page context plus full upstream reports; the formatter later gets the context only. */
  private async handoff(job: Job, project: StudioRecord, episode: StudioRecord, source: Record<string, unknown>, context: Record<string, unknown>, instructions: string) {
    const reports = this.upstreamReports(job, project, episode, source);
    job.workflow!.context = context; job.workflow!.handoff = reports.map(({ report: _report, ...ref }) => ref); this.save(job);
    if (!reports.length) return { input: context, instructions };
    const guide = await readFile(new URL('../prompts/workflow-handoff.md', import.meta.url), 'utf8');
    return { input: { ...context, upstreamReports: reports.map(({ kind, report }) => ({ kind, report })) }, instructions: `${instructions}\n\n${guide}` };
  }
  private assertWorkflowVersions(job: Job) {
    const state = this.studio.snapshot(), project = state.projects.find(item => item.id === job.projectId), episode = state.episodes.find(item => item.id === job.episodeId);
    if (!project || project._version !== job.projectVersion || !episode || episode._version !== job.versions[recordKey('episodes', episode.id)]) throw new StudioConflict('项目或剧集在运行期间发生变化，结果未写入，请重新检查');
    const relevant = [...state.assets.filter(item => item.projectId === job.projectId).map(item => recordKey('assets', item.id)), ...state.shots.filter(item => item.episodeId === job.episodeId).map(item => recordKey('shots', item.id)), ...(['revise-cuts', 'revise-script'].includes(job.kind) ? state.clips.filter(item => item.episodeId === job.episodeId).map(item => recordKey('clips', item.id)) : [])];
    if (relevant.some(key => job.versions[key] === undefined) || Object.entries(job.versions).some(([key, version]) => {
      const [resource, id] = key.split(':');
      return resource === 'assets' ? !state.assets.some(item => item.id === id && item._version === version) : resource === 'shots' ? !state.shots.some(item => item.id === id && item._version === version) : resource === 'clips' ? !state.clips.some(item => item.id === id && item._version === version) : false;
    })) throw new StudioConflict('资产或分镜在运行期间发生变化，结果未写入，请重新检查');
  }
  private saveAssetWorkflow(job: Job, project: StudioRecord, episode: StudioRecord, structured: unknown) {
    const raw = rawOutput(job.workflow);
    if (!raw) throw new Error('没有可核对的资产原始分析');
    validateAssetPromptFidelity(raw, structured, this.studio.snapshot().assets.filter(item => item.projectId === project.id));
    return saveExtractedAssets(this.studio, project, episode, structured, job.versions, job.id);
  }
  private async run(job: Job, controller: AbortController) {
    if (!this.dependencies.debugLog || !job.workflow) return this.runJob(job, controller);
    return runWithWorkflowDebug({ write: this.dependencies.debugLog, jobId: job.id, projectId: job.projectId, episodeId: job.episodeId, kind: job.kind, phase: () => job.phase }, async () => {
      logWorkflowDebug('job.started', { input: job.input, config: job.workflow?.config, skills: job.workflow?.skills });
      await this.runJob(job, controller);
      logWorkflowDebug('job.finished', { status: job.status, error: job.error, result: job.result });
    });
  }
  private async runJob(job: Job, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    try {
      job.status = 'running'; this.save(job);
      const project = this.project(job.projectId), episode = this.episode(project, job.episodeId), source = this.source(project, episode);
      if (job.sourceFileId && source.fileId !== job.sourceFileId) throw new StudioConflict('本集原片已改变，请重新提交');
      const workflow = job.workflow;
      const execution = workflow && job.input.retryFormat !== true && job.input.retrySave !== true ? workflowExecution(workflow.config, workflow.skills, job.id, this.dependencies, workflow.steps, () => this.save(job)) : undefined;
      const instructions = workflow && workflowInstructions(workflow.config, workflow.skills);
      if (workflow && instructions && job.input.retryFormat !== true && job.input.retrySave !== true) { workflow.skillResourcesLoaded = true; this.save(job); }
      const savePartial = (content: string) => { if (workflow) { workflow.outputs.push({ output_type: 'raw', content, incomplete: true }); this.save(job); } };
      if (job.input.retryFormat === true || job.input.retrySave === true) {
        this.assertWorkflowVersions(job);
        const save = (structured: unknown) => { signal.throwIfAborted(); this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); };
        const saved = workflow?.outputs.find(output => output.output_type === 'structured')?.content;
        let summary: Record<string, unknown>;
        if (job.input.retrySave === true) { const structured = parseModelJson(saved || ''); job.phase = '校验并保存结果'; this.save(job); summary = save(structured); }
        else summary = await this.formatAndSave(job, signal, '校验并保存结果', save);
        job.result = { analysis: rawOutput(workflow), ...summary };
        if (['revise-cuts', 'revise-script'].includes(job.kind)) {
          signal.throwIfAborted(); job.phase = '应用调整'; this.save(job);
          this.applyAdjustment(job.id, this.project(job.projectId), this.episode(this.project(job.projectId), job.episodeId), true);
          job.result = { ...job.result, applied: true };
        }
      } else if (job.kind === 'revise-cuts' || job.kind === 'revise-script') {
        if (!workflow || !instructions) throw new Error('原工作流配置不存在');
        this.assertWorkflowVersions(job);
        const parent = this.job(String(job.input.jobId)), state = this.studio.snapshot();
        const parentContext = (parent.workflow?.context || {}) as { originalReport?: string; feedbackHistory?: Array<{ requirements: string; report: string }> };
        const originalReport = parentContext.originalReport || rawOutput(parent.workflow) || '';
        const feedbackHistory = [...(parentContext.feedbackHistory || []), ...(parent.kind === job.kind ? [{ requirements: String(parent.input.requirements || ''), report: rawOutput(parent.workflow) || '' }] : [])];
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, episode: { duration: episode.duration, script: episode.script }, duration: source.duration, scenes: episode.scenes, shots: state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0)), clips: state.clips.filter(item => item.episodeId === episode.id).map(({ id, shotIds }) => ({ id, shotIds })), assets: state.assets.filter(item => item.projectId === project.id), originalReport, feedbackHistory, requirements: job.input.requirements };
        workflow.context = context; workflow.handoff = [{ kind: parent.kind, jobId: parent.id, createdAt: parent.createdAt }]; this.save(job);
        const guide = await readFile(new URL('../prompts/redraw-adjust-feedback.md', import.meta.url), 'utf8');
        let raw: string;
        if (job.kind === 'revise-cuts') {
          const analysis = this.dependencies.analysisCredentials?.();
          if (!analysis?.apiKey || !analysis.baseUrl) throw new Error('请先配置视频分析接口地址与 API Key');
          if (analysis.videoUrlFormat && !['object', 'string'].includes(analysis.videoUrlFormat)) throw new Error('视频分析地址格式配置无效');
          job.phase = '准备原片地址'; this.save(job);
          const videoUrl = await this.files.ensureCosUrl(String(source.fileId), signal);
          job.phase = '对照原片调整镜头'; this.save(job);
          raw = await runVideoWorkflow(analysis.baseUrl, analysis.apiKey, workflow.config.model, `${instructions}\n\n${guide}`, [{ type: 'text', text: JSON.stringify(context) }, { type: 'video_url', video_url: analysis.videoUrlFormat === 'string' ? videoUrl : { url: videoUrl } }], signal, execution, savePartial);
        } else {
          const selected = this.dependencies.model?.(workflow.config.model);
          if (!selected) throw new Error('请配置剧本编写模型');
          job.phase = '根据反馈调整剧本'; this.save(job);
          raw = await runTextWorkflow(selected.provider, selected.model, context, `${instructions}\n\n${guide}`, signal, execution, savePartial);
        }
        if (!raw.trim()) throw new Error('执行 Agent 未返回调整结果');
        workflow.outputs.push({ output_type: 'raw', content: raw }); this.save(job);
        job.result = await this.formatAndSave(job, signal, '校验调整结果', structured => { this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
        signal.throwIfAborted(); job.phase = '应用调整'; this.save(job);
        this.applyAdjustment(job.id, this.project(job.projectId), this.episode(this.project(job.projectId), job.episodeId), true);
        job.result = { ...job.result, applied: true };
      } else if (job.kind === 'plan-storyboard') {
        if (!workflow || !instructions) throw new Error('正式分镜工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用正式分镜文本模型');
        this.assertWorkflowVersions(job);
        const state = this.studio.snapshot();
        const context = { projectId: project.id, episodeId: episode.id, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, script: episode.script, scenes: episode.scenes, shots: state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0)), assets: state.assets.filter(item => item.projectId === project.id), requirements: job.input.requirements || '' };
        const handoff = await this.handoff(job, project, episode, source, context, instructions);
        job.phase = '分析并编写正式分镜'; this.save(job);
        const raw = await runTextWorkflow(selected.provider, selected.model, handoff.input, handoff.instructions, signal, execution, savePartial);
        if (!raw.trim()) throw new Error('正式分镜模型未返回内容');
        signal.throwIfAborted(); workflow.outputs.push({ output_type: 'raw', content: raw }); this.save(job);
        job.result = await this.formatAndSave(job, signal, '校验并保存正式分镜建议', structured => { this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
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
        job.result = await this.formatAndSave(job, signal, '校验并保存分镜调整建议', structured => { this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
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
        this.studio.apply(`redraw-metadata-${hash(job.id).slice(0, 24)}`, [this.sourceChange(liveProject, liveEpisode, { ...liveSource, ...info, segments: candidates })], { source: 'workflow', kind: 'analyze', jobId: job.id });
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
        const summary = await this.formatAndSave(job, signal, '校验并保存分镜', structured => { this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
        job.result = { analysis: raw, ...summary };
      } else if (job.kind === 'script-storyboard') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用剧本分镜文本模型');
        const videoModel = this.dependencies.videoDurations?.();
        if (!videoModel?.seconds.length) throw new Error('请先配置默认视频模型支持的片段时长');
        const state = this.studio.snapshot();
        const context = { projectId: project.id, episodeId: episode.id, project: { outline: project.outline, adaptation: project.adaptation, requirements: project.requirements, durationMin: project.durationMin, durationMax: project.durationMax }, episode: { number: episode.number, title: episode.title, duration: episode.duration, script: episode.script, scenes: episode.scenes }, assets: state.assets.filter(item => item.projectId === project.id), videoModel, mode: job.input.mode || '参考生成', requirements: job.input.requirements || '' };
        workflow.context = context; this.save(job);
        job.phase = '根据大纲、剧本和资产编写分镜'; this.save(job);
        const modeInstructions = await readFile(new URL('../prompts/script-storyboard-mode.md', import.meta.url), 'utf8');
        workflow.adjustmentInstructions = modeInstructions; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, context, `${instructions}\n\n${modeInstructions}`, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('剧本分镜模型未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存分镜', structured => { signal.throwIfAborted(); return this.saveWorkflowResult(job, project, episode, source, structured); });
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'script-assets') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用剧本资产提取文本模型');
        const state = this.studio.snapshot();
        const context = { projectId: project.id, project: { outline: project.outline, requirements: project.requirements, adaptation: project.adaptation }, episodes: state.episodes.filter(item => item.projectId === project.id).map(item => ({ id: item.id, number: item.number, title: item.title, script: item.script, scenes: item.scenes })), requirements: job.input.requirements || '' };
        workflow.context = context; this.save(job);
        job.phase = '根据剧本提取美术资产'; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, context, instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('剧本资产提取接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存资产', structured => { signal.throwIfAborted(); return this.saveWorkflowResult(job, project, episode, source, structured); });
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'novel-script') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用小说剧本文本模型');
        const state = this.studio.snapshot();
        const context = { projectId: project.id, episodeId: episode.id, project: { sourceScript: project.sourceScript, outline: project.outline, adaptation: project.adaptation, requirements: project.requirements, durationMin: project.durationMin, durationMax: project.durationMax }, episode: { number: episode.number, title: episode.title, duration: episode.duration, scenes: episode.scenes }, episodes: state.episodes.filter(item => item.projectId === project.id).map(item => ({ id: item.id, number: item.number, title: item.title, script: item.id === episode.id ? undefined : item.script })), requirements: job.input.requirements || '' };
        workflow.context = context; this.save(job);
        job.phase = '阅读小说并编写剧本'; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, context, instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('小说剧本接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存剧本', structured => { signal.throwIfAborted(); this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'write-script') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用剧本编写文本模型');
        const state = this.studio.snapshot();
        const shots = state.shots.filter(item => item.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0));
        const assets = state.assets.filter(item => item.projectId === project.id);
        const context = { projectId: project.id, episodeId: episode.id, episode: { number: episode.number, title: episode.title, duration: episode.duration }, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, requirements: job.input.requirements || '', scenes: episode.scenes, shots, assets };
        const handoff = await this.handoff(job, project, episode, source, context, instructions);
        job.phase = '分析并编写剧本'; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, handoff.input, handoff.instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('剧本编写接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存剧本', structured => { this.assertWorkflowVersions(job); return this.saveWorkflowResult(job, project, episode, source, structured); });
        job.result = { ...job.result, ...summary };
      } else if (job.kind === 'extract-assets') {
        if (!workflow || !instructions) throw new Error('工作流配置不存在');
        const selected = this.dependencies.model?.(workflow.config.model);
        if (!selected) throw new Error('请在模型设置中配置并启用资产提取文本模型');
        const state = this.studio.snapshot();
        const shots = state.shots.filter(item => item.episodeId === episode.id);
        const assets = state.assets.filter(item => item.projectId === project.id);
        const context = { projectId: project.id, episodeId: episode.id, episode: { duration: episode.duration }, project: { targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements }, extractionRequirements: job.input.requirements || '', scenes: episode.scenes, shots, assets };
        const assetUpdateGuide = await readFile(new URL('../prompts/redraw-assets-update.md', import.meta.url), 'utf8');
        const handoff = await this.handoff(job, project, episode, source, context, `${instructions}\n\n${assetUpdateGuide}`);
        job.phase = '提取并核对美术资产'; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, handoff.input, handoff.instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('资产提取接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存资产', structured => this.saveWorkflowResult(job, project, episode, source, structured));
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
        const formalHandoff = await readFile(new URL('../prompts/redraw-formal-video-handoff.md', import.meta.url), 'utf8');
        const handoff = await this.handoff(job, project, episode, source, context, `${instructions}\n\n${formalHandoff}`);
        job.phase = '编写视频片段提示词'; this.save(job);
        const analysis = await runTextWorkflow(selected.provider, selected.model, handoff.input, handoff.instructions, signal, execution, savePartial);
        if (!analysis.trim()) throw new Error('视频提示词接口未返回内容');
        signal.throwIfAborted();
        workflow.outputs.push({ output_type: 'raw', content: analysis }); job.result = { analysis, model: selected.model.id, providerId: selected.provider.id }; this.save(job);
        const summary = await this.formatAndSave(job, signal, '校验并保存视频提示词', structured => this.saveWorkflowResult(job, project, episode, source, structured));
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
        this.studio.apply(`redraw-${job.id}`, [{ resource: 'films', id: job.id, op: 'create', values: { projectId: project.id, episodeId: episode.id, title: `第${episode.number}集成片`, url: result.url } }], { source: 'workflow', kind: 'export', jobId: job.id });
        job.result = result;
      } else { throw new Error('历史分析任务无法继续，请重新提交原片分析'); }
      signal.throwIfAborted(); job.status = 'completed'; job.phase = '完成'; this.save(job);
    } catch (error) {
      job.status = this.disposed ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed';
      logWorkflowDebug('job.error', { error });
      job.error = safeError(error); this.save(job);
    }
  }
  private applyAdjustment(jobId: string, project: StudioRecord, episode: StudioRecord, running = false) {
    const job = this.job(jobId);
    if (job.projectId !== project.id || job.episodeId !== episode.id || !['revise-cuts', 'revise-script'].includes(job.kind) || !(job.status === 'completed' || (running && job.status === 'running')) || !job.result?.readyToApply || job.result.applied) throw new Error('没有可应用的调整结果');
    const source = this.source(project, episode);
    if (source.fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，不能应用调整');
    this.assertWorkflowVersions(job);
    const structured = parseModelJson(job.workflow?.outputs.find(output => output.output_type === 'structured')?.content || '');
    if (job.kind === 'revise-script') saveRedrawScript(this.studio, episode, structured, job.id, { replace: true });
    else {
      const state = this.studio.snapshot();
      const changes = planShotAdjustment(structured, episode, source, state.shots.filter(item => item.episodeId === episode.id), state.clips.filter(item => item.episodeId === episode.id));
      this.studio.apply(`redraw-adjust-${job.id}`, changes, { source: 'workflow', kind: job.kind, jobId: job.id });
    }
    job.result = { ...job.result, applied: true }; this.save(job);
    return { applied: true };
  }
  private applyRevision(jobId: string, project: StudioRecord, episode: StudioRecord) {
    const job = this.job(jobId);
    if (job.projectId !== project.id || job.episodeId !== episode.id || !['revise-storyboard', 'plan-storyboard'].includes(job.kind) || job.status !== 'completed' || !job.result?.readyToApply || job.result.applied) throw new Error('没有可应用的调整结果');
    if (this.source(project, episode).fileId !== job.sourceFileId) throw new StudioConflict('原片已更换，不能应用调整');
    this.assertWorkflowVersions(job);
    const state = this.studio.snapshot(), shots = state.shots.filter(item => item.episodeId === episode.id);
    const output = job.workflow?.outputs.find(item => item.output_type === 'structured')?.content;
    const revision = validateRevision(parseModelJson(output || ''), shots, job.kind === 'plan-storyboard');
    const changes: StudioChange[] = revision.changes.map(({ shotId, values }) => {
      const shot = shots.find(item => item.id === shotId)!;
      const { sourceDescription, sourceDialogue, dialogue, ...fields } = values;
      const assetIds = values.description === undefined && !dialogue ? undefined : [...new Set([...asList<string>(shot.assetIds), ...mentionedAssets(values.description || '', state.assets.filter(asset => asset.projectId === project.id)).map((asset: { assetId: string }) => asset.assetId), ...(dialogue || []).flatMap(line => line.assetId ? [line.assetId] : [])])];
      return { resource: 'shots', op: 'update', id: shotId, version: shot._version, values: { ...fields, ...(assetIds ? { assetIds } : {}), ...(dialogue ? { dialogue: dialogue.map(line => ({ ...line, id: line.id || randomUUID() })) } : {}), ...(sourceDescription !== undefined || sourceDialogue !== undefined ? { source: { ...(shot.source as object), ...(sourceDescription !== undefined ? { description: sourceDescription } : {}), ...(sourceDialogue !== undefined ? { dialogue: sourceDialogue } : {}) } } : {}) } };
    });
    if (changes.length) this.studio.apply(`redraw-revision-${job.id}`, changes, { source: 'workflow', kind: job.kind, jobId: job.id });
    job.result = { ...job.result, applied: true, appliedCount: changes.length }; this.save(job);
    return { applied: true, count: changes.length };
  }
  private apply(jobId: string, project: StudioRecord, episode: StudioRecord, selected: string[], origin: ChangeOrigin) {
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
    const result = changes.length ? this.studio.apply(randomUUID(), changes, { ...origin, kind: 'apply-draft', jobId: job.id }) : { changed: [] };
    job.applied = [...new Set([...(job.applied || []), ...chosen.map(shot => shot.segmentId)])]; this.save(job);
    return result;
  }
  private mergeAssets(input: Record<string, unknown>, project: StudioRecord, origin: ChangeOrigin) {
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
    return this.studio.apply(randomUUID(), changes, { ...origin, kind: 'merge-assets' });
  }
  dispose() { this.disposed = true; for (const controller of this.running.values()) controller.abort(); }
}

const properties = {
  mode: { type: 'string', enum: ['参考生成', '分镜图'] }, requirements: { type: 'string', maxLength: 2000, description: '剧本编写、资产提取、分镜调整、正式分镜或视频提示词生成的补充要求。' }, projectId: { type: 'string' }, episodeId: { type: 'string' }, jobId: { type: 'string' }, requestId: { type: 'string' }, version: { type: 'integer' },
  start: { type: 'number' }, end: { type: 'number' }, shotId: { type: 'string' }, shotVersion: { type: 'integer' }, split: { type: 'number' },
  shotIds: { type: 'array', items: { type: 'string' } }, fromId: { type: 'string' }, toId: { type: 'string' }, fromVersion: { type: 'integer' }, toVersion: { type: 'integer' },
  selections: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number' } }, required: ['clipId'], additionalProperties: false } },
} as const;
export const REDRAW_TOOLS = [
  { name: 'builtin_wait_video_redraw', title: '等待视频转绘任务', description: '等待指定项目与剧集的剧本分镜、小说剧本、视频分析、镜头和剧本反馈、分镜调整、剧本编写、资产提取、正式分镜或视频提示词任务结束；完成后返回分析结果，失败、中断或取消时返回真实状态和错误。停止等待不会取消后台任务。', risk: 'read' as const, approval: 'workspace' as const, waitForCompletion: true as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId }, required: ['projectId', 'jobId'], additionalProperties: false } },
  { name: 'builtin_read_video_redraw', title: '查询视频转绘', description: '剧本项目可查询小说剧本、剧本资产和剧本分镜任务；describe=true 查询工作流能力和限制；否则以 projectId 和 episodeId 查询该集原片、持久化任务、可应用草稿和错误；传 jobId 读取 analyze、write-script、extract-assets、plan-storyboard、video-prompts 的状态、createdAt、failureStage 失败阶段、工具步骤 steps、outputs（raw 为执行 Agent 的完整报告，会交付给下游节点；structured 为整理 Agent 输出的页面字段）、mode（任务运行时的生成方式）、handoff（本次执行收到的上游报告任务）、formatErrors（校验失败后交回整理 Agent 自动修正的错误）和 skippedLinks（因镜头文字缺少角色名而未写入的角色关联），失败任务也可读取已保存输出；或用 cursor、limit 分页读取历史切镜结果或原声转写；detail=turns/words 只读取该任务已有转写。各节点写入的修改记录在全局变更日志中，用变更日志工具查询和还原。省略 episodeId 兼容第一集。查询不触发生成。', risk: 'read' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 }, detail: { type: 'string', enum: ['turns', 'words'] }, describe: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'builtin_edit_video_redraw', title: '操作视频转绘', description: '按 episodeId 操作对应剧集，省略则使用第一集。剧本项目使用 script-storyboard 读取大纲、本集剧本和资产，按剧情顺序生成片段及视频提示词，分镜图模式另生成分镜图提示词，参考生成模式不生成；允许回到已有场次；仅本集没有片段时允许；使用 script-assets 从全部剧本与大纲提取全项目资产，仅项目资产为空时允许；使用 novel-script，根据小说原文、大纲和分集信息生成当前集剧本，独立配置执行及整理 Agent，已有正文不覆盖；analyze、write-script、extract-assets、plan-storyboard、video-prompts 每个节点由各自的执行 Agent 输出完整报告，再由独立整理 Agent 转为页面字段；校验未通过时会把具体错误交回整理 Agent 最多自动修正两次。write-script、extract-assets、plan-storyboard、video-prompts 会把同集上游节点最近完成的完整报告交给执行 Agent，页面记录与报告冲突时以页面记录为准。analyze 复用原片 COS 地址调用视频模型分析画面与声音，本地原片先通过现有 COS 配置上传；revise-storyboard 将原片和现有分镜发给视频分析 Agent 生成待审核建议；revise-cuts 与 revise-script 带 requirements 继续原工作流 Agent，jobId 可指定上一轮完成的任务；结果经校验后直接应用，可在变更日志还原；镜头可增删及修改时间，关联片段按时间同步引用并保留视频；跨多个片段的新镜头和关联图片镜头的删改会被拒绝；plan-storyboard 使用剧本、上游报告、资产与当前镜头生成正式分镜建议，需用 apply-revision 审核后应用；apply-revision 传 jobId，校验版本后应用建议；write-script 编写并整理剧本，保留已有场次与目标对白，已有剧本不覆盖；extract-assets 更新已有资产文字与提示词并新增缺失资产和镜头关联，镜头文字中找不到名字的已有角色关联不写入并在 skippedLinks 中列出；video-prompts 根据已确认分镜与用户 mode、requirements 创建视频片段和提示词，已有片段不覆盖；retry-format 使用失败任务 jobId、最新项目 version 和新的 requestId 从原始报告重新整理；retry-save 使用已保存的整理结果重试校验与保存，不调用模型；完成后用等待工具取得结果；分析失败时报告真实错误，不自动改用其他分析方式；cancel 取消；merge-assets 合并重复资产，export 按 selections 的 clipId 顺序合成已选用视频，保留生成音轨。所有写入都记入全局变更日志，可用变更日志工具还原。提交长任务须 requestId、最新项目 version，返回任务后查询。失败后使用新 requestId 重新提交。', risk: 'write' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, episodeId: properties.episodeId, jobId: properties.jobId, requestId: properties.requestId, version: properties.version, requirements: properties.requirements, mode: properties.mode, fromId: properties.fromId, toId: properties.toId, fromVersion: properties.fromVersion, toVersion: properties.toVersion, selections: properties.selections, action: { type: 'string', enum: ['analyze', 'revise-storyboard', 'revise-cuts', 'revise-script', 'plan-storyboard', 'apply-revision', 'write-script', 'novel-script', 'script-assets', 'script-storyboard', 'extract-assets', 'video-prompts', 'retry-format', 'retry-save', 'cancel', 'merge-assets', 'export'] } }, required: ['projectId', 'action'], additionalProperties: false } },
] as const;

export async function handleRedrawRequest(req: IncomingMessage, res: ServerResponse, service: VideoRedraw) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/video-redraw/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '仅允许本机或局域网' }); return true; }
  try {
    if (req.method === 'GET' && url.pathname === '/api/video-redraw/outline') {
      sendRevalidatedJson(req, res, service.readOutline(String(url.searchParams.get('projectId') || ''), url.searchParams.get('jobId') || undefined, url.searchParams.get('input') === '1'));
    } else if (req.method === 'POST' && url.pathname === '/api/video-redraw/outline') {
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('请求超过1MB'); }
      const input = JSON.parse(body);
      send(200, input.action === 'cancel' ? service.cancelOutline(String(input.projectId || ''), String(input.jobId || '')) : ['retry-format', 'retry-save'].includes(input.action) ? service.retryOutline(input) : service.startOutline(input));
    } else if (req.method === 'GET' && url.pathname === '/api/video-redraw/wait') {
      const controller = new AbortController(); res.once('close', () => controller.abort());
      send(200, await service.wait({ projectId: url.searchParams.get('projectId'), episodeId: url.searchParams.get('episodeId') || undefined, jobId: url.searchParams.get('jobId') }, controller.signal));
    } else if (req.method === 'GET' && url.pathname === '/api/video-redraw/clip') {
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const bytes = await service.clip(String(url.searchParams.get('projectId') || ''), url.searchParams.get('episodeId') || undefined, String(url.searchParams.get('shotId') || ''), controller.signal);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
    // input=1 is page-only: the flow view shows what the execution Agent actually received; the Agent tool schema does not expose it.
    } else if (req.method === 'GET') sendRevalidatedJson(req, res, service.read({ projectId: url.searchParams.get('projectId'), episodeId: url.searchParams.get('episodeId') || undefined, jobId: url.searchParams.get('jobId') || undefined, cursor: url.searchParams.get('cursor') || undefined, limit: url.searchParams.get('limit') || undefined, detail: url.searchParams.get('detail') || undefined, describe: url.searchParams.has('describe'), includeInput: url.searchParams.get('input') === '1' }));
    else if (req.method === 'POST' && url.pathname === '/api/video-redraw/action') {
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('请求超过1MB'); }
      send(200, await service.edit(JSON.parse(body)));
    } else send(405, { error: '不支持的操作' });
  } catch (error) { send(error instanceof StudioConflict ? 409 : 422, { error: safeError(error) }); }
  return true;
}
