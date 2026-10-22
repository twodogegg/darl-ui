import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import actionPrompts from '../../prompts/studio-actions.json'
import promptCatalog from '../../prompts/studio-prompt-catalog.json'
import { emptyStudioData, studioFields, studioPositions } from '../../studio-schema'
import { styleOptionsFromCatalog } from '../workspace-styles'

const Store = import.meta.hot?.data.studioContext || createContext(null)
if (import.meta.hot) import.meta.hot.data.studioContext = Store
export async function studioApi(path, body, signal) {
  const response = await fetch(`/api/${path}`, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`)
  return value
}
const fields = (resource, item) => Object.fromEntries(studioFields[resource].split(' ').filter(key => item[key] !== undefined).map(key => [key, item[key]]))
export function StudioProvider({ children, onAgentRequest, agents, models, onNavigate, onAgentCancel, currentTextModelId, currentAgentId }) {
  const [data, setData] = useState(emptyStudioData)
  const [mediaJobs, setMediaJobs] = useState([])
  const [mediaDefaults, setMediaDefaults] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [pending, setPending] = useState(0)
  const [agentSelection, setAgentSelection] = useState('')
  const [modelSelections, setModelSelections] = useState({})
  const [lastBatch, setLastBatch] = useState('')
  const getModel = (type, modelId) => models.find(model => model.type === type && model.id === (modelId || modelSelections[type] || (type === 'text' ? currentTextModelId : mediaDefaults[type]?.modelId)))
  const state = useRef(data), queue = useRef(Promise.resolve()), failed = useRef(false), count = useRef(0), timer = useRef(), mounted = useRef(true)
  const announce = useCallback(message => { if (!mounted.current) return; clearTimeout(timer.current); setToast(message); timer.current = setTimeout(() => setToast(''), 4000) }, [])
  const reload = useCallback(async () => {
    const [next, jobs] = await Promise.all([studioApi('studio/state'), studioApi('media-generation/jobs')])
    if (mounted.current) setMediaJobs(jobs)
    if (mounted.current && count.current === 0) { state.current = next; setData(next); setLoading(false) }
    return next
  }, [])
  useEffect(() => {
    mounted.current = true
    reload().catch(reason => { setError(reason.message); setLoading(false) })
    studioApi('default-models').then(value => { if (mounted.current) setMediaDefaults(value) }).catch(reason => announce(reason.message))
    const refresh = () => { if (!count.current) reload().catch(reason => setError(reason.message)) }
    const interval = setInterval(refresh, 3000)
    window.addEventListener('studio-changed', refresh)
    return () => { mounted.current = false; clearInterval(interval); clearTimeout(timer.current); window.removeEventListener('studio-changed', refresh) }
  }, [reload])
  const notify = useCallback(message => {
    if (!count.current) return announce(message)
    queue.current.then(() => { if (!failed.current) announce(message) })
  }, [announce])
  const update = useCallback(fn => {
    if (failed.current) { announce('请先重新加载最新数据，再继续编辑'); return Promise.resolve(false) }
    const before = state.current, next = structuredClone(before)
    fn(next)
    // Derived durations and released shot links use the same rule as the server.
    next.clips.forEach(clip => { clip.shotIds = clip.shotIds.filter(id => next.shots.some(shot => shot.id === id)); clip.duration = Math.round(clip.shotIds.reduce((sum, id) => sum + Number(next.shots.find(shot => shot.id === id).duration), 0) * 100) / 100 })
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
      const saved = await studioApi('studio/changes', { requestId, changes })
      if (mounted.current) setLastBatch(saved.requestId)
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
  const log = (projectId, episodeId, message) => update(draft => draft.history.unshift({ id: crypto.randomUUID(), projectId, ...(episodeId ? { episodeId } : {}), message, time: new Date().toLocaleString('zh-CN') }))
  const requestAgent = async task => {
    await queue.current
    if (failed.current) throw new Error('数据尚未成功保存，请先处理保存错误')
    const entry = promptCatalog.find(item => item.action === task.action)
    const configured = entry && state.current.prompts.find(item => item.id === entry.id)
    const prompt = configured?.mode === 'replace' ? configured.text : configured?.defaultText || actionPrompts[task.action]
    await onAgentRequest({ ...task, prompt, agentId: agentSelection, modelSelections })
  }
  const generateMedia = async ({ type = 'image', prompt, target, references = [], options = {}, modelId, applyStyle = true, styleId }) => {
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
    const catalog = applyStyle ? await studioApi('workspace/styles') : null
    const style = catalog && styleOptionsFromCatalog(catalog.data).find(item => item.id === String(styleId ?? project?.style_catalog_id))
    if (applyStyle && !style) throw new Error('请先选择项目视觉风格')
    const requestId = crypto.randomUUID()
    const resolution = options.resolution || (selectedId === defaults[type]?.modelId ? defaults[type]?.resolution : model.defaults?.resolution) || model.capabilities?.resolutions?.[0]
    const aspectRatio = options.aspectRatio || project?.ratio || defaults[type]?.aspectRatio || model.defaults?.aspectRatio
    if (references.length > (model.capabilities?.images || 0)) throw new Error(`当前模型最多支持 ${model.capabilities?.images || 0} 张参考图片`)
    const job = await studioApi('media-generation/jobs', {
      requestId, taskId: requestId, modelId: selectedId, prompt, ...(style ? { style: { id: style.id, name: style.name, description: style.description, category: style.category } } : {}),
      options: { resolution, aspectRatio, ...options, ...(references.length ? { references } : {}), studioTarget: { ...target, version: item._version } },
    })
    if (mounted.current) setMediaJobs(current => [job, ...current.filter(item => item.id !== job.id)])
    announce('生成任务已入队，可在“生成任务”中查看真实进度')
    return job
  }
  return <Store.Provider value={{ data, update, patch, notify, log, reload, requestAgent, agents, models, getModel, currentAgentId, mediaJobs, mediaDefaults, onNavigate, cancelAgent: onAgentCancel, generateMedia, agentSelection, setAgentSelection, modelSelections, setModelSelections }}>
    {error && <div className="studio-error" role="alert">{error}<button onClick={async () => { failed.current = false; setError(''); await reload() }}>重新加载</button></div>}
    <div className="studio-save-status" role="status">{loading ? '正在读取工作台…' : pending ? `正在保存 ${pending} 批修改…` : error ? '保存失败' : '已同步'}{lastBatch && !pending && <button onClick={async () => { try { await studioApi('studio/changes', { requestId: crypto.randomUUID(), undoBatchId: lastBatch }); setLastBatch(''); await reload(); announce('已撤销上次修改') } catch (reason) { setError(reason.message) } }}>撤销上次修改</button>}</div>
    {!loading && children}
    {toast && <div className="demo-toast" role="status">{toast}</div>}
  </Store.Provider>
}
export const useStore = () => useContext(Store)
export function useAgentTask() {
  const { requestAgent, notify, cancelAgent } = useStore()
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const run = async task => {
    if (busy) return
    setBusy(true)
    try { await requestAgent(task); notify('已交给 Agent，可在聊天中查看执行过程') }
    catch (reason) { notify(reason.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return { busy, run, cancel: () => { if (busy) cancelAgent(); setBusy(false) } }
}
