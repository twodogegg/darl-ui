import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useProject, Workflow } from '../components/Shell'
import { studioDefaults } from '../../../studio-schema'

const clock = seconds => { const centis = Math.round(seconds * 100); return `${Math.floor(centis / 6000)}:${String(Math.floor(centis / 100) % 60).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}` }
function Field({ label, value, onSave, multiline = false }) {
  const Tag = multiline ? 'textarea' : 'input'
  return <label className="dialogue-field"><span>{label}</span><Tag key={value} defaultValue={value || ''} onBlur={event => { if (event.target.value !== (value || '')) onSave(event.target.value) }} /></label>
}
export default function Dialogue() {
  const context = useProject()
  const navigate = useNavigate()
  const { data, patch, update, requestAgent, notify } = useStore()
  const [uploading, setUploading] = useState(false)
  const player = useRef(null), stop = useRef(0)
  const { project, episode, episodes } = context
  const source = episode?.sourceVideo || (episode?.id === episodes[0]?.id ? project?.sourceVideo : null)
  const rows = data.dialogues.filter(row => row.episodeId === episode?.id)
  const start = episodeId => requestAgent({ action: 'redraw-analyze', projectId: project.id, episodeId, requestId: crypto.randomUUID() }).catch(reason => notify(`拉片启动失败：${reason.message}`))
  const addEpisode = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.mp4$/i.test(file.name) || file.size > 300 * 1024 * 1024) return notify('请选择不超过 300 MB 的 MP4')
    setUploading(true)
    try {
      const form = new FormData(); form.set('file', file)
      const response = await fetch('/api/files', { method: 'POST', body: form })
      const uploaded = await response.json()
      if (!response.ok) throw new Error(uploaded.error || '上传失败')
      const episodeId = crypto.randomUUID(), number = Math.max(0, ...episodes.map(item => item.number)) + 1
      const saved = await update(draft => draft.episodes.push({ ...structuredClone(studioDefaults.episodes), id: episodeId, projectId: project.id, number, title: file.name.replace(/\.mp4$/i, ''), sourceVideo: { fileId: uploaded.fileId, url: `/api/files/${uploaded.fileId}`, name: file.name } }))
      if (!saved) throw new Error('剧集保存失败')
      navigate(`/dialogue?projectId=${encodeURIComponent(project.id)}&episodeId=${encodeURIComponent(episodeId)}`)
      start(episodeId)
    } catch (reason) { notify(reason.message) }
    finally { setUploading(false) }
  }
  const play = row => { if (!player.current) return; stop.current = row.sourceEnd; player.current.currentTime = row.sourceStart; player.current.play().catch(() => {}) }
  return <Workflow context={context}>
    <header className="workspace-toolbar"><div><h2>对白改编与对照</h2><label>剧集 <select aria-label="选择对白剧集" value={episode?.id || ''} onChange={event => navigate(context.link('/dialogue', episodes.find(item => item.id === event.target.value)))}>{episodes.map(item => <option key={item.id} value={item.id}>第{item.number}集 · {item.title}</option>)}</select></label><p className="muted">按原片编号核对原文和改编稿；时长为估算，尚待朗读测量。修改不会自动同步至镜头。</p></div><div className="toolbar"><span className="muted">{rows.length} 条对白</span><label className="btn">{uploading ? '正在添加…' : '添加剧集'}<input type="file" accept="video/mp4,.mp4" hidden disabled={uploading} onChange={addEpisode} /></label><button className="btn" disabled={!source?.fileId} onClick={() => start(episode.id)}>重新开始拉片</button></div></header>
    {source?.url && <video ref={player} src={source.url} preload="metadata" style={{ display: 'none' }} onTimeUpdate={() => { if (player.current?.currentTime >= stop.current) player.current.pause() }} />}
    <div className="dialogue-list">{rows.map(row => <article className="dialogue-card" key={row.id}>
      <div className="dialogue-meta"><strong>{row.idCode}</strong><span>{clock(row.sourceStart)}–{clock(row.sourceEnd)}</span><button type="button" disabled={!source?.url} onClick={() => play(row)}>播放原声</button><span>{row.timingStatus === 'estimate_not_measured' ? '时长估算，未实测' : row.timingStatus}</span><span>预计说话 {Number(row.estimatedSeconds || 0).toFixed(1)} 秒 · 窗口 {Number(row.plannedSeconds || 0).toFixed(1)} 秒</span></div>
      <div className="dialogue-columns">{[['原片对白', 'sourceText', 'sourceSpeaker'], ['改编对白', 'targetText', 'targetSpeaker']].map(([title, text, speaker]) => <section key={text}><h3>{title}</h3><Field label="说话人" value={row[speaker]} onSave={value => patch('dialogues', row.id, { [speaker]: value })} /><Field label="台词" value={row[text]} multiline onSave={value => patch('dialogues', row.id, { [text]: value })} /></section>)}</div>
      <div className="dialogue-columns"><Field label="语气与表演" value={row.tone} onSave={value => patch('dialogues', row.id, { tone: value })} /><Field label="校订及改编说明" value={row.note} onSave={value => patch('dialogues', row.id, { note: value })} /></div>
    </article>)}{!rows.length && <div className="empty"><h2>暂无对白</h2><p>本集的原文和改编对白会显示在这里。</p></div>}</div>
  </Workflow>
}
