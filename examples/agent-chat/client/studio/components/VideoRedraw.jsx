import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { studioApi, useStore } from '../store'
import { startPolling } from '../../polling'
import { Button, Field, Modal, DirectorSelect } from './ui'
import { Workflow, useProject } from './Shell'
import { studioDefaults } from '../../../studio-schema'
import { StyleSelector } from '@darl/ui'
import { createWorkspaceStyle, styleOptionsFromCatalog } from '../../workspace-styles'

const regions = { japan: '日本', western: '欧美' }
const languages = { ja: '日语', en: '英语' }
const statusNames = { queued: '排队', running: '进行中', completed: '完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
export const sourceTime = value => `${Number(value || 0).toFixed(2)}s`
const activeJob = job => ['queued', 'running'].includes(job?.status)

function useRedraw(projectId) {
  const { reload, notify } = useStore()
  const [jobs, setJobs] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const refresh = async signal => {
    const value = await studioApi(`video-redraw/jobs?projectId=${encodeURIComponent(projectId)}`, undefined, signal)
    if (!signal?.aborted) setJobs(value.jobs)
  }
  useEffect(() => {
    return startPolling(refresh, 2500, reason => setError(reason.message))
  }, [projectId])
  async function action(action, options = {}) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const current = await studioApi('studio/query', { resource: 'projects', ids: [projectId] })
      const result = await studioApi('video-redraw/action', { projectId, action, requestId: crypto.randomUUID(), version: current.items[0]?._version, ...options })
      await Promise.all([refresh(), reload()])
      return result
    } catch (reason) { setError(reason.message); notify(reason.message); throw reason }
    finally { setBusy(false) }
  }
  return { jobs, action, busy, error, running: jobs.some(activeJob) }
}

