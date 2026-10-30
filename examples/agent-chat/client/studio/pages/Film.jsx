import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconMovie, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useProject, Workflow } from '../components/Shell'
import { Button } from '../components/ui'
import { useStore } from '../store'
import { episodeScenes } from '../scenes'
import FilmTrim from '../components/FilmTrim'
import { jobLabel } from '../art'

export default function Film() {
  const context = useProject()
  return <Workflow context={context}>{context.episode && <FilmWorkspace key={context.episode.id} context={context} />}</Workflow>
}
function FilmWorkspace({ context }) {
  const { data, update, notify, mediaJobs } = useStore()
  const navigate = useNavigate()
  const scenes = episodeScenes(context.episode)
  const all = data.clips.filter(item => item.episodeId === context.episode.id)
  const clips = [...scenes.flatMap(scene => all.filter(clip => clip.sceneId === scene.id)), ...all.filter(clip => !scenes.some(scene => scene.id === clip.sceneId))]
  const [sceneId, setSceneId] = useState('all')
  const visible = sceneId === 'all' ? clips : clips.filter(clip => clip.sceneId === sceneId)
  const [activeId, setActiveId] = useState(clips[0]?.id)
  const active = visible.find(clip => clip.id === activeId) || visible[0]
  const [preview, setPreview] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [historyTab, setHistoryTab] = useState('clip')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [durations, setDurations] = useState({})
  const timeline = useRef(null)
  const abort = useRef(null)
  const playNext = useRef(false)
  const draggedVideo = useRef(null)
  useEffect(() => () => abort.current?.abort(), [])
  const current = preview?.clipId === active?.id ? preview.url : active?.currentVideo
  const dialogues = data.dialogues.filter(item => item.episodeId === context.episode.id && (item.targetText || item.sourceText)).sort((a, b) => a.sourceStart - b.sourceStart)
  const films = data.films.filter(item => item.projectId === context.projectId && (item.episodeId === context.episode.id || (!item.episodeId && context.episode.id === context.episodes[0]?.id)))
  const historyJobs = mediaJobs.filter(job => job.options?.studioTarget?.resource === 'clips' && job.options.studioTarget.id === active?.id && job.options.studioTarget.field === 'videos' && (job.status !== 'completed' || job.error)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ready = clips.filter(clip => clip.currentVideo)
  const sources = visible.filter(clip => clip.currentVideo).map(clip => ({ id: clip.id, url: clip.currentVideo, name: clip.title }))
  async function saveFilm(result) {
    if (!result?.url) throw new Error('合成未返回视频结果')
    const saved = await update(draft => draft.films.unshift({ id: crypto.randomUUID(), projectId: context.projectId, episodeId: context.episode.id, title: `第${context.episode.number}集成片`, url: result.url }))
    if (!saved) throw new Error('成片保存失败，请检查连接')
    setHistoryTab('film'); setHistoryOpen(true); notify('成片已保存')
  }
  function exportDialogue() {
    const text = dialogues.map(item => `${item.targetSpeaker || item.sourceSpeaker || '旁白'}：${item.targetText || item.sourceText}`).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `第${context.episode.number}集台词.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function compose(download = false) {
    if (saving || !sources.length) return
    const controller = new AbortController(); abort.current = controller; setSaving(true); setError('')
    try {
      const response = await fetch('/api/video-editing/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ratio: context.project.ratio, selections: sources.map(item => ({ url: item.url, start: 0 })) }), signal: controller.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '视频合成失败')
      await saveFilm(result)
      if (download) { const anchor = document.createElement('a'); anchor.href = `/api/files/${encodeURIComponent(result.fileId)}?download=1`; anchor.download = `第${context.episode.number}集成片.mp4`; anchor.click() }
    } catch (reason) { if (!controller.signal.aborted) setError(reason.message || '视频合成失败') }
    finally { abort.current = null; setSaving(false) }
  }
  async function placeVideo(clip, url) {
    if (!url || saving) return
    setError('')
    try {
      const saved = await update(draft => {
        const target = draft.clips.find(item => item.id === clip.id)
        if (!target) throw new Error('片段已删除')
        target.videos = [url, ...(target.videos || []).filter(item => item !== url)]
        target.currentVideo = url
      })
      if (!saved) throw new Error('选用视频保存失败')
      setDurations(value => { const next = { ...value }; delete next[clip.id]; return next }); setActiveId(clip.id); setPreview(null); notify('已将视频放入时间线')
    } catch (reason) { setError(reason.message || '选用视频保存失败') }
  }
  function advance() {
    const index = visible.findIndex(clip => clip.id === active?.id)
    const next = visible[index + 1]
    if (!next) return
    if (!next.currentVideo) { setError(`下一片段「${next.title}」暂无视频`); return }
    playNext.current = true; setPreview(null); setActiveId(next.id)
  }
  const format = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  let elapsed = 0
  const segments = visible.map(clip => { const start = elapsed; const duration = durations[clip.id] || Number(clip.duration) || 1; elapsed += duration; return { clip, start, duration } })
  const filmWidth = Math.max(visible.length * 90, elapsed * 8, 400)
  return <div className="film-workspace">
    <header className="film-toolbar"><div><select aria-label="选择场次" value={sceneId} onChange={event => { setSceneId(event.target.value); setPreview(null) }}><option value="all">全部场次</option>{scenes.map((scene, index) => <option value={scene.id} key={scene.id}>第{index + 1}场 · {scene.location || '地点待填写'}</option>)}</select><span>{active ? `${active.title} / ` : ''}共 {visible.length} 个片段</span><select aria-label="选择剧集" value={context.episode.id} onChange={event => navigate(context.link('/film', context.episodes.find(item => item.id === event.target.value)))}>{context.episodes.map(item => <option key={item.id} value={item.id}>第{item.number}集 · {item.title}</option>)}</select></div><div><span>{ready.length}/{clips.length} 已完成</span><Button disabled={!current || saving} onClick={() => setEditing(true)}>剪辑</Button><Button disabled={!dialogues.length} title={dialogues.length ? "" : "本集暂无结构化台词"} onClick={exportDialogue}>导出台词</Button><Button primary disabled={!clips.length || ready.length !== clips.length || saving || sceneId !== 'all'} onClick={() => compose(true)}>{saving ? '正在合成…' : '一键导出'}</Button>{saving && <Button onClick={() => abort.current?.abort()}>取消</Button>}</div></header>
    {error && <p className="film-error" role="alert">{error}</p>}
    <div className="film-stage"><div className="film-preview">{current ? <video key={`${active?.id}:${current}`} src={current} controls playsInline preload="metadata" onEnded={advance} onError={() => { playNext.current = false; setError('视频加载失败') }} onLoadedMetadata={event => { if (playNext.current) { playNext.current = false; event.currentTarget.play().catch(() => setError('无法自动播放下一片段，请点击播放')) } const duration = event.currentTarget.duration; if (Number.isFinite(duration) && preview?.clipId !== active.id) setDurations(value => ({ ...value, [active.id]: duration })) }} /> : <div className="film-empty"><strong>暂无预览</strong><span>请先生成视频或选择历史版本。</span></div>}</div>
      <aside className={`film-history${historyOpen ? ' is-open' : ''}`} aria-label="历史记录"><button className="film-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? '收起 ›' : '片段历史 ‹'}</button>{historyOpen && <><div className="film-history-tabs"><button aria-pressed={historyTab === 'clip'} onClick={() => setHistoryTab('clip')}>片段历史</button><button aria-pressed={historyTab === 'film'} onClick={() => setHistoryTab('film')}>成片</button></div>{historyTab === 'clip' ? <><p>{active ? `当前片段：${active.title}` : '请选择片段'}</p>{historyJobs.map(job => <article key={job.id}><span role={job.error ? 'alert' : 'status'}>{jobLabel(job)}{job.error ? `：${job.error}` : ''}</span></article>)}{(active?.videos || []).map((url, index) => <article key={url} draggable onDragStart={event => { draggedVideo.current = url; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', url) }} onDragEnd={() => { draggedVideo.current = null }}><button onClick={() => setPreview({ clipId: active.id, url })}><img src={`/api/video-editing/thumbnail?url=${encodeURIComponent(url)}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /><span>版本 {(active.videos || []).length - index}{url === current ? ' · 预览中' : ''}<small>拖至下方片段替换</small></span></button><button disabled={saving} onClick={() => placeVideo(active, url)}>选用到当前片段</button></article>)}{!active?.videos?.length && !historyJobs.length && <p>当前片段暂无视频历史</p>}</> : <>{films.map(film => <article key={film.id}><span>{film.title}</span><video src={film.url} controls playsInline preload="none" /><a href={film.url} download>下载</a></article>)}{!films.length && <p>暂无成片</p>}</>}</>}</aside>
    </div>
    <div className="film-timeline"><button aria-label="向左滚动时间线" onClick={() => timeline.current?.scrollBy({ left: -400, behavior: 'smooth' })}><IconChevronLeft size={16} /></button><div className="film-timeline-scroll" ref={timeline}><div className="film-timeline-inner" style={{ width: filmWidth }}><div className="film-ruler">{Array.from({ length: Math.ceil(elapsed / 10) + 1 }, (_, i) => <span key={i} style={{ left: `${elapsed ? i * 10 / elapsed * 100 : 0}%` }}>{format(i * 10)}</span>)}</div><div className="film-tracks">{segments.map(({ clip, duration }) => { const scene = scenes.findIndex(item => item.id === clip.sceneId); const index = clips.filter(item => item.sceneId === clip.sceneId).findIndex(item => item.id === clip.id); return <button key={clip.id} onDragOver={event => { if (draggedVideo.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { event.preventDefault(); const url = draggedVideo.current; draggedVideo.current = null; void placeVideo(clip, url) }} style={{ flexGrow: duration }} className={active?.id === clip.id ? 'active' : ''} aria-label={`片段 ${scene + 1}-${index + 1} ${clip.title}`} onClick={() => { playNext.current = false; setActiveId(clip.id); setPreview(null) }}><span className="film-track-thumb">{clip.currentVideo ? <img loading="lazy" src={`/api/video-editing/thumbnail?url=${encodeURIComponent(clip.currentVideo)}`} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /> : <IconMovie size={22} />}</span><small>{scene >= 0 ? `${scene + 1}-${index + 1}` : '场次待确认'} <span>{Number(duration.toFixed(1))}s</span></small></button> })}</div></div></div><button aria-label="向右滚动时间线" onClick={() => timeline.current?.scrollBy({ left: 400, behavior: 'smooth' })}><IconChevronRight size={16} /></button></div>
    {editing && current && <FilmTrim source={{ url: current, name: active.title }} ratio={context.project.ratio} onClose={() => setEditing(false)} onSaved={async result => { if (!result?.url) throw new Error('裁剪未返回视频结果'); const saved = await update(draft => { const clip = draft.clips.find(item => item.id === active.id); if (!clip) throw new Error('片段已删除，裁剪结果未关联'); clip.videos = [result.url, ...(clip.videos || []).filter(url => url !== result.url)]; clip.currentVideo = result.url }); if (!saved) throw new Error('裁剪结果保存失败'); setPreview(null); setHistoryTab('clip'); setHistoryOpen(true); notify('裁剪结果已保存并选用') }} />}
  </div>
}
