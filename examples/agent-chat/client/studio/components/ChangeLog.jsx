import { useEffect, useMemo, useRef, useState } from 'react'
import { IconRefresh } from '@tabler/icons-react'
import { imageUrl } from '../../image-url'
import { startPolling } from '../../polling'
import { studioApi, useStore } from '../store'
import { Button, Confirm, Modal, Tabs } from './ui'

// 服务端只保存稳定代码，界面文字统一在这里翻译。
export const KIND_LABELS = { analyze: '原片分析', 'write-script': '剧本编写', 'novel-script': '小说转剧本', 'script-assets': '剧本资产提取', 'extract-assets': '转绘资产', 'plan-storyboard': '正式分镜', 'revise-storyboard': '分镜调整', 'revise-cuts': '镜头拆分调整', 'revise-script': '剧本调整', 'video-prompts': '视频提示词', export: '成片导出', 'apply-draft': '应用分析草稿', 'merge-assets': '合并重复资产', opencut: '剪辑成片', image: '图片生成', video: '视频生成', audio: '音频生成', page: '页面编辑', agent: 'Agent 修改', workflow: '工作流', media: '媒体写回', system: '系统' }
const SOURCE_LABELS = { page: '页面', agent: 'Agent', workflow: '工作流', media: '媒体', restore: '还原', system: '系统' }
const RESOURCE_LABELS = { projects: '项目', episodes: '剧集', dialogues: '对白', assets: '资产', shots: '镜头', clips: '片段', films: '成片', folders: '文件夹', library: '素材', audio: '音频', voices: '音色', prompts: '提示词' }
const OP_LABELS = { create: '新增', update: '修改', delete: '删除' }
const STATUS = { restorable: ['可还原', 'ok'], partial: ['部分可还原', 'warn'], conflict: ['之后已被修改', 'warn'], unchanged: ['已是修改前内容', 'muted'], unsupported: ['不支持还原', 'muted'], restored: ['已还原', 'muted'] }
const FIELD_STATUS = { conflict: '之后已被修改，不会还原', unsupported: '不支持还原' }
const REASONS = { 'already-restored': '已还原过', 'project-lifecycle': '不支持还原项目的新建或删除', missing: '记录已不存在', 'changed-later': '之后已被修改', exists: '记录已重新存在', partial: '部分字段之后已被修改，已保留这些字段', 'in-use': '仍被其他内容引用，未删除', conflict: '之后已被修改', unchanged: '已是修改前内容', unsupported: '不支持还原' }
const TABS = [{ value: 'ai', label: 'AI 修改', sources: 'agent,workflow' }, { value: 'page', label: '页面编辑', sources: 'page' }, { value: 'all', label: '全部' }]
const FIELDS = { core: '故事内核', story: '完整故事主线', keep: '保留', remove: '砍掉', merge: '合并', risks: '风险', roles: '角色', props: '关键道具', position: '身份与作用', relationships: '人物关系', arc: '人物变化', involvement: '涉及人物 / 事件', title: '标题', name: '名称', summary: '简介', cover: '封面', ratio: '画幅', requirements: '创作要求', outline: '大纲', duration: '时长', number: '集数', script: '剧本', scenes: '场次', stage: '阶段', sourceVideo: '原片', creationMode: '创作模式', targetRegion: '目标地区', targetLanguage: '目标语言', type: '类型', role: '定位', alias: '别名', description: '描述', appearance: '外貌特征', costume: '服装', voiceDescription: '声音描述', image: '图片', prompt: '提示词', variants: '衍生状态', history: '图片历史', voiceId: '音色', references: '参考素材', dependencies: '依赖资产', imageDependencies: '生图依赖', source: '来源', episodeIds: '所属剧集', episodeId: '剧集', projectId: '项目', assetIds: '关联资产', assetId: '资产', sceneId: '场次', scale: '景别', camera: '运镜', transition: '转场', dialogue: '对白', effects: '音效', imageHistory: '图片历史', storyboardPrompt: '分镜图提示词', clipId: '所属片段', shotIds: '包含镜头', currentVideo: '选用视频', videos: '生成视频', model: '模型', resolution: '分辨率', mode: '模式', firstFrame: '首帧', lastFrame: '尾帧', storyboardImage: '分镜图', storyboardHistory: '分镜图历史', blocking: '走位', blockingImage: '走位图', blockingHistory: '走位图历史', idCode: '编号', sourceText: '原台词', targetText: '目标台词', sourceSpeaker: '原说话人', targetSpeaker: '目标说话人', sourceStart: '原片开始', sourceEnd: '原片结束', tone: '语气', note: '备注', estimatedSeconds: '预估时长', plannedSeconds: '计划时长', timingStatus: '时长状态', text: '内容', defaultText: '默认内容', group: '分组', url: '地址', location: '地点', setting: '内外景', time: '时间', suggestedDuration: '建议时长', content: '正文', speaker: '说话人', purpose: '用途', variantId: '形态', language: '语言', gender: '性别', favorite: '收藏', folderId: '文件夹', assets: '资产', shots: '镜头', clips: '片段', changes: '修改建议', notes: '说明', reason: '原因', values: '修改内容', shotId: '镜头', existingId: '已有资产', key: '标识', sceneKey: '场次', originalDescription: '原片描述', start: '开始', end: '结束', asset: '资产', variant: '形态', openItems: '待确认事项', conflicts: '冲突', globalStart: '开始时间', globalEnd: '结束时间', sourceDescription: '原画面描述', sourceDialogue: '原对白' }
const RESOURCE_FIELDS = { assets: { description: '主体说明', prompt: '生图提示词' }, shots: { description: '画面描述', image: '分镜图' }, clips: { description: '片段描述', prompt: '视频提示词' }, prompts: { text: '提示词内容' } }
const REFS = { assetIds: 'assets', assetId: 'assets', episodeIds: 'episodes', episodeId: 'episodes', projectId: 'projects', shotIds: 'shots', shotId: 'shots', existingId: 'assets', clipId: 'clips', voiceId: 'voices', folderId: 'folders' }
const MEDIA = new Set(['image', 'cover', 'storyboardImage', 'blockingImage'])
const COUNT_ONLY = new Set(['history', 'imageHistory', 'storyboardHistory', 'blockingHistory', 'videos', 'excludedFrameUrls'])

