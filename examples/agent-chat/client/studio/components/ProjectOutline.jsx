import { useEffect, useRef, useState } from 'react'
import { Button, Field, Modal } from './ui'
import { makeOutline } from '../data'
import { studioApi, useStore } from '../store'
import { startPolling } from '../../polling'
import OutlineTable from './OutlineTable'
import { WorkflowRunDetails } from './WorkflowRunDetails'

const choices = [
  ['keep', '保留', '哪些主线、人物与关键情节必须保留'],
  ['remove', '砍掉', '哪些支线或重复情节可以删去'],
  ['merge', '合并', '哪些角色、场景或情节可以合并'],
  ['risks', '风险', '整部作品需留意的逻辑、节奏与连续性问题'],
]
const roleColumns = [
  { key: 'name', label: '姓名', type: 'text', width: '12%' },
  { key: 'position', label: '身份与作用', width: '23%' },
  { key: 'relationships', label: '人物关系', width: '25%' },
  { key: 'arc', label: '人物变化（可选）', width: '29%' },
]
const sceneColumns = [
  { key: 'name', label: '场景名称', type: 'text', width: '23%' },
  { key: 'purpose', label: '剧情用途', width: '66%' },
]
const propColumns = [
  { key: 'name', label: '道具', type: 'text', width: '23%' },
  { key: 'purpose', label: '剧情功能', width: '34%' },
  { key: 'involvement', label: '涉及人物 / 事件', width: '32%' },
]
const outlineValue = (project) => ({ ...makeOutline(project), ...(project.outline || {}) })

