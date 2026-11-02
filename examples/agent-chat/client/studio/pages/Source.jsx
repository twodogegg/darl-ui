import { useProject, Workflow } from '../components/Shell'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { studioApi, useStore } from '../store'
import { startPolling } from '../../polling'
import { SourcePlayer } from '../components/VideoRedraw'
import { WorkflowRunDetails } from '../components/WorkflowRunDetails'
import { studioDefaults } from '../../../studio-schema'

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
  const { data, reload, notify, update } = useStore()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false), [uploading, setUploading] = useState(false)
  const [analysis, setAnalysis] = useState(null), [refresh, setRefresh] = useState(0), [submitError, setSubmitError] = useState('')
  const input = useRef(null)
  const source = episode?.sourceVideo || (episode?.id === episodes[0]?.id ? project.sourceVideo : null)
  const hasShots = data.shots.some(shot => shot.episodeId === episode?.id)
  useEffect(() => {
    if (!episode?.id) return
    const params = new URLSearchParams({ projectId: project.id, episodeId: episode.id })
    let completed = false
    return startPolling(async signal => {
      const result = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      const job = result.jobs.find(item => item.kind === 'analyze' && item.sourceFileId === source?.fileId)
      setAnalysis(job || null)
      if (job?.status === 'completed' && !completed) { completed = true; await reload(signal) }
    }, 3000, error => setAnalysis({ status: 'failed', error: `读取进度失败：${error.message}` }))
  }, [project.id, episode?.id, source?.fileId, refresh, reload])
  async function addEpisode(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || uploading) return
    if (!/\.mp4$/i.test(file.name) || file.size > 300 * 1024 * 1024) { notify('请选择不超过 300 MB 的 MP4'); return }
    setUploading(true)
    try {
      const form = new FormData(); form.set('file', file)
      const response = await fetch('/api/files', { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok || !result.fileId) throw new Error(result.error || '上传失败')
      const episodeId = crypto.randomUUID()
      const saved = await update(draft => {
        const number = Math.max(0, ...draft.episodes.filter(item => item.projectId === project.id).map(item => item.number)) + 1
        draft.episodes.push({ ...structuredClone(studioDefaults.episodes), id: episodeId, projectId: project.id, number, title: file.name.replace(/\.mp4$/i, ''), duration: null, sourceVideo: { fileId: result.fileId, url: `/api/files/${result.fileId}`, name: file.name } })
      })
      if (!saved) throw new Error('剧集保存失败')
      navigate(`/source?projectId=${encodeURIComponent(project.id)}&episodeId=${encodeURIComponent(episodeId)}`)
      notify('剧集已添加，请分析本集原片')
    } catch (error) { notify(`添加剧集失败：${error.message}`) }
    finally { setUploading(false) }
  }
  async function generate() {
    if (!source?.fileId || starting) return
    setStarting(true); setSubmitError('')
    try {
      const latest = await reload()
      const currentProject = latest.projects.find(item => item.id === project.id)
      const job = await studioApi('video-redraw/action', { action: 'analyze', projectId: project.id, episodeId: episode.id, requestId: crypto.randomUUID(), version: currentProject._version })
      setAnalysis(job); setRefresh(value => value + 1)
    } catch (reason) { setSubmitError(reason.message) }
    finally { setStarting(false) }
  }
  return <Workflow context={context}>
    <header className="workspace-toolbar"><div><h2>原片</h2><p className="muted">自动检测候选切镜并分析原片，分析出的镜头先在镜头校对中核对，再供剧本、资产和视频制作使用。</p></div><div className="toolbar"><input ref={input} type="file" accept="video/mp4,.mp4" aria-label="上传新剧集原片" hidden onChange={addEpisode} /><button className="btn" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? '正在上传剧集…' : '＋ 添加剧集'}</button><button className="btn" disabled={!source?.fileId || starting || hasShots || ['queued', 'running'].includes(analysis?.status)} onClick={generate}>{starting ? '正在启动…' : ['failed', 'cancelled', 'interrupted'].includes(analysis?.status) ? '重新分析原片' : '分析原片'}</button><button className="btn primary" disabled={!hasShots || ['queued', 'running'].includes(analysis?.status)} onClick={() => navigate(`/storyboard?projectId=${encodeURIComponent(project.id)}&episodeId=${encodeURIComponent(episode?.id || '')}`)}>进入镜头校对</button></div></header>
    <div className="redraw-source"><WorkflowRunDetails projectId={project.id} episodeId={episode?.id} job={analysis} reload={reload} onStarted={next => { setAnalysis(next); setRefresh(value => value + 1) }} />{source?.fileId ? <SourcePlayer source={source} /> : <div className="empty"><h2>暂无原视频</h2><p>请先上传原视频。</p></div>}<p className="muted" role={submitError || analysis?.status === 'failed' ? 'alert' : 'status'}>{submitError ? `原片分析启动失败：${submitError}` : ['queued', 'running'].includes(analysis?.status) ? `正在分析原片：${analysis.phase || '排队'}…` : analysis?.status === 'completed' || hasShots ? '原片分析完成，可进入剧本。' : ['failed', 'interrupted', 'cancelled'].includes(analysis?.status) ? `原片分析未完成${analysis.failureStage ? `（${analysis.failureStage}）` : ''}：${analysis.error || '任务已取消'}，可查看任务详情。` : '分析后可在此查看进度，完成后进入剧本。'}</p></div>
  </Workflow>
}
