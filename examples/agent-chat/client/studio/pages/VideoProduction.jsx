import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconMovie, IconPlus, IconPhotoSpark, IconUpload, IconChevronDown, IconSettings, IconArrowUp, IconDots, IconTrash } from '@tabler/icons-react'
import * as Popover from '@radix-ui/react-popover'
import { useProject, Workflow } from '../components/Shell'
import { Button, Field, Modal, Confirm, FileButton, MediaPreview, Processing } from '../components/ui'
import ClipReferences from '../components/ClipReferences'
import { studioApi, useStore } from '../store'
import { id, makeClips } from '../data'
import {
  CLIP_DURATION_LIMIT, CLIP_IMAGE_COLUMNS, assetMentionCandidates, clipMediaReferences, clipImagePrompt,
  clipVoices, clipAudioReferences, shotNumber, videoDuration, videoImageReferences,
} from '../storyboard'
import AssetMentionInput, { MentionText } from '../components/AssetMentionInput'
import { jobLabel, pendingJob } from '../art'
import { isH3Model } from '../../../../../src/components/media-workspace/model'
import { optimizeMediaPrompt } from '../../prompt-optimization'
import { styleOptionsFromCatalog } from '../../workspace-styles'
import { download } from '../files'
import { episodeScenes, sceneLabel } from '../scenes'
import { VideoCompare } from '../../../../../src'
import { validateAssetMentions } from '../../../asset-mentions'
import promptCatalog from '../../../prompts/studio-prompt-catalog.json'
import { h3ReferenceSnapshot, isH3FormattedPrompt, videoPrompt } from '../video-prompt'

// Keep batch work alive when the production page is unmounted.
const batchStates = new Map()
const batchListeners = new Set()
function useBatchState(episodeId) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const listener = () => refresh(value => value + 1)
    batchListeners.add(listener)
    return () => batchListeners.delete(listener)
  }, [])
  const state = batchStates.get(episodeId) || { batch: null, busy: false }
  const set = (key, value) => {
    const current = batchStates.get(episodeId) || { batch: null, busy: false }
    batchStates.set(episodeId, { ...current, [key]: typeof value === 'function' ? value(current[key]) : value })
    batchListeners.forEach(listener => listener())
  }
  return [state.batch, value => set('batch', value), state.busy, value => set('busy', value)]
}

function sourceVideos(clip, prefix = clip?.id || 'clip') {
  if (!clip) return []
  const urls = [...new Set([clip.currentVideo, ...(clip.videos || [])].filter(Boolean))]
  return urls.map((url, index) => ({ id: `${prefix}:${url}`, url, name: `${clip.title || '视频'} · 版本${urls.length - index}` }))
}

const formatVideoTime = value => {
  if (!Number.isFinite(value)) return '00:00.00'
  const seconds = Math.max(0, value)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
}

export function VideoEditModal({ sources, ratio, onClose, onSaved, initialAll = false }) {
  const [items, setItems] = useState(() => (initialAll ? sources : sources.slice(0, 1)).map(source => ({ ...source, start: 0, end: undefined })))
  const [durations, setDurations] = useState({})
  const [playheads, setPlayheads] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  const videoRefs = useRef(new Map())
  useEffect(() => () => abortRef.current?.abort(), [])
  const add = source => {
    if (items.some(item => item.url === source.url)) return
    setItems(current => [...current, { ...source, start: 0, end: undefined }])
  }
  const remove = id => setItems(current => current.filter(item => item.id !== id))
  const move = (id, offset) => setItems(current => {
    const index = current.findIndex(item => item.id === id), next = index + offset
    if (index < 0 || next < 0 || next >= current.length) return current
    const result = [...current]; [result[index], result[next]] = [result[next], result[index]]; return result
  })
  const update = (id, key, value) => setItems(current => current.map(item => item.id === id ? { ...item, [key]: value === '' ? undefined : Number(value) } : item))
  const seek = (item, value) => {
    const next = Number(value)
    const video = videoRefs.current.get(item.id)
    if (video && Number.isFinite(next)) video.currentTime = next
    setPlayheads(current => ({ ...current, [item.url]: next }))
  }
  const setBoundary = (item, key) => {
    const duration = durations[item.url]
    const at = playheads[item.url] ?? item.start ?? 0
    if (!Number.isFinite(duration) || !Number.isFinite(at)) return
    setItems(current => current.map(value => {
      if (value.id !== item.id) return value
      if (key === 'start') {
        const end = value.end ?? duration
        return { ...value, start: Math.min(at, Math.max(0, end - 0.01)) }
      }
      return { ...value, end: Math.max(value.start + 0.01, Math.min(at, duration)) }
    }))
  }
  const normalized = items.map(item => {
    const duration = durations[item.url]
    return { ...item, duration, end: item.end ?? duration }
  })
  const invalid = normalized.some(item => !Number.isFinite(item.duration) || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > item.duration + 0.05)
  const total = normalized.reduce((sum, item) => sum + (Number.isFinite(item.end) && Number.isFinite(item.start) ? Math.max(0, item.end - item.start) : 0), 0)
  async function compose() {
    if (busy || invalid || !normalized.length) return
    const controller = new AbortController(); abortRef.current = controller; setBusy(true); setError('')
    try {
      const selections = normalized.map(item => ({ url: item.url, start: item.start, end: item.end }))
      const response = await fetch('/api/video-editing/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ratio, selections }), signal: controller.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '视频合成失败')
      await onSaved(result)
      onClose()
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason.message || '视频合成失败')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setBusy(false)
    }
  }
  return <Modal title="剪辑与拼接" wide onClose={() => { if (!busy) onClose() }} footer={<><Button disabled={busy} onClick={onClose}>取消</Button>{busy && <Button onClick={() => abortRef.current?.abort()}>取消合成</Button>}<Button primary disabled={busy || invalid || !normalized.length} onClick={compose}>{busy ? '正在合成…' : `合成并保存${total ? ` · ${total.toFixed(2)} 秒` : ''}`}</Button></>}>
    <p className="muted">按顺序裁剪并拼接视频。原视频不会被覆盖，合成结果会作为新版本保存。</p>
    <div className="production-edit-sources"><strong>可添加的视频</strong><div>{sources.filter(source => !items.some(item => item.url === source.url)).map(source => <Button key={source.id} variant="outline" size="sm" onClick={() => add(source)}>＋ {source.name}</Button>)}{sources.every(source => items.some(item => item.url === source.url)) && <span className="muted">已全部加入</span>}</div></div>
    <div className="production-edit-list">{items.map((item, index) => <article key={item.id} className="production-edit-item">
      <div className="production-edit-item-head"><strong>{index + 1}. {item.name}</strong><div className="toolbar"><Button size="sm" variant="ghost" disabled={index === 0 || busy} onClick={() => move(item.id, -1)}>上移</Button><Button size="sm" variant="ghost" disabled={index === items.length - 1 || busy} onClick={() => move(item.id, 1)}>下移</Button><Button size="sm" danger disabled={busy} onClick={() => remove(item.id)}>移除</Button></div></div>
      <video ref={element => { if (element) videoRefs.current.set(item.id, element); else videoRefs.current.delete(item.id) }} className="production-edit-video" src={item.url} controls playsInline preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; setDurations(current => ({ ...current, [item.url]: duration })); setPlayheads(current => ({ ...current, [item.url]: 0 })); setItems(current => current.map(value => value.id === item.id && value.end === undefined ? { ...value, end: duration } : value)) }} onTimeUpdate={event => { const currentTime = event.currentTarget.currentTime; setPlayheads(current => ({ ...current, [item.url]: currentTime })) }} />
      <div className="production-edit-scrubber"><div className="production-edit-scrubber-label"><span>预览位置</span><strong>{formatVideoTime(playheads[item.url] ?? 0)} / {formatVideoTime(durations[item.url])}</strong></div><input aria-label={`${item.name}预览位置`} type="range" min="0" max={durations[item.url] || 1} step="0.01" value={Math.min(playheads[item.url] ?? 0, durations[item.url] || 1)} disabled={busy || !Number.isFinite(durations[item.url])} onChange={event => seek(item, event.target.value)} /><div className="production-edit-scrubber-actions"><Button size="sm" variant="outline" disabled={busy || !Number.isFinite(durations[item.url])} onClick={() => setBoundary(item, 'start')}>设为开始</Button><Button size="sm" variant="outline" disabled={busy || !Number.isFinite(durations[item.url])} onClick={() => setBoundary(item, 'end')}>设为结束</Button><span className="muted">拖动滑块，画面会跟着变化</span></div></div>
      <div className="production-edit-fields"><Field label="开始秒"><input type="number" min="0" step="0.01" value={item.start} disabled={busy} onChange={event => update(item.id, 'start', event.target.value)} /></Field><Field label="结束秒"><input type="number" min="0" step="0.01" max={durations[item.url] || undefined} value={item.end ?? ''} disabled={busy} onChange={event => update(item.id, 'end', event.target.value)} /></Field><span className="muted">原时长 {Number.isFinite(durations[item.url]) ? `${durations[item.url].toFixed(2)} 秒` : '读取中…'}</span></div>
    </article>)}{!items.length && <p className="muted">请先添加视频。</p>}</div>
    {invalid && items.length > 0 && <p className="production-edit-error" role="alert">请等待视频时长读取完成，并检查每段的开始/结束时间。</p>}
    {error && <p className="production-edit-error" role="alert">{error}</p>}
  </Modal>
}

