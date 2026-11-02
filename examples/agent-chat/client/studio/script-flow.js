import { redrawFlow } from './redraw-flow'

// 剧本项目使用自己的工作流任务；媒体节点复用与转绘相同的页面记录。
export function scriptFlow(input) {
  const hasEpisode = input.data.episodes.some(item => item.projectId === input.projectId)
  const viewInput = hasEpisode ? input : { ...input, episodeId: '__project__', data: { ...input.data, episodes: [...input.data.episodes, { id: '__project__', projectId: input.projectId, number: 1, scenes: [] }] } }
  const flow = redrawFlow(viewInput)
  if (!flow.episode) return flow
  const project = input.data.projects.find(item => item.id === input.projectId)
  const current = id => flow.nodes.find(node => node.id === id)
  const agent = (kind, produced) => {
    const runs = (input.jobs || []).filter(job => job.kind === kind)
    const job = runs[0]
    const status = job ? ({ queued: 'running', running: 'running', completed: 'done', failed: 'failed', interrupted: 'failed', cancelled: 'failed' }[job.status] || 'idle') : produced ? 'done' : 'idle'
    return { status, runs, ...(job ? { jobId: job.id, phase: job.phase, error: job.error, failureStage: job.failureStage } : {}) }
  }
  const scripted = Boolean(String(flow.episode.script || '').trim() || flow.scenes.some(scene => String(scene.content || '').trim()))
  const outline = Boolean(String(project.outline?.story || '').trim())
  const nodes = [
    { id: 'outline', title: '小说转大纲', kind: 'agent', jobKind: 'novel-outline', page: '/outline', position: [0, 0], ...agent('novel-outline', false), input: ['小说原文、已有大纲与创作要求'], output: [outline ? '已保存项目大纲' : '尚未保存大纲', ...(agent('novel-outline', false).status === 'done' && !agent('novel-outline', false).runs[0]?.applied ? ['草稿可在大纲页查看'] : [])] },
    { id: 'novel-script', title: '剧本编写', kind: 'agent', jobKind: 'novel-script', page: '/script', position: [1, 0], ...agent('novel-script', scripted), input: ['小说原文、大纲与分集信息'], output: [`剧本 ${String(flow.episode.script || '').length} 字 · 场次 ${flow.scenes.length} 个`] },
    { id: 'script-assets', title: '美术资产提取', kind: 'agent', jobKind: 'script-assets', page: '/art', position: [2, 0], ...agent('script-assets', flow.assets.length), input: ['项目大纲与全部剧本'], output: [`资产 ${flow.assets.length} 项`] },
    { ...current('asset-images'), position: [2, 1] },
    { id: 'script-storyboard', title: '分镜与视频提示词', kind: 'agent', jobKind: 'script-storyboard', page: '/video', position: [3, 0], ...agent('script-storyboard', flow.clips.length), input: ['大纲、本集剧本、资产与视频模型', '视频提示词调整使用剧本分镜 Agent'], output: [`片段 ${flow.clips.length} 个`, `视频提示词 ${flow.clips.filter(clip => String(clip.prompt || '').trim()).length}/${flow.clips.length}`] },
    { ...current('storyboard-images'), position: [4, 0] },
    { ...current('video-generation'), position: [5, 0] },
    { ...current('film'), position: [6, 0] },
  ]
  const links = [
    ['outline', 'novel-script', '大纲与分集信息'], ['outline', 'script-assets', '项目大纲'],
    ['novel-script', 'script-assets', '全部剧本'], ['outline', 'script-storyboard', '项目大纲'],
    ['novel-script', 'script-storyboard', '本集剧本'], ['script-assets', 'script-storyboard', '资产设定'],
    ['script-assets', 'asset-images', '生图提示词'], ['script-storyboard', 'storyboard-images', '分镜图模式：分镜提示词'],
    ['asset-images', 'storyboard-images', '资产参考图'], ['script-storyboard', 'video-generation', '视频提示词'],
    ['asset-images', 'video-generation', '参考生成素材'], ['storyboard-images', 'video-generation', '分镜图模式：选用分镜图'],
    ['video-generation', 'film', '选用视频'],
  ]
  const edges = links.map(([source, target, label]) => ({ id: `${source}->${target}`, source, target, sourceHandle: source === 'script-assets' && target === 'asset-images' ? 'down' : 'out', targetHandle: source === 'script-assets' && target === 'asset-images' ? 'up' : 'in', type: 'data', data: { label, active: ['done', 'partial', 'waiting'].includes(nodes.find(node => node.id === source)?.status) } }))
  return { ...flow, project, nodes, edges }
}
