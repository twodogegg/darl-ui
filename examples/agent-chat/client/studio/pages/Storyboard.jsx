import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconGripVertical } from '@tabler/icons-react'
import { useProject, Workflow } from '../components/Shell'
import { Button, Confirm } from '../components/ui'
import DialogueEditor from '../components/DialogueEditor'
import { useStore } from '../store'
import { id } from '../data'
import { formatDialogue, shotNumber, totalDuration } from '../storyboard'
import { episodeScenes, orderedShots, sceneLabel } from '../scenes'
import { SourceEvidence, SourceShotEditor, SupplementShot, sourceTime } from '../components/VideoRedraw'

function ShotInput({ value, version, label, multiline = false, number = false, onCommit, validate }) {
  const [draft, setDraft] = useState(String(value))
  const { notify } = useStore()
  const base = useRef({ value: String(value), version })
  useEffect(() => { if (draft === base.current.value) { setDraft(String(value)); base.current = { value: String(value), version } } }, [value, version])
  const Tag = multiline ? 'textarea' : 'input'
  return <Tag aria-label={label} value={draft} placeholder="—" rows={multiline ? 4 : undefined} type={number ? 'number' : undefined} min={number ? 0.1 : undefined} step={number ? '0.1' : undefined} maxLength={number ? undefined : 10000} onChange={(e) => setDraft(e.target.value)} onBlur={() => {
    if (draft === base.current.value) return
    if (version !== base.current.version) { notify('镜头已被其他操作修改，当前输入已保留。按 Escape 恢复最新值后可重新编辑。'); return }
    const error = validate?.(draft)
    if (error) { notify(error); setDraft(String(value)); return }
    onCommit(number ? Number(draft) : draft)
    base.current = { value: draft, version: version + 1 }
  }} onKeyDown={event => { if (event.key === 'Escape') { setDraft(String(value)); base.current = { value: String(value), version } } }} />
}
const columns = [['scale', '景别'], ['camera', '运镜'], ['transition', '切镜方式'], ['description', '画面']]