function VersionParametersModal({ item, jobs, models, onClose }) {
  const fileId = decodeURIComponent(item.url.match(/^\/api\/files\/([^/?#]+)/)?.[1] || '')
  const job = fileId && jobs.find(job => job.type === item.kind && job.resultFileIds?.includes(fileId))
  const model = job && models.find(model => model.id === job.modelId)
  const statusText = { queued: '排队中', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消', uncertain: '结果未知' }
  const options = job?.options || {}
  const count = value => Array.isArray(value) ? value.length : 0
  const rows = job ? [
    ['模型', model?.name || job.modelId],
    ['生成时间', new Date(job.createdAt).toLocaleString('zh-CN')],
    ['状态', statusText[job.status] || job.status],
    ...(options.resolution ? [['分辨率', options.resolution]] : []),
    ...(options.aspectRatio ? [['画幅', options.aspectRatio]] : []),
    ...(Number.isFinite(options.duration) ? [['生成时长', `${options.duration} 秒`]] : []),
    ...(job.style?.name ? [['视觉风格', job.style.name]] : []),
    ...(count(options.references) ? [['参考图片', `${count(options.references)} 张`]] : []),
    ...(count(options.referenceVideos) ? [['参考视频', `${count(options.referenceVideos)} 个`]] : []),
    ...(count(options.referenceAudios) ? [['参考音频', `${count(options.referenceAudios)} 个`]] : []),
  ] : []
  return <Modal title={`${item.name} · 生成参数`} wide onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    {!job ? <p className="muted">该版本没有对应的生成任务记录（可能来自上传或剪辑合成）。</p> : <>
      <dl className="production-parameters">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <Field label="提示词"><p className="production-parameters-prompt">{job.prompt}</p></Field>
      {job.error && <p className="production-edit-error" role="alert">{job.error}</p>}
    </>}
  </Modal>
}

function VideoCompareModal({ sources, onClose, onUse }) {
  const [selected, setSelected] = useState(() => sources.slice(0, 2).map(source => source.id))
  const [best, setBest] = useState(null)
  const items = sources.filter(source => selected.includes(source.id)).map(({ id, url, name }) => ({ id, name, src: url }))
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current)
  return <Modal title="对比视频" wide onClose={onClose} footer={<><Button onClick={onClose}>关闭</Button>{best && <Button primary onClick={() => { onUse(best); onClose() }}>使用最佳版本</Button>}</>}>
    <p className="muted">选择两个视频进行同步播放。对比不会修改原视频。</p>
    <div className="production-compare-pick">{sources.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id)} />{source.name}</label>)}</div>
    {items.length === 2 ? <VideoCompare videos={items} defaultBestVideoId={best} onBestChange={setBest} /> : <p className="production-compare-empty">请选择两个视频。</p>}
  </Modal>
}

/** 片段自己的图片：分镜图、故事板、站位图各自独立保存与切换，不覆盖镜头分镜图。 */
function SegmentImages({ clip, busy, jobs, submission, onGenerate, onUpload, onUse, onPreview, onDelete, onEditImage, onRemove }) {
  const [kind, setKind] = useState('image')
  const image = CLIP_IMAGE_COLUMNS.find(item => item.key === kind)
  const blocking = CLIP_IMAGE_COLUMNS.find(item => item.key === 'blockingImage')
  const renderImage = column => {
    const current = clip[column.key], history = clip[column.history] || []
    const pending = jobs.filter(job => job.options.studioTarget.field === column.key && pendingJob(job))
    const submitting = submission?.id === clip.id && submission.field === column.key
    return <>
      <div className="segment-image-canvas">
        {current && <button className="segment-image-current" aria-label={`预览${column.label}`} onClick={() => onPreview({ name: column.label, url: current, kind: 'image' })}><img src={imageUrl(current, 320)} alt={column.label} loading="lazy" /></button>}
        {(submitting || pending.length > 0) && <div className="segment-image-progress"><Processing busy text={submitting ? '正在提交…' : jobLabel(pending[0])} /></div>}
        <div className="segment-image-tools">
          <button type="button" className="segment-image-tool" aria-label={`生成${column.label}`} title={`生成${column.label}`} disabled={busy} onClick={() => onGenerate(column)}><IconPhotoSpark size={19} /></button>
          <FileButton kind="image" className="segment-image-upload" disabled={busy} onSelect={item => onUpload(column, item.url)}><IconUpload size={19} /><span className="studio-sr-only">上传{column.label}</span></FileButton>
          {current && <button type="button" className="segment-image-tool segment-image-tool--danger" aria-label={`删除${column.label}`} title={`删除${column.label}`} disabled={busy} onClick={() => onRemove(column)}><IconTrash size={19} /></button>}
        </div>
      </div>
      {history.length > 0 && <details className="segment-image-versions"><summary>历史版本 · {history.length}</summary><div className="segment-history">{history.map((url, index) => <article key={`${column.key}-${url}-${index}`} className={url === current ? 'current' : ''}>
        <button className="segment-history-thumb" aria-label={`查看${column.label}版本${history.length - index}`} onClick={() => onPreview({ name: `${column.label}版本${history.length - index}`, url, kind: 'image' })}><img loading="lazy" src={imageUrl(url, 320)} alt="" /></button>
        <div className="production-history-meta"><small>版本 {history.length - index}</small>{url === current && <span>当前使用</span>}</div>
        <div className="production-history-actions"><Button size="sm" disabled={url === current} onClick={() => onUse(column, url)}>使用</Button>{column.key === 'image' && <Button size="sm" disabled={busy} onClick={() => onEditImage(column, url)}>改图</Button>}<Button size="sm" disabled={busy} onClick={() => onDelete(column, index)}>删除</Button></div>
      </article>)}</div></details>}
    </>
  }
  return <div className="segment-images">
    <section className="segment-image-section"><div className="segment-image-tabs" role="tablist" aria-label="分镜图与故事板切换">{CLIP_IMAGE_COLUMNS.filter(item => item.key !== 'blockingImage').map(item => <button role="tab" type="button" key={item.key} aria-selected={item.key === kind} className={item.key === kind ? 'active' : ''} onClick={() => setKind(item.key)}>{item.label}</button>)}</div>{renderImage(image)}</section>
    <section className="segment-image-section"><h3>站位图</h3>{renderImage(blocking)}</section>
  </div>
}

function InlineVideoPrompt({ clip, candidates, update, notify, onDirtyChange }) {
  const [text, setText] = useState(clip.prompt || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const base = useRef(clip.prompt || '')
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current && !saving) { base.current = clip.prompt || ''; setText(clip.prompt || '') }
  }, [clip.prompt, saving])
  async function save(value) {
    if (!dirty.current || saving) return
    const problem = validateAssetMentions(value, candidates)
    if (problem) { setError(problem); return }
    setSaving(true); setError('')
    try {
      const saved = await update(draft => {
        const item = draft.clips.find(item => item.id === clip.id)
        if (!item || item.prompt !== base.current) throw new Error('视频描述已在其他位置修改，请复制草稿并重新加载核对。')
        item.prompt = value; item.description = value
        if (!isH3FormattedPrompt(value)) item.references = (item.references || []).filter(ref => !ref?.h3PromptReference)
      })
      if (saved) { base.current = value; dirty.current = false; onDirtyChange(false) }
      else setError('保存失败，请保留草稿并检查连接。')
    } catch (reason) { setError(reason.message); notify(reason.message) }
    finally { setSaving(false) }
  }
  return <><div inert={saving ? true : undefined}><AssetMentionInput label="视频描述" value={text} candidates={candidates} onChange={value => { setText(value); dirty.current = value !== base.current; onDirtyChange(dirty.current); setError('') }} onBlur={save} placeholder="输入画面、动作、运镜和对白，键入 @ 关联资产…" /></div>{saving && <small role="status">正在保存…</small>}{error && <p role="alert">{error}</p>}</>
}

