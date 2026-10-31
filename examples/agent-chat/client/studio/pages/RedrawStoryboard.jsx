import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject, Workflow } from '../components/Shell'
import { studioApi, useStore } from '../store'
import AssetMentionInput from '../components/AssetMentionInput'
import DialogueEditor from '../components/DialogueEditor'
import { StoryboardRevision } from '../components/StoryboardRevision'
import { Button, Field, Modal } from '../components/ui'
import { startPolling } from '../../polling'
import { redrawImageReadiness } from '../art'
import { assetMentionCandidates, mentionedAssets } from '../../../asset-mentions'

function ShotVideo({ source, projectId, episodeId, shotId, index }) {
  const [visible, setVisible] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  if (!source?.fileId) return <span>原片不可用</span>
  const params = new URLSearchParams({ projectId, episodeId, shotId })
  const poster = `/api/video-editing/thumbnail?${new URLSearchParams({ url: `/api/files/${source.fileId}`, start: String(source.start) })}`
  return visible ? <><video src={`/api/video-redraw/clip?${params}`} poster={posterFailed ? undefined : poster} controls autoPlay playsInline preload="none" onError={() => setPlaybackFailed(true)} aria-label={`镜头 ${index + 1} 原片片段`} />{playbackFailed && <button type="button" className="redraw-shot-preview" onClick={() => { setVisible(false); setPlaybackFailed(false) }}>片段加载失败，点击重试</button>}</>
    : <button type="button" className="redraw-shot-preview" aria-label={`播放镜头 ${index + 1} 原片片段`} onClick={() => setVisible(true)}>{!posterFailed && <img src={poster} alt={`镜头 ${index + 1} 首帧`} loading="lazy" decoding="async" onError={() => setPosterFailed(true)} />}<span className="redraw-shot-play">▶</span><small>{posterFailed ? '首帧加载失败，点击播放' : `${Number(source.start).toFixed(1)}–${Number(source.end).toFixed(1)} 秒`}</small></button>
}

function ShotRow({ shot, index, projectId, episodeId, assets, onPatch, onSplit, onMerge, onEditDialogue, canMerge, notify }) {
  const [duration, setDuration] = useState(Number(shot.duration).toFixed(1))
  const [description, setDescription] = useState(shot.description || '')
  const editingDuration = useRef(false), editingDescription = useRef(false)
  useEffect(() => { if (!editingDuration.current) setDuration(Number(shot.duration).toFixed(1)) }, [shot.duration])
  useEffect(() => { if (!editingDescription.current) setDescription(shot.description || '') }, [shot.description])
  const candidates = assetMentionCandidates(assets)
  return <tr>
    <td data-label="镜头"><strong>{String(index + 1).padStart(2, '0')}</strong><ShotVideo source={shot.source} projectId={projectId} episodeId={episodeId} shotId={shot.id} index={index} /></td>
    <td data-label="时间与时长"><small>原片 {Number(shot.source?.start ?? 0).toFixed(1)}–{Number(shot.source?.end ?? 0).toFixed(1)} 秒</small><label>目标时长（秒）<input aria-label={`镜头 ${index + 1} 目标时长`} type="number" min="0.1" step="0.1" value={duration} onChange={e => { editingDuration.current = true; setDuration(e.target.value) }} onBlur={() => { if (!editingDuration.current) return; editingDuration.current = false; const value = Number(duration); if (!Number.isFinite(value) || value < 0.1 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-7) { setDuration(Number(shot.duration).toFixed(1)); notify('目标时长须为大于等于 0.1 秒且精确到一位小数的数字'); return } setDuration(value.toFixed(1)); if (value !== Number(shot.duration)) onPatch(shot, { duration: value }) }} /></label></td>
    <td data-label="景别"><input aria-label="景别" key={shot.scale} defaultValue={shot.scale || ''} onBlur={e => onPatch(shot, { scale: e.target.value })} /></td>
    <td data-label="运镜"><input aria-label={`镜头 ${index + 1} 运镜`} key={shot.camera} defaultValue={shot.camera || ''} onBlur={e => onPatch(shot, { camera: e.target.value })} /></td>
    <td data-label="画面描述"><AssetMentionInput value={description} label="画面描述" candidates={candidates} onChange={value => { editingDescription.current = true; setDescription(value) }} onBlur={value => { editingDescription.current = false; onPatch(shot, { description: value }) }} />{(shot.source?.description || shot.source?.dialogue) && <div className="redraw-shot-source"><span>原片画面与对白</span>{shot.source.description && <p>{shot.source.description}</p>}{shot.source.dialogue && <p>{shot.source.dialogue}</p>}</div>}</td>
    <td data-label="对白与旁白"><button type="button" className="segment-dialogue-summary redraw-dialogue-summary" aria-label={`编辑镜头 ${index + 1} 对白与旁白`} onClick={() => onEditDialogue(shot.id)}>{shot.dialogue?.length ? shot.dialogue.map(line => <div key={line.id}><p>{line.type === '旁白' ? '旁白' : assets.find(asset => asset.id === line.assetId)?.name || line.speaker}：{line.text}</p>{line.description && <p className="redraw-dialogue-description">怎么说：{line.description}</p>}</div>) : <span className="muted">本镜无台词</span>}<em>编辑台词</em></button></td>
    <td data-label="音效"><textarea aria-label="音效" key={shot.effects} rows={2} defaultValue={shot.effects || ''} onBlur={e => onPatch(shot, { effects: e.target.value })} /></td>
    <td data-label="操作"><div className="redraw-shot-actions"><button type="button" onClick={() => onSplit(shot)}>拆分</button><button type="button" disabled={!canMerge} onClick={() => onMerge(shot)}>合并下一镜</button></div></td>
  </tr>
}

