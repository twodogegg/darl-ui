import { useEffect, useState } from 'react'
import { startPolling } from '../../polling'
import { studioApi } from '../store'
import { Button, Modal } from './ui'
import { WorkflowRunDetails } from './WorkflowRunDetails'

const labels = { description: '改编画面', scale: '景别', camera: '运镜', duration: '目标时长（秒）', effects: '音效', sourceDescription: '原片画面', sourceDialogue: '原片对白', dialogue: '目标对白' }
const display = value => Array.isArray(value) ? value.map(line => `${line.speaker || line.type}：${line.text}${line.description ? `（${line.description}）` : ''}`).join('\n') : value || '（空）'

export function StoryboardRevision({ projectId, episodeId, shots, source, reload, scriptReady }) {
  const [open, setOpen] = useState(false), [requirements, setRequirements] = useState(''), [job, setJob] = useState(null), [detail, setDetail] = useState(null), [analysisAvailable, setAnalysisAvailable] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!episodeId) return
    let knownId = '', loadedId = ''
    return startPolling(async signal => {
      const params = new URLSearchParams({ projectId, episodeId })
      const result = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      const current = result.jobs.find(item => item.kind === 'plan-storyboard' && item.sourceFileId === source?.fileId)
      setAnalysisAvailable(result.jobs.some(item => item.kind === 'analyze' && item.status === 'completed' && item.sourceFileId === source?.fileId))
      setJob(current || null)
      if (current?.id !== knownId) { knownId = current?.id || ''; loadedId = ''; setDetail(null) }
      if (open && current?.status === 'completed' && loadedId !== current.id) {
        setDetail(await studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId, jobId: current.id })}`, undefined, signal))
        loadedId = current.id
      }
    }, 3000, reason => setError(reason.message))
  }, [projectId, episodeId, source?.fileId, refresh, open])
  async function start() {
    setBusy(true); setError('')
    try {
      const latest = await reload(), version = latest.projects.find(item => item.id === projectId)?._version
      const next = await studioApi('video-redraw/action', { action: 'plan-storyboard', projectId, episodeId, requirements, requestId: crypto.randomUUID(), version })
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
  return <><Button disabled={!shots.length || !source?.fileId || !scriptReady} title={!scriptReady ? '请先完成本集剧本和相关场次正文' : undefined} onClick={() => { setError(''); setOpen(true) }}>Agent 编写分镜</Button>{!scriptReady && shots.length > 0 && <span className="muted">请先完成本集剧本和相关场次正文</span>}{open && <Modal title="生成正式分镜建议" wide onClose={() => setOpen(false)}>
    <p>读取剧本、原片分析、当前分镜和资产文字，由分镜 Agent 分析、整理 Agent 整理；建议经确认后才写入。当前不向模型发送图片或视频。</p>
    {analysisAvailable === false && <p role="status">本集没有可用的原片分析任务记录，将使用当前镜头保存的原片依据；缺失内容请核对。</p>}
    <label htmlFor="revision-requirements">调整要求</label><textarea id="revision-requirements" maxLength={2000} rows={3} value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="例如：保持动作连续，完善镜头运镜" />
    <div className="toolbar"><Button primary disabled={busy || running} onClick={start}>{busy ? '处理中…' : '生成分镜建议'}</Button>{running && <Button disabled={busy} onClick={cancel}>取消任务</Button>}{job && <WorkflowRunDetails projectId={projectId} episodeId={episodeId} reload={reload} job={job} onStarted={() => setRefresh(value => value + 1)} />}</div>
    {job && <p role="status">{running ? `正在处理：${job.phase}` : job.status === 'completed' ? detail?.applied ? '调整已应用' : '分析完成，请查看建议' : `任务未完成：${job.error || job.status}`}</p>}
    {error && <p role="alert">{error}</p>}
    {revision && <><p>可审核并应用画面、景别、运镜、音效和目标时长；对白、原片时间及场次保持不变。</p>{revision.changes?.map(change => {
      const index = shots.findIndex(shot => shot.id === change.shotId), shot = shots[index]
      return <section key={change.shotId}><h3>第 {index >= 0 ? index + 1 : '？'} 镜</h3><p>{change.reason}</p>{Object.entries(change.values || {}).map(([key, value]) => <div key={key}><strong>{labels[key] || key}</strong><p style={{ whiteSpace: 'pre-wrap' }}>当前：{key === 'duration' ? `${Number(shot?.duration).toFixed(1)} 秒` : display(key === 'sourceDescription' ? shot?.source?.description : key === 'sourceDialogue' ? shot?.source?.dialogue : shot?.[key])}</p><p style={{ whiteSpace: 'pre-wrap' }}>建议：{key === 'duration' ? `${Number(value).toFixed(1)} 秒` : display(value)}</p></div>)}</section>
    })}{revision.notes && <><h3>其他建议</h3><p style={{ whiteSpace: 'pre-wrap' }}>{revision.notes}</p></>}{job?.status === 'completed' && !detail?.applied && <Button primary disabled={busy || !revision.changes?.length} onClick={apply}>应用这些调整</Button>}</>}
  </Modal>}</>
}
