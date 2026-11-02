import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { startPolling } from '../../polling'
import { studioApi } from '../store'
import { ChangeFields, ChangeValue, KIND_LABELS, fieldLabel, useRecordNames } from './ChangeLog'
import { Button, Modal, Tabs } from './ui'

const STATUS = { queued: ['排队中', 'muted'], running: ['运行中', 'run'], completed: ['已完成', 'ok'], failed: ['失败', 'bad'], cancelled: ['已取消', 'muted'], interrupted: ['已中断', 'warn'] }
const STAGE_STATE = { done: '完成', running: '进行中', failed: '未通过', pending: '未开始' }
const STEP_STATUS = { running: '调用中', completed: '完成', failed: '失败' }
// 旧版资产任务曾由执行 Agent 直接提交，保留其步骤名称以便查看历史记录。
const LEGACY_TOOLS = { submit_asset_batch: '提交资产草稿', finish_assets: '校验资产草稿' }
const STAGE_INDEX = { 原始分析: 0, 页面字段整理: 1, 校验与保存: 2 }
const TERMINAL = ['failed', 'cancelled', 'interrupted']

const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
function parseObject(text) {
  if (typeof text !== 'string') return undefined
  const start = text.search(/[[{]/), end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end <= start) return undefined
  try { const value = JSON.parse(text.slice(start, end + 1)); return value && typeof value === 'object' ? value : undefined } catch { return undefined }
}
/** 执行 → 整理 → 校验保存三段的当前状态，失败阶段以服务端 failureStage 为准。 */
function stageStates(detail) {
  const phase = detail.phase || ''
  const at = TERMINAL.includes(detail.status) ? STAGE_INDEX[detail.failureStage] ?? 0
    : detail.status === 'completed' ? 3 : detail.status === 'queued' ? -1 : /校验并保存|校验调整结果|应用调整/.test(phase) ? 2 : /整理/.test(phase) ? 1 : 0
  return [0, 1, 2].map(index => index < at ? 'done' : index > at || at < 0 ? 'pending' : TERMINAL.includes(detail.status) ? 'failed' : 'running')
}

export function WorkflowRunDetails({ projectId, episodeId, reload, job, onStarted, outline = false }) {
  const names = useRecordNames()
  const [open, setOpen] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState(''), [retrying, setRetrying] = useState(false), [selectedId, setSelectedId] = useState(''), [tab, setTab] = useState('report'), [tools, setTools] = useState({})
  const jobId = selectedId || job?.id || job?.jobId
  useEffect(() => { setSelectedId(''); setDetail(null) }, [projectId, episodeId, job?.id, job?.jobId])
  useEffect(() => {
    if (!open || !jobId || (!outline && !episodeId)) return
    return startPolling(async signal => {
      const params = new URLSearchParams(outline ? { projectId, jobId, input: '1' } : { projectId, episodeId, jobId })
      const response = await studioApi(`video-redraw/${outline ? 'outline' : 'status'}?${params}`, undefined, signal)
      const value = outline ? response.job : response
      setDetail(value); setError('')
    }, 3000, reason => setError(reason.message))
  }, [open, jobId, projectId, episodeId, outline])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    // 工具名称来自工作流工具目录，旧任务里已下线的工具才使用本地名称。
    studioApi('workflow-agents/tools', undefined, controller.signal).then(list => setTools(Object.fromEntries(list.map(tool => [tool.name, tool.title || tool.name])))).catch(() => undefined)
    return () => controller.abort()
  }, [open])
  async function retry(action) {
    setRetrying(true); setError('')
    try {
      const latest = await reload()
      const version = latest.projects.find(item => item.id === projectId)?._version
      if (!Number.isInteger(version)) throw new Error('无法读取项目版本，请刷新页面后重试')
      const result = await studioApi(`video-redraw/${outline ? 'outline' : 'action'}`, { action, projectId, ...(outline ? {} : { episodeId }), jobId, requestId: crypto.randomUUID(), version })
      const next = outline ? result.job : result
      setSelectedId(next.id); setDetail(null); onStarted?.(next)
    } catch (reason) { setError(reason.message) } finally { setRetrying(false) }
  }
  if (!jobId) return null
  const outputs = detail?.outputs || []
  const raws = outputs.filter(output => output.output_type === 'raw')
  const raw = raws.find(output => !output.incomplete) || raws.at(-1)
  const structured = outputs.find(output => output.output_type === 'structured')
  const fields = parseObject(structured?.content)
  const pageFields = detail?.kind === 'script-storyboard' && detail?.mode === '参考生成' && Array.isArray(fields?.clips)
    ? { ...fields, clips: fields.clips.map(clip => { if (!clip || typeof clip !== 'object') return clip; const { storyboardPrompt: _unused, ...rest } = clip; return rest }) }
    : fields
  const failed = TERMINAL.includes(detail?.status)
  const states = detail ? stageStates(detail) : ['pending', 'pending', 'pending']
  const review = ['plan-storyboard', 'revise-storyboard'].includes(detail?.kind)
  const [statusLabel, statusTone] = STATUS[detail?.status] || ['加载中', 'muted']
  const stages = [
    { title: '执行 Agent', agent: detail?.model, note: raw?.incomplete ? '输出不完整，任务中断时保存的部分内容' : outline ? '根据原始素材、当前大纲和修改意见生成完整报告' : detail?.kind === 'script-assets' ? '根据全项目大纲和剧本生成资产报告' : detail?.kind === 'novel-script' ? '根据小说原文和大纲生成完整报告' : detail?.handoff?.length ? `收到上游报告 ${detail.handoff.length} 份；完整报告交给下游节点` : '完整报告交给下游节点' },
    { title: '整理 Agent', agent: detail?.formatMode === 'asset-tools' ? '旧任务：执行 Agent 多轮工具提交' : detail?.formatterModel, note: detail?.formatErrors?.length ? `校验未通过，已带着错误自动修正 ${detail.formatErrors.length} 次` : '把报告整理为页面字段' },
    { title: review ? '校验建议' : '校验并保存', note: outline && detail?.status === 'completed' && !detail.applied ? '结果保留为草稿，尚未写入页面' : review && detail?.status === 'completed' ? detail.applied ? '已应用到分镜' : '待在页面审核后应用' : '写入页面，记入变更日志' },
  ]
  const skipped = detail?.skippedLinks || []
  return <><Button onClick={() => setOpen(true)}>任务详情</Button>{open && <Modal title={`${outline ? '大纲' : KIND_LABELS[detail?.kind] || '工作流'} · 任务详情`} wide onClose={() => setOpen(false)} panelClassName="run-details">
    <div className="run-head">
      <span className={`change-status ${statusTone}`}>{statusLabel}</span>
      {detail?.status === 'running' && detail.phase && <span>{detail.phase}</span>}
      {detail?.createdAt && <time dateTime={detail.createdAt}>{formatTime(detail.createdAt)}</time>}
    </div>
    <ol className="run-stages">{stages.map((stage, index) => <li key={stage.title} className={`run-stage ${states[index]}`}>
      <span className="run-stage-title">{index + 1}. {stage.title}<em>{STAGE_STATE[states[index]]}</em></span>
      {stage.agent && <code>{stage.agent}</code>}
      <small>{stage.note}</small>
    </li>)}</ol>
    {(detail?.error || error) && <div className="run-alert" role="alert">{failed && detail?.failureStage && <strong>未完成阶段：{detail.failureStage}</strong>}<p>{detail?.error || error}</p>{detail?.error && error && <p>{error}</p>}</div>}
    {!!detail?.formatErrors?.length && <div className="run-notice"><strong>自动修正记录</strong>{detail.formatErrors.map((item, index) => <p key={index}>第 {index + 1} 次整理未通过校验：{item}</p>)}<small>以上错误已交回整理 Agent 重新整理。</small></div>}
    {!!skipped.length && <div className="run-notice"><strong>{skipped.length} 个角色关联未写入</strong><small>镜头文字中没有出现角色名称或别名，系统没有写入这些关联，可在分镜页手动关联。</small><p>{skipped.map(link => `${link.name} → ${names('shots', link.shotId) || link.shotId}`).join('；')}</p></div>}
    {failed && <div className="toolbar run-actions">
      {raw && !raw.incomplete && <Button disabled={retrying} onClick={() => retry('retry-format')}>{retrying ? '正在提交…' : '重新整理页面字段'}</Button>}
      {detail?.failureStage === '校验与保存' && structured && <Button disabled={retrying} onClick={() => retry('retry-save')}>{retrying ? '正在提交…' : '重试保存（不调用模型）'}</Button>}
    </div>}
    <Tabs label="任务内容" value={tab} onChange={setTab} items={[{ value: 'report', label: '交付报告' }, { value: 'fields', label: '页面字段' }, { value: 'steps', label: '执行过程' }]} />
    {tab === 'report' && (raw ? <section className="run-section">
      <p className="run-hint">{outline ? '执行 Agent 的完整大纲报告，供整理 Agent 转换为页面字段。' : detail?.kind === 'script-assets' ? '执行 Agent 根据全项目大纲和剧本生成的资产报告。' : detail?.kind === 'novel-script' ? '执行 Agent 根据小说和大纲生成的完整报告。' : '执行 Agent 的完整报告，会原样交给下游节点；与页面记录冲突时，下游以页面记录为准。'}</p>
      {/^\s*(```json|[[{])/.test(raw.content) ? <pre className="change-json">{raw.content}</pre> : <div className="run-report"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{raw.content}</ReactMarkdown></div>}
    </section> : <p className="change-empty">{detail ? '执行 Agent 尚未输出报告。' : '正在读取…'}</p>)}
    {tab === 'fields' && (structured ? <section className="run-section">
      <p className="run-hint">{outline && detail?.status === 'completed' && !detail.applied ? '整理结果已校验，保留为草稿。' : '整理 Agent 按页面字段格式输出，系统校验后写入页面。'}</p>
      {/* 顶层按字段逐项展开，整份输出再长也不折叠成 JSON。 */}
      {pageFields ? Array.isArray(pageFields) ? <ChangeValue field="" value={pageFields} names={names} /> : <ChangeFields value={pageFields} names={names} /> : <pre className="change-json">{structured.content}</pre>}
      {fields && <details className="change-long"><summary>查看原始 JSON</summary><pre className="change-json">{structured.content}</pre></details>}
    </section> : <p className="change-empty">{detail ? '尚未生成页面字段。' : '正在读取…'}</p>)}
    {tab === 'steps' && <section className="run-section">
      <h3>收到的上游报告</h3>
      {detail?.handoff?.length ? <ul className="run-list">{detail.handoff.map(item => <li key={item.jobId}><strong>{KIND_LABELS[item.kind] || item.kind}</strong><span>{formatTime(item.createdAt)}</span></li>)}</ul> : outline && detail?.executionInput?.context?.originalReport ? <p className="change-empty">已收到上一轮大纲任务的完整报告。</p> : <p className="change-empty">本次没有收到上游报告。</p>}
      <h3>工具调用</h3>
      {detail?.steps?.length ? <ol className="run-list">{detail.steps.map((step, index) => <li key={index}><strong>{tools[step.tool] || LEGACY_TOOLS[step.tool] || step.tool}</strong><span className={`change-status ${step.status === 'failed' ? 'bad' : step.status === 'completed' ? 'ok' : 'run'}`}>{STEP_STATUS[step.status] || step.status}</span>{step.error && <p>{step.error}</p>}</li>)}</ol> : <p className="change-empty">没有工具调用记录。</p>}
      {detail?.requirements && <><h3>{outline ? '修改意见' : fieldLabel('requirements')}</h3><p className="change-text">{detail.requirements}</p></>}
    </section>}
  </Modal>}</>
}
