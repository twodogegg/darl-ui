import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { startPolling } from '../../polling'
import { studioApi, useStore } from '../store'
import { Button, Modal } from './ui'

export function WorkflowAdjustment({ projectId, episodeId, kind, reload, disabled }) {
  const { ensureWritable } = useStore()
  const [open, setOpen] = useState(false), [feedback, setFeedback] = useState(''), [jobs, setJobs] = useState([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const action = kind === 'cuts' ? 'revise-cuts' : 'revise-script'
  const original = kind === 'cuts' ? 'analyze' : 'write-script'
  useEffect(() => { setJobs([]); setLoaded(false); setFeedback(''); setError('') }, [projectId, episodeId])
  useEffect(() => {
    if (!open || !episodeId) return
    let appliedId = ''
    return startPolling(async signal => {
      const params = new URLSearchParams({ projectId, episodeId })
      const status = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      const relevant = status.jobs.filter(item => item.sourceFileId === status.source?.fileId)
      let current = relevant.find(item => item.kind === action) || relevant.find(item => item.kind === original && item.status === 'completed')
      const chain = [], seen = new Set()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        const detail = await studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId, jobId: current.id })}`, undefined, signal)
        chain.unshift(detail)
        current = detail.parentJobId && relevant.find(item => item.id === detail.parentJobId)
      }
      setJobs(chain); setLoaded(true); setError('')
      const newest = chain.at(-1)
      if (newest?.kind === action && newest.status === 'completed' && newest.applied && newest.jobId !== appliedId) { appliedId = newest.jobId; await reload(signal) }
    }, 3000, reason => setError(reason.message))
  }, [open, projectId, episodeId, action, original, refresh, reload])
  const latest = jobs.at(-1), running = ['queued', 'running'].includes(latest?.status)
  const parent = [...jobs].reverse().find(item => item.status === 'completed' && !item.restored)
  const structured = latest?.outputs?.find(item => item.output_type === 'structured')?.content
  let proposal
  try { proposal = structured && JSON.parse(structured) } catch { proposal = null }
  async function submit() {
    if (!feedback.trim() || busy || running) return
    setBusy(true); setError('')
    try {
      await ensureWritable()
      const state = await reload(), project = state.projects.find(item => item.id === projectId)
      if (!project) throw new Error('项目不存在')
      await studioApi('video-redraw/action', { action, projectId, episodeId, ...(parent ? { jobId: parent.jobId } : {}), requirements: feedback.trim(), requestId: crypto.randomUUID(), version: project._version })
      setFeedback(''); setRefresh(value => value + 1)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function cancel() {
    setBusy(true); setError('')
    try { await studioApi('video-redraw/action', { action: 'cancel', projectId, episodeId, jobId: latest.jobId }); setRefresh(value => value + 1) }
    catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function retry(actionName) {
    setBusy(true); setError('')
    try {
      await ensureWritable()
      const state = await reload(), project = state.projects.find(item => item.id === projectId)
      if (!project) throw new Error('项目不存在')
      await studioApi('video-redraw/action', { action: actionName, projectId, episodeId, jobId: latest.jobId, requestId: crypto.randomUUID(), version: project._version })
      setRefresh(value => value + 1)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  return <><Button disabled={disabled || !episodeId} onClick={() => { setJobs([]); setLoaded(false); setOpen(true) }}>{kind === 'cuts' ? '与原片分析 Agent 调整' : '与剧本 Agent 调整'}</Button>{open && <Modal title={kind === 'cuts' ? '与原片分析 Agent 调整镜头' : '与剧本 Agent 调整剧本'} wide onClose={() => setOpen(false)}>
    <p className="muted">基于原任务和当前页面继续反馈，完成后直接应用；可在变更日志中撤销。{kind === 'cuts' ? '已关联的片段会同步镜头引用并保留视频，请核对片段内容；关联图片的镜头不能直接删除或修改时间。' : '保留已有场次与已确认对白。'}</p>
    {!loaded && !error && <p role="status">正在读取原工作流任务…</p>}
    {jobs.map((job, index) => <section key={job.jobId} className="run-section">
      <h3>{index === 0 && job.kind === original ? '原任务' : `反馈 ${index}`}{job.model ? ` · ${job.model}` : ''}</h3>
      {job.requirements && <p><strong>你的意见：</strong>{job.requirements}</p>}
      {job.restored && <p role="status">此轮调整已撤销或部分还原。</p>}
      {job.kind !== original && job.outputs?.find(item => item.output_type === 'raw')?.content && <div className="run-report"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{job.outputs.find(item => item.output_type === 'raw').content}</ReactMarkdown></div>}
      {['queued', 'running'].includes(job.status) && <p role="status">{job.phase || '排队中'}…</p>}
      {['failed', 'cancelled', 'interrupted'].includes(job.status) && <p role={job.status === 'cancelled' ? 'status' : 'alert'}>{job.status === 'cancelled' ? '任务已取消' : job.error || '任务未完成'}</p>}
    </section>)}
    {proposal && latest?.kind === action && <details><summary>查看调整结果</summary>{kind === 'cuts' ? <><p>{proposal.notes}</p>{proposal.shots?.map((shot, index) => <p key={index}><strong>第 {index + 1} 镜 · {shot.start}–{shot.end} 秒</strong> {shot.description}</p>)}</> : proposal.scenes?.map((scene, index) => <section key={scene.sceneId}><h3>第 {index + 1} 场</h3><pre className="change-json">{scene.content}</pre></section>)}</details>}
    {latest?.applied && !latest.restored && <p role="status">此轮调整已应用。</p>}
    {['failed', 'interrupted', 'cancelled'].includes(latest?.status) && latest?.outputs?.some(item => item.output_type === 'raw' && !item.incomplete) && !/发生变化|已更换/.test(latest.error || '') && <div className="toolbar"><Button disabled={busy} onClick={() => retry('retry-format')}>重新整理结果</Button>{structured && <Button disabled={busy} onClick={() => retry('retry-save')}>重试写入</Button>}</div>}
    {error && <p role="alert">{error}</p>}
    <label htmlFor={`workflow-feedback-${kind}`}>调整意见</label><textarea id={`workflow-feedback-${kind}`} maxLength={2000} rows={4} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={kind === 'cuts' ? '例如：第 3 镜切点不准确，请重新核对 3–10 秒' : '例如：第 1 场动作描述过于重复，请结合镜头精简'} />
    <div className="toolbar"><Button primary disabled={!parent || !feedback.trim() || running || busy} onClick={submit}>发送给工作流 Agent</Button>{running && <Button disabled={busy} onClick={cancel}>取消任务</Button>}</div>
    {!parent && loaded && <p className="muted">未找到已完成的原工作流任务，请先完成原阶段。</p>}
  </Modal>}</>
}
