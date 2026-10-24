import { useEffect, useRef, useState } from 'react'
import { Button, Field } from './ui'
import { makeOutline } from '../data'
import { useStore } from '../store'
import OutlineTable from './OutlineTable'

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

export default function ProjectOutline({ project, onWrite }) {
  const { patch, notify, requestAgent } = useStore()
  const [outline, setOutline] = useState(() => outlineValue(project))
  const base = useRef({ version: project._version, outline: JSON.stringify(outlineValue(project)) })
  useEffect(() => {
    const next = outlineValue(project)
    if (JSON.stringify(outline) === base.current.outline) {
      setOutline(next)
      base.current = { version: project._version, outline: JSON.stringify(next) }
    }
  }, [project._version])
  const dirty = JSON.stringify(outline) !== JSON.stringify(outlineValue(project))
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
            : `${project.duration} 秒`}</span>
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
        <span className="muted">{dirty ? '项目大纲有未保存修改' : '项目大纲已保存，全部剧集共用'}</span>
        <div className="toolbar">
          <Button onClick={() => requestAgent({ action: 'outline', projectId: project.id, draftOnly: true }).catch(reason => notify(reason.message))}>AI 生成大纲</Button>
          <Button onClick={() => save()}>保存项目大纲</Button>
          {onWrite && <Button primary onClick={() => { if (save(true)) onWrite() }}>
            编写分集剧本 ↗
          </Button>}
        </div>
      </footer>
    </>
  )
}
