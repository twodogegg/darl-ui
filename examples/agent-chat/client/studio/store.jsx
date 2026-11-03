import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { emptyStudioData, studioFields, studioPositions } from '../../studio-schema'
import { styleOptionsFromCatalog } from '../workspace-styles'
import { startPolling } from '../polling'
import { isH3FormattedPrompt, videoPrompt } from './video-prompt'

const Store = import.meta.hot?.data.studioContext || createContext(null)
if (import.meta.hot) import.meta.hot.data.studioContext = Store
export async function studioApi(path, body, signal) {
  const response = await fetch(`/api/${path}`, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (!response.ok) { const error = new Error(typeof value.error === 'string' ? value.error : value.error?.message || `请求失败（${response.status}）`); error.status = response.status; throw error }
  return value
}
const fields = (resource, item) => Object.fromEntries(studioFields[resource].split(' ').filter(key => item[key] !== undefined).map(key => [key, item[key]]))
export function StudioProvider({ children, models, onNavigate }) {
  const [data, setData] = useState(emptyStudioData)
  const [mediaJobs, setMediaJobs] = useState([])
  const [mediaDefaults, setMediaDefaults] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [pending, setPending] = useState(0)
  const [modelSelections, setModelSelections] = useState({})
  const getModel = (type, modelId) => models.find(model => model.type === type && model.enabled !== false && model.id === (modelId || modelSelections[type] || mediaDefaults[type]?.modelId))
  const state = useRef(data), queue = useRef(Promise.resolve()), failed = useRef(false), count = useRef(0), timer = useRef(), mounted = useRef(true)
  const announce = useCallback(message => { if (!mounted.current) return; clearTimeout(timer.current); setToast(message); timer.current = setTimeout(() => setToast(''), 4000) }, [])
  const reloading = useRef(null)
  const reloadSignal = useRef()
  const reload = useCallback((signal) => {
    if (reloading.current && !reloadSignal.current?.aborted) return reloading.current
    reloadSignal.current = signal
    const request = Promise.allSettled([
      studioApi('studio/state', undefined, signal).then(next => {
        if (!signal?.aborted && mounted.current && count.current === 0) { state.current = next; setData(next); setLoading(false) }
        return next
      }),
      studioApi('media-generation/jobs', undefined, signal).then(jobs => { if (!signal?.aborted && mounted.current) setMediaJobs(jobs) }),
    ]).then(([next, jobs]) => {
      if (next.status === 'rejected') throw next.reason
      if (jobs.status === 'rejected' && !signal?.aborted && mounted.current) setError(jobs.reason.message)
      else if (!signal?.aborted && mounted.current && !failed.current) setError('')
      return next.value
    }).finally(() => { if (reloading.current === request) reloading.current = null })
    reloading.current = request
    return request
  }, [])
  useEffect(() => {
    mounted.current = true
    const refreshDefaults = () => studioApi('default-models').then(value => { if (mounted.current) setMediaDefaults(value) }).catch(reason => announce(reason.message))
    refreshDefaults()
    const refresh = () => { if (!count.current) reload().catch(reason => { if (reason.name !== 'AbortError') setError(reason.message) }) }
    const stop = startPolling(async signal => { if (!count.current) await reload(signal) }, 3000, reason => { setError(reason.message); setLoading(false) })
    window.addEventListener('studio-changed', refresh)
    window.addEventListener('studio-defaults-changed', refreshDefaults)
    return () => { mounted.current = false; stop(); clearTimeout(timer.current); window.removeEventListener('studio-changed', refresh); window.removeEventListener('studio-defaults-changed', refreshDefaults) }
  }, [reload])
  const notify = useCallback(message => {
    if (!count.current) return announce(message)
    queue.current.then(() => { if (!failed.current) announce(message) })
  }, [announce])
  const update = useCallback(fn => {
    if (failed.current) { announce('请先重新加载最新数据，再继续编辑'); return Promise.resolve(false) }
    const before = state.current, next = structuredClone(before)
    fn(next)
    // 只清理已删除镜头留下的失效关联；片段时长由片段自身维护，不再由关联镜头求和覆盖。
    next.clips.forEach(clip => { clip.shotIds = clip.shotIds.filter(id => next.shots.some(shot => shot.id === id)) })
    const changes = []
    for (const resource of Object.keys(studioFields)) {
      const previous = new Map(before[resource].map(item => [item.id, item]))
      const positions = studioPositions(before[resource], next[resource])
      next[resource].forEach(item => {
        const position = positions.get(item.id)
        const old = previous.get(item.id), values = fields(resource, item)
        const patch = old ? Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(old[key]))) : values
        const orderChanged = (old?._position ?? before[resource].indexOf(old)) !== position
        if (!old || Object.keys(patch).length || orderChanged) {
          changes.push({ resource, id: item.id, op: old ? 'update' : 'create', ...(old ? { version: old._version } : {}), values: patch, position })
          item._version = (old?._version || 0) + 1; item._position = position
        }
      })
      before[resource].filter(item => !next[resource].some(other => other.id === item.id)).forEach(item => changes.push({ resource, id: item.id, op: 'delete', version: item._version }))
    }
    if (!changes.length) return queue.current.then(() => !failed.current)
    if (changes.length > 500) { announce('修改超过500项，请按剧集分批处理'); return Promise.resolve(false) }
    state.current = next; setData(next); count.current++; setPending(count.current); setError('')
    const requestId = crypto.randomUUID()
    const task = queue.current.then(async () => {
      if (failed.current) return false
      await studioApi('studio/changes', { requestId, changes })
      return true
    }).catch(async reason => {
      failed.current = true
      if (mounted.current) setError(`${reason.message}。本批未保存，请重新加载后核对。`)
      return false
    }).finally(async () => {
      count.current--; if (mounted.current) setPending(count.current)
      if (!count.current && !failed.current) await reload().catch(reason => { if (mounted.current) setError(reason.message) })
    })
    queue.current = task
    return task
  }, [announce, reload])
  const patch = (resource, id, values) => update(draft => { const item = draft[resource].find(item => item.id === id); if (item) Object.assign(item, values) })
  const ensureWritable = async () => {
    await queue.current
    if (failed.current) throw new Error('数据尚未成功保存，请先重新加载并处理保存错误')
  }
  const recover = async () => {
    await queue.current
    await reload()
    failed.current = false
    if (mounted.current) setError('')
  }
  const log = (projectId, episodeId, message) => update(draft => draft.history.unshift({ id: crypto.randomUUID(), projectId, ...(episodeId ? { episodeId } : {}), message, time: new Date().toLocaleString('zh-CN') }))
  const generateMedia = async ({ type = 'image', prompt, target, references = [], options = {}, modelId, applyStyle = true, styleId, preview = false, promptReferences = [], promptAudios = [] }) => {
    await queue.current
    if (failed.current) throw new Error('请先处理保存错误')
    options = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== '' && value !== undefined))
    const defaults = await studioApi('default-models')
    if (mounted.current) setMediaDefaults(defaults)
    const selectedId = modelId || modelSelections[type] || defaults[type]?.modelId
    const model = models.find(model => model.id === selectedId && model.type === type)
    if (!model) throw new Error('请先配置并启用对应生成模型')
    const item = state.current[target.resource].find(item => item.id === target.id)
    if (!item) throw new Error('请先保存生成目标')
    const episode = item.episodeId && state.current.episodes.find(episode => episode.id === item.episodeId)
    const project = state.current.projects.find(project => project.id === (item.projectId || episode?.projectId))
    if (project?.creationMode === 'video-redraw') {
      if (!preview && target.resource === 'clips') {
        const missing = state.current.assets.filter(asset => item.assetIds.includes(asset.id) && !asset.image)
        if (missing.length) throw new Error(`请先准备目标资产图片：${missing.map(asset => asset.name).join('、')}`)
        if (!references.length) throw new Error('视频转绘需要目标形象参考，请选择多模态参考并准备目标资产图片')
      }
    }
    const catalog = applyStyle ? await studioApi('workspace/styles') : null
    const style = catalog && styleOptionsFromCatalog(catalog.data).find(item => item.id === String(styleId ?? project?.style_catalog_id))
    if (applyStyle && !style) throw new Error('请先选择项目视觉风格')
    const preparedVideoPrompt = type === 'video' && target.resource === 'clips'
    if (preparedVideoPrompt) prompt = videoPrompt(prompt, style, promptReferences, promptAudios, !isH3FormattedPrompt(prompt))
    const requestId = crypto.randomUUID()
    const resolution = options.resolution || (selectedId === defaults[type]?.modelId ? defaults[type]?.resolution : model.defaults?.resolution) || model.capabilities?.resolutions?.[0]
    const aspectRatio = options.aspectRatio || (type === 'image' && target.resource === 'assets' ? '16:9' : project?.ratio) || defaults[type]?.aspectRatio || model.defaults?.aspectRatio
    if (!preview && references.length > (model.capabilities?.images || 0)) throw new Error(`当前模型最多支持 ${model.capabilities?.images || 0} 张参考图片`)
    const job = await studioApi(preview ? 'media-generation/preview-prompt' : 'media-generation/jobs', {
      requestId, taskId: requestId, modelId: selectedId, prompt, ...(style && !preparedVideoPrompt ? { style: { id: style.id, name: style.name, description: style.description, category: style.category } } : {}),
      options: { resolution, aspectRatio, ...options, ...(references.length ? { references } : {}), studioTarget: { ...target, version: item._version } },
    })
    if (preview) return job.prompt
    if (mounted.current) setMediaJobs(current => [job, ...current.filter(item => item.id !== job.id)])
    announce('生成任务已入队，页面将同步真实进度')
    return job
  }
  const cancelMediaJob = async id => {
    const job = await studioApi(`media-generation/jobs/${encodeURIComponent(id)}/cancel`, {})
    const apply = () => { if (mounted.current) setMediaJobs(current => current.map(item => item.id === id ? job : item)) }
    apply()
    void reload().catch(() => {}).finally(apply)
  }
  return <Store.Provider value={{ data, update, patch, notify, log, reload, ensureWritable, recover, models, getModel, mediaJobs, mediaDefaults, onNavigate, generateMedia, cancelMediaJob, modelSelections, setModelSelections }}>
    {error && <div className="studio-error" role="alert">{error}<button onClick={() => recover().catch(reason => setError(reason.message))}>重新加载</button></div>}
    <div className="studio-save-status" role="status">{loading ? '正在读取工作台…' : pending ? `正在保存 ${pending} 批修改…` : error ? '保存失败' : '已同步'}</div>
    {!loading && children}
    {toast && <div className="demo-toast" role="status">{toast}</div>}
  </Store.Provider>
}
export const useStore = () => useContext(Store)