export function CreateRedraw() {
  const { update, reload, notify } = useStore(), navigate = useNavigate()
  const [file, setFile] = useState(null), [title, setTitle] = useState(''), [region, setRegion] = useState('japan')
  const [ratio, setRatio] = useState('16:9'), [style, setStyle] = useState('4'), [styles, setStyles] = useState([]), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submitted = useRef(false), preparation = useRef(null)
  const [styleOpen, setStyleOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    studioApi('workspace/styles', undefined, controller.signal).then(value => setStyles(styleOptionsFromCatalog(value.data))).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [])
  async function create(event) {
    event.preventDefault()
    if (submitted.current) return
    if (!styles.some(item => item.id === style)) return setError('请选择视觉风格')
    if (!file || !/\.mp4$/i.test(file.name) || file.size > 50 * 1024 * 1024) return setError('请选择不超过 50 MB 的 MP4')
    submitted.current = true; setBusy(true); setError('')
    let projectId
    try {
      if (!preparation.current) {
        const form = new FormData(); form.set('file', file)
        const uploaded = await fetch('/api/files', { method: 'POST', body: form })
        const source = await uploaded.json()
        if (!uploaded.ok) throw new Error(source.error || '上传失败')
        const result = await studioApi('workspace/projects', { name: title.trim() || file.name.replace(/\.mp4$/i, ''), description: notes, aspect_ratio: ratio, style_catalog_id: Number(style) })
        projectId = String(result.data.project_id)
        await reload()
        const saved = await update(draft => {
          Object.assign(draft.projects.find(project => project.id === projectId), { creationMode: 'video-redraw', targetRegion: region, targetLanguage: region === 'japan' ? 'ja' : 'en', requirements: notes, sourceVideo: { fileId: source.fileId, url: `/api/files/${source.fileId}`, name: file.name } })
          draft.episodes.push({ ...studioDefaults.episodes, id: crypto.randomUUID(), projectId, title: '原片转绘', scenes: [] })
        })
        if (!saved) throw new Error('项目创建后设置未保存，请重新加载核对')
        const current = await studioApi('studio/query', { resource: 'projects', ids: [projectId] })
        preparation.current = { projectId, action: 'prepare', requestId: crypto.randomUUID(), version: current.items[0]._version }
      }
      await studioApi('video-redraw/action', preparation.current)
      navigate(`/source?projectId=${encodeURIComponent(preparation.current.projectId)}`)
      notify('原片已保存，正在自动切镜与抽帧')
    } catch (reason) { setError(reason.message + (preparation.current ? '。项目已保存，请重试启动切镜与抽帧。' : projectId ? '。项目已创建，可在项目列表继续。' : '')) }
    finally { submitted.current = false; setBusy(false) }
  }
  return <>
    <StyleSelector styles={styles} open={styleOpen} onOpenChange={setStyleOpen} value={style} onChange={item => setStyle(item?.id || '')} onCreate={async input => {
      await createWorkspaceStyle(input)
      const catalog = await studioApi('workspace/styles')
      setStyles(styleOptionsFromCatalog(catalog.data))
    }} />
    <form className="redraw-create" onSubmit={create}>
    <div className="redraw-heading"><span>VIDEO REDRAW</span><h2>从一段视频，走向新的观众。</h2><p>沿用原片人物、场景和道具，制作目标地区与语言版本。</p></div>
    <Field label="原始视频"><input aria-label="上传原始视频" type="file" accept="video/mp4,.mp4" disabled={busy || !!preparation.current} onChange={event => setFile(event.target.files[0] || null)} /><small>MP4 · 最长 120 秒 · 最大 50 MB · 最多 40 个候选镜头</small></Field>
    <div className="redraw-fields">
      <Field label="项目名称"><input aria-label="转绘项目名称" disabled={busy || !!preparation.current} maxLength={80} value={title} onChange={event => setTitle(event.target.value)} placeholder={file?.name || '可使用视频文件名'} /></Field>
      <Field label="目标地区与语言"><select aria-label="目标地区与语言" disabled={busy || !!preparation.current} value={region} onChange={event => setRegion(event.target.value)}><option value="japan">日本 · 日语</option><option value="western">欧美 · 英语</option></select></Field>
      <Field label="目标画幅"><select aria-label="转绘画幅" disabled={busy || !!preparation.current} value={ratio} onChange={event => setRatio(event.target.value)}><option value="16:9">16:9 横版</option><option value="9:16">9:16 竖版</option></select></Field>
      <Field label="目标视觉风格"><Button aria-label="转绘视觉风格" disabled={busy || !!preparation.current} onClick={() => setStyleOpen(true)}>{styles.find(item => item.id === style)?.name || '选择视觉风格'}</Button></Field>
    </div>
    <Field label="改编要求"><textarea aria-label="转绘改编要求" disabled={busy || !!preparation.current} rows={3} value={notes} maxLength={10000} onChange={event => setNotes(event.target.value)} placeholder="例如：人物采用日本当地形象，保留原片餐厅布局、职业与递物动作。" /></Field>
    {error && <p role="alert">{error}</p>}
    <Button type="submit" primary disabled={busy || !file}>{busy ? '正在创建并启动切镜…' : preparation.current ? '重试启动切镜与抽帧' : '创建视频转绘项目'}</Button>
    </form>
  </>
}

export function SourcePlayer({ source, start, end }) {
  const player = useRef(null)
  useEffect(() => { if (player.current && start !== undefined) { player.current.currentTime = Number(start); player.current.pause() } }, [start, end])
  return <video ref={player} className="redraw-player" src={source.url || `/api/files/${source.fileId}`} controls playsInline preload="metadata"
    onLoadedMetadata={() => { if (start !== undefined && player.current) player.current.currentTime = Number(start) }}
    onTimeUpdate={() => { if (end !== undefined && player.current?.currentTime >= Number(end)) player.current.pause() }} />
}

