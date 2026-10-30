import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { studioApi, useStore } from '../store'
import { Button, Field, Modal } from './ui'
import { studioDefaults } from '../../../studio-schema'
import { StyleSelector } from '@darl/ui'
import { createWorkspaceStyle, styleOptionsFromCatalog } from '../../workspace-styles'

export const sourceTime = value => `${Number(value || 0).toFixed(2)}s`

export function CreateRedraw() {
  const { update, reload } = useStore(), navigate = useNavigate()
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
    if (!file || !/\.mp4$/i.test(file.name) || file.size > 300 * 1024 * 1024) return setError('请选择不超过 300 MB 的 MP4')
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
        const episodeId = crypto.randomUUID()
        const saved = await update(draft => {
          Object.assign(draft.projects.find(project => project.id === projectId), { creationMode: 'video-redraw', adaptation: '忠实', targetRegion: region, targetLanguage: region === 'japan' ? 'ja' : 'en', requirements: notes, sourceVideo: { fileId: source.fileId, url: `/api/files/${source.fileId}`, name: file.name } })
          draft.episodes.push({ ...studioDefaults.episodes, id: episodeId, projectId, title: '原片转绘', scenes: [] })
        })
        if (!saved) throw new Error('项目创建后设置未保存，请重新加载核对')
        preparation.current = { projectId, episodeId }
      }
      const task = preparation.current
      const latest = await reload()
      const project = latest.projects.find(item => item.id === task.projectId)
      await studioApi('video-redraw/action', { action: 'analyze', ...task, requestId: crypto.randomUUID(), version: project._version })
      navigate(`/source?projectId=${encodeURIComponent(task.projectId)}&episodeId=${encodeURIComponent(task.episodeId)}`)
    } catch (reason) { setError(reason.message + (preparation.current ? '。项目已保存，请重试生成分镜。' : projectId ? '。项目已创建，可在项目列表继续。' : '')) }
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
    <Field label="原始视频"><input aria-label="上传原始视频" type="file" accept="video/mp4,.mp4" disabled={busy || !!preparation.current} onChange={event => setFile(event.target.files[0] || null)} /><small>MP4 · 最长 300 秒 · 最大 300 MB · 支持生成分镜</small></Field>
    <div className="redraw-fields">
      <Field label="项目名称"><input aria-label="转绘项目名称" disabled={busy || !!preparation.current} maxLength={80} value={title} onChange={event => setTitle(event.target.value)} placeholder={file?.name || '可使用视频文件名'} /></Field>
      <Field label="目标地区与语言"><select aria-label="目标地区与语言" disabled={busy || !!preparation.current} value={region} onChange={event => setRegion(event.target.value)}><option value="japan">日本 · 日语</option><option value="western">欧美 · 英语</option></select></Field>
      <Field label="目标画幅"><select aria-label="转绘画幅" disabled={busy || !!preparation.current} value={ratio} onChange={event => setRatio(event.target.value)}><option value="16:9">16:9 横版</option><option value="9:16">9:16 竖版</option></select></Field>
      <Field label="目标视觉风格"><Button aria-label="转绘视觉风格" disabled={busy || !!preparation.current} onClick={() => setStyleOpen(true)}>{styles.find(item => item.id === style)?.name || '选择视觉风格'}</Button></Field>
    </div>
    <Field label="改编要求"><textarea aria-label="转绘改编要求" disabled={busy || !!preparation.current} rows={3} value={notes} maxLength={10000} onChange={event => setNotes(event.target.value)} placeholder="例如：人物采用日本当地形象，保留原片餐厅布局、职业与递物动作。" /></Field>
    {error && <p role="alert">{error}</p>}
    <Button type="submit" primary disabled={busy || !file}>{busy ? '正在创建并启动…' : preparation.current ? '重试生成分镜' : '生成分镜'}</Button>
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

export function SupplementAsset({ context, onClose }) {
  const { projectId, project, episode } = context, { update, notify } = useStore()
  const [name, setName] = useState(''), [type, setType] = useState('角色'), [description, setDescription] = useState(''), [target, setTarget] = useState('')
  const video = episode?.sourceVideo || (episode?.id === context.episodes[0]?.id ? project.sourceVideo : null)
  const [start, setStart] = useState('0'), [end, setEnd] = useState(String(Math.min(3, video?.duration || 3)))
  return <Modal title="从原片补入资产" onClose={onClose} footer={<Button primary disabled={!episode || !video?.fileId || !name.trim() || !description.trim() || !target.trim()} onClick={async () => {
    const saved = await update(draft => {
      draft.assets.push({ ...structuredClone(studioDefaults.assets), id: crypto.randomUUID(), projectId, episodeIds: [episode.id], type, name: name.trim(), description: target, source: { fileId: video.fileId, start: Number(start), end: Number(end), frames: [], name: name.trim(), description, confirmed: false } })
    })
    if (saved) { notify('已补入资产与原片来源'); onClose() }
  }}>保存资产</Button>}>
    <Field label="原片资产名称"><input aria-label="补漏资产名称" value={name} maxLength={100} onChange={event => setName(event.target.value)} /></Field>
    <Field label="资产类型"><select value={type} onChange={event => setType(event.target.value)}>{['角色', '场景', '道具'].map(type => <option key={type}>{type}</option>)}</select></Field>
    <div className="redraw-fields"><Field label="原片开始秒"><input type="number" value={start} step="0.01" onChange={event => setStart(event.target.value)} /></Field><Field label="原片结束秒"><input type="number" value={end} step="0.01" onChange={event => setEnd(event.target.value)} /></Field></div>
    <Field label="原始描述"><textarea value={description} onChange={event => setDescription(event.target.value)} /></Field><Field label="目标视觉设定"><textarea value={target} onChange={event => setTarget(event.target.value)} /></Field>
  </Modal>
}

export function SourceEvidence({ source }) {
  if (!source) return null
  return <section className="redraw-evidence"><strong>原始参考 · {source.name || ''} {sourceTime(source.start)} – {sourceTime(source.end)}</strong>
    <div>{source.frames?.map(frame => <img loading="lazy" key={frame.fileId} src={imageUrl(frame.url, 320)} alt={`原片 ${sourceTime(frame.time)}`} />)}</div>
    <p>{source.description}</p>{source.dialogue && <p>原对白：{source.dialogue}</p>}{source.notes && <p>待核对：{source.notes}</p>}
  </section>
}

export function AssetSourceEvidence({ source }) {
  if (!source) return null
  return <details className="redraw-source-info"><summary aria-label="查看原片依据" title="查看原片依据">ⓘ</summary><SourceEvidence source={source} /></details>
}