export const fieldLabel = (field, resource) => RESOURCE_FIELDS[resource]?.[field] || FIELDS[field] || field
const canonical = value => JSON.stringify(value ?? null, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const same = (a, b) => canonical(a) === canonical(b)
const empty = value => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
const primitives = value => empty(value) || (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object'))
const keyed = value => empty(value) || (Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.id === 'string'))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const itemTitle = (item, index) => [item?.setting, item?.location, item?.time].filter(Boolean).join(' ') || item?.name || item?.title || item?.speaker || item?.text?.slice?.(0, 24) || `第 ${index + 1} 项`

/** id → 当前名称；记录被删除后仍显示原编号。 */
export function useRecordNames() {
  const { data } = useStore()
  return useMemo(() => {
    const names = new Map(), numbers = new Map(data.episodes.map(item => [item.id, item.number]))
    data.projects.forEach(item => names.set(`projects:${item.id}`, item.title || '未命名项目'))
    data.episodes.forEach(item => names.set(`episodes:${item.id}`, `第${item.number}集`))
    data.assets.forEach(item => names.set(`assets:${item.id}`, item.name))
    for (const resource of ['shots', 'clips']) {
      const counts = new Map()
      data[resource].forEach(item => {
        const index = (counts.get(item.episodeId) || 0) + 1
        counts.set(item.episodeId, index)
        names.set(`${resource}:${item.id}`, `第${numbers.get(item.episodeId) ?? '?'}集 ${resource === 'shots' ? '镜头' : '片段'}${index}${item.title ? ` ${item.title}` : ''}`)
      })
    }
    data.voices.forEach(item => names.set(`voices:${item.id}`, item.name))
    data.folders.forEach(item => names.set(`folders:${item.id}`, item.name))
    return (resource, id) => names.get(`${resource}:${id}`)
  }, [data])
}

function entryTitle(resource, label = {}, id) {
  const episode = label.episode ? `第${label.episode}集` : ''
  if (resource === 'shots') return `${episode} 镜头${label.index || ''}`.trim()
  if (resource === 'clips') return [`${episode} 片段${label.index || ''}`.trim(), label.name].filter(Boolean).join(' · ')
  if (resource === 'dialogues') return [episode, '对白', label.name].filter(Boolean).join(' ')
  if (resource === 'episodes') return [episode, label.name].filter(Boolean).join(' ') || id
  return label.name || id
}
// find 按日志 id 查已加载的批次。还原沿链找到最初的修改批次：奇数层把内容恢复到修改前，偶数层又回到修改后；链未加载全时退回修改类型。
function batchTitle(item, find) {
  if (item.source === 'restore') {
    let depth = 1, origin = find?.(item.restoreOf)
    while (origin?.source === 'restore') { depth += 1; origin = find(origin.restoreOf) }
    return origin ? `${depth % 2 ? '还原' : '撤销还原'}「${batchTitle(origin)}」` : `还原「${KIND_LABELS[item.kind] || item.kind || '修改'}」`
  }
  if (item.source === 'agent') return item.agentName ? `${item.agentName} 的修改` : 'Agent 对话修改'
  if (item.source === 'media') return `${KIND_LABELS[item.kind] || '媒体'}结果写回`
  return KIND_LABELS[item.kind] || KIND_LABELS[item.source] || item.source
}

function RefChip({ resource, id, names, tone = '' }) {
  const name = names(resource, id)
  return <span className={`change-chip ${tone}`} title={id}>{tone === 'added' ? '+ ' : tone === 'removed' ? '− ' : ''}{name || id}{!name && <small>（已不存在）</small>}</span>
}
export function ChangeValue({ field, value, names, resource, depth = 0 }) {
  if (empty(value)) return <span className="change-empty">（空）</span>
  if (REFS[field]) return <span className="change-chips">{(Array.isArray(value) ? value : [value]).map(id => <RefChip key={id} resource={REFS[field]} id={id} names={names} />)}</span>
  if (COUNT_ONLY.has(field) && Array.isArray(value)) return <span>{value.length} 项</span>
  if (MEDIA.has(field) && typeof value === 'string') return <a className="change-media" href={value} target="_blank" rel="noreferrer"><img src={imageUrl(value, 160)} alt={fieldLabel(field, resource)} loading="lazy" /></a>
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>
  if (typeof value !== 'object') return <p className="change-text">{String(value)}</p>
  if (primitives(value)) return <span className="change-chips">{value.map((item, index) => <span key={index} className="change-chip">{String(item)}</span>)}</span>
  // 列表逐项展示；过深或过长的对象（如原片切镜数据）折叠为 JSON。
  if (depth > 2 || (!Array.isArray(value) && JSON.stringify(value).length > 6000)) return <details className="change-long"><summary>内容较长，展开查看</summary><pre className="change-json">{JSON.stringify(value, null, 2)}</pre></details>
  if (Array.isArray(value)) return <ol className="change-items">{value.map((item, index) => <li key={item?.id || index}>{item && typeof item === 'object' ? <><strong>{itemTitle(item, index)}</strong><ChangeFields value={item} names={names} depth={depth + 1} /></> : <ChangeValue field={field} value={item} names={names} depth={depth + 1} />}</li>)}</ol>
  return <ChangeFields value={value} names={names} resource={resource} depth={depth + 1} />
}
export function ChangeFields({ value, names, resource, depth = 0, hide = [] }) {
  const entries = Object.entries(value || {}).filter(([key, item]) => key !== 'id' && !hide.includes(key) && !empty(item))
  if (!entries.length) return null
  return <dl className="change-fields">{entries.map(([key, item]) => <div key={key}><dt>{fieldLabel(key, resource)}</dt><dd><ChangeValue field={key} value={item} names={names} resource={resource} depth={depth} /></dd></div>)}</dl>
}
function Compare({ before, after }) {
  return <div className="change-compare"><div><small>修改前</small>{before}</div><div><small>修改后</small>{after}</div></div>
}
function ItemsDiff({ before = [], after = [], names }) {
  const prev = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]))
  const rows = [...after.flatMap((item, index) => !prev.has(item.id) ? [{ op: 'create', item, index }] : same(prev.get(item.id), item) ? [] : [{ op: 'update', item, index, old: prev.get(item.id) }]), ...before.flatMap((item, index) => next.has(item.id) ? [] : [{ op: 'delete', item, index }])]
  if (!rows.length) return <p className="change-empty">仅调整了顺序</p>
  return <ol className="change-items">{rows.map(row => <li key={`${row.op}:${row.item.id}`}>
    <div className="change-item-head"><span className={`change-op ${row.op}`}>{OP_LABELS[row.op]}</span><strong>{itemTitle(row.item, row.index)}</strong></div>
    {row.op === 'update' ? Object.keys({ ...row.old, ...row.item }).filter(key => key !== 'id' && !same(row.old[key], row.item[key])).map(key => <div key={key} className="change-subfield"><small>{fieldLabel(key)}</small><Compare before={<ChangeValue field={key} value={row.old[key]} names={names} depth={1} />} after={<ChangeValue field={key} value={row.item[key]} names={names} depth={1} />} /></div>) : <ChangeFields value={row.item} names={names} depth={1} />}
  </li>)}</ol>
}
function FieldDiff({ resource, field, before, after, status, names }) {
  const list = Array.isArray(before) || Array.isArray(after)
  let body
  if (list && primitives(before) && primitives(after)) {
    const prev = before || [], next = after || []
    const added = next.filter(item => !prev.includes(item)), removed = prev.filter(item => !next.includes(item))
    body = !added.length && !removed.length ? <p className="change-empty">仅调整了顺序</p>
      : COUNT_ONLY.has(field) || !REFS[field] && added.length + removed.length > 12 ? <p className="change-text">新增 {added.length} 项，移除 {removed.length} 项</p>
        : <div className="change-chips">{added.map(item => REFS[field] ? <RefChip key={`+${item}`} resource={REFS[field]} id={item} names={names} tone="added" /> : <span key={`+${item}`} className="change-chip added">+ {String(item)}</span>)}{removed.map(item => REFS[field] ? <RefChip key={`-${item}`} resource={REFS[field]} id={item} names={names} tone="removed" /> : <span key={`-${item}`} className="change-chip removed">− {String(item)}</span>)}</div>
  } else if (list && keyed(before) && keyed(after)) body = <ItemsDiff before={before || []} after={after || []} names={names} />
  else body = <Compare before={<ChangeValue field={field} value={before} names={names} resource={resource} />} after={<ChangeValue field={field} value={after} names={names} resource={resource} />} />
  return <section className="change-field"><div className="change-field-head"><strong>{fieldLabel(field, resource)}</strong>{FIELD_STATUS[status] && <span className="change-status warn">{FIELD_STATUS[status]}</span>}</div>{body}</section>
}
// undo：所在批次本身是一次还原，对它再还原即撤销，文案相应改为“撤销”。
function Entry({ entry, undo, names, busy, onRestore }) {
  const [label, tone] = undo && entry.status === 'restored' ? ['已撤销', 'muted'] : STATUS[entry.status] || [entry.status, 'muted']
  const note = entry.reason && entry.status !== 'restored' ? REASONS[entry.reason] || entry.reason : ''
  return <li className="change-entry">
    <div className="change-entry-head">
      <span className={`change-op ${entry.op}`}>{OP_LABELS[entry.op]}</span>
      <span className="change-entry-title"><small>{RESOURCE_LABELS[entry.resource] || entry.resource}</small>{entryTitle(entry.resource, entry.label, entry.id)}</span>
      <span className={`change-status ${tone}`}>{label}</span>
      {['restorable', 'partial'].includes(entry.status) && <Button disabled={busy} onClick={onRestore}>{undo ? '撤销此项' : '还原此项'}</Button>}
    </div>
    {note && note !== label && <p className="change-note">{note}</p>}
    {entry.op === 'update' ? Object.keys(entry.after || {}).map(field => <FieldDiff key={field} resource={entry.resource} field={field} before={entry.before?.[field]} after={entry.after[field]} status={entry.status === 'partial' ? entry.fields?.[field] : undefined} names={names} />)
      : <details className="change-long"><summary>{entry.op === 'create' ? '本次新建，还原时删除。查看内容' : '本次删除，还原时重新创建。查看内容'}</summary><ChangeFields value={entry.op === 'create' ? entry.after : entry.before} names={names} resource={entry.resource} hide={['projectId', 'episodeId']} /></details>}
  </li>
}
function RestoreResult({ result, undo }) {
  return <div className="change-result" role="status">
    <p>{result.repeated ? '该还原请求已执行过。' : result.restored ? `已${undo ? '撤销' : '还原'} ${result.restored} 项，可在「全部」中撤销这次操作。` : '没有还原任何内容。'}{result.skipped?.length ? `以下 ${result.skipped.length} 项已跳过或部分保留：` : ''}</p>
    {!!result.skipped?.length && <ul>{result.skipped.map(skip => <li key={`${skip.index}:${skip.reason}`}>{RESOURCE_LABELS[skip.resource] || skip.resource} {entryTitle(skip.resource, skip.label, `#${skip.index + 1}`)} — {REASONS[skip.reason] || skip.reason}{skip.fields?.length ? `（${skip.fields.map(field => fieldLabel(field, skip.resource)).join('、')}）` : ''}</li>)}</ul>}
  </div>
}

