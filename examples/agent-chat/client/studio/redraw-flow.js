// 视频转绘流程视图：节点状态与输入输出只从页面记录、转绘任务和媒体任务推导，不保存任何流程数据。
import { pendingJob } from './art'

export const FLOW_KIND_LABELS = { agent: 'Agent', human: '人工', media: '媒体' }
export const FLOW_STATUS_LABELS = { idle: '未开始', waiting: '待确认', running: '运行中', done: '已完成', partial: '部分完成', failed: '未完成' }

/** 节点顺序与转绘步骤一致：原片 → 镜头校对 → 剧本 → 转绘资产 → 视频制作 → 短片；原片作为原片分析的输入展示。position 为 [列, 行]。 */
export const FLOW_NODES = [
  { id: 'analyze', title: '原片分析', kind: 'agent', jobKind: 'analyze', page: '/source', position: [0, 0] },
  { id: 'shots', title: '镜头校对', kind: 'human', page: '/storyboard', position: [1, 0] },
  { id: 'write-script', title: '剧本编写', kind: 'agent', jobKind: 'write-script', page: '/script', position: [2, 0] },
  { id: 'extract-assets', title: '资产分析与提示词', kind: 'agent', jobKind: 'extract-assets', page: '/art', position: [3, 0] },
  { id: 'asset-images', title: '资产成图', kind: 'media', page: '/art', position: [3, 1] },
  { id: 'video-prompts', title: '片段与视频提示词', kind: 'agent', jobKind: 'video-prompts', page: '/video', position: [4, 0] },
  { id: 'storyboard-prompts', title: '分镜提示词', kind: 'human', page: '/video', position: [5, 0] },
  { id: 'storyboard-images', title: '分镜成图', kind: 'media', page: '/video', position: [6, 0] },
  { id: 'video-generation', title: '视频生成', kind: 'media', page: '/video', position: [7, 0] },
  { id: 'film', title: '成片', kind: 'media', page: '/film', position: [8, 0] },
]
// 主数据流：[来源, 目标, 传递内容, 来源端口, 目标端口]
const FLOW_EDGES = [
  ['analyze', 'shots', '分析出的镜头', 'out', 'in'],
  ['shots', 'write-script', '校对后镜头', 'out', 'in'],
  ['write-script', 'extract-assets', '剧本与场次', 'out', 'in'],
  ['extract-assets', 'asset-images', '生图提示词', 'down', 'up'],
  ['video-prompts', 'storyboard-prompts', '片段与视频提示词', 'out', 'in'],
  ['storyboard-prompts', 'storyboard-images', '分镜提示词', 'out', 'in'],
  ['asset-images', 'storyboard-images', '资产与参考图', 'out', 'bottom-in'],
  ['analyze', 'video-prompts', '原片分析', 'report-out', 'report-in'],
  ['shots', 'video-prompts', '校对后镜头', 'report-out', 'report-in'],
  ['write-script', 'video-prompts', '剧本', 'report-out', 'report-in'],
  ['extract-assets', 'video-prompts', '资产设定', 'report-out', 'report-in'],
  ['video-prompts', 'video-generation', '视频提示词', 'out', 'in'],
  ['storyboard-images', 'video-generation', '选用分镜图', 'down', 'bottom-in'],
  ['asset-images', 'video-generation', '参考生成素材', 'out', 'bottom-in'],
  ['video-generation', 'film', '选用视频', 'out', 'in'],
]
const JOB_STATUS = { queued: 'running', running: 'running', completed: 'done', failed: 'failed', cancelled: 'failed', interrupted: 'failed' }
const nodeOfKind = kind => FLOW_NODES.find(node => node.jobKind === kind)
const seconds = value => `${Math.round(Number(value || 0) * 10) / 10} 秒`
const byPosition = (a, b) => Number(a._position || 0) - Number(b._position || 0)

export function episodeSource(project, episode, episodes) {
  return episode?.sourceVideo || (episode && episode.id === episodes[0]?.id ? project?.sourceVideo : null) || {}
}

/**
 * 某集的流程节点与连线；jobs 为该集转绘任务（新任务在前），details 为已读取的任务详情（按 jobId）。
 * @param {{ data: any, jobs?: any[], mediaJobs?: any[], details?: Record<string, any>, projectId: string, episodeId?: string }} input
 */