export default function VideoProduction() {
  const context = useProject()
  return <Workflow context={context}>{context.episode && <Production key={context.episode.id} context={context} />}</Workflow>
}
function Production({ context }) {
  const navigate = useNavigate()
  const { data, patch, update, reload, notify, requestAgent, generateMedia, models, getModel, mediaDefaults, mediaJobs } = useStore()
  const { episode, projectId, link } = context
  const [busy, setBusy] = useState(false)
  const [promptSetupOpen, setPromptSetupOpen] = useState(() => new URLSearchParams(window.location.search).get('promptSetup') === '1')
  const [promptMode, setPromptMode] = useState('参考生成')
  const [promptRequirements, setPromptRequirements] = useState('')
  const [promptTask, setPromptTask] = useState(null)
  const [promptRefresh, setPromptRefresh] = useState(0)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('promptSetup') === '1') navigate(`/video?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(episode.id)}`, { replace: true })
  }, [projectId, episode.id])
  useEffect(() => {
    if (context.project.creationMode !== 'video-redraw') return
    const controller = new AbortController(), params = new URLSearchParams({ projectId, episodeId: episode.id })
    studioApi(`video-redraw/status?${params}`, undefined, controller.signal).then(async result => {
      const job = result.jobs.find(item => item.kind === 'video-prompts')
      if (!job) { setPromptTask(null); return }
      setPromptTask(job)
      if (['queued', 'running'].includes(job.status)) {
        params.set('jobId', job.id)
        const done = await studioApi(`video-redraw/wait?${params}`, undefined, controller.signal)
        setPromptTask(done)
        if (done.status === 'completed') await reload()
      }
    }).catch(error => { if (!controller.signal.aborted) setPromptTask({ status: 'failed', error: error.message }) })
    return () => controller.abort()
  }, [projectId, episode.id, promptRefresh])
  async function submitPromptTask() {
    try {
      const latest = await reload(), project = latest.projects.find(item => item.id === projectId)
      const job = await studioApi('video-redraw/action', { action: 'video-prompts', projectId, episodeId: episode.id, requestId: crypto.randomUUID(), version: project._version, mode: promptMode, requirements: promptRequirements.trim() })
      setPromptTask(job); setPromptSetupOpen(false); setPromptRefresh(value => value + 1)
    } catch (error) { notify(`视频提示词生成失败：${error.message}`) }
  }
  const [submission, setSubmission] = useState(null)
  const scenes = episodeScenes(episode)
  const clips = scenes.flatMap((scene) => data.clips.filter((clip) => clip.episodeId === episode.id && clip.sceneId === scene.id))
  const unassignedClips = data.clips.filter((clip) => clip.episodeId === episode.id && !scenes.some(scene => scene.id === clip.sceneId))
  const promptPlan = promptTask?.plan || promptTask?.result?.plan || []
  const sourceShots = data.shots.filter(shot => shot.episodeId === episode.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0))
  const plannedDuration = item => {
    const clip = [...clips, ...unassignedClips].find(value => value.id === item.clipId)
    if (!clip) return '片段已删除'
    try { return `${videoDuration(clip.duration, getModel('video', clip.model))} 秒` } catch { return '请调整时长' }
  }
  const [activeId, setActiveId] = useState(clips[0]?.id)
  const active = [...clips, ...unassignedClips].find((clip) => clip.id === activeId) || clips[0] || unassignedClips[0]
  const [group, setGroup] = useState(null)
  const [savingGroup, setSavingGroup] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [deletingJob, setDeletingJob] = useState(null)
  const [removingJob, setRemovingJob] = useState(false)
  const [preview, setPreview] = useState(null)
  const [parameters, setParameters] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [historyKind, setHistoryKind] = useState('video')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [promptDirty, setPromptDirty] = useState(false)
  const [imageEdit, setImageEdit] = useState(null)
  const [removingImage, setRemovingImage] = useState(null)
  const [imageNotes, setImageNotes] = useState('')
  const [promptEdit, setPromptEdit] = useState(null)
  const [promptPreview, setPromptPreview] = useState(null)
  const [optimizing, setOptimizing] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [batch, setBatch, batchBusy, setBatchBusy] = useBatchState(episode.id)
  const [batchOpen, setBatchOpen] = useState(false)
  const promptBackupKey = `studio-prompt-optimization:${episode.id}`
  const [promptBackups, setPromptBackups] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(promptBackupKey) || '{}') || {} } catch { return {} }
  })
  useEffect(() => {
    try { sessionStorage.setItem(promptBackupKey, JSON.stringify(promptBackups)) } catch {}
  }, [promptBackupKey, promptBackups])
  const promptBackup = promptBackups[active?.id]
  const optimization = useRef(null)
  useEffect(() => () => optimization.current?.abort(), [])
  const model = getModel('video', active?.model)
  const resolution = active?.resolution || (mediaDefaults.video?.modelId === model?.id ? mediaDefaults.video?.resolution : model?.defaults?.resolution) || model?.capabilities?.resolutions?.[0]
  const ratio = active?.ratio || context.project.ratio || mediaDefaults.video?.aspectRatio || model?.defaults?.aspectRatio
  const references = active ? clipMediaReferences(active, data) : { images: [], additional: [] }
  // 视频制作只区分“分镜图”和“参考生成”。旧数据中的文本生成/全能参考均按
  // 参考生成处理，避免历史片段继续绕过参考素材。
  const mode = active?.mode === '分镜图' ? '分镜图' : '参考生成'
  const storyboardReference = active ? videoImageReferences(active, references, '分镜图') : []
  const selectedImageReferences = active ? videoImageReferences(active, references, mode) : []
  // 视频描述按引用编辑时的候选：片段分镜图只引用片段图与片段资产。
  const target = promptEdit?.kind === 'clipImage' ? 'clipImage' : 'video'
  const candidateImages = target === 'clipImage' ? (active?.image ? [{ id: `${active.id}:storyboard`, name: '片段分镜图', kind: 'image', url: active.image }] : []) : (mode === '分镜图' ? storyboardReference : references.images)
  const mentionCandidates = assetMentionCandidates(data.assets.filter(asset => asset.projectId === projectId), {
    assetIds: [...new Set(active?.assetIds || [])],
    references: candidateImages,
  })
  let duration, durationError
  const planned = Number(active?.duration) || 0
  const overLimit = planned > CLIP_DURATION_LIMIT
  try { duration = videoDuration(planned, model) } catch (reason) { durationError = reason.message }
  if (!durationError && context.project.creationMode === 'video-redraw' && duration !== planned) durationError = `当前模型不支持 ${planned} 秒，请调整片段时长，使内容时长与生成时长一致`
  const activeJobs = mediaJobs.filter(job => job.options?.studioTarget?.resource === 'clips' && job.options.studioTarget.id === active?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const historyField = 'videos'
  const historyJobs = activeJobs.filter(job => job.options.studioTarget.field === historyField && (job.status !== 'completed' || job.error))
  const videoJob = activeJobs.find(job => job.options.studioTarget.field === 'videos')
  const generatingVideo = pendingJob(videoJob)
  const currentVideo = active && ('currentVideo' in active ? active.currentVideo : (active.videos || [])[0])
  const canGenerateVideo = Boolean(active && model && !durationError && active.prompt?.trim() && (!model.capabilities?.resolutions?.length || model.capabilities.resolutions.includes(resolution)) && (!model.capabilities?.aspectRatios?.length || model.capabilities.aspectRatios.includes(ratio)))

  function editGroup(clip = null, sceneId = active?.sceneId || scenes[0]?.id, insertion = null) {
    setGroup({ clipId: clip?.id, version: clip?._version, sceneId: clip?.sceneId || sceneId, title: clip?.title || `视频片段 ${clips.length + 1}`, duration: clip?.duration ?? 5, prompt: clip?.prompt || '', insertion })
  }
  async function saveGroup() {
    if (savingGroup) return
    if (group.clipId && data.clips.find(clip => clip.id === group.clipId)?._version !== group.version) return notify('片段已被其他操作修改，当前草稿已保留，请核对后重新打开')
    if (!group.title.trim()) return notify('请填写片段名称')
    const clipDuration = Number(group.duration)
    if (!Number.isFinite(clipDuration) || clipDuration <= 0 || clipDuration > CLIP_DURATION_LIMIT) return notify(`片段时长须大于 0 且不超过 ${CLIP_DURATION_LIMIT} 秒`)
    const mentionError = validateAssetMentions(group.prompt, mentionCandidates)
    if (mentionError) return notify(mentionError)
    const redraw = context.project.creationMode === 'video-redraw'
    // 片段只保存自身描述与时长，不再关联或派生自镜头。
    const values = { sceneId: group.sceneId, title: group.title.trim(), duration: clipDuration, prompt: group.prompt || '', description: group.prompt || '' }
    setSavingGroup(true)
    try {
    if (group.clipId) {
      if (!await patch('clips', group.clipId, values)) return
    } else {
      const clip = { ...makeClips(episode.id, [])[0], ...values, ...(redraw ? { mode: '参考生成' } : {}), ratio: context.project.ratio, id: id(), assetIds: [], image: '', imageHistory: [], storyboardImage: '', storyboardHistory: [], blockingImage: '', blockingHistory: [], videos: [] }
      try {
        const saved = await update(draft => {
          const anchor = group.insertion && draft.clips.findIndex(item => item.id === group.insertion.id && item.episodeId === episode.id && item.sceneId === group.sceneId)
          if (group.insertion && group.sceneId === group.insertion.sceneId && anchor === -1) throw new Error('插入位置已被修改，请重新选择片段。')
          if (typeof anchor === 'number' && anchor >= 0) draft.clips.splice(anchor + (group.insertion.side === 'after' ? 1 : 0), 0, clip)
          else draft.clips.push(clip)
        })
        if (!saved) return
        setActiveId(clip.id)
      } catch (reason) { notify(reason.message); return }
    }
    setGroup(null)
    } finally { setSavingGroup(false) }
  }
  function saveImage(column, url, clipId = active.id) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === clipId)
      if (!clip) return
      clip[column.key] = url
      clip[column.history] = [url, ...(clip[column.history] || []).filter(item => item !== url)]
    })
  }
  function deleteVersion(column, index) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === active.id)
      const versions = [...(clip[column.history] || [])]
      const current = clip[column.key]
      const deletingCurrent = versions.indexOf(current) === index
      versions.splice(index, 1)
      clip[column.history] = versions
      if (deletingCurrent) clip[column.key] = versions[0] || ''
    })
    notify('图片版本已删除')
  }
  /** 删除当前图片：清空当前图并从历史里移除该版本，其他历史版本仍保留。 */
  function removeImage(column) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === active.id)
      if (!clip) return
      const url = clip[column.key]
      clip[column.key] = ''
      clip[column.history] = (clip[column.history] || []).filter((item) => item !== url)
      clip.excludedFrameUrls = (clip.excludedFrameUrls || []).filter((item) => item !== url)
    })
    setRemovingImage(null)
    notify(`${column.label}已删除`)
  }
  function deleteVideoVersion(index) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === active.id)
      const versions = clip.videos
      const current = 'currentVideo' in clip ? clip.currentVideo : versions[0]
      const deletingCurrent = versions.indexOf(current) === index
      versions.splice(index, 1)
      if (deletingCurrent) clip.currentVideo = versions[0] || ''
    })
    notify('历史版本已删除')
  }
  async function deleteJob() {
    if (removingJob) return
    setRemovingJob(true)
    try {
      const response = await fetch(`/api/media-generation/jobs/${encodeURIComponent(deletingJob.id)}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '删除失败')
      await reload()
      setDeletingJob(null)
      notify('生成记录已删除')
    } catch (reason) { notify(reason.message) }
    finally { setRemovingJob(false) }
  }
  async function saveVideo(item, clipId) {
    const saved = await update(draft => {
      const clip = draft.clips.find(clip => clip.id === clipId)
      if (!clip) throw new Error('片段已删除，视频未关联')
      clip.videos = [item.url, ...(clip.videos || []).filter(url => url !== item.url)]
      clip.currentVideo = item.url
    })
    if (saved) { setHistoryKind('video'); notify('视频已上传并选用') }
  }
  async function saveComposed(result) {
    if (!result?.url) throw new Error('合成未返回视频结果')
    const saved = await update(draft => {
      const clip = draft.clips.find(item => item.id === active.id)
      if (!clip) throw new Error('片段已删除，合成结果未关联')
      clip.videos = [result.url, ...(clip.videos || []).filter(url => url !== result.url)]
      clip.currentVideo = result.url
    })
    if (saved) { setHistoryKind('video'); notify('剪辑结果已保存并选用') }
  }
  function storyboardImagePrompt(clip, content) {
    const entry = data.prompts.find(item => item.id === '2-1')
    const instruction = entry?.mode === 'replace' ? entry.text : entry?.defaultText || promptCatalog.find(item => item.id === '2-1').defaultText
    return [instruction, `本次任务：直接生成当前片段的完整分镜拼版。项目单格画幅：${context.project.ratio || '未指定'}。`, `当前片段已确定的描述：\n${content}`].filter(Boolean).join('\n\n')
  }
  /** 片段自己的分镜图：使用片段分镜图提示词，结果归属 Clip。 */
  async function generateClipImage(column = CLIP_IMAGE_COLUMNS[0]) {
    if (busy || !active) return
    setBusy(true)
    setSubmission({ id: active.id, field: column.key })
    try {
      const custom = context.project.creationMode !== 'video-redraw' && column.key === 'blockingImage' ? active.blockingPrompt?.trim() : ''
      const base = clipImagePrompt(active, [], scenes, column.label)
      const content = [custom || base, imageEdit?.source ? imageNotes : ''].filter(Boolean).join('\n')
      const prompt = column.key === 'image' && !imageEdit?.source ? storyboardImagePrompt(active, content) : content
      if (!custom && !active.prompt?.trim()) throw new Error('请先填写视频描述')
      await generateMedia({ prompt, target: { resource: 'clips', id: active.id, field: column.key }, references: imageEdit?.source ? [imageEdit.source] : clipMediaReferences(active, data, { includeFrames: false }).images.map(ref => ref.url), ...(['image', 'storyboardImage'].includes(column.key) ? { options: { aspectRatio: '16:9', ...(column.key === 'image' && active.mode === '分镜图' && !imageEdit?.source ? { resolution: '4K' } : {}) } } : {}) })
    } catch (reason) { notify(reason.message) }
    finally { setBusy(false); setSubmission(null) }
  }
  async function submitVideo(clip, preview = false, unlimited = false) {
    const selectedModel = getModel('video', clip.model)
    if (!selectedModel) throw new Error('请先选择视频模型')
    const plannedDuration = Number(clip.duration) || 0
    if (plannedDuration > CLIP_DURATION_LIMIT) throw new Error(`片段时长超过 ${CLIP_DURATION_LIMIT} 秒上限`)
    const seconds = videoDuration(plannedDuration, selectedModel)
    if (context.project.creationMode === 'video-redraw' && seconds !== plannedDuration) throw new Error(`当前模型不支持 ${plannedDuration} 秒，请调整片段时长，使内容时长与生成时长一致`)
    if (!clip.prompt?.trim()) throw new Error('请先填写视频描述')
    const clipMode = clip.mode === '分镜图' ? '分镜图' : '参考生成'
    const refs = clipMediaReferences(clip, data)
    const images = videoImageReferences(clip, refs, clipMode)
    if (!preview && clipMode === '分镜图' && !images.length) throw new Error('请先生成或上传片段分镜图')
    const voices = clipVoices(clip, data)
    const enabledVoices = voices.filter(voice => voice.enabled)
    const videos = clipMode === '参考生成' ? refs.additional.filter(ref => ref.kind === 'video').map(ref => ref.url) : []
    const audioReferences = clipAudioReferences(clip, data, refs, clipMode)
    const audios = audioReferences.map(ref => ref.url)
    if (!preview && clipMode === '参考生成' && enabledVoices.some(voice => !voice.url)) throw new Error('所选音色缺少试听音频，请先配置音频或取消勾选')
    if (!preview && videos.length > (selectedModel.capabilities?.videos || 0)) throw new Error(`当前模型最多支持 ${selectedModel.capabilities?.videos || 0} 个参考视频`)
    if (!preview && audios.length > (selectedModel.capabilities?.audios || 0)) throw new Error(`当前模型最多支持 ${selectedModel.capabilities?.audios || 0} 个参考音频`)
    if (!preview && clipMode === '参考生成' && !images.length && !videos.length) throw new Error('请先生成或添加参考图片或视频')
    const selectedResolution = clip.resolution || (mediaDefaults.video?.modelId === selectedModel.id ? mediaDefaults.video?.resolution : selectedModel.defaults?.resolution) || selectedModel.capabilities?.resolutions?.[0]
    const selectedRatio = clip.ratio || context.project.ratio || mediaDefaults.video?.aspectRatio || selectedModel.defaults?.aspectRatio
    return generateMedia({ preview, promptReferences: images, promptAudios: audioReferences, type: 'video', modelId: selectedModel.id, prompt: clip.prompt.trim(), target: { resource: 'clips', id: clip.id, field: 'videos' }, references: images.map(ref => ref.url), options: { duration: seconds, resolution: selectedResolution, aspectRatio: selectedRatio, ...(unlimited ? { batchUnlimited: true } : {}), ...(videos.length ? { referenceVideos: videos } : {}), ...(audios.length ? { referenceAudios: audios } : {}) } })
  }
  async function generateVideo() {
    if (busy || !active || !canGenerateVideo) return
    setBusy(true); setSubmission({ id: active.id, field: 'videos' }); setHistoryKind('video')
    try { await submitVideo(active) } catch (reason) { notify(reason.message) }
    finally { setBusy(false); setSubmission(null) }
  }
  function openBatch(kind) {
    if (batch?.kind === kind) { setBatchOpen(true); return }
    if (batch && batchBusy) {
      setBatchOpen(true)
      if (batch.kind !== kind) notify('请先查看当前批量任务的结果')
      return
    }
    setBatch({ kind, selected: clips.map(clip => clip.id), results: {}, optimization: model && isH3Model(model) ? 'h3' : 'general' })
    setBatchOpen(true)
  }
  async function runBatch() {
    if (batchBusy || !batch.selected.length) return
    const controller = new AbortController(); setBatchBusy(true)
    const selected = clips.filter(clip => batch.selected.includes(clip.id))
    await Promise.all(selected.map(async clip => {
        setBatch(current => ({ ...current, results: { ...current.results, [clip.id]: { status: '处理中' } } }))
        try {
          if (batch.kind === 'image') {
            const column = CLIP_IMAGE_COLUMNS[0]
            if (!clip.prompt?.trim()) throw new Error('请先填写视频描述')
            await generateMedia({ prompt: storyboardImagePrompt(clip, clipImagePrompt(clip, [], scenes, column.label)), target: { resource: 'clips', id: clip.id, field: column.key }, references: clipMediaReferences(clip, data, { includeFrames: false }).images.map(ref => ref.url), options: { aspectRatio: '16:9', ...(clip.mode === '分镜图' ? { resolution: '4K' } : {}), batchUnlimited: true } })
          } else if (batch.kind === 'video') {
            await submitVideo(clip, false, true)
          } else {
            const selectedModel = getModel('video', clip.model)
            if (!selectedModel || !clip.prompt?.trim()) throw new Error('请先选择视频模型并填写视频描述')
            const seconds = videoDuration(Number(clip.duration) || 0, selectedModel)
            const clipMode = clip.mode === '分镜图' ? '分镜图' : '参考生成'
            const refs = clipMediaReferences(clip, data)
            const images = videoImageReferences(clip, refs, clipMode)
            const audios = clipAudioReferences(clip, data, refs, clipMode)
            if (clipMode === '分镜图' && !images.length) throw new Error('请先生成或上传分镜图')
            const catalog = await studioApi('workspace/styles', undefined, controller.signal)
            const style = styleOptionsFromCatalog(catalog.data).find(item => item.id === String(context.project.style_catalog_id))
            const optimization = batch.optimization
            if (optimization === 'h3' && !isH3Model(selectedModel)) throw new Error('H3 提示优化只适用于 H3 视频模型')
            const text = await optimizeMediaPrompt({ model: selectedModel, modelId: selectedModel.id, optimization, prompt: optimization === 'h3' ? videoPrompt(clip.prompt, style, images, audios) : clip.prompt, mode: 'reference', options: { count: 1, resolution: clip.resolution || (mediaDefaults.video?.modelId === selectedModel.id ? mediaDefaults.video?.resolution : selectedModel.defaults?.resolution) || selectedModel.capabilities?.resolutions?.[0], aspectRatio: clip.ratio || context.project.ratio || mediaDefaults.video?.aspectRatio || selectedModel.defaults?.aspectRatio, duration: seconds }, ...(style ? { style } : {}), ...(images.length || audios.length ? { references: { ...(images.length ? { images } : {}), ...(audios.length ? { audios } : {}) } } : {}) }, { signal: controller.signal })
            if (optimization === 'h3' && !isH3FormattedPrompt(text)) throw new Error('H3 优化结果缺少必需的结构字段，请重试或检查优化提示词')
            const result = { before: clip.prompt, text, optimization, images, audios }
            setBatch(current => ({ ...current, results: { ...current.results, [clip.id]: { ...result, status: '保存中' } } }))
            const saved = await update(draft => {
              const item = draft.clips.find(item => item.id === clip.id)
              if (!item || item.prompt !== clip.prompt || item.duration !== clip.duration || item.model !== clip.model) throw new Error('视频描述、时长或模型已修改，请重新优化')
              const refs = clipMediaReferences(item, draft)
              const currentImages = videoImageReferences(item, refs, item.mode === '分镜图' ? '分镜图' : '参考生成')
              const candidates = assetMentionCandidates(draft.assets.filter(asset => asset.projectId === projectId), { assetIds: [...new Set(item.assetIds || [])], references: currentImages })
              const mentionError = validateAssetMentions(text, candidates)
              if (mentionError) throw new Error(mentionError)
              item.prompt = text; item.description = text
              if (context.project.creationMode === 'video-redraw') item.duration = seconds
              if (optimization === 'h3') item.references = h3ReferenceSnapshot(item.references, images, audios)
              else if (!isH3FormattedPrompt(text)) item.references = (item.references || []).filter(ref => !ref?.h3PromptReference)
            })
            if (!saved) throw new Error('保存失败，请重新加载后重试')
            setPromptBackups(current => ({ ...current, [clip.id]: { before: clip.prompt, after: text, optimization, ...(context.project.creationMode === 'video-redraw' ? { beforeDuration: clip.duration, afterDuration: seconds } : {}) } }))
            setBatch(current => ({ ...current, results: { ...current.results, [clip.id]: { ...result, status: '已应用' } } }))
            return
          }
          setBatch(current => ({ ...current, results: { ...current.results, [clip.id]: { status: '已入队' } } }))
        } catch (reason) {
          setBatch(current => ({ ...current, results: { ...current.results, [clip.id]: { ...current.results[clip.id], status: '失败', error: reason.message } } }))
        }
    }))
    setBatchBusy(false)
  }
  function closePrompt() {
    if (savingPrompt) return
    optimization.current?.abort()
    optimization.current = null
    setOptimizing(false)
    setPromptEdit(null)
  }
  function openPromptOptimization(backup) {
    setPromptEdit({ id: active.id, currentPrompt: active.prompt, currentDuration: active.duration, currentModel: active.model, text: backup?.after ?? active.prompt, before: backup?.before ?? active.prompt, optimization: backup?.optimization || (isH3Model(model) ? 'h3' : 'general') })
  }
  function rememberOptimization(text) {
    setPromptBackups(current => ({ ...current, [promptEdit.id]: { before: promptEdit.before, after: text, optimization: promptEdit.optimization, ...(promptEdit.optimizedDuration !== undefined ? { beforeDuration: promptEdit.currentDuration, afterDuration: promptEdit.optimizedDuration } : {}) } }))
  }
  async function savePrompt() {
    if (savingPrompt) return
    if (active?.id !== promptEdit.id) return notify('片段已变更，请重新打开描述')
    const mentionError = validateAssetMentions(promptEdit.text, mentionCandidates)
    if (mentionError) return notify(mentionError)
    setSavingPrompt(true)
    try {
      const saved = await update(draft => {
        const clip = draft.clips.find(clip => clip.id === promptEdit.id)
        if (!clip || clip.prompt !== promptEdit.currentPrompt || (promptEdit.optimizedDuration !== undefined && (clip.duration !== promptEdit.currentDuration || clip.model !== promptEdit.currentModel))) throw new Error('视频描述、时长或模型已被其他操作修改，当前草稿已保留，请核对后重新打开')
        clip.prompt = promptEdit.text
        clip.description = promptEdit.text
        if (promptEdit.optimizedDuration !== undefined) clip.duration = promptEdit.optimizedDuration
        if (promptEdit.optimizedImages && isH3FormattedPrompt(promptEdit.text)) clip.references = h3ReferenceSnapshot(clip.references, promptEdit.optimizedImages, promptEdit.optimizedAudios)
        else if (!isH3FormattedPrompt(promptEdit.text)) clip.references = (clip.references || []).filter(ref => !ref?.h3PromptReference)
      })
      if (saved) {
        if (promptEdit.optimization && promptEdit.text !== promptEdit.before) rememberOptimization(promptEdit.text)
        setPromptEdit(null)
      }
    } catch (reason) { notify(reason.message) }
    finally { setSavingPrompt(false) }
  }
  async function restorePrompt() {
    if (savingPrompt || !promptBackup) return
    setSavingPrompt(true)
    try {
      const saved = await update(draft => {
        const clip = draft.clips.find(clip => clip.id === active.id)
        if (!clip || clip.prompt !== promptBackup.after) throw new Error('视频描述已修改，请先打开优化对比核对原文')
        clip.prompt = promptBackup.before
        clip.description = promptBackup.before
        if (promptBackup.beforeDuration !== undefined && clip.duration === promptBackup.afterDuration) clip.duration = promptBackup.beforeDuration
        clip.references = (clip.references || []).filter(ref => !ref?.h3PromptReference)
      })
      if (saved) notify('已还原优化前的原文')
    } catch (reason) { notify(reason.message) }
    finally { setSavingPrompt(false) }
  }
  async function optimizePrompt() {
    if (!model || !promptEdit?.text.trim() || optimization.current) return
    const controller = new AbortController()
    optimization.current = controller
    setOptimizing(true)
    setPromptEdit(current => ({ ...current, error: '' }))
    try {
      const optimizationDuration = videoDuration(planned, model)
      if (mode === '分镜图' && !storyboardReference.length) throw new Error('请先生成或上传分镜图')
      const catalog = await studioApi('workspace/styles', undefined, controller.signal)
      const style = styleOptionsFromCatalog(catalog.data).find(style => style.id === String(context.project.style_catalog_id))
      const audios = clipAudioReferences(active, data, references, mode)
      const text = await optimizeMediaPrompt({ model, modelId: model.id, optimization: promptEdit.optimization, prompt: promptEdit.optimization === 'h3' ? videoPrompt(promptEdit.text, style, selectedImageReferences, audios) : promptEdit.text, mode: 'reference', options: { count: 1, resolution, aspectRatio: ratio, duration: optimizationDuration }, ...(style ? { style } : {}), ...(selectedImageReferences.length || audios.length ? { references: { ...(selectedImageReferences.length ? { images: selectedImageReferences } : {}), ...(audios.length ? { audios } : {}) } } : {}) }, { signal: controller.signal })
      if (promptEdit.optimization === 'h3' && !isH3FormattedPrompt(text)) throw new Error('H3 优化结果缺少必需的结构字段，请重试或检查优化提示词')
      if (!controller.signal.aborted) {
        setPromptEdit(current => ({ ...current, text, optimizedDuration: context.project.creationMode === 'video-redraw' ? optimizationDuration : undefined, optimizedImages: current.optimization === 'h3' ? selectedImageReferences : undefined, optimizedAudios: current.optimization === 'h3' ? audios : undefined }))
      }
    } catch (reason) {
      if (!controller.signal.aborted) setPromptEdit(current => ({ ...current, error: reason.message }))
    } finally {
      if (optimization.current === controller) { optimization.current = null; setOptimizing(false) }
    }
  }
  function moveClip(clip, offset) {
    const sceneClips = clips.filter((item) => item.sceneId === clip.sceneId)
    const other = sceneClips[sceneClips.indexOf(clip) + offset]
    if (!other) return
    update((draft) => {
      const a = draft.clips.findIndex((item) => item.id === clip.id), b = draft.clips.findIndex((item) => item.id === other.id)
      ;[draft.clips[a], draft.clips[b]] = [draft.clips[b], draft.clips[a]]
    })
  }
  const clipTask = clip => {
    const job = mediaJobs.find(job => job.options?.studioTarget?.resource === 'clips' && job.options.studioTarget.id === clip.id && pendingJob(job))
    if (job) return `${job.type === 'video' ? '视频' : '图片'}${jobLabel(job)}${typeof job.progress === 'number' ? ` ${job.progress}%` : ''}`
    const result = batch?.kind === 'prompt' && batch.results[clip.id]
    return batchBusy && ['处理中', '保存中'].includes(result?.status) ? '提示词优化中' : ''
  }
  return (
    <div className="page-storyboard production-page">
      <header className="workspace-toolbar"><div className="sb-toolbar-head"><h2>分镜</h2><label className="sb-episode-pick"><span>剧集</span><select aria-label="选择剧集" value={episode.id} onChange={(e) => navigate(`/video?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(e.target.value)}`)}>{context.episodes.map((e) => <option key={e.id} value={e.id}>第{e.number}集 · {e.title}</option>)}</select></label><p className="muted">共 {clips.length} 个视频片段 · 在下方选择片段</p></div><div className="toolbar"><Button disabled={!clips.length || busy} onClick={() => openBatch('image')}>批量生成分镜图</Button><Button disabled={!clips.length || busy} onClick={() => openBatch('prompt')}>批量优化提示词</Button><Button disabled={!clips.length || busy} onClick={() => openBatch('video')}>批量生成视频</Button>{context.project.creationMode === 'video-redraw' ? <><span role="status">{['queued', 'running'].includes(promptTask?.status) ? '正在编写视频提示词…' : ['failed', 'interrupted', 'cancelled'].includes(promptTask?.status) ? `视频提示词生成失败：${promptTask.error || '请重试'}` : promptTask?.status === 'completed' ? '视频提示词已生成' : ''}</span><Button disabled={['queued', 'running'].includes(promptTask?.status) || clips.length > 0} onClick={() => setPromptSetupOpen(true)}>生成视频提示词</Button>{clips.length > 0 && <Button onClick={() => requestAgent({ action: 'redraw-video-description', projectId, episodeId: episode.id, continueCurrentSession: true }).catch(reason => notify(reason.message))}>让 Agent 调整</Button>}</> : <Button onClick={() => requestAgent({ action: 'video-description', projectId, episodeId: episode.id }).catch(reason => notify(reason.message))}>AI 编写视频描述</Button>}</div></header>
      {context.project.creationMode === 'video-redraw' && <p className="redraw-production-note">当前使用视频描述和目标资产生成，连续动作不保证逐帧还原。请试听生成结果的目标语言对白。<button className="link-btn" onClick={() => navigate(link('/film'))}>进入短片剪辑 →</button></p>}
      {promptPlan.length > 0 && <details className="prompt-plan" open><summary>Chip 拆分总表（生成时）</summary><div className="prompt-plan-scroll"><table><thead><tr><th>片段</th><th>原视频时间</th><th>内容时长</th><th>生成时长</th><th>对应镜头</th></tr></thead><tbody>{promptPlan.map((item, index) => <tr key={item.clipId}><td>Chip {shotNumber(index)}</td><td>{formatVideoTime(item.globalStart)}–{formatVideoTime(item.globalEnd)}</td><td>{[...clips, ...unassignedClips].find(clip => clip.id === item.clipId)?.duration ?? '已删除'} 秒</td><td>{plannedDuration(item)}</td><td>{item.shotIds.map(id => { const number = sourceShots.findIndex(shot => shot.id === id); return number < 0 ? '已删除' : shotNumber(number) }).join('、')}</td></tr>)}</tbody></table></div><p className="muted">生成时长按片段当前选择的视频模型和时长计算。</p></details>}
      <div className="production-layout">
        <div className="production-mobile-picker">
          <select aria-label="选择视频片段" value={active?.id || ''} disabled={!clips.length} onChange={event => { setActiveId(event.target.value); setHistoryKind('video') }}>
            {!clips.length && <option value="">暂无视频片段</option>}
            {scenes.map((scene, index) => <optgroup key={scene.id} label={`第${index + 1}场 · ${scene.location || '地点待填写'}`}>
              {clips.filter(clip => clip.sceneId === scene.id).map(clip => <option key={clip.id} value={clip.id}>{`片段 ${shotNumber(clips.indexOf(clip))} · ${clip.title}`}</option>)}
            </optgroup>)}
          </select>
          <Button aria-label="创建视频片段" disabled={busy} onClick={() => editGroup(null, scenes[0]?.id)}>＋ 新建</Button>
        </div>
        <aside className="production-list" aria-label="场次与视频片段">
          {scenes.map((scene, sceneIndex) => {
            const sceneClips = clips.filter(clip => clip.sceneId === scene.id)
            if (!sceneClips.length) return <button key={scene.id} className="production-empty-scene" disabled={busy || promptDirty} onClick={() => editGroup(null, scene.id)} title={`${sceneLabel(scene, sceneIndex)}：新增片段`}>第{sceneIndex + 1}场 <IconPlus size={15} /></button>
            return sceneClips.map((clip, index) => {
              const number = `${sceneIndex + 1}-${index + 1}`
              const label = `片段 ${number} · ${Number(clip.duration) || 0}秒`
              const task = clipTask(clip)
              return <div className="production-tile" key={clip.id}>
                <button className="production-tile-insert production-tile-insert--before" aria-label={`在${label}之前新增片段`} title="在前面新增片段" disabled={busy || promptDirty} onClick={() => editGroup(null, scene.id, { id: clip.id, sceneId: scene.id, side: 'before' })}><IconPlus size={13} /></button>
                <button className={`production-clip${active?.id === clip.id ? ' active' : ''}`} aria-label={`${label} · ${clip.title}${task ? ` · ${task}` : ''}`} aria-pressed={active?.id === clip.id} disabled={promptDirty} onClick={() => { setActiveId(clip.id); setHistoryKind('video') }} title={`${sceneLabel(scene, sceneIndex)} · ${clip.title}${task ? ` · ${task}` : ''}`}>
                  <span className="production-tile-preview">{clip.currentVideo ? <img src={`/api/video-editing/thumbnail?url=${encodeURIComponent(clip.currentVideo)}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : <IconMovie size={24} stroke={1.5} />}</span>
                  {task && <span className="production-tile-task">{task}</span>}
                </button>
                <Popover.Root><Popover.Trigger asChild><button className="production-tile-menu-trigger" type="button" aria-label={`管理片段 ${number}`} disabled={busy || promptDirty}><IconDots size={15} /></button></Popover.Trigger><Popover.Portal container={document.querySelector('.rn-studio')}><Popover.Content side="top" align="end" sideOffset={6} className="production-control-popover production-tile-menu">
                  <Popover.Close asChild><button onClick={() => editGroup(clip)}>编辑片段</button></Popover.Close>
                  <Popover.Close asChild><button disabled={index === 0} onClick={() => moveClip(clip, -1)}>上移片段</button></Popover.Close>
                  <Popover.Close asChild><button disabled={index === sceneClips.length - 1} onClick={() => moveClip(clip, 1)}>下移片段</button></Popover.Close>
                  <Popover.Close asChild><button onClick={() => setDeleting(clip)}>删除片段</button></Popover.Close>
                </Popover.Content></Popover.Portal></Popover.Root>
                <span className="production-tile-label">{number} · {Number(clip.duration) || 0}s</span>
                <button className="production-tile-insert production-tile-insert--after" aria-label={`在${label}之后新增片段`} title="在后面新增片段" disabled={busy || promptDirty} onClick={() => editGroup(null, scene.id, { id: clip.id, sceneId: scene.id, side: 'after' })}><IconPlus size={13} /></button>
              </div>
            })
          })}
          {unassignedClips.map(clip => { const task = clipTask(clip); return <div className="production-tile" key={clip.id}><button className={`production-clip${active?.id === clip.id ? ' active' : ''}`} aria-label={`场次待确认 · ${clip.title}${task ? ` · ${task}` : ''}`} aria-pressed={active?.id === clip.id} disabled={promptDirty} onClick={() => { setActiveId(clip.id); setHistoryKind('video') }} title={clip.title}><span className="production-tile-preview">{clip.currentVideo ? <img src={`/api/video-editing/thumbnail?url=${encodeURIComponent(clip.currentVideo)}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : <IconMovie size={24} stroke={1.5} />}</span>{task && <span className="production-tile-task">{task}</span>}</button><span className="production-tile-label">场次待确认 · {Number(clip.duration) || 0}s</span></div> })}
          {!scenes.length && <p className="muted">还没有场次，请先在剧本页维护场次。</p>}
        </aside>
        {active ? <>
          <aside className="production-assets" aria-label="片段素材与引用">
            <div className="production-clip-heading"><strong>片段 {(() => { const sceneIndex = scenes.findIndex(scene => scene.id === active.sceneId); return sceneIndex < 0 ? '场次待确认' : `${sceneIndex + 1}-${clips.filter(clip => clip.sceneId === active.sceneId).findIndex(clip => clip.id === active.id) + 1}` })()}</strong><span>时长 {planned} 秒</span></div>
            <h3>引用资产与音色</h3><ClipReferences key={active.id} clip={active} projectId={projectId} />
            <SegmentImages clip={active} busy={busy || promptDirty} jobs={activeJobs} submission={submission} fromDescription={context.project.creationMode === 'video-redraw'} onGenerate={(column) => generateClipImage(column)} onUpload={(column, url) => saveImage(column, url)} onUse={(column, url) => { patch('clips', active.id, { [column.key]: url, excludedFrameUrls: (active.excludedFrameUrls || []).filter(item => item !== url) }); notify('已选用该图片版本') }} onPreview={setPreview} onDelete={(column, index) => deleteVersion(column, index)} onEditImage={(column, url) => { setImageNotes(''); setImageEdit({ ...column, source: url }) }} onRemove={(column) => setRemovingImage({ column })} />
          </aside>
          <div className="production-center">
            <section className="production-description" aria-label="视频描述">
              <div className="row"><h3>视频描述</h3><div className="toolbar"><Button disabled={busy || !canGenerateVideo} onClick={async () => { try { setPromptPreview(await submitVideo(active, true)) } catch (reason) { notify(reason.message) } }}>预览生成提示词</Button><Button disabled={busy || promptDirty || !model || !active.prompt.trim()} onClick={() => openPromptOptimization()}>提示词优化</Button>{promptBackup && <><Button onClick={() => openPromptOptimization(promptBackup)}>优化对比</Button><Button disabled={savingPrompt || active.prompt !== promptBackup.after || promptBackup.before === promptBackup.after} onClick={restorePrompt}>还原原文</Button></>}</div></div>
              <p className="muted">画面、动作、镜头切换和对白统一写在视频描述中。</p>
              <InlineVideoPrompt key={active.id} clip={active} candidates={mentionCandidates} update={update} notify={notify} onDirtyChange={setPromptDirty} />
            </section>
          </div>
          <section className="production-main-preview" aria-label="片段预览">
            <h3>片段预览</h3>
            <div className="production-preview-media">
              {currentVideo ? <video key={`${active.id}-${currentVideo}`} className="production-video" src={currentVideo} controls playsInline preload="metadata" /> : <div className="production-video-empty">{generatingVideo ? <Processing busy text={jobLabel(videoJob)} /> : '尚未生成视频'}</div>}
              <div className="production-media-actions"><Button disabled={busy || sourceVideos(active).length < 2} onClick={() => setCompareOpen(true)}>对比视频</Button><details><summary>更多操作</summary><div className="toolbar"><FileButton key={active.id} kind="video" disabled={busy} onSelect={item => saveVideo(item, active.id)}>上传视频</FileButton>{currentVideo && <><Button onClick={() => download(currentVideo, `${active.title}.mp4`)}>下载视频</Button><Button onClick={() => patch('clips', active.id, { currentVideo: '' })}>移除当前视频</Button></>}<Button disabled={busy || !sourceVideos(active).length} onClick={() => setEditOpen(true)}>剪辑 / 拼接</Button></div></details></div>
            </div>
          </section>
            <aside className={`production-history${historyOpen ? ' is-open' : ''}`} aria-label="片段视频生成历史">
              <button className="production-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? '收起历史 ›' : '历史记录 ‹'}</button>
              {historyOpen && <>
              <div className="row"><h3>当前片段 · 视频历史</h3><Processing busy={busy && submission?.id === active.id && submission.field === 'videos'} text="正在提交视频任务…" /></div>
              <div className="production-history-items">{historyJobs.map(job => <article key={job.id} className={`production-job production-job--${job.status}`} aria-label={`视频${jobLabel(job)}`}>
                {pendingJob(job) ? <><Processing busy text={jobLabel(job)} />{typeof job.progress === 'number' && <span role="status">{job.progress}%</span>}</> : <p role="alert">{jobLabel(job)}{job.error && `：${job.error}`}</p>}
                {!pendingJob(job) && <Button danger disabled={removingJob} onClick={() => setDeletingJob(job)}>删除记录</Button>}
              </article>)}{(active.videos || []).map((url, index) => {
                const name = `视频历史版本${(active.videos || []).length - index}`
                const selected = url === currentVideo
                return <article key={`${active.id}-video-${index}`} aria-label={name} className={selected ? 'current' : ''}>
                  <button aria-label={`切换到${name}`} title={`切换到${name}`} onClick={() => { if (!selected) { patch('clips', active.id, { currentVideo: url }); notify(`已切换到${name}`) } }}><video src={url} muted preload="none" /></button>
                  <div className="production-history-meta"><small>版本 {(active.videos || []).length - index}</small>{selected && <span>当前使用</span>}</div>
                  <div className="production-history-actions"><Button onClick={() => setPreview({ name, url, kind: 'video' })}>预览</Button><Button onClick={() => setParameters({ name, url, kind: 'video' })}>参数</Button><Button disabled={selected} onClick={() => patch('clips', active.id, { currentVideo: url })}>使用此版本</Button><Button danger disabled={busy} onClick={() => deleteVideoVersion(index)}>删除</Button></div>
                </article>
              })}{!historyJobs.length && !(active.videos || []).length && !busy && <p className="muted">暂无视频历史</p>}</div>
              </>}
            </aside>
          <aside className="production-settings" aria-label="视频生成控制">
            <div className="production-control-bar">
              <Popover.Root><Popover.Trigger asChild><button className="production-control-trigger" type="button" aria-label="选择视频模型">{model?.name || '选择模型'} <IconChevronDown size={14} /></button></Popover.Trigger><Popover.Portal container={document.querySelector('.rn-studio')}><Popover.Content side="top" align="start" sideOffset={8} className="production-control-popover production-model-menu">
                {models.filter(item => item.type === 'video').map(item => <Popover.Close asChild key={item.id}><button type="button" className={item.id === model?.id ? 'selected' : ''} onClick={() => patch('clips', active.id, { model: item.id, resolution: '', ratio: context.project.ratio })}>{item.name}</button></Popover.Close>)}
              </Popover.Content></Popover.Portal></Popover.Root>
              <Popover.Root><Popover.Trigger asChild><button className="production-control-trigger" type="button" aria-label="画幅和分辨率">{ratio || '画幅'} / {resolution || '分辨率'}{resolution && model?.capabilities?.resolutions?.length && !model.capabilities.resolutions.includes(resolution) ? '（不支持）' : ''} / {duration ? `${duration}s` : '时长'} <IconChevronDown size={14} /></button></Popover.Trigger><Popover.Portal container={document.querySelector('.rn-studio')}><Popover.Content side="top" align="start" sideOffset={8} className="production-control-popover production-parameter-panel">
                <h3>画幅</h3><div className="production-option-grid">{(model?.capabilities?.aspectRatios || []).map(value => <button key={value} type="button" aria-pressed={ratio === value} onClick={() => patch('clips', active.id, { ratio: value })}>{value}</button>)}</div>
                <h3>分辨率</h3>{resolution && model?.capabilities?.resolutions?.length && !model.capabilities.resolutions.includes(resolution) && <small>当前值 {resolution} 不受此模型支持，请选择下方选项。</small>}<div className="production-option-grid">{(model?.capabilities?.resolutions || []).map(value => <button key={value} type="button" aria-pressed={resolution === value} onClick={() => patch('clips', active.id, { resolution: value })}>{value}</button>)}</div>
                <h3>片段时长</h3><label className="production-control-duration"><input key={`${active.id}-${planned}`} aria-label="片段时长（秒）" type="number" min="0.1" max={CLIP_DURATION_LIMIT} step="0.1" defaultValue={planned} onBlur={event => { const value = Number(event.target.value); if (!Number.isFinite(value) || value <= 0 || value > CLIP_DURATION_LIMIT) { event.target.value = String(planned); notify(`片段时长须大于 0 且不超过 ${CLIP_DURATION_LIMIT} 秒`); return } if (value !== planned) patch('clips', active.id, { duration: value }) }} /> 秒</label><small>{durationError || `生成时长 ${duration} 秒${duration !== planned ? '，按模型要求向上取整' : ''}`}</small>
              </Popover.Content></Popover.Portal></Popover.Root>
              <Popover.Root><Popover.Trigger asChild><button className="production-control-icon" type="button" aria-label="生成方式" title="生成方式"><IconSettings size={19} /></button></Popover.Trigger><Popover.Portal container={document.querySelector('.rn-studio')}><Popover.Content side="top" align="start" sideOffset={8} className="production-control-popover production-mode-panel"><h3>生成方式</h3><div className="production-option-grid">{['分镜图', '参考生成'].map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => patch('clips', active.id, { mode: value })}>{value}</button>)}</div></Popover.Content></Popover.Portal></Popover.Root>
              <Button className="production-generate" primary disabled={busy || promptDirty || !canGenerateVideo || overLimit} onClick={generateVideo} aria-label="生成整段视频">{busy && submission?.field === 'videos' ? '提交中…' : <><span>生成</span><IconArrowUp size={18} /></>}</Button>
            </div>
          </aside>
        </> : <div className="empty"><h3>还没有视频片段</h3><p>按场次创建视频片段，然后生成整段视频。</p><Button primary onClick={() => editGroup(null, scenes[0]?.id)}>创建视频片段</Button></div>}
      </div>
      {promptSetupOpen && context.project.creationMode === 'video-redraw' && <Modal title="生成视频提示词" onClose={() => setPromptSetupOpen(false)} footer={<><Button onClick={() => setPromptSetupOpen(false)}>取消</Button><Button primary disabled={['queued', 'running'].includes(promptTask?.status) || clips.length > 0} onClick={submitPromptTask}>开始生成</Button></>}><Field label="视频生成方式"><select aria-label="视频生成方式" value={promptMode} onChange={event => setPromptMode(event.target.value)}><option value="参考生成">参考生成</option><option value="分镜图">分镜图</option></select></Field><Field label="补充要求（选填）"><textarea aria-label="视频提示词补充要求" maxLength={2000} rows={3} value={promptRequirements} onChange={event => setPromptRequirements(event.target.value)} placeholder="例如：优先保持原片动作和对白节奏" /></Field>{clips.length > 0 && <p className="muted">本集已有视频片段，可通过 Agent 调整。</p>}</Modal>}
      {batch && batchOpen && <Modal title={{ image: '批量生成分镜图', prompt: '批量优化提示词', video: '批量生成视频' }[batch.kind]} wide onClose={() => setBatchOpen(false)} footer={<><Button onClick={() => setBatchOpen(false)}>关闭</Button>{!batchBusy && <>{Object.keys(batch.results).length > 0 && <Button onClick={() => setBatch({ ...batch, selected: clips.map(clip => clip.id), results: {} })}>新建批次</Button>}<Button primary disabled={!batch.selected.length || Object.keys(batch.results).length > 0} onClick={runBatch}>开始处理（{batch.selected.length}）</Button></>}</>}>
        <p className="muted">选择本集片段，同时提交处理。关闭窗口后任务继续运行。{batch.kind === 'prompt' ? '优化完成后自动保存并应用。' : '每个片段按自身设置提交，任务进度可在片段历史中查看。'}</p>
        {batch.kind === 'prompt' && <><Field label="优化方式"><select aria-label="批量优化方式" disabled={batchBusy || Object.keys(batch.results).length > 0} value={batch.optimization} onChange={event => setBatch(current => ({ ...current, optimization: event.target.value }))}><option value="general">普通优化</option><option value="h3">H3 提示优化</option></select></Field><p className="muted">H3 提示优化需要片段使用 H3 视频模型并提供参考图片；不符合条件的片段会显示失败原因。</p></>}
        <label><input type="checkbox" disabled={batchBusy || Object.keys(batch.results).length > 0} checked={batch.selected.length === clips.length} onChange={event => setBatch(current => ({ ...current, selected: event.target.checked ? clips.map(clip => clip.id) : [] }))} /> 全选</label>
        <div className="production-batch-list">{clips.map((clip, index) => { const result = batch.results[clip.id]; return <div className="production-batch-item" key={clip.id}>
          <label><input type="checkbox" disabled={batchBusy || Object.keys(batch.results).length > 0} checked={batch.selected.includes(clip.id)} onChange={event => setBatch(current => ({ ...current, selected: event.target.checked ? [...current.selected, clip.id] : current.selected.filter(id => id !== clip.id) }))} /> 片段 {shotNumber(index)} · {clip.title}</label>
          {result && <div><span role={result.error ? 'alert' : 'status'}>{result.status}{result.error && `：${result.error}`}</span>{result.text && <><details><summary>查看原文与优化结果</summary><p><strong>原文</strong></p><p className="production-parameters-prompt">{result.before}</p><p><strong>优化结果</strong></p><p className="production-parameters-prompt">{result.text}</p></details></>}</div>}
        </div> })}</div>
      </Modal>}
      {group && <Modal title={group.clipId ? "编辑视频片段" : "新增视频片段"} wide onClose={() => { if (!savingGroup) setGroup(null) }} footer={<><Button disabled={savingGroup} onClick={() => setGroup(null)}>取消</Button><Button primary disabled={savingGroup || !group.title.trim()} onClick={saveGroup}>{savingGroup ? "正在保存…" : "保存片段"}</Button></>}>
        <Field label="所属场次"><select value={group.sceneId} onChange={(e) => setGroup({ ...group, sceneId: e.target.value })}>{scenes.map((scene, index) => <option key={scene.id} value={scene.id}>{sceneLabel(scene, index)}</option>)}</select></Field>
        <Field label="片段名称"><input value={group.title} maxLength={100} onChange={(e) => setGroup({ ...group, title: e.target.value })} /></Field>
        <Field label="片段时长（秒）"><input type="number" min="0.1" max={CLIP_DURATION_LIMIT} step="0.1" value={group.duration} onChange={(e) => setGroup({ ...group, duration: e.target.value })} /></Field>
        <Field label="视频描述"><textarea rows={6} maxLength={10000} value={group.prompt} placeholder="整段视频的画面、动作、镜头与对白，直接作为生成依据…" onChange={(e) => setGroup({ ...group, prompt: e.target.value })} /></Field>
        <p className="muted">生成时长按模型支持的秒数向上取整，视频描述中的时间安排请与片段时长保持一致。</p>
      </Modal>}
      {promptPreview !== null && <Modal title="生成视频提示词" wide onClose={() => setPromptPreview(null)}><pre className="production-prompt-preview">{promptPreview}</pre></Modal>}
      {promptEdit && <Modal title={promptEdit.optimization ? '视频提示词优化对比' : '编辑视频描述'} wide onClose={closePrompt} footer={<><Button disabled={savingPrompt} onClick={closePrompt}>取消</Button><Button primary disabled={optimizing || savingPrompt || !promptEdit.text.trim()} onClick={savePrompt}>{savingPrompt ? '正在保存…' : promptEdit.optimization ? '应用结果' : '保存描述'}</Button></>}>
        {promptEdit.optimization && <><div className="toolbar"><Field label="优化方式"><select aria-label="优化方式" disabled={optimizing || savingPrompt} value={promptEdit.optimization} onChange={event => setPromptEdit({ ...promptEdit, optimization: event.target.value })}><option value="general">普通优化</option>{model && isH3Model(model) && <option value="h3">H3 提示优化</option>}</select></Field><Button disabled={optimizing || savingPrompt || !model || !promptEdit.text.trim()} onClick={optimizePrompt}>开始优化</Button>{optimizing && <Button onClick={() => { optimization.current?.abort(); optimization.current = null; setOptimizing(false) }}>取消优化</Button>}<Button disabled={optimizing || savingPrompt || promptEdit.text === promptEdit.before} onClick={() => setPromptEdit({ ...promptEdit, text: promptEdit.before, error: '', optimizedDuration: undefined, optimizedImages: undefined, optimizedAudios: undefined })}>还原原文</Button></div><p className="muted">对照原文检查优化结果，也可继续编辑。点击“应用结果”后更新视频描述。{context.project.creationMode === 'video-redraw' && duration && duration !== planned && ` 优化将按 ${duration} 秒编排，应用结果时同步调整片段时长。`}</p><Processing busy={optimizing} text="正在优化提示词…" />{promptEdit.error && <p role="alert">{promptEdit.error}</p>}</>}
        <div className={promptEdit.optimization ? 'production-prompt-comparison' : ''}>
          {promptEdit.optimization && <Field label="原文"><div className="production-prompt-readonly"><MentionText value={promptEdit.before} candidates={mentionCandidates} /></div></Field>}
          <Field label={promptEdit.optimization ? '优化后' : '视频描述'}><AssetMentionInput value={promptEdit.text} label={promptEdit.optimization ? '优化后' : '视频描述'} candidates={mentionCandidates} onChange={text => setPromptEdit(current => ({ ...current, text }))} /></Field>
        </div>
      </Modal>}
      {imageEdit && <Modal title={`修改${imageEdit.label}`} onClose={() => { setImageEdit(null) }} footer={<><Button onClick={() => { setImageEdit(null) }}>取消</Button><Button primary disabled={busy || !imageNotes.trim()} onClick={() => { generateClipImage(imageEdit); setImageEdit(null) }}>生成改图</Button></>}><img loading="lazy" className="production-edit-source" src={imageEdit.source} alt="本次修改的原图" /><Field label="修改要求"><textarea rows={5} maxLength={5000} value={imageNotes} onChange={(e) => setImageNotes(e.target.value)} /></Field></Modal>}
      {deleting && <Confirm title="删除视频片段" danger onClose={() => setDeleting(null)} onConfirm={() => { update((draft) => { draft.clips = draft.clips.filter((clip) => clip.id !== deleting.id) }); setDeleting(null) }}>删除“{deleting.title}”及其生成历史？已生成的视频文件保留。</Confirm>}
      {removingImage && <Confirm title={`删除${removingImage.column.label}`} danger onClose={() => setRemovingImage(null)} onConfirm={() => removeImage(removingImage.column)}>删除当前{removingImage.column.label}？该图片会从历史版本中一并移除，其他历史版本仍会保留；删除后可通过重新生成或上传恢复。</Confirm>}
      {deletingJob && <Modal title="删除生成记录" onClose={() => { if (!removingJob) setDeletingJob(null) }} footer={<><Button disabled={removingJob} onClick={() => setDeletingJob(null)}>取消</Button><Button danger disabled={removingJob} onClick={deleteJob}>{removingJob ? '正在删除…' : '确认删除'}</Button></>}>删除这条生成记录？{deletingJob.status === 'uncertain' && '上游任务结果未知，删除记录不会取消上游任务或退还费用。'}</Modal>}
      {preview && <MediaPreview item={preview} onClose={() => setPreview(null)} />}
      {parameters && <VersionParametersModal item={parameters} jobs={mediaJobs} models={models} onClose={() => setParameters(null)} />}
      {editOpen && <VideoEditModal sources={sourceVideos(active)} ratio={ratio} onClose={() => setEditOpen(false)} onSaved={saveComposed} />}
      {compareOpen && <VideoCompareModal sources={sourceVideos(active)} onClose={() => setCompareOpen(false)} onUse={url => patch('clips', active.id, { currentVideo: sourceVideos(active).find(item => item.id === url)?.url || url })} />}
    </div>
  )
}