export function RedrawSource({ context }) {
  const { project, projectId, link } = context, { models, agents, agentSelection, currentAgentId, notify, reload } = useStore()
  const { jobs, action, busy, running, error } = useRedraw(projectId)
  const [modelId, setModel] = useState(''), [language, setLanguage] = useState('')
  const [selected, setSelected] = useState(null), [preview, setPreview] = useState(null)
  const availableModels = models.filter(model => model.type === 'text' && model.enabled !== false)
  const chosenModel = availableModels.find(model => model.id === modelId) || availableModels[0]
  const chosenAgent = agents.find(agent => agent.id === (agentSelection || currentAgentId) && agent.enabled !== false)
  const source = project.sourceVideo || {}, latest = jobs.find(job => job.kind === 'analyze' && job.draft.shots.length)
  const draftShots = latest?.draft.shots || []
  const selectedIds = selected && latest && selected.jobId === latest.id ? selected.ids : draftShots.filter(shot => !latest.applied?.includes(shot.segmentId)).map(shot => shot.segmentId)
  const perform = (name, options) => action(name, options).catch(() => {})
  const analysisOptions = { modelId: chosenModel?.logicalModelId || chosenModel?.id, agentId: chosenAgent?.id, sourceLanguage: language }
  return <div className="redraw-source">
    <header className="workspace-toolbar"><div><h2>原片与拉片</h2><p>切镜 → AI 分析 → 校对应用；原始参考与目标版本分别保存。</p></div><Link className="btn" to={link('/art')}>查看转绘资产 ↗</Link></header>
    <div className="redraw-source-layout">
      <section><SourcePlayer source={source} start={preview?.start} end={preview?.end} />
        <p>{source.name || '原始视频'} {source.duration && `· ${source.duration.toFixed(2)} 秒 · ${source.width}×${source.height} · ${source.hasAudio ? '有音轨' : '无音轨'}`}</p>
        <Field label="目标地区与语言"><p>{regions[project.targetRegion]} · {languages[project.targetLanguage]}</p></Field>
        <details><summary>原片镜头 {source.segments?.length || 0} 个</summary><div className="redraw-frame-grid">{source.segments?.map(segment => <button key={segment.id} onClick={() => setPreview(segment)}><img loading="lazy" src={imageUrl(segment.frames[1]?.url, 320)} alt="" /><span>{sourceTime(segment.start)} – {sourceTime(segment.end)}</span></button>)}</div></details>
      </section>
      <section className="redraw-analysis">
        <h3>拉片与目标改编</h3><DirectorSelect label="转绘导演" disabled={running || busy} />
        <Field label="视觉分析模型"><select aria-label="视觉分析模型" value={chosenModel?.id || ''} onChange={event => setModel(event.target.value)}>{!availableModels.length && <option value="">请先配置支持图片输入的文本模型</option>}{availableModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></Field>
        <Field label="原片语言"><select aria-label="原片语言" value={language} onChange={event => setLanguage(event.target.value)}><option value="">自动识别</option><option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option></select></Field>
        <p className="muted">使用已配置模型与语音账户，产生实际 API 用量。</p>
        <div className="toolbar"><Button primary disabled={running || busy || !source.segments?.length || !chosenModel || !chosenAgent} onClick={() => perform('analyze', analysisOptions)}>分析原片并生成改编草稿</Button></div>
        {error && <p role="alert">{error}</p>}
        <div className="redraw-jobs" aria-live="polite">{jobs.map(job => <article key={job.id}><strong>{{ prepare: '切镜抽帧', analyze: '拉片分析', export: '成片合成' }[job.kind]} · {statusNames[job.status]}</strong><span>{job.phase}</span>{job.error && <p role="alert">{job.error}</p>}
          {activeJob(job) && <Button disabled={busy} onClick={() => perform('cancel', { jobId: job.id })}>取消任务</Button>}
          {['failed', 'interrupted', 'cancelled'].includes(job.status) && job.kind !== 'export' && <Button disabled={busy || running} onClick={() => perform(job.kind, { ...Object.fromEntries(Object.entries(job.input).filter(([key]) => !['action', 'projectId', 'version', 'requestId'].includes(key))), resumeJobId: job.id })}>继续已完成阶段</Button>}
        </article>)}</div>
      </section>
    </div>
    {!!draftShots.length && <section className="redraw-draft"><div className="row"><h3>分析草稿 · {draftShots.length} 镜头 / {latest.draft.assets.length} 项资产</h3><Button primary disabled={busy || running || !selectedIds.length} onClick={async () => { try { await action('apply', { jobId: latest.id, shotIds: selectedIds }); await reload(); notify('已写入分镜和资产，请继续校对') } catch {} }}>应用选中镜头与关联资产（{selectedIds.length}）</Button></div>
      <p>应用前核对原片与目标描述；应用后可在分镜表、资产页编辑。再次分析不会自动覆盖已保存内容。</p>
      {draftShots.map(shot => { const segment = latest.segments.find(segment => segment.id === shot.segmentId); return <article key={shot.segmentId}>
        <label><input type="checkbox" checked={selectedIds.includes(shot.segmentId)} onChange={event => setSelected({ jobId: latest.id, ids: event.target.checked ? [...selectedIds, shot.segmentId] : selectedIds.filter(id => id !== shot.segmentId) })} />{sourceTime(segment.start)} – {sourceTime(segment.end)} {latest.applied?.includes(shot.segmentId) && '已应用'}</label>
        <button className="redraw-thumb" onClick={() => setPreview(segment)}><img loading="lazy" src={imageUrl(segment.frames[1]?.url, 320)} alt="回看原镜头" /></button>
        <div><strong>原片</strong><p>{shot.description}</p><p>{shot.dialogue || '未识别对白'}</p></div><div><strong>目标 · {regions[project.targetRegion]} / {languages[project.targetLanguage]}</strong><p>{shot.targetDescription}</p>{shot.targetDialogue.map((line, index) => <p key={index}>{line.text}</p>)}</div>
        {shot.notes && <p role="note">待核对：{shot.notes}</p>}
      </article> })}
    </section>}
  </div>
}

export function SupplementAsset({ context, onClose }) {
  const { projectId, project, episodes } = context, { data, update, notify } = useStore()
  const [name, setName] = useState(''), [type, setType] = useState('角色'), [description, setDescription] = useState(''), [target, setTarget] = useState('')
  const [start, setStart] = useState('0'), [end, setEnd] = useState(String(Math.min(3, project.sourceVideo.duration))), [shotId, setShot] = useState('')
  const { busy, action, error } = useRedraw(projectId)
  const shots = data.shots.filter(shot => episodes.some(episode => episode.id === shot.episodeId))
  return <Modal title="从原片补入资产" onClose={onClose} footer={<Button primary disabled={busy || !name.trim() || !description.trim() || !target.trim()} onClick={async () => {
    try {
      const result = await action('frame', { start: Number(start), end: Number(end) })
      if (!result) return
      const id = crypto.randomUUID()
      const saved = await update(draft => {
        draft.assets.push({ ...structuredClone(studioDefaults.assets), id, projectId, episodeIds: episodes.map(episode => episode.id), type, name: name.trim(), description: target, source: { ...result.source, name: name.trim(), description } })
        const shot = draft.shots.find(shot => shot.id === shotId)
        if (shot) shot.assetIds = [...new Set([...(shot.assetIds || []), id])]
      })
      if (saved) { notify('已补入资产，原片截图与目标设定分别保存'); onClose() }
    } catch {}
  }}>截帧并保存</Button>}>
    <Field label="原片资产名称"><input aria-label="补漏资产名称" value={name} maxLength={100} onChange={event => setName(event.target.value)} /></Field>
    <Field label="资产类型"><select value={type} onChange={event => setType(event.target.value)}>{['角色', '场景', '道具'].map(type => <option key={type}>{type}</option>)}</select></Field>
    <div className="redraw-fields"><Field label="原片开始秒"><input type="number" value={start} step="0.01" onChange={event => setStart(event.target.value)} /></Field><Field label="原片结束秒"><input type="number" value={end} step="0.01" onChange={event => setEnd(event.target.value)} /></Field></div>
    <Field label="原始描述"><textarea value={description} onChange={event => setDescription(event.target.value)} /></Field><Field label="目标视觉设定"><textarea value={target} onChange={event => setTarget(event.target.value)} /></Field>
    <Field label="关联镜头"><select value={shotId} onChange={event => setShot(event.target.value)}><option value="">暂不关联</option>{shots.map((shot, index) => <option key={shot.id} value={shot.id}>镜头 {index + 1} · {shot.description.slice(0, 40)}</option>)}</select></Field>
    {error && <p role="alert">{error}</p>}
  </Modal>
}

export function SourceEvidence({ source }) {
  if (!source) return null
  return <section className="redraw-evidence"><strong>原始参考 · {source.name || ''} {sourceTime(source.start)} – {sourceTime(source.end)}</strong>
    <div>{source.frames?.map(frame => <img loading="lazy" key={frame.fileId} src={imageUrl(frame.url, 320)} alt={`原片 ${sourceTime(frame.time)}`} />)}</div>
    <p>{source.description}</p>{source.dialogue && <p>原对白：{source.dialogue}</p>}{source.notes && <p>待核对：{source.notes}</p>}
  </section>
}

export function SupplementShot({ context, sceneId, afterId, onClose }) {
  const { update, notify } = useStore(), { action, busy, error } = useRedraw(context.projectId)
  const [start, setStart] = useState('0'), [end, setEnd] = useState('1'), [description, setDescription] = useState(''), [target, setTarget] = useState('')
  return <Modal title="从原片补入镜头" onClose={onClose} footer={<Button primary disabled={busy || !description.trim() || !target.trim()} onClick={async () => {
    try {
      const result = await action('frame', { start: Number(start), end: Number(end) })
      if (!result) return
      const saved = await update(draft => {
        const id = crypto.randomUUID(), source = { ...result.source, description }
        const shot = { ...structuredClone(studioDefaults.shots), id, episodeId: context.episode.id, sceneId, description: target, duration: Number(end) - Number(start), source, assetIds: [] }
        const after = draft.shots.findIndex(shot => shot.id === afterId)
        draft.shots.splice(after < 0 ? draft.shots.length : after + 1, 0, shot)
        const project = draft.projects.find(project => project.id === context.projectId)
        project.sourceVideo.segments = [...project.sourceVideo.segments, { id, start: Number(start), end: Number(end), frames: result.source.frames }].sort((a, b) => a.start - b.start)
      })
      if (saved) { notify('镜头已补入，请在分镜表核对台词和资产关联'); onClose() }
    } catch {}
  }}>截帧并保存镜头</Button>}>
    <p>填写原片中的实际区间；不会自动裁切其他镜头。</p>
    <div className="redraw-fields"><Field label="来源开始秒"><input type="number" step="0.01" value={start} onChange={event => setStart(event.target.value)} /></Field><Field label="来源结束秒"><input type="number" step="0.01" value={end} onChange={event => setEnd(event.target.value)} /></Field></div>
    <Field label="原始画面"><textarea value={description} onChange={event => setDescription(event.target.value)} /></Field><Field label="目标画面"><textarea value={target} onChange={event => setTarget(event.target.value)} /></Field>
    {error && <p role="alert">{error}</p>}
  </Modal>
}

export function SourceShotEditor({ context, shot, onClose }) {
  const { action, busy, error } = useRedraw(context.projectId)
  const { data } = useStore()
  const nextShot = data.shots.find(item => item.id !== shot.id && item.sceneId === shot.sceneId && item.episodeId === shot.episodeId && Math.abs(Number(item.source?.start) - Number(shot.source.end)) < 0.05)
  const [start, setStart] = useState(shot.source.start), [end, setEnd] = useState(shot.source.end), [split, setSplit] = useState('')
  return <Modal title="校对原片切点" wide onClose={onClose} footer={<><Button disabled={busy} onClick={async () => { try { await action('edit-shot', { shotId: shot.id, shotVersion: shot._version, start: Number(start), end: Number(end) }); onClose() } catch {} }}>更新切点和参考帧</Button><Button disabled={busy || !split} onClick={async () => { try { await action('edit-shot', { shotId: shot.id, shotVersion: shot._version, start: Number(start), end: Number(end), split: Number(split) }); onClose() } catch {} }}>在指定时间拆分</Button></>}>
    <SourcePlayer source={context.project.sourceVideo} start={Number(start)} end={Number(end)} /><SourceEvidence source={shot.source} />
    <div className="redraw-fields">{[['原片开始秒', start, setStart], ['原片结束秒', end, setEnd], ['拆分点（原片秒）', split, setSplit]].map(([label, value, set]) => <Field key={label} label={label}><input aria-label={label} type="number" step="0.01" value={value} onChange={event => set(event.target.value)} /></Field>)}</div>
    <p>调整切点不会改变已编辑的目标时长。拆分会保留左镜头 ID，并创建需要校对内容和对白的右镜头。</p>{error && <p role="alert">{error}</p>}
    {nextShot && <Button disabled={busy} onClick={async () => { try { await action('merge-shots', { fromId: shot.id, fromVersion: shot._version, toId: nextShot.id, toVersion: nextShot._version }); onClose() } catch {} }}>合并下一个原片镜头（保留当前 ID）</Button>}
  </Modal>
}

export function MergeAsset({ context, asset, onClose }) {
  const { data } = useStore(), { action, busy, error } = useRedraw(context.projectId), [toId, setToId] = useState('')
  const targets = data.assets.filter(item => item.projectId === context.projectId && item.type === asset.type && item.id !== asset.id)
  return <Modal title={`合并重复资产：${asset.name}`} onClose={onClose} footer={<Button primary disabled={busy || !toId} onClick={async () => { try {
    const to = targets.find(item => item.id === toId)
    await action('merge-assets', { fromId: asset.id, fromVersion: asset._version, toId: to.id, toVersion: to._version }); onClose()
  } catch {} }}>迁移引用并合并</Button>}>
    <p>将当前资产合入选中的主体，迁移镜头和片段关联，保留图片历史及来源证据。确认它们是原片中的同一主体。</p>
    <Field label="保留的主体"><select aria-label="合并目标资产" value={toId} onChange={event => setToId(event.target.value)}><option value="">选择同一主体</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    {error && <p role="alert">{error}</p>}
  </Modal>
}

export function RedrawFilm() {
  const context = useProject()
  return <Workflow context={context} projectLevel>{context.project && <FilmWorkspace key={context.projectId} context={context} />}</Workflow>
}
function FilmWorkspace({ context }) {
  const { data } = useStore(), { jobs, action, running, busy, error } = useRedraw(context.projectId)
  const clips = data.clips.filter(clip => context.episodes.some(episode => episode.id === clip.episodeId))
  const [selection, setSelection] = useState([]), films = data.films.filter(film => film.projectId === context.projectId)
  return <div className="redraw-film"><h2>合成与导出</h2><p>按勾选顺序拼接已选用的真实视频，保留各片段生成音轨；不会混入原片声音。未生成目标对白的片段仍需先完成配音或视频重做。</p>
    {clips.map(clip => <div className="redraw-export-row" key={clip.id}><label><input type="checkbox" disabled={!clip.currentVideo || running || busy} checked={selection.some(item => item.clipId === clip.id)} onChange={event => setSelection(current => event.target.checked ? [...current, { clipId: clip.id, start: 0 }] : current.filter(item => item.clipId !== clip.id))} />{clip.title} {selection.some(item => item.clipId === clip.id) && `· 第 ${selection.findIndex(item => item.clipId === clip.id) + 1} 段`}{!clip.currentVideo && ' · 尚未选用视频'}</label>
      {selection.some(item => item.clipId === clip.id) && <div className="redraw-fields">{['start', 'end'].map(key => <Field key={key} label={key === 'start' ? '裁剪开始秒' : '结束秒（留空用实际时长）'}><input type="number" min="0" step="0.01" value={selection.find(item => item.clipId === clip.id)[key] ?? ''} onChange={event => setSelection(current => current.map(item => item.clipId === clip.id ? { ...item, [key]: event.target.value === '' ? undefined : Number(event.target.value) } : item))} /></Field>)}</div>}
    </div>)}
    <Button primary disabled={busy || running || !selection.length} onClick={() => action('export', { selections: selection }).catch(() => {})}>合成并导出选中片段</Button>
    {error && <p role="alert">{error}</p>}{jobs.filter(job => job.kind === 'export').map(job => <p key={job.id} role="status">{statusNames[job.status]} · {job.phase} {job.error}{activeJob(job) && <Button onClick={() => action('cancel', { jobId: job.id }).catch(() => {})}>取消合成</Button>}</p>)}
    {films.map(film => <article key={film.id}><h3>{film.title}</h3><video src={film.url} controls preload="metadata" playsInline /><a className="btn" href={`${film.url}?download=1`}>下载成片</a></article>)}
  </div>
}