export function redrawFlow({ data, jobs = [], mediaJobs = [], details = {}, projectId, episodeId }) {
  const project = data.projects.find(item => item.id === projectId)
  const episodes = data.episodes.filter(item => item.projectId === projectId).sort((a, b) => Number(a.number) - Number(b.number))
  const episode = episodes.find(item => item.id === episodeId) || episodes[0]
  if (!project || !episode) return { episode: null, source: {}, nodes: [], edges: [] }
  const source = episodeSource(project, episode, episodes)
  const shots = data.shots.filter(item => item.episodeId === episode.id).sort(byPosition)
  const scenes = episode.scenes || []
  const assets = data.assets.filter(item => item.projectId === projectId)
  const clips = data.clips.filter(item => item.episodeId === episode.id)
  const films = data.films.filter(item => item.projectId === projectId && (item.episodeId === episode.id || (!item.episodeId && episode.id === episodes[0]?.id)))
  // 原片更换后旧任务的结果已过期，服务端也不再返回其详情，因此只看当前原片的任务。
  const runs = kind => jobs.filter(job => (job.kind === kind || (!job.restored && ((kind === 'analyze' && job.kind === 'revise-cuts') || (kind === 'write-script' && job.kind === 'revise-script')))) && (!source.fileId || job.sourceFileId === source.fileId))
  const assetIds = new Set(assets.map(item => item.id)), clipIds = new Set(clips.map(item => item.id))
  const imageJobs = mediaJobs.filter(job => job.type === 'image' && job.options?.studioTarget?.resource === 'assets' && assetIds.has(job.options.studioTarget.id))
  const storyboardClips = clips.filter(clip => clip.mode === '分镜图')
  const storyboardJobs = mediaJobs.filter(job => job.type === 'image' && job.options?.studioTarget?.resource === 'clips' && job.options.studioTarget.field === 'image' && storyboardClips.some(clip => clip.id === job.options.studioTarget.id))
  const videoJobs = mediaJobs.filter(job => job.type === 'video' && job.options?.studioTarget?.resource === 'clips' && clipIds.has(job.options.studioTarget.id))
  const imageSlots = assets.flatMap(asset => [{ asset, image: asset.image }, ...(asset.variants || []).map(variant => ({ asset, variant, image: variant.image }))])
  const imaged = imageSlots.filter(slot => slot.image).length
  const lines = shots.reduce((count, shot) => count + (shot.dialogue?.length || 0), 0)
  const scripted = !!String(episode.script || '').trim() || scenes.some(scene => String(scene.content || '').trim())
  const generated = clips.filter(clip => clip.videos?.length).length, selected = clips.filter(clip => clip.currentVideo).length
  const types = ['角色', '场景', '道具'].map(type => `${type} ${assets.filter(asset => asset.type === type).length}`).join(' · ')
  const videoPromptCount = clips.filter(clip => String(clip.prompt || '').trim()).length
  const storyboardPromptCount = storyboardClips.filter(clip => String(clip.storyboardPrompt || '').trim()).length
  // 有记录但没有任务（Agent 工具或旧流程写入）时按记录算完成；有任务时以最近一次运行为准。
  const agent = (kind, produced) => {
    const job = runs(kind)[0]
    return job ? { status: JOB_STATUS[job.status] || 'idle', phase: job.phase, error: job.error, failureStage: job.failureStage, jobId: job.id, runs: runs(kind) } : { status: produced ? 'done' : 'idle', runs: [] }
  }
  const media = (pending, done, total, started) => pending ? 'running' : total && done === total ? 'done' : started ? 'partial' : 'idle'
  const state = {
    analyze: { ...agent('analyze', shots.length), input: [source.fileId ? `原片 ${seconds(source.duration)}${source.width ? ` · ${source.width}×${source.height}` : ''}` : '尚未上传原片', `候选切镜 ${(source.segments || []).length} 段`], output: [`镜头 ${shots.length} 条 · 场次 ${scenes.length} 个`] },
    shots: { status: !shots.length ? 'idle' : Number(episode.stage || 0) >= 4 || scripted || runs('write-script').length ? 'done' : 'waiting', input: ['原片分析写入的镜头', '向原片分析 Agent 反馈并直接应用'], output: [`镜头 ${shots.length} 条 · 台词 ${lines} 句`, `目标时长 ${seconds(shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0))}`] },
    'write-script': { ...agent('write-script', scripted), input: [`镜头 ${shots.length} 条`, episode.duration == null ? '目标时长未设置' : `目标时长 ${seconds(episode.duration)}`, '上游报告', '向剧本 Agent 反馈并直接应用'], output: [`剧本 ${String(episode.script || '').length} 字`, `场次正文 ${scenes.filter(scene => String(scene.content || '').trim()).length}/${scenes.length}`] },
    'extract-assets': { ...agent('extract-assets', assets.length), ...(assets.length && imageSlots.length && imaged === imageSlots.length && agent('extract-assets', assets.length).status === 'failed' ? { status: 'done', note: '资产图片已齐；最近一次提取失败' } : {}), input: ['原片分析、剧本、镜头与已有资产', episode.duration == null ? '目标时长未设置' : `目标时长 ${seconds(episode.duration)}`], output: [`资产 ${assets.length} 项`, types, '资产设定与生图提示词'] },
    'asset-images': { status: media(imageJobs.some(pendingJob), imaged, imageSlots.length, imaged), input: ['资产生图提示词、风格与参考图'], output: [`已出图 ${imaged}/${imageSlots.length}`] },
    'storyboard-prompts': { status: media(false, storyboardPromptCount, storyboardClips.length, storyboardClips.length), runs: [], input: ['视频片段与视频提示词', '手动填写或按要求调整'], output: [`片段 ${clips.length} 个`, `分镜提示词 ${storyboardPromptCount}/${storyboardClips.length}`] },
    'video-prompts': { ...agent('video-prompts', false), status: agent('video-prompts', false).status === 'running' ? 'running' : videoPromptCount === clips.length && clips.length ? 'done' : videoPromptCount ? 'partial' : agent('video-prompts', false).status === 'failed' ? 'failed' : 'idle', input: ['原片分析、剧本、资产与镜头', '上游报告、视频模型、生成方式与要求'], output: [`视频提示词 ${videoPromptCount}/${clips.length}`] },
    'storyboard-images': { status: media(storyboardJobs.some(pendingJob), storyboardClips.filter(clip => clip.image).length, storyboardClips.length, storyboardClips.some(clip => clip.image)), input: ['分镜提示词', '资产图片与其他参考图'], output: [`已选分镜图 ${storyboardClips.filter(clip => clip.image).length}/${storyboardClips.length}`] },
    'video-generation': { status: media(videoJobs.some(pendingJob), selected, clips.length, generated || selected), input: [`视频提示词 ${videoPromptCount}/${clips.length}`, '分镜图或参考素材'], output: [`已生成 ${generated}/${clips.length}`, `已选用 ${selected}`] },
    film: { status: films.length ? 'done' : 'idle', input: [`已选用视频 ${selected} 个`], output: [`成片 ${films.length} 个`] },
  }
  const nodes = FLOW_NODES.map(node => ({ ...node, ...state[node.id] }))
  const active = id => ['done', 'partial', 'waiting'].includes(state[id].status)
  /** @type {Array<{ id: string, source: string, target: string, sourceHandle: string, targetHandle: string, type: 'data' | 'report', data: { label?: string, active?: boolean, stale?: boolean } }>} */
  const edges = FLOW_EDGES.map(([from, to, label, sourceHandle, targetHandle], index) => ({ id: `${from}->${to}`, source: from, target: to, sourceHandle, targetHandle, type: 'data', data: { label, lane: sourceHandle === 'report-out' ? index : undefined, below: from === 'storyboard-images' && to === 'video-generation', active: from === 'video-prompts' ? videoPromptCount > 0 : from === 'storyboard-prompts' ? (to === 'storyboard-images' ? storyboardPromptCount > 0 : clips.length > 0) : from === 'storyboard-images' ? storyboardClips.some(clip => clip.image) : from === 'extract-assets' ? assets.length > 0 : active(from) } }))
  // 上游报告连线来自下游任务实际收到的 handoff；服务端交接的是上游最近一次完成的报告，之后上游又完成过新运行即标为旧版。
  const latestReport = kind => runs(kind).find(job => job.status === 'completed' && (job.kind === kind || job.applied))?.id
  for (const node of nodes) {
    for (const ref of details[node.jobId]?.handoff || []) {
      const upstream = nodeOfKind(ref.kind)
      if (upstream) edges.push({ id: `report:${ref.kind}->${node.id}`, source: upstream.id, target: node.id, sourceHandle: 'report-out', targetHandle: 'report-in', type: 'report', data: { stale: ref.jobId !== latestReport(ref.kind) } })
    }
  }
  return { episode, source, shots, scenes, assets, clips, films, imageJobs, storyboardClips, storyboardJobs, videoJobs, imageSlots, nodes, edges, data }
}

/** 页面上下文里每个字段的简短说明，便于先看规模再展开原始 JSON。 */
export function contextSummary(value) {
  if (Array.isArray(value)) return `${value.length} 项`
  if (value && typeof value === 'object') return `${Object.keys(value).length} 个字段`
  if (typeof value === 'string') return value.trim() ? `${value.length} 字` : '空'
  return value === undefined || value === null ? '空' : String(value)
}
