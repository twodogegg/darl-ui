import { useEffect, useRef, useState } from 'react'
import { IconGripVertical } from '@tabler/icons-react'
import { imageUrl } from '../../image-url'
import { Button, Confirm, FileButton, MediaPreview, Modal } from './ui'
import DialogueEditor from './DialogueEditor'
import { useStore } from '../store'
import { BLOCKING_COLUMNS, shotNumber, totalDuration } from '../storyboard'
import { FIRST_SHOT_TRANSITION, shotOptionValue, shotOptions } from '../../../studio-schema'
import { assetMentionCandidates, validateAssetMentions } from '../../../asset-mentions'
import AssetMentionInput from './AssetMentionInput'

function ShotInput({ value, version, label, multiline = false, number = false, onCommit, validate }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const { notify } = useStore()
  const base = useRef({ value: String(value ?? ''), version })
  useEffect(() => { if (draft === base.current.value) { setDraft(String(value ?? '')); base.current = { value: String(value ?? ''), version } } }, [value, version])
  const Tag = multiline ? 'textarea' : 'input'
  return <Tag aria-label={label} value={draft} placeholder="—" rows={multiline ? 3 : undefined} type={number ? 'number' : undefined} min={number ? 0.1 : undefined} step={number ? '0.1' : undefined} maxLength={number ? undefined : 10000} onChange={(e) => setDraft(e.target.value)} onBlur={() => {
    if (draft === base.current.value) return
    if (version !== base.current.version) { notify('镜头已被其他操作修改，当前输入已保留。按 Escape 恢复最新值后可重新编辑。'); return }
    const error = validate?.(draft)
    if (error) { notify(error); setDraft(String(value ?? '')); return }
    onCommit(number ? Number(draft) : draft)
    base.current = { value: draft, version: version + 1 }
  }} onKeyDown={event => { if (event.key === 'Escape') { setDraft(String(value ?? '')); base.current = { value: String(value ?? ''), version } } }} />
}
function MentionShotInput({ value, version, label, candidates, onCommit }) {
  const [draft, setDraft] = useState(String(value || ''))
  const { notify } = useStore()
  const base = useRef({ value: String(value || ''), version })
  useEffect(() => { if (draft === base.current.value) { setDraft(String(value || '')); base.current = { value: String(value || ''), version } } }, [value, version])
  return <AssetMentionInput value={draft} label={label} placeholder="画面与动作，键入 @ 引用资产…" candidates={candidates} onChange={(text) => setDraft(text)} onBlur={(text) => {
    if (text === base.current.value) return
    if (version !== base.current.version) { notify('镜头已被其他操作修改，当前输入已保留。按 Escape 恢复最新值后可重新编辑。'); return }
    const error = validateAssetMentions(text, candidates)
    if (error) { notify(error); return }
    onCommit(text)
    base.current = { value: text, version: version + 1 }
  }} />
}

const shotFields = [['scale', '景别'], ['camera', '运镜'], ['transition', '切镜方式']]

/** 画面与动作的放大编辑弹窗：与表格内同一个 @ 引用编辑器，仅编辑空间更大。 */
function ShotDescriptionModal({ shot, label, candidates, onClose, onSave }) {
  const { notify } = useStore()
  const [draft, setDraft] = useState(String(shot.description || ''))
  const [version] = useState(shot._version)
  function save() {
    if (shot._version !== version) return notify('镜头已被其他操作修改，当前画面草稿已保留，请核对后重新打开')
    const error = validateAssetMentions(draft, candidates)
    if (error) return notify(error)
    onSave(draft)
  }
  return (
    <Modal title={`${label}与动作`} onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button primary onClick={save}>保存</Button></>}>
      <div className="segment-shot-zoom">
        <AssetMentionInput value={draft} label={label} placeholder="画面与动作，键入 @ 引用资产…" candidates={candidates} onChange={setDraft} />
      </div>
    </Modal>
  )
}

/**
 * 景别 / 运镜 / 切镜的下拉选择。选项来自共享的 shotOptions；
 * 历史自由描述不在选项里时保留为“自定义”并原样显示，选中标准选项后即被替换。
 */
function ShotSelect({ field, value, label, onChange, disabled, hint }) {
  const current = shotOptionValue(field, value)
  const options = shotOptions[field]
  const custom = !options.includes(current)
  // 首镜的切镜方式固定为破折号，不提供其他选项。
  if (field === 'transition' && disabled) return <span className="segment-shot-first">—</span>
  return <select
    className={`segment-shot-select${custom ? ' is-custom' : ''}`}
    aria-label={label}
    title={custom ? `历史自定义描述：${current}，可改为标准选项` : undefined}
    value={current}
    onChange={(event) => onChange(event.target.value)}
  >
    {!current && <option value="">待选</option>}
    {custom && <option value={current}>{current.length > 12 ? `${current.slice(0, 12)}…` : current}（自定义）</option>}
    {options.filter(option => option !== FIRST_SHOT_TRANSITION).map(option => <option key={option} value={option}>{option}</option>)}
  </select>
}

