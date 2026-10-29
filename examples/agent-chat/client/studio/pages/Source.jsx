import { useProject, Workflow } from '../components/Shell'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { SourcePlayer, sourceTime } from '../components/VideoRedraw'
import { imageUrl } from '../../image-url'

export default function Source() {
  const context = useProject()
  const { project } = context
  const text = String(project?.sourceScript || '').trim()
  const requirements = String(project?.requirements || '').trim()
  if (project?.creationMode === 'video-redraw') return <RedrawSource key={context.episode?.id} context={context} />
  return (
    <Workflow key={context.projectId} context={context} projectLevel>
      <header className="workspace-toolbar">
        <div>
          <h2>原始素材</h2>
          <p className="muted">小说、剧本或其他文字资料，只作为创作依据，不直接作为剧集正文。</p>
        </div>
        {text && <span className="muted">{text.length} 字</span>}
      </header>
      <div className="source-page">
        {requirements && <section className="source-requirements">
          <h3>创作要求</h3>
          <p>{requirements}</p>
        </section>}
        {text ? <section className="source-text">
          <h3>提交的资料</h3>
          <pre>{text}</pre>
        </section> : <div className="empty">
          <h2>暂无原始素材</h2>
          <p>创建项目时上传的小说、剧本或其他文字资料会显示在这里。</p>
        </div>}
      </div>
    </Workflow>
  )
}