function Batch({ item, find, projectId, names, onChanged }) {
  const { reload, notify } = useStore()
  const [open, setOpen] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(null), [result, setResult] = useState(null), [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    studioApi(`studio/change-log?${new URLSearchParams({ ...(projectId ? { projectId } : {}), id: String(item.id) })}`, undefined, controller.signal)
      .then(value => { setDetail(value); setError('') })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [open, projectId, item.id, item.restoredCount, revision])
  async function restore(entries) {
    setConfirm(null); setBusy(true); setError(''); setResult(null)
    try {
      const value = await studioApi('studio/change-log/restore', { requestId: crypto.randomUUID(), ...(projectId ? { projectId } : {}), id: item.id, ...(entries ? { entries } : {}) })
      setResult(value); setRevision(current => current + 1)
      await reload().catch(() => undefined)
      onChanged()
      notify(value.restored ? `已${undo ? '撤销' : '还原'} ${value.restored} 项修改` : '没有可还原的修改')
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  const restoredAll = item.restoredCount >= item.count, undo = item.source === 'restore'
  const nothingLeft = detail?.entries && !detail.entries.some(entry => ['restorable', 'partial'].includes(entry.status))
  const summary = (item.labels || []).map(label => entryTitle(label.resource, label.label, RESOURCE_LABELS[label.resource])).join('、')
  const title = batchTitle(item, find)
  return <article className="change-batch">
    <header className="change-batch-head">
      <span className={`change-source ${item.source}`}>{SOURCE_LABELS[item.source] || item.source}</span>
      <strong>{title}</strong>
      <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
    </header>
    <p className="change-batch-summary">{Object.entries(item.resources || {}).map(([resource, count]) => `${RESOURCE_LABELS[resource] || resource} ${count}`).join(' · ')}{summary && <span> — {summary}{item.count > (item.labels || []).length ? ` 等 ${item.count} 项` : ''}</span>}</p>
    <div className="change-batch-foot">
      {item.restoredCount > 0 && <span className="change-status muted">{restoredAll ? (undo ? '已撤销' : '已全部还原') : `${undo ? '已撤销' : '已还原'} ${item.restoredCount}/${item.count}`}</span>}
      <button type="button" className="change-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起' : `查看 ${item.count} 项修改`}</button>
      <Button disabled={busy || restoredAll || nothingLeft} onClick={() => setConfirm({})}>{busy ? '正在还原…' : undo ? '撤销这次还原' : '整批还原'}</Button>
    </div>
    {error && <p className="change-error" role="alert">{error}</p>}
    {result && <RestoreResult result={result} undo={undo} />}
    {open && (detail ? <ol className="change-entries">{detail.entries.map(entry => <Entry key={entry.index} entry={entry} undo={undo} names={names} busy={busy} onRestore={() => setConfirm({ entry })} />)}</ol> : !error && <p className="change-empty">正在读取修改内容…</p>)}
    {confirm && <Confirm title={confirm.entry ? (undo ? '撤销此项还原' : '还原此项修改') : undo ? '撤销这次还原' : '整批还原'} onClose={() => setConfirm(null)} onConfirm={() => restore(confirm.entry ? [confirm.entry.index] : undefined)}>
      <p>{confirm.entry ? `将把「${entryTitle(confirm.entry.resource, confirm.entry.label, confirm.entry.id)}」恢复到这次修改之前。` : `将把「${title}」写入的 ${item.count} 项内容恢复到修改之前。`}只还原仍保持本次修改结果的字段；之后被页面或 Agent 再次修改的内容会跳过并列出原因。还原本身也会记入变更日志，可以再撤销。</p>
    </Confirm>}
  </article>
}

export function ChangeLog({ projectId, onClose }) {
  const { data } = useStore()
  const names = useRecordNames()
  const [scope, setScope] = useState(projectId || ''), [tab, setTab] = useState('ai')
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [loading, setLoading] = useState(true), [more, setMore] = useState(false), [error, setError] = useState('')
  const refresh = useRef(() => undefined)
  const sources = TABS.find(item => item.value === tab).sources
  const query = extra => `studio/change-log?${new URLSearchParams({ ...(scope ? { projectId: scope } : {}), ...(sources ? { sources } : {}), ...extra })}`
  useEffect(() => {
    let first = true
    setItems([]); setCursor(null); setLoading(true); setError('')
    // 打开期间保持第一页最新，Agent 正在批量修改时也能看到新记录；已加载的更早记录保留。
    const load = async signal => {
      const page = await studioApi(query(), undefined, signal)
      if (signal?.aborted) return
      setItems(current => { const oldest = page.items.at(-1)?.id ?? Infinity; return first ? page.items : [...page.items, ...current.filter(item => item.id < oldest)] })
      if (first) setCursor(page.nextCursor)
      first = false; setLoading(false); setError('')
    }
    const controller = new AbortController()
    refresh.current = () => load(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    const stop = startPolling(load, 5000, reason => { setError(reason.message); setLoading(false) })
    return () => { controller.abort(); stop() }
  }, [scope, sources])
  const find = id => items.find(item => item.id === id)
  async function loadMore() {
    setMore(true)
    try {
      const page = await studioApi(query({ cursor }))
      setItems(current => [...current, ...page.items.filter(item => !current.some(existing => existing.id === item.id))]); setCursor(page.nextCursor)
    } catch (reason) { setError(reason.message) } finally { setMore(false) }
  }
  return <Modal title="变更日志" drawer onClose={onClose} panelClassName="change-log-panel" bodyClassName="change-log-body">
    <div className="change-log-toolbar">
      <label><span>范围</span><select aria-label="日志范围" value={scope} onChange={event => setScope(event.target.value)}>
        <option value="">全局资源（提示词、素材库、音色）</option>
        {data.projects.map(project => <option key={project.id} value={project.id}>{project.title || '未命名项目'}</option>)}
      </select></label>
      <button type="button" className="icon-btn" aria-label="刷新日志" onClick={() => refresh.current()}><IconRefresh size={18} /></button>
    </div>
    <Tabs label="日志来源" items={TABS} value={tab} onChange={setTab} />
    <p className="change-log-hint">每次写入记为一条记录。还原只恢复仍保持当时修改结果的内容，之后又被改过的部分会跳过并说明原因。</p>
    {error && <p className="change-error" role="alert">{error}</p>}
    {loading ? <p className="change-empty">正在读取变更日志…</p> : !items.length ? <p className="change-empty">{tab === 'ai' ? '暂无 Agent 或工作流的修改记录。' : '暂无修改记录。'}</p>
      : <div className="change-batches">{items.map(item => <Batch key={item.id} item={item} find={find} projectId={scope} names={names} onChanged={() => refresh.current()} />)}</div>}
    {cursor && <Button disabled={more} onClick={loadMore}>{more ? '正在加载…' : '加载更早的记录'}</Button>}
  </Modal>
}
