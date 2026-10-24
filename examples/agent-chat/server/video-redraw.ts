import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentModelConfig } from '../../../src/index';
import type { StudioChange, StudioRecord } from '../studio-schema';
import prompts from '../prompts/video-redraw.json';
import { StudioStore, StudioConflict } from './studio';
import { generate, safeError, type ChatMessage, type StoredProvider } from './models';
import type { TimedTranscript } from './voice';
import { REDRAW_LIMITS, analysisFrameSheet, composeVideo, extractFrame, prepareVideo, videoCommand, withVideoFiles, type SourceSegment } from './video-processing';
import { isLocalOrLanAddress } from './local-access';

type DraftAsset = { key: string; type: string; name: string; description: string; targetName: string; targetDescription: string; targetAppearance?: string; targetCostume?: string; targetVoiceDescription?: string; targetPrompt?: string; evidenceSegmentId: string; frameIndex: number };
type DraftShot = { segmentId: string; sceneKey: string; description: string; dialogue: string; scale: string; camera: string; transition: string; effects: string; assetKeys: string[]; targetDescription: string; targetDuration?: number; targetDialogue: Array<{ assetKey: string; text: string; description: string }>; notes: string };
export type RedrawDraft = { assets: DraftAsset[]; shots: DraftShot[] };
type Job = { id: string; projectId: string; sourceFileId?: string; kind: 'prepare' | 'analyze' | 'export'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; createdAt: string; error?: string; input: Record<string, unknown>; fingerprint: string;
  versions: Record<string, number>; projectVersion: number; draft: RedrawDraft; segments: SourceSegment[]; transcript?: TimedTranscript; result?: Record<string, unknown>; applied?: string[] };
type Dependencies = {
  model: (modelId: string) => { provider: StoredProvider; model: AgentModelConfig };
  instructions: (agentId: string) => Promise<string>;
  transcribe: (bytes: Buffer, language: string, signal: AbortSignal) => Promise<TimedTranscript>;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];
