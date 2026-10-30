import { useEffect, useState } from 'react'
import { startPolling } from '../../polling'
import { studioApi } from '../store'
import { Button, Modal } from './ui'

function hasStructuredObject(value) {
  if (typeof value !== 'string') return false
  const start = value.indexOf('{'), end = value.lastIndexOf('}')
  if (start < 0 || end <= start) return false
  try { const parsed = JSON.parse(value.slice(start, end + 1)); return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) } catch { return false }
}

export function WorkflowRunDetails({ projectId, episodeId, reload, job, onStarted }) {
  const [open, setOpen] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState(''), [retrying, setRetrying] = useState(false), [selectedId, setSelectedId] = useState('')
  const jobId = selectedId || job?.id || job?.jobId
  useEffect(() => { setSelectedId(''); setDetail(null) }, [projectId, episodeId, job?.id, job?.jobId])
  useEffect(() => {
    if (!open || !jobId || !episodeId) return
    return startPolling(async signal => {
      const params = new URLSearchParams({ projectId, episodeId, jobId })
      const value = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      setDetail(value); setError('')
    }, 3000, reason => setError(reason.message))
  }, [open, jobId, projectId, episodeId])
  async function retry(action) {
    setRetrying(true); setError('')
    try {
      const latest = await reload()
      const version = latest.projects.find(item => item.id === projectId)?._version
      if (!Number.isInteger(version)) throw new Error('无法读取项目版本，请刷新页面后重试')
      const next = await studioApi('video-redraw/action', { action, projectId, episodeId, jobId, requestId: crypto.randomUUID(), version })
      setSelectedId(next.id); setDetail(null); onStarted?.(next)
    } catch (reason) { setError(reason.message) } finally { setRetrying(false) }
  }
  if (!jobId) return null
  const outputs = detail?.outputs || []
  const raw = outputs.find(output => output.output_type === 'raw')
  const structured = outputs.find(output => output.output_type === 'structured')
  const failed = ['failed', 'cancelled', 'interrupted'].includes(detail?.status)
  const saveFailure = failed && (detail?.failureStage === '校验与保存' || /校验并保存/.test(detail?.phase || '') || (detail?.phase === '整理页面字段' && hasStructuredObject(structured?.content)))
  const stage = detail?.failureStage || (saveFailure ? '校验与保存' : /整理|校验整理/.test(detail?.phase || '') ? '整理页面字段' : '原始分析')
  return <><Button onClick={() => setOpen(true)}>查看模型输出与任务详情</Button>{open && <Modal title="工作流任务详情" wide onClose={() => setOpen(false)}><p>状态：{detail?.status || '加载中'} · {detail?.phase || ''}</p>{detail?.model && <p>执行模型：{detail.model} · 整理模型：{detail.formatterModel}</p>}{detail?.error && <p role="alert">{detail.error}</p>}{error && <p role="alert">{error}</p>}
    {failed && <p role="status">未完成阶段：{stage}。{saveFailure && raw && structured ? '原始分析和页面字段均已生成，保存校验未通过。' : ''}</p>}
    <p>原始分析：{raw ? raw.incomplete ? '输出不完整' : '已生成' : '未生成'} · 页面字段整理：{structured ? '已生成' : '未生成'} · 校验与保存：{detail?.kind === 'revise-storyboard' && detail?.status === 'completed' ? detail?.applied ? '已应用' : '待确认应用' : detail?.status === 'completed' ? '已完成' : saveFailure ? '未通过' : '未完成'}</p>
    <h3>工具步骤</h3>{detail?.steps?.length ? <ol>{detail.steps.map((step, index) => <li key={index}>{step.tool} · {step.status}{step.error ? `：${step.error}` : ''}</li>)}</ol> : <p>没有工具调用记录。</p>}
    {outputs.map((output, index) => <section key={`${output.output_type}-${index}`}><h3>{output.output_type === 'raw' ? `原始输出${output.incomplete ? '（不完整）' : ''}` : '页面字段'}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '35vh', overflow: 'auto' }}>{output.content}</pre></section>)}
    {!outputs.length && detail && <p>该任务没有可查看的工作流输出。</p>}
    {saveFailure && structured && <Button disabled={retrying} onClick={() => retry('retry-save')}>{retrying ? '正在提交…' : '重试保存（不调用模型）'}</Button>}
    {raw && !raw.incomplete && failed && <Button disabled={retrying} onClick={() => retry('retry-format')}>{retrying ? '正在提交…' : '重新整理页面字段'}</Button>}
  </Modal>}</>
}