export default function ProjectOutline({ project, onWrite, writing = false }) {
  const { patch, notify, ensureWritable, onNavigate, reload } = useStore()
  const [outline, setOutline] = useState(() => outlineValue(project))
  const [job, setJob] = useState(null), [jobError, setJobError] = useState(''), [submitting, setSubmitting] = useState(false), [preview, setPreview] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false), [feedback, setFeedback] = useState(''), [adjustError, setAdjustError] = useState('')
  const base = useRef({ version: project._version, outline: JSON.stringify(outlineValue(project)) })
  useEffect(() => {
    const next = outlineValue(project)
    if (JSON.stringify(outline) === base.current.outline) {
      setOutline(next)
      base.current = { version: project._version, outline: JSON.stringify(next) }
    }
  }, [project._version])
  const dirty = JSON.stringify(outline) !== JSON.stringify(outlineValue(project))
  const hasOutline = Boolean(String(project.outline?.core || '').trim() || String(project.outline?.story || '').trim())
  useEffect(() => {
    const controller = new AbortController()
    studioApi(`video-redraw/outline?${new URLSearchParams({ projectId: project.id })}`, undefined, controller.signal).then(result => setJob(result.job)).catch(error => { if (!controller.signal.aborted) setJobError(error.message) })
    return () => controller.abort()
  }, [project.id])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    return startPolling(async signal => {
      const result = await studioApi(`video-redraw/outline?${new URLSearchParams({ projectId: project.id, jobId: job.id })}`, undefined, signal)
      setJob(result.job); setJobError('')
    }, 3000, error => setJobError(error.message))
  }, [project.id, job?.id, job?.status])
  async function generateOutline() {
    if (submitting || ['queued', 'running'].includes(job?.status)) return
    setSubmitting(true); setJobError('')
    try {
      await ensureWritable()
      const result = await studioApi('video-redraw/outline', { projectId: project.id, version: project._version, requestId: crypto.randomUUID() })
      setJob(result.job)
    } catch (error) { setJobError(error.message) } finally { setSubmitting(false) }
  }
  async function adjustOutline() {
    if (!feedback.trim() || submitting || dirty) return
    setSubmitting(true); setAdjustError('')
    try {
      await ensureWritable()
      const state = await reload(), current = state.projects.find(item => item.id === project.id)
      if (!current || current._version !== project._version) throw new Error('项目已变化，请核对最新大纲后重试')
      const result = await studioApi('video-redraw/outline', { projectId: project.id, version: current._version, requestId: crypto.randomUUID(), autoApply: true, requirements: feedback.trim() })
      setJob(result.job); setFeedback(''); setAdjustOpen(false); setJobError('')
    } catch (error) { setAdjustError(error.message) } finally { setSubmitting(false) }
  }
  async function cancelOutline() {
    try { const result = await studioApi('video-redraw/outline', { action: 'cancel', projectId: project.id, jobId: job.id }); setJob(result.job) }
    catch (error) { setJobError(error.message) }
  }
  function edit(key, value) {
    setOutline((current) => ({ ...current, [key]: value }))
  }
  function save(quiet = false) {
    if (!dirty) return true
    if (project._version !== base.current.version) { notify('大纲已被其他操作修改，当前草稿已保留，请核对后重新打开'); return false }
    patch('projects', project.id, { outline })
    base.current = { version: project._version + 1, outline: JSON.stringify(outline) }
    if (!quiet) notify('项目大纲已保存，全部剧集共用')
    return true
  }
  function textField(key, label, placeholder, rows = 4) {
    return (
      <Field label={label}>
        <textarea
          value={outline[key]}
          maxLength={100000}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => edit(key, e.target.value)}
        />
      </Field>
    )
  }
  return (
    <>
      <header className="workspace-toolbar">
        <div className="outline-heading">
          <span>PROJECT OUTLINE / 全项目</span>
          <h2>{project.title} · 项目大纲</h2>
          <p>先确定整部作品讲什么、如何推进、在哪里结束，再编写各集剧本。</p>
        </div>
        <span className="outline-scope">全部剧集共用</span>
      </header>
      <div className="project-outline">
        <p className="outline-meta">
          <span>计划 {project.planned ? `${project.planned} 集` : '集数待定（由 Agent 填写）'}</span>
          <span>改编幅度 {project.adaptation || '抽核'}</span>
          <span>单集时长 {project.durationMin && project.durationMax
            ? `${project.durationMin}–${project.durationMax} 分钟`
            : project.duration != null ? `${project.duration} 秒` : '未设置'}</span>
          <span>画幅 {project.ratio}</span>
        </p>
        <section aria-label="故事内核">
          {textField('core', '故事内核', '整部作品的核心命题、主角欲望与主要矛盾', 3)}
        </section>
        <section aria-label="完整故事主线">
          {textField('story', '完整故事主线', '连贯写清开端、冲突升级、关键转折、高潮和最终结局，而不是只概述当前一集', 7)}
        </section>
        <section aria-labelledby="outline-adaptation-title">
          <h3 id="outline-adaptation-title">改编取舍</h3>
          <div className="outline-choices">
            {choices.map(([key, label, placeholder]) => (
              <div key={key}>{textField(key, label, placeholder, 6)}</div>
            ))}
          </div>
        </section>
        <OutlineTable
          title="角色表"
          itemLabel="角色"
          prefix="C"
          columns={roleColumns}
          rows={outline.roles || []}
          onChange={(rows) => edit('roles', rows)}
        />
        <OutlineTable
          title="场景表"
          itemLabel="场景"
          prefix="S"
          columns={sceneColumns}
          rows={outline.scenes || []}
          onChange={(rows) => edit('scenes', rows)}
        />
        <OutlineTable
          title="关键叙事道具表"
          itemLabel="道具"
          prefix="P"
          columns={propColumns}
          rows={outline.props || []}
          onChange={(rows) => edit('props', rows)}
        />
        <section aria-label="分集走向">
          {textField('episodes', '分集走向', '在同一份项目大纲中列出各集的主要事件、转折与集末悬念，明确它们如何共同走向结局', 7)}
        </section>
      </div>
      <footer className="workspace-footer">
        <span className="muted">{jobError || (['failed', 'interrupted', 'cancelled'].includes(job?.status) ? `大纲任务未完成：${job.error || job.status}` : ['queued', 'running'].includes(job?.status) ? `大纲任务进行中：${job.phase}` : dirty ? '项目大纲有未保存修改，请先保存再使用 AI 修改' : job?.status === 'completed' && !job.applied ? '大纲草稿已生成，请查看并核对' : '项目大纲已保存，全部剧集共用')}</span>
        <div className="toolbar">
          <Button onClick={() => onNavigate('workflow-outline-agent')}>配置大纲 Agent</Button>
          <Button disabled={submitting || dirty || ['queued', 'running'].includes(job?.status)} onClick={() => hasOutline ? (setAdjustError(''), setAdjustOpen(true)) : generateOutline()}>{submitting || ['queued', 'running'].includes(job?.status) ? '大纲任务进行中…' : hasOutline ? 'AI 修改大纲' : 'AI 生成大纲'}</Button>
          {['queued', 'running'].includes(job?.status) && <Button onClick={cancelOutline}>取消任务</Button>}
          <WorkflowRunDetails outline projectId={project.id} reload={reload} job={job} onStarted={setJob} />
          {job?.status === 'completed' && job.outline && <Button onClick={() => setPreview(true)}>查看生成的大纲</Button>}
          <Button onClick={() => save()}>保存项目大纲</Button>
          {onWrite && <Button primary disabled={writing || submitting || ['queued', 'running'].includes(job?.status)} onClick={() => { if (save(true)) onWrite() }}>
            {writing ? '正在进入剧本…' : '编写分集剧本 ↗'}
          </Button>}
        </div>
      </footer>
      {adjustOpen && <Modal title="AI 修改大纲" onClose={() => setAdjustOpen(false)} footer={<><Button onClick={() => setAdjustOpen(false)}>取消</Button><Button primary disabled={submitting || !feedback.trim()} onClick={adjustOutline}>{submitting ? '正在提交…' : '开始修改'}</Button></>}>
        <p className="muted">执行 Agent 会结合当前大纲和你的意见修改，整理 Agent 校验后保存；可在任务详情查看进度和报告。</p>
        <Field label="修改意见"><textarea rows={5} maxLength={2000} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="例如：加强主角与家人的冲突，保留其他角色和故事走向" /></Field>
        {adjustError && <p role="alert">{adjustError}</p>}
      </Modal>}
      {preview && job?.outline && <Modal title="小说转大纲 · 生成结果" wide onClose={() => setPreview(false)} footer={<><Button onClick={() => setPreview(false)}>关闭</Button>{!job.applied && <Button primary disabled={dirty || project._version !== job.projectVersion} onClick={() => { setOutline(job.outline); setPreview(false); notify('草稿已填入表单，请核对并保存') }}>填入大纲表单</Button>}</>}>
        <p className="muted">{job.applied ? '生成结果已自动保存到项目大纲。' : '生成草稿不会自动覆盖项目大纲。填入后可继续修改，保存才会写入项目。'}</p>
        {dirty && <p role="alert">表单有未保存修改，请先保存或处理后再填入草稿。</p>}
        {!job.applied && project._version !== job.projectVersion && <p role="alert">项目在生成期间发生变化，请重新生成，避免覆盖新的内容。</p>}
        {['core', 'story', 'keep', 'remove', 'merge', 'risks', 'episodes'].map(key => <section key={key}><h3>{{ core: '故事内核', story: '完整故事主线', keep: '保留', remove: '砍掉', merge: '合并', risks: '风险', episodes: '分集走向' }[key]}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{job.outline[key] || '未指定'}</p></section>)}
        {['roles', 'scenes', 'props'].map(key => <section key={key}><h3>{{ roles: '角色', scenes: '场景', props: '关键叙事道具' }[key]}</h3>{job.outline[key].length ? job.outline[key].map(item => <p key={item.id}><strong>{item.name}</strong>：{Object.entries(item).filter(([field, value]) => !['id', 'name'].includes(field) && value).map(([, value]) => value).join('；')}</p>) : <p>无</p>}</section>)}
      </Modal>}
    </>
  )
}