/** 初始站位与状态：文字描述片段开始前的人物、道具与相机状态，可补站位参考图。 */
export function BlockingEditor({ clip }) {
  const { patch, notify } = useStore()
  const [draft, setDraft] = useState(clip.blocking || '')
  const [preview, setPreview] = useState(null)
  const base = useRef({ value: clip.blocking || '', version: clip._version })
  useEffect(() => {
    if (draft === base.current.value) { setDraft(clip.blocking || ''); base.current = { value: clip.blocking || '', version: clip._version } }
  }, [clip.blocking, clip._version])
  const changed = draft !== base.current.value
  function save() {
    if (!changed) return
    if (clip._version !== base.current.version) return notify('片段已被其他操作修改，当前填写已保留，请核对后重新编辑')
    patch('clips', clip.id, { blocking: draft })
    base.current = { value: draft, version: clip._version + 1 }
  }
  const column = BLOCKING_COLUMNS[0]
  const history = clip[column.history] || []
  const saveImage = (url) => patch('clips', clip.id, { [column.key]: url, [column.history]: [url, ...history.filter(item => item !== url)] })
  return (
    <section className="segment-blocking" aria-label="初始站位与状态">
      <div className="segment-blocking-body">
        <div className="segment-blocking-field">
          <div className="row"><h3>初始站位与状态</h3>{changed && <small>离开输入框后自动保存</small>}</div>
          <textarea aria-label="初始站位与状态" rows={4} maxLength={4000} value={draft} placeholder="例如：女主站在门外右侧，面向房门，右手抬起但尚未敲门；男主坐在室内桌旁；相机位于走廊。" onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === 'Escape') setDraft(base.current.value) }} />
        </div>
        <div className="segment-blocking-image">
          <span className="asset-mention-label">站位图</span>
          {clip[column.key] ? <button type="button" className="segment-blocking-thumb" onClick={() => setPreview({ name: '站位图', url: clip[column.key], kind: 'image' })}><img loading="lazy" src={imageUrl(clip[column.key], 320)} alt="站位图" /></button> : <div className="segment-blocking-thumb segment-blocking-thumb--empty">可选</div>}
          <div className="segment-blocking-image-actions">
            <FileButton kind="image" onSelect={(item) => saveImage(item.url)}>{clip[column.key] ? '替换' : '上传'}</FileButton>
            {clip[column.key] && <Button size="sm" variant="ghost" onClick={() => patch('clips', clip.id, { [column.key]: '' })}>移除</Button>}
          </div>
          {history.length > 1 && <select aria-label="站位图历史" value={clip[column.key]} onChange={(event) => patch('clips', clip.id, { [column.key]: event.target.value })}>{history.map((url, index) => <option key={`${url}-${index}`} value={url}>{`版本 ${history.length - index}`}</option>)}</select>}
        </div>
      </div>
      {preview && <MediaPreview item={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}

/**
 * 当前片段内的镜头列表。镜头记录仍归属剧集与场次，这里按片段 shotIds 展示与编辑；
 * 分镜图生成结果归属对应 Shot，不影响其他镜头。
 */
export default function ShotList({ clip, shots, shotsIndex, characters, projectAssets, busy, busyShotId, onGenerateImage, onCommit, onAdd, onRemove, onDelete, onMove }) {
  const { patch } = useStore()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [preview, setPreview] = useState(null)
  const [zooming, setZooming] = useState(null)
  const [insertedId, setInsertedId] = useState(null)
  const [dragging, setDragging] = useState(null)
  const drag = useRef(null)
  const list = useRef(null)
  useEffect(() => {
    if (!insertedId) return
    const row = list.current?.querySelector(`[data-shot-id="${insertedId}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    setInsertedId(null)
  }, [insertedId])
  // 按 shot.id 定位：拖拽开始时保存的是 snapshot，期间片段数据刷新后旧对象不在新数组里。
  function reorder(shotId, targetId, after) {
    const from = shots.findIndex(item => item.id === shotId)
    const target = shots.findIndex(item => item.id === targetId)
    if (from < 0 || target < 0 || from === target) return
    onMove(shotId, target + (after ? 1 : 0))
  }
  function startDrag(event, shot) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { shot, startY: event.clientY }
  }
  function moveDrag(event) {
    const current = drag.current
    if (!current || (!current.active && Math.abs(event.clientY - current.startY) < 5)) return
    current.active = true
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr[data-shot-id]')
    const target = shots.find(item => item.id === row?.dataset.shotId)
    current.target = target && target.id !== current.shot.id ? target : null
    current.after = !!row && event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
    setDragging({ sourceId: current.shot.id, targetId: current.target?.id, after: current.after })
  }
  function finishDrag(cancel = false) {
    const current = drag.current
    drag.current = null
    setDragging(null)
    if (current && !cancel) reorder(current.shot.id, current.target?.id, current.after)
  }
  const activeDialogue = editing && shots.find(shot => shot.id === editing)
  // 弹窗与表格内编辑器共用同一份候选，保证 @ 引用解析一致。
  const shotCandidates = shot => assetMentionCandidates(projectAssets, { assetIds: [...(shot.assetIds || []), ...(Array.isArray(shot.dialogue) ? shot.dialogue : []).map(line => line.assetId).filter(Boolean)] })
  const activeZoom = zooming && shots.find(shot => shot.id === zooming)
  return (
    <section className="segment-shots" aria-label="片段镜头">
      <div className="segment-shots-head">
        <div><h3>镜头（{shots.length}）</h3><p className="muted">镜头合计 {totalDuration(shots)} 秒 · 每个镜头可单独生成分镜图</p></div>
        <div className="toolbar">
          {shots.some(shot => !shot.image) && <Button size="sm" disabled={busy} onClick={() => shots.filter(shot => !shot.image).forEach(shot => onGenerateImage(shot))}>批量为缺图镜头生图</Button>}
          <Button size="sm" primary disabled={busy} onClick={() => setInsertedId(onAdd(clip.shotIds.at(-1)))}>＋ 新增镜头</Button>
        </div>
      </div>
      {!shots.length && <p className="empty">本片段还没有镜头。新增镜头，或从“未关联镜头”列表分配已有镜头。</p>}
      <div className="segment-shot-table-wrap">
        <table ref={list} className="segment-shot-table" aria-label="片段镜头列表">
          <thead><tr><th scope="col">编号</th><th scope="col">分镜图</th><th scope="col">景别 / 运镜 / 切镜</th><th scope="col">画面与动作</th><th scope="col">台词 / 音效</th><th scope="col">时长</th></tr></thead>
          <tbody>
            {shots.map((shot, index) => {
              const isGenerating = busyShotId === shot.id
              const candidates = shotCandidates(shot)
              const dialogue = Array.isArray(shot.dialogue) ? shot.dialogue : []
              return <tr key={shot.id} data-shot-id={shot.id} className={`${dragging?.sourceId === shot.id ? 'shot-row-dragging' : ''} ${dragging?.targetId === shot.id ? dragging.after ? 'shot-drop-after' : 'shot-drop-before' : ''}`}>
                <th scope="row" className="segment-shot-identity">
                  <div className="segment-shot-identity-head"><strong>{shotNumber(index)}</strong><small>全片 {shotNumber(shotsIndex(shot))}</small></div>
                  <div className="segment-shot-actions">
                    <button className="shot-drag-handle" aria-label={`拖动镜头${shotNumber(index)}排序`} title="拖动调整片段内顺序，也可用键盘上下方向键" onPointerDown={(event) => startDrag(event, shot)} onPointerMove={moveDrag} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onKeyDown={(event) => {
                      if (event.key === 'Escape') finishDrag(true)
                      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
                      event.preventDefault()
                      const offset = event.key === 'ArrowUp' ? -1 : 1
                      reorder(shot.id, shots[index + offset]?.id, offset > 0)
                    }}><IconGripVertical size={16} /></button>
                    <div className="segment-shot-move">
                      <button aria-label={`上移镜头${shotNumber(index)}`} title="上移" disabled={index === 0 || busy} onClick={() => reorder(shot.id, shots[index - 1]?.id, false)}>↑</button>
                      <button aria-label={`下移镜头${shotNumber(index)}`} title="下移" disabled={index === shots.length - 1 || busy} onClick={() => reorder(shot.id, shots[index + 1]?.id, true)}>↓</button>
                    </div>
                    <button aria-label={`在镜头${shotNumber(index)}后新增分镜`} title="在此镜后新增分镜" disabled={busy} onClick={() => setInsertedId(onAdd(shot.id))}>＋</button>
                    <button aria-label={`从片段移除镜头${shotNumber(index)}`} title="从片段移除，镜头记录保留" onClick={() => onRemove(shot)}>⇤</button>
                    <button aria-label={`删除镜头${shotNumber(index)}`} title="删除镜头记录" onClick={() => setDeleting(shot)}>×</button>
                  </div>
                </th>
                <td className="segment-shot-image-cell">
                  {shot.image ? <button className="segment-shot-image" aria-label={`查看镜头${shotNumber(index)}分镜图`} onClick={() => setPreview({ name: `镜头 ${shotNumber(index)} 分镜图`, url: shot.image, kind: 'image' })}><img loading="lazy" src={imageUrl(shot.image, 320)} alt={`镜头${shotNumber(index)}分镜图`} /></button> : <div className="segment-shot-image segment-shot-image--empty">未生成</div>}
                  <div className="segment-shot-image-actions">
                    <Button size="sm" disabled={busy} onClick={() => onGenerateImage(shot)}>{isGenerating ? '生成中…' : shot.image ? '重新生成' : '生成本镜图'}</Button>
                    <FileButton kind="image" disabled={busy} onSelect={(item) => patch('shots', shot.id, { image: item.url, imageHistory: [item.url, ...(shot.imageHistory || [])] })}>上传</FileButton>
                    {(shot.imageHistory || []).length > 1 && <select aria-label={`镜头${shotNumber(index)}分镜图历史`} value={shot.image} onChange={(event) => patch('shots', shot.id, { image: event.target.value })}>{shot.imageHistory.map((url, i) => <option key={`${url}-${i}`} value={url}>{`版本 ${shot.imageHistory.length - i}`}</option>)}</select>}
                  </div>
                </td>
                <td className="segment-shot-fields">
                  {shotFields.map(([key, label]) => <label key={key}><span>{label}</span><ShotSelect
                    label={`镜头${shotNumber(index)} ${label}`}
                    field={key}
                    value={shot[key]}
                    disabled={busy || (key === 'transition' && index === 0)}
                    onChange={(value) => patch('shots', shot.id, { [key]: value })}
                    hint={key === 'transition' && index === 0 ? '首镜' : undefined}
                  /></label>)}
                </td>
                <td className="segment-shot-description">
                  <MentionShotInput key={`${shot.id}-${shot._version}`} version={shot._version} label={`镜头${shotNumber(index)} 画面`} value={shot.description} candidates={candidates} onCommit={(value) => patch('shots', shot.id, { description: value })} />
                  <button className="segment-shot-expand" aria-label={`放大编辑镜头${shotNumber(index)}画面与动作`} onClick={() => setZooming(shot.id)}>放大编辑</button>
                </td>
                <td className="segment-shot-dialogue">
                  <button className="segment-dialogue-summary" aria-label={`编辑镜头${shotNumber(index)}台词`} onClick={() => setEditing(shot.id)}>{dialogue.length ? dialogue.map((line, i) => <p key={i}>{line.type === '旁白' ? '旁白' : line.speaker}｜{line.description || '描述未指定'}｜{line.text}</p>) : <span className="muted">本镜无台词</span>}<em>编辑台词</em></button>
                  <ShotInput version={shot._version} label={`镜头${shotNumber(index)} 音效`} value={shot.effects} multiline onCommit={(value) => patch('shots', shot.id, { effects: value })} />
                </td>
                <td className="segment-shot-duration"><ShotInput version={shot._version} label={`镜头${shotNumber(index)} 时长（秒）`} value={shot.duration} number validate={(value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0 ? '镜头时长须为大于 0 的秒数' : ''} onCommit={(duration) => patch('shots', shot.id, { duration })} /><small>秒</small></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {activeDialogue && <DialogueEditor shot={activeDialogue} characters={characters} onClose={() => setEditing(null)} onSave={(lines) => { patch('shots', editing, { dialogue: lines }); setEditing(null) }} />}
      {activeZoom && <ShotDescriptionModal shot={activeZoom} label={`镜头${shotNumber(shots.findIndex(item => item.id === zooming))} 画面`} candidates={shotCandidates(activeZoom)} onClose={() => setZooming(null)} onSave={(value) => { patch('shots', activeZoom.id, { description: value }); setZooming(null) }} />}
      {preview && <MediaPreview item={preview} onClose={() => setPreview(null)} />}
      {deleting && <Confirm title="删除镜头" danger onClose={() => setDeleting(null)} onConfirm={() => { onDelete(deleting); setDeleting(null) }}>删除后按顺序重新编号；片段会移除该镜头关联，已生成的分镜图与视频保留。</Confirm>}
    </section>
  )
}