function RedrawSource({ context }) {
  const { project, episode, episodes } = context
  const { data, patch, requestAgent, notify } = useStore()
  const navigate = useNavigate()
  const [selected, setSelected] = useState('')
  const [view, setView] = useState('镜头')
  const [starting, setStarting] = useState(false)
  const source = episode?.sourceVideo || (episode?.id === episodes[0]?.id ? project.sourceVideo : null)
  const shots = data.shots.filter(shot => shot.episodeId === episode?.id && shot.source)
  const segments = [...(source?.segments || [])].sort((a, b) => a.start - b.start)
  // 切镜列表以剧集原片为准；只有区间一致的分析才能附到该镜头。
  const items = segments.length ? segments.map(segment => {
    const matches = shots.filter(shot => {
      const evidence = shot.source
      return (!evidence.segmentId || evidence.segmentId === segment.id)
        && Math.abs(Number(evidence.start) - Number(segment.start)) < 0.002
        && Math.abs(Number(evidence.end) - Number(segment.end)) < 0.002
    })
    const shot = matches.length === 1 ? matches[0] : null
    return { id: segment.id, source: { ...segment, ...(shot ? { description: shot.source.description, dialogue: shot.source.dialogue, notes: shot.source.notes, evidence: shot.source.evidence } : {}) }, shot }
  }) : shots.sort((a, b) => a.source.start - b.source.start).map(shot => ({ id: shot.id, source: shot.source, shot }))
  const needsReview = item => /needs_human_review|partially_confirmed|待确认|待核|未定|未确认|不可读/.test(item.source.notes || '')
  const visible = items.filter(item => view === '镜头' || (view === '对白' ? item.source.dialogue : needsReview(item)))
  const current = visible.find(item => item.id === selected) || visible[0]
  const index = current ? items.findIndex(item => item.id === current.id) : -1
  const analyzed = items.filter(item => item.source.description?.trim()).length
  const run = action => requestAgent({ action, projectId: project.id, episodeId: episode.id, requestId: crypto.randomUUID() })
  const next = () => {
    if (starting) return
    setStarting(true)
    run('redraw-dialogue').catch(reason => notify(`对白改编失败：${reason.message}`)).finally(() => setStarting(false))
    navigate(context.link('/dialogue'))
  }
  return <Workflow context={context}>
    <header className="workspace-toolbar"><div><h2>原片与拉片</h2><p className="muted">第 {episode?.number} 集 · {items.length} 个镜头 · 已有 {analyzed} 条镜头分析</p></div><button className="btn" disabled={!source?.fileId} onClick={() => run('redraw-analyze').catch(reason => notify(`拉片启动失败：${reason.message}`))}>重新开始拉片</button></header>
    <div className="redraw-source">
      <nav className="redraw-breakdown-tabs" aria-label="拉片内容">{['镜头', '对白', '待确认'].map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => { setView(tab); setSelected('') }}>{tab}{tab === '待确认' ? ` ${items.filter(needsReview).length}` : ''}</button>)}</nav>
      {segments.length > analyzed && <p className="muted">切镜已显示完整 {segments.length} 镜，其中 {segments.length - analyzed} 镜暂无对应分析。已有记录会保留，未匹配的描述不会套用到新镜头。</p>}
      <div className="redraw-breakdown">
        <section className="redraw-breakdown-list" aria-label="原片镜头">
          {visible.map(item => { const number = items.indexOf(item) + 1; const frame = item.source.frames?.[0]; return <button key={item.id} className={current?.id === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}>{frame && <img src={imageUrl(frame.url, 160)} alt="" loading="lazy" />}<span><strong>{item.id}</strong><br />{sourceTime(item.source.start)} – {sourceTime(item.source.end)}<br />{item.source.description || `镜头 ${number} · 暂无分析`}</span></button> })}
          {!visible.length && <p className="muted">{items.length ? `暂无${view}内容` : '拉片结果会在处理后显示，可在 AI 助手中查看进度。'}</p>}
        </section>
        <section className="redraw-breakdown-detail">
          {source?.fileId && <SourcePlayer source={source} start={current?.source.start} end={current?.source.end} />}
          {current && <><h3>{current.id} · {sourceTime(current.source.start)} – {sourceTime(current.source.end)}</h3><div className="redraw-frame-grid">{current.source.frames?.map(frame => <a href={frame.url} target="_blank" rel="noreferrer" key={frame.fileId}><img src={imageUrl(frame.url, 320)} alt={`原片 ${sourceTime(frame.time)}`} /><span>{sourceTime(frame.time)}</span></a>)}</div>{current.source.evidence?.length > 0 && <><h3>补充证据</h3><div className="redraw-supplement">{current.source.evidence.map(item => <figure key={`${item.fileId}-${item.label}`}><figcaption>第 {item.round} 轮 · {{ single: '单帧', crop: '局部放大', grid4: '四帧拼图', clip: '片段' }[item.kind]} · {item.label}<br />{sourceTime(item.start)} – {sourceTime(item.end)}</figcaption>{item.kind === 'clip' ? <video src={item.url} controls playsInline preload="none" /> : <a href={item.url} target="_blank" rel="noreferrer"><img src={imageUrl(item.url, 640)} alt={item.label} loading="lazy" /></a>}</figure>)}</div></>}<div className="redraw-shot-controls"><button className="btn" disabled={index <= 0} onClick={() => { setView('镜头'); setSelected(items[index - 1].id) }}>上一镜</button><button className="btn" disabled={index >= items.length - 1} onClick={() => { setView('镜头'); setSelected(items[index + 1].id) }}>下一镜</button></div></>}
        </section>
        <section className="redraw-breakdown-info"><h3>镜头详情</h3>{current?.shot ? <div className="redraw-breakdown-edit">{[['画面描述', 'description'], ['原片对白', 'dialogue'], ['证据与备注', 'notes']].map(([label, field]) => <label key={field}>{label}<textarea key={`${current.id}-${field}-${current.source[field] || ''}`} defaultValue={current.source[field] || ''} onBlur={event => { if (event.target.value !== (current.source[field] || '')) patch('shots', current.shot.id, { source: { ...current.shot.source, [field]: event.target.value } }) }} /></label>)}</div> : <p className="muted">{current ? '这个镜头尚无对应的分析记录。' : '选择镜头查看详情。'}</p>}</section>
      </div>
      <div className="redraw-next"><button className="btn primary" disabled={!analyzed || starting} onClick={next}>下一步：生成对白改编</button>{!analyzed && <small>需要先完成镜头分析。</small>}</div>
    </div>
  </Workflow>
}