const text = (value: unknown, label: string) => { if (typeof value !== 'string' || value.length > 16_000) throw new Error(`${label} 须为文本且不超过16000字`); return value; };
const recordKey = (resource: string, id: string) => `${resource}:${id}`;

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
  private save(job: Job) { this.db.prepare('INSERT INTO video_redraw_jobs(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, job.projectId, JSON.stringify(job)); }
  private project(id: string) {
    const project = this.studio.snapshot().projects.find(item => item.id === id);
    if (!project || project.creationMode !== 'video-redraw') throw new Error('视频转绘项目不存在');
    return project;
  }
  private job(id: string) { const job = this.jobs().find(job => job.id === id); if (!job) throw new Error('解析任务不存在'); return job; }
  describe() { return { limits: REDRAW_LIMITS, regions: { japan: 'ja', western: 'en' }, operations: REDRAW_TOOLS.map(tool => tool.parameters), supportsVideoReference: false }; }
  read(input: Record<string, unknown>) {
    if (input.describe === true) return this.describe();
    const projectId = String(input.projectId || ''); this.project(projectId);
    return { jobs: this.jobs(projectId), source: this.project(projectId).sourceVideo };
  }
  async edit(input: Record<string, unknown>) {
    const allowed = new Set([...Object.keys(properties), 'action']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('转绘请求包含未知参数');
    if (input.visualOnly !== undefined && typeof input.visualOnly !== 'boolean') throw new Error('visualOnly 须为布尔值');
    const projectId = String(input.projectId || ''), project = this.project(projectId);
    const action = String(input.action);
    if (action === 'cancel') {
      const job = this.job(String(input.jobId));
      if (job.projectId !== projectId) throw new Error('任务不属于当前项目');
      if (['queued', 'running'].includes(job.status)) { job.status = 'cancelled'; this.running.get(job.id)?.abort(); this.save(job); }
      return job;
    }
    if (action === 'apply') return this.apply(String(input.jobId), project, asList<string>(input.shotIds));
    if (action === 'frame' || action === 'edit-shot') return this.editSource(input, project);
    if (action === 'merge-assets') return this.mergeAssets(input, project);
    if (action === 'merge-shots') return this.mergeShots(input, project);
    if (!['prepare', 'analyze', 'export'].includes(action)) throw new Error('不支持的转绘操作');
    const requestId = String(input.requestId || '');
    if (!/^[\w-]{8,160}$/.test(requestId)) throw new Error('提交任务须提供唯一 requestId，原样重试沿用');
    const fingerprint = hash(input), prior = this.jobs().find(job => job.id === requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('同一 requestId 不能用于不同请求'); return prior; }
    if (this.jobs(projectId).some(job => ['running', 'queued'].includes(job.status))) throw new Error('本项目已有任务运行，请完成或取消后再提交');
    if (this.running.size >= 2) throw new Error('当前有两个转绘任务运行，请稍后提交');
    if (input.version !== project._version) throw new StudioConflict('项目设置已变化，请重新读取');
    const source = project.sourceVideo as Record<string, unknown>;
    if (!source.fileId) throw new Error('请先上传原视频');
    let segments = asList<SourceSegment>(source.segments);
    if (action === 'analyze') {
      this.dependencies.model(String(input.modelId || ''));
      if (!segments.length) throw new Error('请先完成切镜和抽帧');
      const start = input.start === undefined ? 0 : Number(input.start), end = input.end === undefined ? Number(source.duration) : Number(input.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(source.duration)) throw new Error('补漏区间无效');
      segments = segments.filter(segment => segment.end > start && segment.start < end);
      if (!segments.length) throw new Error('所选区间没有镜头');
    }
    const resume = input.resumeJobId ? this.job(String(input.resumeJobId)) : undefined;
    if (resume && (resume.projectId !== projectId || resume.kind !== action || !['failed', 'cancelled', 'interrupted'].includes(resume.status)
      || resume.projectVersion !== project._version || resume.input.modelId !== input.modelId || resume.input.agentId !== input.agentId
      || resume.input.sourceLanguage !== input.sourceLanguage || resume.input.visualOnly !== input.visualOnly || resume.input.start !== input.start || resume.input.end !== input.end)) throw new Error('旧任务与当前设置或区间不一致，请新建分析');
    const state = this.studio.snapshot();
    const reusableTranscript = input.visualOnly === true ? undefined : this.jobs().find(job => job.transcript
      && (job.sourceFileId || (state.projects.find(item => item.id === job.projectId)?.sourceVideo as Record<string, unknown>)?.fileId) === source.fileId
      && String(job.input.sourceLanguage || '') === String(input.sourceLanguage || ''))?.transcript;
    const job: Job = { id: requestId, projectId, sourceFileId: String(source.fileId), kind: action as Job['kind'], status: 'queued', phase: '排队', createdAt: new Date().toISOString(), input, fingerprint,
      projectVersion: project._version, versions: Object.fromEntries(['assets', 'shots', 'episodes'].flatMap(resource => state[resource as 'assets'].map(item => [recordKey(resource, item.id), item._version]))),
      segments, draft: resume?.draft || { assets: [], shots: [] }, ...(resume?.transcript || reusableTranscript ? { transcript: resume?.transcript || reusableTranscript } : {}) };
    this.save(job);
    const controller = new AbortController(); this.running.set(job.id, controller);
    void this.run(job, controller).finally(() => this.running.delete(job.id));
    return job;
  }
  private async run(job: Job, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    try {
      job.status = 'running'; this.save(job);
      const project = this.project(job.projectId), source = project.sourceVideo as Record<string, unknown>;
      if (job.kind === 'prepare') {
        job.phase = '检测切镜与提取参考帧'; job.segments = []; this.save(job);
        const result = await prepareVideo(this.files, String(source.fileId), signal, segment => { job.segments.push(segment); this.save(job); });
        signal.throwIfAborted();
        const live = this.project(job.projectId);
        if (live._version !== job.projectVersion) throw new StudioConflict('项目已修改，抽帧结果保留在任务中，未覆盖项目');
        this.studio.apply(`redraw-${job.id}`, [{ resource: 'projects', id: live.id, op: 'update', version: live._version, values: { sourceVideo: { ...result, ...(source.name ? { name: source.name } : {}) } } }]);
        job.result = result;
      } else if (job.kind === 'analyze') {
        const selected = this.dependencies.model(String(job.input.modelId));
        const instructions = await this.dependencies.instructions(String(job.input.agentId || ''));
        if (source.hasAudio && job.input.visualOnly !== true && !job.transcript) {
          job.phase = '提取原声并按原语言转写'; this.save(job);
          job.transcript = await withVideoFiles(this.files, [String(source.fileId)], async ([path], root) => {
            const audio = join(root, 'source.wav');
            await videoCommand('ffmpeg', ['-y', '-i', path, '-vn', '-ac', '1', '-ar', '16000', audio], signal);
            return this.dependencies.transcribe(await readFile(audio), String(job.input.sourceLanguage || ''), signal);
          });
          this.save(job);
        }
        const state = this.studio.snapshot(), existing = state.assets.filter(asset => asset.projectId === project.id);
        const pending = job.segments.filter(segment => !job.draft.shots.some(shot => shot.segmentId === segment.id));
        for (let index = 0; index < pending.length;) {
          signal.throwIfAborted();
          const segments: SourceSegment[] = [];
          let frameCount = 0;
          while (index < pending.length && segments.length < 4) {
            const segment = pending[index];
            if (segments.length && frameCount + segment.frames.length > 12) break;
            segments.push(segment); frameCount += segment.frames.length; index++;
          }
          job.phase = `视觉分析 ${job.draft.shots.length}/${job.segments.length} 镜头`; this.save(job);
          const sheet = await analysisFrameSheet(this.files, segments, signal);
          const transcriptSegments = job.transcript?.segments.filter(line => segments.some(segment => line.end > segment.start && line.start < segment.end));
          const content: Exclude<ChatMessage['content'], string> = [{ type: 'text', text: JSON.stringify({ targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements,
            segments: segments.map(({ frames: _, ...segment }) => segment), frameSheet: { width: sheet.width, height: sheet.height, frames: sheet.frames },
            transcript: job.transcript ? { language: job.transcript.language, segments: transcriptSegments } : null, existingAssets: [...existing.map(asset => ({ key: asset.id, type: asset.type, name: asset.name, description: asset.source || asset.description })), ...job.draft.assets],
            instruction: this.prompt('analysis') }) }];
          content.push({ type: 'image', name: 'source-frame-sheet.jpg', mimeType: 'image/jpeg', data: sheet.bytes.toString('base64') });
          let output = '';
          for await (const chunk of generate(selected.provider, selected.model, [{ role: 'user', content }], instructions, undefined, signal)) output += chunk;
          const decoded = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
          const known = [...existing, ...job.draft.assets.map(asset => ({ ...asset, id: asset.key, _version: 0 }))];
          const draft = validateRedrawDraft(decoded, segments, known);
          for (const asset of draft.assets) if (!job.draft.assets.some(item => item.key === asset.key)) job.draft.assets.push(asset);
          job.draft.shots.push(...draft.shots); this.save(job);
        }
      } else {
        job.phase = '合成实际片段'; this.save(job);
        const selections = asList<{ clipId: string; start?: number; end?: number }>(job.input.selections);
        const state = this.studio.snapshot();
        const inputs = selections.map(selection => {
          const clip = state.clips.find(clip => clip.id === selection.clipId), episode = state.episodes.find(episode => episode.id === clip?.episodeId);
          if (!clip || episode?.projectId !== project.id || typeof clip.currentVideo !== 'string') throw new Error('所选片段不属于项目或尚未选用视频');
          const fileId = clip.currentVideo.match(/^\/api\/files\/([\w-]+)$/)?.[1];
          if (!fileId) throw new Error('请先将生成结果保存到文件服务并选用');
          return { fileId, start: selection.start ?? 0, ...(selection.end === undefined ? {} : { end: selection.end }) };
        });
        const result = await composeVideo(this.files, inputs, String(project.ratio), signal);
        signal.throwIfAborted();
        this.project(project.id);
        this.studio.apply(`redraw-${job.id}`, [{ resource: 'films', id: job.id, op: 'create', values: { projectId: project.id, title: '视频转绘成片', url: result.url } }]);
        job.result = result;
      }
      signal.throwIfAborted(); job.status = 'completed'; job.phase = '完成'; this.save(job);
    } catch (error) {
      job.status = this.disposed ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = safeError(error); this.save(job);
    }
  }
  prompt(kind: keyof typeof prompts) {
    const entry = this.studio.snapshot().prompts.find(item => item.id === `4-${['analysis', 'asset', 'clip'].indexOf(kind)}`);
    return String(entry?.mode === 'replace' ? entry.text : entry?.defaultText || prompts[kind]);
  }
  private apply(jobId: string, project: StudioRecord, selected: string[]) {
    const job = this.job(jobId);
    if (job.projectId !== project.id || job.kind !== 'analyze' || !job.draft.shots.length) throw new Error('没有可应用的分析草稿');
    if (project._version !== job.projectVersion) throw new StudioConflict('项目地区/语言或设置已变化，请重新分析');
    const state = this.studio.snapshot(), episode = state.episodes.find(item => item.projectId === project.id);
    if (!episode) throw new Error('项目剧集不存在');
    const chosen = selected.length ? job.draft.shots.filter(shot => selected.includes(shot.segmentId)) : job.draft.shots;
    if (!chosen.length) throw new Error('请选择需要应用的镜头');
    const changes: StudioChange[] = [], keyMap = new Map(state.assets.filter(asset => asset.projectId === project.id).map(asset => [asset.id, asset.id]));
    for (const asset of job.draft.assets) keyMap.set(asset.key, keyMap.get(asset.key) || `redraw-${hash([project.id, asset.key]).slice(0, 24)}`);
    const needed = new Set(chosen.flatMap(shot => [shot.sceneKey, ...shot.assetKeys, ...shot.targetDialogue.map(line => line.assetKey).filter(Boolean)]));
    for (const asset of job.draft.assets.filter(asset => needed.has(asset.key))) {
      const id = keyMap.get(asset.key)!, prior = state.assets.find(item => item.id === id);
      if (prior) continue; // Supplement analysis reuses accepted assets without overwriting their target settings.
      const segment = job.segments.find(segment => segment.id === asset.evidenceSegmentId)!;
      changes.push({ resource: 'assets', id, op: 'create', values: { projectId: project.id, episodeIds: [episode.id], type: asset.type, name: asset.targetName, description: asset.targetDescription,
        appearance: asset.targetAppearance || '', costume: asset.targetCostume || '', voiceDescription: asset.targetVoiceDescription || '', prompt: asset.targetPrompt || '',
        source: { fileId: (project.sourceVideo as Record<string, unknown>).fileId, start: segment.start, end: segment.end, frames: [segment.frames[asset.frameIndex]], name: asset.name, description: asset.description, confirmed: false } } });
    }
    const scenes = structuredClone(episode.scenes) as Array<Record<string, unknown>>;
    for (const shot of chosen) {
      const segment = job.segments.find(segment => segment.id === shot.segmentId)!;
      const sceneId = `redraw-scene-${keyMap.get(shot.sceneKey)}`;
        if (!scenes.some(scene => scene.id === sceneId)) scenes.push({ id: sceneId, location: job.draft.assets.find(asset => asset.key === shot.sceneKey)?.targetName || String(state.assets.find(asset => asset.id === shot.sceneKey)?.name || '待确认地点'), setting: '内外', time: '待确认', content: '', suggestedDuration: '' });
      const legacy = state.shots.find(item => item.id === segment.id && item.episodeId === episode.id);
      const shotId = legacy?.id || `redraw-shot-${hash([project.id, segment.id]).slice(0, 24)}`;
      const prior = state.shots.find(item => item.id === shotId);
      if (prior && job.applied?.includes(segment.id)) continue;
      if (prior && prior._version !== job.versions[recordKey('shots', prior.id)]) throw new StudioConflict('镜头已被人工修改，保留当前内容；请重新分析该区间');
        const values = { episodeId: episode.id, sceneId, description: shot.targetDescription, scale: shot.scale, camera: shot.camera, transition: shot.transition, effects: shot.effects, duration: shot.targetDuration || segment.end - segment.start,
        assetIds: [...new Set([shot.sceneKey, ...shot.assetKeys].map(key => keyMap.get(key)!))],
        dialogue: shot.targetDialogue.map(line => ({ id: randomUUID(), type: line.assetKey ? '角色' : '旁白', ...(line.assetKey ? { assetId: keyMap.get(line.assetKey), speaker: job.draft.assets.find(asset => asset.key === line.assetKey)?.targetName || state.assets.find(asset => asset.id === line.assetKey)?.name } : {}), text: line.text, description: line.description })),
        source: { fileId: (project.sourceVideo as Record<string, unknown>).fileId, segmentId: segment.id, start: segment.start, end: segment.end, frames: segment.frames, description: shot.description, dialogue: shot.dialogue, notes: shot.notes, confirmed: false } };
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
  private async editSource(input: Record<string, unknown>, project: StudioRecord) {
    const video = project.sourceVideo as Record<string, unknown>, start = Number(input.start), end = Number(input.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(video.duration)) throw new Error('原片区间无效');
    return withVideoFiles(this.files, [String(video.fileId)], async ([path], root) => {
      const frame = await extractFrame(this.files, path, root, (start + end) / 2, AbortSignal.timeout(60_000));
      const source = { fileId: video.fileId, start, end, frames: [frame], confirmed: false };
      if (input.action === 'frame') return { source };
      const shot = this.studio.snapshot().shots.find(item => item.id === input.shotId), episode = this.studio.snapshot().episodes.find(item => item.id === shot?.episodeId);
      if (!shot || episode?.projectId !== project.id || input.shotVersion !== shot._version) throw new StudioConflict('镜头已修改或不属于本项目');
      const segmentId = String((shot.source as Record<string, unknown>)?.segmentId || shot.id);
      if (input.split !== undefined) {
        const split = Number(input.split);
        if (!(split > start && split < end)) throw new Error('拆分点须在镜头区间内');
        if (this.studio.snapshot().clips.some(clip => (clip.shotIds as string[]).includes(shot.id))) throw new Error('请先调整已关联片段，避免拆分后丢失视频关联');
        const rightFrame = await extractFrame(this.files, path, root, (split + end) / 2, AbortSignal.timeout(60_000));
        const leftFrame = await extractFrame(this.files, path, root, (start + split) / 2, AbortSignal.timeout(60_000));
        const { id: _, _version: __, _position: ___, ...values } = shot;
        const rightId = randomUUID(), oldSegments = asList<SourceSegment>(video.segments);
        return this.studio.apply(randomUUID(), [
          { resource: 'shots', id: shot.id, op: 'update', version: shot._version, values: { source: { ...(shot.source as object), ...source, end: split, frames: [leftFrame] }, duration: split - start } },
          { resource: 'shots', id: rightId, op: 'create', position: Number(shot._position || 0) + 0.001, values: { ...values, source: { ...(shot.source as object), ...source, segmentId: rightId, start: split, frames: [rightFrame] }, duration: end - split, dialogue: [] } },
          { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { sourceVideo: { ...video, segments: oldSegments.flatMap(segment => segment.id === segmentId ? [{ id: segmentId, start, end: split, frames: [leftFrame] }, { id: rightId, start: split, end, frames: [rightFrame] }] : [segment]) } } },
        ]);
      }
      return this.studio.apply(randomUUID(), [
        { resource: 'shots', id: shot.id, op: 'update', version: shot._version, values: { source: { ...(shot.source as object), ...source } } },
        { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { sourceVideo: { ...video, segments: asList<SourceSegment>(video.segments).map(segment => segment.id === segmentId ? { id: segmentId, start, end, frames: [frame] } : segment) } } },
      ]);
    });
  }
  private mergeShots(input: Record<string, unknown>, project: StudioRecord) {
    const state = this.studio.snapshot(), left = state.shots.find(shot => shot.id === input.fromId), right = state.shots.find(shot => shot.id === input.toId);
    const episode = state.episodes.find(episode => episode.id === left?.episodeId);
    if (!left || !right || left.id === right.id || episode?.projectId !== project.id || left.sceneId !== right.sceneId
      || left.episodeId !== right.episodeId || input.fromVersion !== left._version || input.toVersion !== right._version) throw new StudioConflict('请选择同一场次中版本未变化的两个镜头');
    const a = left.source as Record<string, unknown>, b = right.source as Record<string, unknown>;
    if (!a || !b || Math.abs(Number(a.end) - Number(b.start)) > 0.05) throw new Error('只能合并原片时间相邻且顺序一致的镜头');
    if (state.clips.some(clip => asList<string>(clip.shotIds).some(id => id === left.id || id === right.id))) throw new Error('请先调整已关联片段，避免合并后丢失视频关联');
    const source = { ...a, end: b.end, frames: [...asList(a.frames), ...asList(b.frames)].slice(0, 12), description: [a.description, b.description].filter(Boolean).join('\n'), dialogue: [a.dialogue, b.dialogue].filter(Boolean).join('\n'), confirmed: false };
    const video = project.sourceVideo as Record<string, unknown>;
    return this.studio.apply(randomUUID(), [
      { resource: 'shots', id: left.id, op: 'update', version: left._version, values: { source, description: `${left.description}\n${right.description}`, dialogue: [...asList(left.dialogue), ...asList(right.dialogue)], duration: Number(left.duration) + Number(right.duration), assetIds: [...new Set([...asList<string>(left.assetIds), ...asList<string>(right.assetIds)])] } },
      { resource: 'shots', id: right.id, op: 'delete', version: right._version },
      { resource: 'projects', id: project.id, op: 'update', version: project._version, values: { sourceVideo: { ...video, segments: asList<SourceSegment>(video.segments).filter(segment => segment.id !== (b.segmentId || right.id)).map(segment => segment.id === (a.segmentId || left.id) ? { id: segment.id, start: Number(a.start), end: Number(b.end), frames: source.frames } : segment) } } },
    ]);
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
    changes.push({ resource: 'assets', id: to.id, op: 'update', version: to._version, values: { history: [...new Set([...asList<string>(to.history), String(from.image || ''), ...asList<string>(from.history)].filter(Boolean))],
      ...(a && b ? { source: { ...a, start: Math.min(Number(a.start), Number(b.start)), end: Math.max(Number(a.end), Number(b.end)), frames: [...asList(a.frames), ...asList(b.frames)].slice(0, 12), description: [a.description, b.description].filter(Boolean).join('\n') } } : {}),
      references: [...asList(to.references), ...asList(from.references)] } },
    { resource: 'assets', id: from.id, op: 'delete', version: from._version });
    return this.studio.apply(randomUUID(), changes);
  }
  dispose() { this.disposed = true; for (const controller of this.running.values()) controller.abort(); }
}

const properties = {
  projectId: { type: 'string' }, jobId: { type: 'string' }, requestId: { type: 'string' }, version: { type: 'integer' },
  modelId: { type: 'string' }, agentId: { type: 'string' }, sourceLanguage: { type: 'string' }, visualOnly: { type: 'boolean' },
  resumeJobId: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, shotId: { type: 'string' }, shotVersion: { type: 'integer' }, split: { type: 'number' },
  shotIds: { type: 'array', items: { type: 'string' } }, fromId: { type: 'string' }, toId: { type: 'string' }, fromVersion: { type: 'integer' }, toVersion: { type: 'integer' },
  selections: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number' } }, required: ['clipId'], additionalProperties: false } },
} as const;
export const REDRAW_TOOLS = [
  { name: 'builtin_read_video_redraw', title: '查询视频转绘', description: 'describe=true 查询转绘能力和限制；否则以 projectId 查询原片、持久化任务、可应用草稿和错误。查询不触发生成。', risk: 'read' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { projectId: properties.projectId, describe: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'builtin_edit_video_redraw', title: '操作视频转绘', description: 'prepare 切镜抽帧；analyze 用已配置视觉模型和选定 Agent 分析并生成目标地区语言草稿，可传 start/end 补漏区间；apply 按草稿 segment ID 的 shotIds 应用选中镜头（留空为全部），保留人工修改；cancel 取消；frame 截取 start/end 中间参考帧供补资产；edit-shot 调整来源区间或 split 拆分；merge-assets 合并重复资产，merge-shots 合并同场相邻镜头（fromId/toId/fromVersion/toVersion）；export 按 selections 的 clipId 顺序合成已选用视频，保留生成音轨。提交长任务须 requestId、最新项目 version，返回任务后查询。失败任务可用新 requestId 与 resumeJobId 续做已完成分析。', risk: 'write' as const, approval: 'workspace' as const, appId: 'builtin:studio', appName: '视频转绘', parameters: { type: 'object', properties: { ...properties, action: { type: 'string', enum: ['prepare', 'analyze', 'apply', 'cancel', 'frame', 'edit-shot', 'merge-assets', 'merge-shots', 'export'] } }, required: ['projectId', 'action'], additionalProperties: false } },
] as const;

export async function handleRedrawRequest(req: IncomingMessage, res: ServerResponse, service: VideoRedraw) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/video-redraw/')) return false;
  const send = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '仅允许本机或局域网' }); return true; }
  try {
    if (req.method === 'GET') send(200, service.read({ projectId: url.searchParams.get('projectId'), describe: url.searchParams.has('describe') }));
    else if (req.method === 'POST' && url.pathname === '/api/video-redraw/action') {
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('请求超过1MB'); }
      send(200, await service.edit(JSON.parse(body)));
    } else send(405, { error: '不支持的操作' });
  } catch (error) { send(error instanceof StudioConflict ? 409 : 422, { error: safeError(error) }); }
  return true;
}
