import type { StudioStore } from './studio';
import type { VideoRedraw } from './video-redraw';

/** Recover complete items even if a model response ends before the JSON array closes. */
export function parseBatchPromptResults(text: string): unknown[] {
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed?.items)) return parsed.items; } catch { /* recover complete entries below */ }
  const start = /"items"\s*:\s*\[/.exec(text);
  if (!start) return [];
  const items: unknown[] = [];
  let depth = 0, begin = -1, quoted = false, escaped = false;
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth++ === 0) begin = i; }
    else if (char === '}' && depth > 0 && --depth === 0) { try { items.push(JSON.parse(text.slice(begin, i + 1))); } catch { /* only this entry is invalid */ } }
    else if (char === ']' && depth === 0) break;
  }
  return items;
}

export function validatePromptTiming(text: string, field: unknown, duration: unknown) {
  if (field !== 'prompt' || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return;
  for (const match of text.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:-|—|–|~|～|至|到)\s*(\d+(?:\.\d+)?)\s*(?:秒|s\b)/gi)) {
    if (/原片(?:时间|时码|片段)?\s*[:：]?\s*$/.test(text.slice(Math.max(0, match.index - 16), match.index) + match[0].slice(0, match[0].indexOf(match[1])))) continue;
    if (Number(match[2]) > duration || Number(match[1]) > Number(match[2])) throw new Error(`调整结果的时间区间超出片段时长 ${duration} 秒或顺序无效，结果未保存，请重试`);
  }
}

/** Build the model input from current project data, not client-supplied content. */
export function promptAdjustmentContext(studio: StudioStore, redraw: VideoRedraw, input: Record<string, unknown>) {
  const { projectId, episodeId, clipId, field, requirements } = input;
  if (typeof projectId !== 'string' || typeof episodeId !== 'string' || typeof clipId !== 'string' || !['prompt', 'storyboardPrompt'].includes(String(field)) || typeof requirements !== 'string' || !requirements.trim() || requirements.length > 2000) throw new Error('请选择片段和提示词，并填写不超过 2000 字的调整要求');
  const state = studio.snapshot();
  const project = state.projects.find(item => item.id === projectId);
  const episode = state.episodes.find(item => item.id === episodeId && item.projectId === projectId);
  const clip = state.clips.find(item => item.id === clipId && item.episodeId === episodeId);
  if (!project || !episode || !clip) throw new Error('项目、剧集或片段不存在');
  if (field === 'storyboardPrompt' && clip.mode !== '分镜图') throw new Error('参考生成模式不使用分镜图提示词，请先切换为分镜图模式');
  let originalAnalysis = '';
  if (project.creationMode === 'video-redraw') {
    const status = redraw.read({ projectId, episodeId }) as { source: { fileId?: string }; jobs: Array<{ id: string; kind: string; status: string; sourceFileId?: string }> };
    const source = status.jobs.find(job => job.kind === 'analyze' && job.status === 'completed' && job.sourceFileId === status.source.fileId);
    if (!source) throw new Error('未找到当前原片已完成的分析，请先完成原片分析');
    const report = redraw.read({ projectId, episodeId, jobId: source.id }) as { analysis?: string; outputs?: Array<{ output_type: string; content: string; incomplete?: boolean }> };
    originalAnalysis = report.analysis || report.outputs?.find(output => output.output_type === 'raw' && !output.incomplete)?.content || '';
    if (!originalAnalysis.trim()) throw new Error('原片分析报告为空，请检查原片分析任务');
  }
  const ids = new Set(Array.isArray(clip.shotIds) ? clip.shotIds : []);
  const assets = state.assets.filter(item => item.projectId === projectId);
  const shots = state.shots.filter(item => item.episodeId === episodeId && ids.has(item.id));
  const usesAllShots = field === 'prompt';
  const contextShots = usesAllShots ? state.shots.filter(item => item.episodeId === episodeId) : shots;
  const versions = (items: typeof assets) => JSON.stringify(items.map(item => [item.id, item._version]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  const assertCurrent = () => {
    const current = studio.snapshot();
    const sameProject = current.projects.find(item => item.id === projectId)?._version === project._version;
    const sameEpisode = current.episodes.find(item => item.id === episodeId)?._version === episode._version;
    const sameClip = current.clips.find(item => item.id === clipId)?._version === clip._version;
    if (!sameProject || !sameEpisode || !sameClip || versions(current.assets.filter(item => item.projectId === projectId)) !== versions(assets) || versions(current.shots.filter(item => item.episodeId === episodeId && (usesAllShots || ids.has(item.id)))) !== versions(contextShots)) throw new Error('项目、剧本、资产或片段在调整期间发生变化，结果未保存，请重试');
  };
  return {
    context: {
      field, requirements: requirements.trim(), originalAnalysis,
      project: { id: project.id, targetRegion: project.targetRegion, targetLanguage: project.targetLanguage, requirements: project.requirements, ratio: project.ratio },
      episode: { id: episode.id, script: episode.script, scenes: episode.scenes },
      assets,
      shots,
      clip: { id: clip.id, sceneId: clip.sceneId, title: clip.title, shotIds: clip.shotIds, mode: clip.mode, duration: clip.duration, assetIds: clip.assetIds, references: clip.references, storyboardPrompt: clip.storyboardPrompt, prompt: clip.prompt },
    },
    version: clip._version,
    before: String(clip[field as string] || ''),
    assertCurrent,
  };
}
