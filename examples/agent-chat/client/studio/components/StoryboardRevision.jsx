import { useEffect, useState } from 'react'
import { startPolling } from '../../polling'
import { studioApi } from '../store'
import { Button, Modal } from './ui'
import { WorkflowRunDetails } from './WorkflowRunDetails'

const labels = { description: '改编画面', scale: '景别', effects: '音效', sourceDescription: '原片画面', sourceDialogue: '原片对白', dialogue: '目标对白' }
const display = value => Array.isArray(value) ? value.map(line => `${line.speaker || line.type}：${line.text}${line.description ? `（${line.description}）` : ''}`).join('\n') : value || '（空）'

export function StoryboardRevision({ projectId, episodeId, shots, source, reload }) {
  const [open, setOpen] = useState(false), [requirements, setRequirements] = useState(''), [job, setJob] = useState(null), [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!episodeId) return
    return startPolling(async signal => {
      const params = new URLSearchParams({ projectId, episodeId })
      const result = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      const current = result.jobs.find(item => item.kind === 'revise-storyboard' && item.sourceFileId === source?.fileId)
      setJob(current || null)
      if (current) setDetail(await studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId, jobId: current.id })}`, undefined, signal))
      else setDetail(null)
    }, 3000, reason => setError(reason.message))
  }, [projectId, episodeId, source?.fileId, refresh])
  async function start() {
    setBusy(true); setError('')
    try {
      const latest = await reload(), version = latest.projects.find(item => item.id === projectId)?._version
      const next = await studioApi('video-redraw/action', { action: 'revise-storyboard', projectId, episodeId, requirements, requestId: crypto.randomUUID(), version })
      setJob(next); setDetail(null); setRefresh(value => value + 1)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function apply() {
    setBusy(true); setError('')
    try {
      await studioApi('video-redraw/action', { action: 'apply-revision', projectId, episodeId, jobId: job.id })
      await reload(); setRefresh(value => value + 1)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function cancel() {
    setBusy(true); setError('')
    try { await studioApi('video-redraw/action', { action: 'cancel', projectId, episodeId, jobId: job.id }); setRefresh(value => value + 1) }
    catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  let revision
  try { revision = detail?.status === 'completed' ? JSON.parse(detail?.outputs?.find(item => item.output_type === 'structured')?.content || 'null') : null } catch { revision = null }
  const running = ['queued', 'running'].includes(job?.status)
  return <><Button disabled={!shots.length || !source?.fileId} onClick={() => { setError(''); setOpen(true) }}>重新分析并调整</Button>{open && <Modal title="对照原片调整分镜" wide onClose={() => setOpen(false)}>
    <p>将当前分镜、场次和资产连同原视频发给视频分析 Agent。会产生模型调用费用；调整建议需确认后才会写入。</p>
    <label htmlFor="revision-requirements">调整要求</label><textarea id="revision-requirements" maxLength={2000} rows={3} value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="例如：核对人物动作、原片对白和画面描述" />
    <div className="toolbar"><Button primary disabled={busy || running} onClick={start}>{busy ? '处理中…' : '开始重新分析'}</Button>{running && <Button disabled={busy} onClick={cancel}>取消任务</Button>}{job && <WorkflowRunDetails projectId={projectId} episodeId={episodeId} reload={reload} job={job} onStarted={() => setRefresh(value => value + 1)} />}</div>
    {job && <p role="status">{running ? `正在处理：${job.phase}` : job.status === 'completed' ? detail?.applied ? '调整已应用' : '分析完成，请查看建议' : `任务未完成：${job.error || job.status}`}</p>}
    {error && <p role="alert">{error}</p>}
    {revision && <><p>可直接应用画面、景别、音效和对白；镜头数量、时间与场次的建议请手动核对。</p>{revision.changes?.map(change => {
      const index = shots.findIndex(shot => shot.id === change.shotId), shot = shots[index]
      return <section key={change.shotId}><h3>第 {index >= 0 ? index + 1 : '？'} 镜</h3><p>{change.reason}</p>{Object.entries(change.values || {}).map(([key, value]) => <div key={key}><strong>{labels[key] || key}</strong><p style={{ whiteSpace: 'pre-wrap' }}>当前：{display(key === 'sourceDescription' ? shot?.source?.description : key === 'sourceDialogue' ? shot?.source?.dialogue : shot?.[key])}</p><p style={{ whiteSpace: 'pre-wrap' }}>建议：{display(value)}</p></div>)}</section>
    })}{revision.notes && <><h3>其他建议</h3><p style={{ whiteSpace: 'pre-wrap' }}>{revision.notes}</p></>}{job?.status === 'completed' && !detail?.applied && <Button primary disabled={busy || !revision.changes?.length} onClick={apply}>应用这些调整</Button>}</>}
  </Modal>}</>
}