export default function RedrawStoryboard() {
  const context = useProject(), { data, update, notify, reload, mediaJobs, models, mediaDefaults, setModelSelections } = useStore(), navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [editingDialogue, setEditingDialogue] = useState(null)
  const [nextOpen, setNextOpen] = useState(false), [nextModel, setNextModel] = useState('minimax-h3'), [nextMode, setNextMode] = useState('参考生成')
  const [extraction, setExtraction] = useState(null)
  const { project, episode, episodes, projectId } = context
  const shots = data.shots.filter(item => item.episodeId === episode?.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0))
  const assets = data.assets.filter(item => item.projectId === projectId)
  const scenes = episode?.scenes || []
  const readiness = redrawImageReadiness(data.assets, mediaJobs, projectId)
  useEffect(() => {
    if (!episode?.id || !projectId) return
    return startPolling(async signal => {
      const result = await studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId: episode.id })}`, undefined, signal)
      setExtraction(result.jobs.find(item => item.kind === 'extract-assets') || null)
    }, 3000, error => notify(`读取资产任务失败：${error.message}`))
  }, [projectId, episode?.id])
  const sceneAssets = assets.filter(item => item.type === '场景')
  const groups = shots.reduce((result, shot, index) => { const last = result[result.length - 1]; if (last?.sceneId === shot.sceneId) last.shots.push({ shot, index }); else result.push({ sceneId: shot.sceneId, shots: [{ shot, index }] }); return result }, [])
  async function updateScene(id, values) { await update(draft => { const scene = draft.episodes.find(item => item.id === episode.id)?.scenes.find(item => item.id === id); if (scene) Object.assign(scene, values) }) }
  async function addScene() { await update(draft => { draft.episodes.find(item => item.id === episode.id).scenes.push({ id: crypto.randomUUID(), location: '待确认', setting: '内外', time: '待确认', content: '', suggestedDuration: '' }) }) }
  const video = episode?.sourceVideo || (episode?.id === episodes[0]?.id ? project?.sourceVideo : null)
  async function patchShot(shot, values) {
    if (Object.entries(values).every(([key, value]) => shot[key] === value)) return
    const saved = await update(draft => {
      const current = draft.shots.find(item => item.id === shot.id)
      if (!current) return
      Object.assign(current, values)
      if ('description' in values) current.assetIds = [...new Set([...current.assetIds, ...mentionedAssets(values.description, assets).map(item => item.assetId)])]
    })
    if (!saved) notify('修改未保存')
  }
  async function splitShot(shot) {
    const start = Number(shot.source?.start), end = Number(shot.source?.end)
    if (Number(shot.duration) < 0.2) return notify('目标时长不足 0.2 秒，无法拆分')
    if (data.clips.some(clip => (clip.shotIds || []).includes(shot.id))) return notify('镜头已关联视频片段，请先解除关联再拆分')
    const input = window.prompt(`输入原片拆分时间（${start.toFixed(1)}–${end.toFixed(1)} 秒）`, ((start + end) / 2).toFixed(1))
    if (input === null) return
    const split = Number(input)
    if (!(split > start && split < end)) { notify('拆分时间必须在镜头区间内'); return }
    await update(draft => {
      const index = draft.shots.findIndex(item => item.id === shot.id), current = draft.shots[index]
      const total = Math.max(0.2, Math.round(Number(current.duration) * 10) / 10)
      const first = Math.max(0.1, Math.min(total - 0.1, Math.round(total * (split - start) / (end - start) * 10) / 10))
      const next = { ...structuredClone(current), id: crypto.randomUUID(), _version: 0, source: { ...current.source, start: split, frames: [], dialogue: '', notes: '拆分后请核对画面和对白' }, duration: Number((total - first).toFixed(1)), dialogue: [] }
      delete next._position; current.source = { ...current.source, end: split, frames: [], notes: '拆分后请核对画面和对白' }; current.duration = first
      draft.shots.splice(index + 1, 0, next)
    })
  }
  async function mergeShot(shot) {
    const index = shots.findIndex(item => item.id === shot.id), next = shots[index + 1]
    if (data.clips.some(clip => (clip.shotIds || []).includes(next?.id))) { notify('下一镜已关联视频片段，请先解除关联'); return }
    if (next && next.sceneId !== shot.sceneId) { notify('不同场次的镜头不能合并，请先调整所属场次'); return }
    if (!next || Math.abs(Number(shot.source?.end) - Number(next.source?.start)) > .05) { notify('只能合并相邻的原片镜头'); return }
    await update(draft => {
      const left = draft.shots.find(item => item.id === shot.id), right = draft.shots.find(item => item.id === next.id)
      left.source = { ...left.source, end: right.source.end, frames: [], description: [left.source.description, right.source.description].filter(Boolean).join('\n'), dialogue: [left.source.dialogue, right.source.dialogue].filter(Boolean).join('\n'), notes: '合并后请核对画面和对白' }
      left.duration = Number((Number(left.duration) + Number(right.duration)).toFixed(1)); left.description = [...new Set([left.description, right.description].filter(Boolean))].join('\n'); left.dialogue = [...left.dialogue, ...right.dialogue]; left.assetIds = [...new Set([...left.assetIds, ...right.assetIds])]
      draft.shots = draft.shots.filter(item => item.id !== right.id)
    })
  }
  async function next() {
    if (busy || !shots.length) return
    setBusy(true)
    try {
      const [latest, jobs, status] = await Promise.all([reload(), studioApi('media-generation/jobs'), studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId: episode.id })}`)])
      if (!redrawImageReadiness(latest.assets, jobs, projectId).ready) { notify('请先完成所有资产主图和衍生形态图片'); return }
      if (status.jobs.some(job => job.kind === 'extract-assets' && ['queued', 'running'].includes(job.status))) { notify('资产提取进行中，请等待完成'); return }
      const modelId = mediaDefaults.video?.modelId
      if (!models.some(model => model.id === modelId && model.type === 'video' && model.enabled !== false && ['minimax-h3-flash', 'minimax-h3-standard'].includes(model.id))) { notify('请先在设置中配置并启用 MiniMax H3 视频模型'); return }
      const saved = await update(draft => { const current = draft.episodes.find(item => item.id === episode.id); if (current) current.stage = Math.max(current.stage, 4) })
      if (!saved) return
      setModelSelections(current => ({ ...current, video: modelId }))
      navigate(`/video?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(episode.id)}`, { state: { promptMode: nextMode } })
    } catch (error) { notify(`进入视频制作失败：${error.message}`) } finally { setBusy(false) }
  }
  return <Workflow context={context}><header className="workspace-toolbar"><div><h2>正式分镜</h2><p className="muted">根据剧本、原片分析和资产完善分镜；原片时间用于对照，目标时长可单独编辑。</p></div><button className="btn primary" disabled={!shots.length || busy} onClick={() => setNextOpen(true)}>确认分镜，进入视频制作</button></header>
    <div className="redraw-shot-list"><div className="toolbar"><button type="button" className="btn" onClick={addScene}>添加场次</button><StoryboardRevision scriptReady={!!String(episode?.script || '').trim() && scenes.every(scene => !shots.some(shot => shot.sceneId === scene.id) || !!String(scene.content || '').trim())} projectId={projectId} episodeId={episode?.id} shots={shots} source={video} reload={reload} /></div>{!shots.length ? <p>暂无分镜，请在原片页生成。</p> : <table className="redraw-shot-table"><thead><tr>{['镜头', '时间与时长', '景别', '运镜', '画面描述', '对白与旁白', '音效', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead>{groups.map((group, groupIndex) => { const scene = scenes.find(item => item.id === group.sceneId); const sceneAsset = sceneAssets.find(item => item.id === scene?.assetId); return <tbody key={`${group.sceneId}-${groupIndex}`}><tr className="redraw-scene-row"><td colSpan={8}><div className="redraw-scene-header"><strong>第 {scenes.findIndex(item => item.id === group.sceneId) + 1} 场</strong><input key={`${group.sceneId}-location-${scene?.location}`} aria-label="场次地点" defaultValue={scene?.location || ''} onBlur={e => { if (e.target.value !== scene?.location) updateScene(group.sceneId, { location: e.target.value }) }} /><select aria-label="场次场景资产" value={scene?.assetId || ''} onChange={e => updateScene(group.sceneId, { assetId: e.target.value, variantId: '' })}><option value="">场景待确认</option>{sceneAssets.map(asset => <option key={asset.id} value={asset.id}>@{asset.name}</option>)}</select>{sceneAsset?.variants?.length > 0 && <select aria-label="场景状态" value={scene?.variantId || ''} onChange={e => updateScene(group.sceneId, { variantId: e.target.value })}><option value="">默认状态</option>{sceneAsset.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select>}<select aria-label="内外景" value={scene?.setting || '内外'} onChange={e => updateScene(group.sceneId, { setting: e.target.value })}>{['内', '外', '内外'].map(value => <option key={value}>{value}</option>)}</select><input key={`${group.sceneId}-time-${scene?.time}`} aria-label="场次时间" defaultValue={scene?.time || ''} onBlur={e => { if (e.target.value !== scene?.time) updateScene(group.sceneId, { time: e.target.value }) }} /></div></td></tr>{group.shots.map(({ shot, index }) => <ShotRow key={shot.id} shot={shot} index={index} projectId={projectId} episodeId={episode.id} assets={assets} onPatch={patchShot} onSplit={splitShot} onMerge={mergeShot} onEditDialogue={setEditingDialogue} notify={notify} canMerge={index < shots.length - 1 && shots[index + 1]?.sceneId === shot.sceneId} />)}</tbody> })}</table>}</div>
    {nextOpen && <Modal title="选择视频制作方式" onClose={() => setNextOpen(false)} footer={<><Button onClick={() => setNextOpen(false)}>取消</Button><Button primary disabled={busy || nextModel !== 'minimax-h3' || !readiness.ready || ['queued', 'running'].includes(extraction?.status)} onClick={next}>{busy ? '正在进入…' : '进入视频制作'}</Button></>}>
      <Field label="视频模型"><select aria-label="视频模型" value={nextModel} onChange={event => setNextModel(event.target.value)}><option value="seedance-2.5">Seedance 2.5</option><option value="seedance-2.0">Seedance 2.0</option><option value="minimax-h3">MiniMax H3</option></select></Field>
      {nextModel !== 'minimax-h3' && <p className="muted" role="status">当前工作台尚未接入所选模型，请选择 MiniMax H3。</p>}
      <Field label="生成模式"><select aria-label="生成模式" value={nextMode} onChange={event => setNextMode(event.target.value)}><option value="分镜图">四宫格分镜</option><option value="参考生成">参考生成</option></select></Field>
      {!readiness.ready && <p className="muted" role="status">{readiness.running ? '图片生成中，请等待完成' : readiness.missing ? `还有 ${readiness.missing} 张资产图片未生成` : '请先添加资产并生成图片'}</p>}
      {['queued', 'running'].includes(extraction?.status) && <p className="muted" role="status">资产提取进行中，请等待完成。</p>}
    </Modal>}
    {editingDialogue && shots.find(shot => shot.id === editingDialogue) && <DialogueEditor shot={shots.find(shot => shot.id === editingDialogue)} characters={assets.filter(asset => asset.type === '角色')} onClose={() => setEditingDialogue(null)} onSave={async lines => { const saved = await update(draft => { const shot = draft.shots.find(item => item.id === editingDialogue); if (shot) shot.dialogue = lines }); if (saved) setEditingDialogue(null); else notify('台词未保存') }} />}
  </Workflow>
}