export default function Storyboard() {
  const context = useProject()
  return <Workflow context={context}>{context.episode && <ShotTable key={context.episode.id} context={context} />}</Workflow>
}
function ShotTable({ context }) {
  const { data, patch, update, notify, requestAgent } = useStore()
  const navigate = useNavigate()
  const { episode, link, projectId } = context
  const scenes = episodeScenes(episode)
  const shots = orderedShots(data.shots.filter((shot) => shot.episodeId === episode.id), scenes)
  const characters = data.assets.filter((asset) => asset.projectId === projectId && asset.type === '角色')
  const [sceneId, setSceneId] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [sourceEditor, setSourceEditor] = useState(null)
  const [adding, setAdding] = useState(null)
  const [insertedId, setInsertedId] = useState(null)
  const [dragging, setDragging] = useState(null)
  const drag = useRef(null)
  const table = useRef(null)
  useEffect(() => {
    if (!insertedId) return
    const row = table.current?.querySelector(`[data-shot-id="${insertedId}"]`)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    row?.querySelector('input')?.focus({ preventScroll: true })
  }, [insertedId])
  function normalize(draft) {
    const ordered = orderedShots(draft.shots.filter((shot) => shot.episodeId === episode.id), scenes)
    ordered.forEach((shot, index) => { if (!index) shot.transition = '—'; else if (shot.transition === '—') shot.transition = '硬切' })
  }
  function addShot(sceneId, afterId) {
    if (context.project.creationMode === 'video-redraw') { setAdding({ sceneId, afterId }); return }
    const shot = { id: id(), episodeId: episode.id, sceneId, scale: '', camera: '', transition: '硬切', description: '', dialogue: [], effects: '', duration: 4 }
    update((draft) => {
      const after = draft.shots.findIndex((item) => item.id === afterId)
      draft.shots.splice(after < 0 ? draft.shots.length : after + 1, 0, shot)
      normalize(draft)
    })
    setInsertedId(shot.id)
  }
  function reorder(shot, target, after) {
    if (!target || shot.id === target.id || shot.sceneId !== target.sceneId) return
    update((draft) => {
      const [moved] = draft.shots.splice(draft.shots.findIndex((item) => item.id === shot.id), 1)
      const position = draft.shots.findIndex((item) => item.id === target.id)
      draft.shots.splice(position + (after ? 1 : 0), 0, moved)
      normalize(draft)
    })
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
    const scroller = table.current.parentElement
    const bounds = scroller.getBoundingClientRect()
    if (event.clientY < bounds.top + 45) scroller.scrollTop -= 18
    else if (event.clientY > bounds.bottom - 45) scroller.scrollTop += 18
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr[data-shot-id]')
    const target = shots.find((shot) => shot.id === row?.dataset.shotId)
    current.target = target?.sceneId === current.shot.sceneId && target.id !== current.shot.id ? target : null
    current.after = !!row && event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
    setDragging({ sourceId: current.shot.id, targetId: current.target?.id, after: current.after })
  }
  function finishDrag(cancel = false) {
    const current = drag.current
    drag.current = null
    setDragging(null)
    if (current && !cancel) reorder(current.shot, current.target, current.after)
  }
  function confirm() {
    if (!shots.length || shots.some((shot) => !shot.description.trim() || !shot.scale.trim() || !shot.camera.trim())) return notify('请补齐各镜头的景别、运镜和画面')
    patch('episodes', episode.id, { stage: Math.max(episode.stage, 3) })
    navigate(link('/video'))
  }
  return (
    <div className="shot-table-page">
      <header className="workspace-toolbar"><Button onClick={() => requestAgent({ action: 'storyboard', projectId, episodeId: episode.id }).catch(reason => notify(reason.message))}>AI 编写分镜</Button>
        <div className="sb-toolbar-head">
          <h2>分镜脚本</h2>
          <label className="sb-episode-pick"><span>剧集</span><select aria-label="选择剧集" value={episode.id} onChange={(e) => navigate(`/storyboard?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(e.target.value)}`)}>{context.episodes.map((e) => <option key={e.id} value={e.id}>第{e.number}集 · {e.title}</option>)}</select></label>
          <label className="sb-episode-pick"><span>场次</span><select aria-label="筛选场次" value={sceneId} onChange={(e) => setSceneId(e.target.value)}><option value="">全部场次</option>{scenes.map((scene, index) => <option key={scene.id} value={scene.id}>{sceneLabel(scene, index)}</option>)}</select></label>
        </div>
        <p className="muted">{scenes.length} 场 · {shots.length} 个镜头 · 预计 {totalDuration(shots)} 秒</p>
      </header>
      <details className="shot-table-help">
        <summary>填写说明</summary>
        <p>每场沿用剧本的地点、内外景和时间，每行一个镜头。拖动编号旁的手柄调整本场顺序；聚焦手柄后也可用键盘上下方向键排序。点击“＋”在当前镜头后插入分镜，编号自动更新。</p>
        <p>景别说明拍谁及范围；运镜只写固定、推近、拉远、摇、移、跟等运动。切镜方式描述上一镜到本镜的衔接，首镜为“—”，默认硬切。</p>
        <p>台词按“谁说、怎么说、说什么”记录。选择角色资产或旁白，描述中填写语气和发声状态；非语言声音写在音效列。时长为单镜持续秒数，包含对白、动作和停顿。</p>
      </details>
      <div className="shot-table-scroll" role="region" aria-label="分镜表，可横向滚动" tabIndex={0}>
        <table ref={table} className="shot-table" aria-label="分镜表">
          <colgroup>{[94, 150, 120, 180, 340, 360, 240, 100].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
          <thead><tr>{['镜头编号', '景别', '运镜', '切镜方式', '画面', '台词/对白', '音效', '时长（秒）'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          {scenes.filter((scene) => !sceneId || scene.id === sceneId).map((scene) => {
            const group = shots.filter((shot) => shot.sceneId === scene.id)
            return <tbody key={scene.id} aria-label={sceneLabel(scene, scenes.indexOf(scene))}>
              <tr className="shot-scene-heading"><th colSpan={8} scope="rowgroup"><div className="shot-scene-bar"><strong>{sceneLabel(scene, scenes.indexOf(scene))}</strong><span>{group.length} 镜 · {totalDuration(group)} 秒</span><Button onClick={() => addShot(scene.id)}>＋ 新增镜头</Button></div></th></tr>
              {group.map((shot) => {
                const index = shots.indexOf(shot), number = shotNumber(index)
                return <tr key={shot.id} data-shot-id={shot.id} className={`${dragging?.sourceId === shot.id ? 'shot-row-dragging' : ''} ${dragging?.targetId === shot.id ? dragging.after ? 'shot-drop-after' : 'shot-drop-before' : ''}`}>
                  <th scope="row"><strong>{number}</strong>{shot.source && <button className="redraw-shot-link" onClick={() => setSourceEditor(shot.id)}><img src={`${shot.source.frames[0]?.url}?width=160`} alt={`镜头${number}原片`} />{sourceTime(shot.source.start)} – {sourceTime(shot.source.end)}<span>校对切点</span></button>}<div className="shot-row-actions">
                    <button className="shot-drag-handle" aria-label={`拖动镜头${number}排序`} title="拖动调整本场顺序，也可用键盘上下方向键" onPointerDown={(event) => startDrag(event, shot)} onPointerMove={moveDrag} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onKeyDown={(event) => {
                      if (event.key === 'Escape') finishDrag(true)
                      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
                      event.preventDefault()
                      const offset = event.key === 'ArrowUp' ? -1 : 1
                      reorder(shot, group[group.indexOf(shot) + offset], offset > 0)
                    }}><IconGripVertical size={16} /></button>
                    <button aria-label={`在镜头${number}后新增分镜`} title="在此镜后新增分镜" onClick={() => addShot(scene.id, shot.id)}>＋</button>
                    <button aria-label={`删除镜头${number}`} title="删除镜头" onClick={() => setDeleting(shot)}>×</button>
                  </div></th>
                  {columns.map(([key, label]) => <td key={key}>{key === 'description' && shot.source && <><SourceEvidence source={shot.source} /><details><summary>关联原片主体（{shot.assetIds?.length || 0}）</summary>{data.assets.filter(asset => asset.projectId === projectId).map(asset => <label className="redraw-asset-check" key={asset.id}><input type="checkbox" checked={shot.assetIds?.includes(asset.id) || false} onChange={event => patch('shots', shot.id, { assetIds: event.target.checked ? [...new Set([...(shot.assetIds || []), asset.id])] : shot.assetIds.filter(id => id !== asset.id) })} />{asset.type} · {asset.name}</label>)}</details></>}{!index && key === 'transition' ? <span>—</span> : <ShotInput key={`${shot.id}-${key}`} version={shot._version} label={`镜头${number} ${label}`} value={shot[key]} multiline={key === 'description'} onCommit={(value) => patch('shots', shot.id, { [key]: key === 'transition' ? value.trim() || '硬切' : value })} />}</td>)}
                  <td><button className="shot-dialogue-cell" aria-label={`编辑镜头${number}台词`} onClick={() => setEditing(shot.id)}>{!shot.dialogue.length ? '—' : shot.dialogue.map((line) => <p key={line.id}>{formatDialogue(line)}</p>)}<span>编辑台词</span></button></td>
                  <td><ShotInput key={`${shot.id}-effects`} version={shot._version} label={`镜头${number} 音效`} value={shot.effects} multiline onCommit={(value) => patch('shots', shot.id, { effects: value })} /></td>
                  <td><ShotInput key={`${shot.id}-duration`} version={shot._version} label={`镜头${number} 时长（秒）`} value={shot.duration} number validate={(value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0 ? '镜头时长须为大于 0 的秒数' : ''} onCommit={(duration) => patch('shots', shot.id, { duration })} /></td>
                </tr>
              })}
              {!group.length && <tr><td colSpan={8} className="muted">本场暂无镜头，点击“新增镜头”开始编写。</td></tr>}
            </tbody>
          })}
        </table>
        {!scenes.length && <p className="empty">请先在剧本中添加场次。</p>}
      </div>
      <footer className="workspace-footer"><span className="muted">修改自动保存到当前项目 · 总时长 {totalDuration(shots)} 秒</span><Button primary onClick={confirm}>确认分镜，进入视频制作 ↗</Button></footer>
      {editing && shots.some(shot => shot.id === editing) && <DialogueEditor shot={shots.find((shot) => shot.id === editing)} characters={characters} onClose={() => setEditing(null)} onSave={(dialogue) => { patch('shots', editing, { dialogue }); setEditing(null) }} />}
      {sourceEditor && shots.find(shot => shot.id === sourceEditor)?.source && <SourceShotEditor context={context} shot={shots.find(shot => shot.id === sourceEditor)} onClose={() => setSourceEditor(null)} />}
      {adding && <SupplementShot context={context} {...adding} onClose={() => setAdding(null)} />}
      {deleting && <Confirm title="删除镜头" danger onClose={() => setDeleting(null)} onConfirm={() => {
        update((draft) => {
          draft.shots = draft.shots.filter((shot) => shot.id !== deleting.id)
          draft.clips.forEach((clip) => { clip.shotIds = clip.shotIds.filter((shotId) => shotId !== deleting.id) })
          normalize(draft)
        })
        setDeleting(null)
      }}>删除后重新按顺序编号；视频片段会移除该镜头关联，已生成的视频保留。</Confirm>}
    </div>
  )
}
