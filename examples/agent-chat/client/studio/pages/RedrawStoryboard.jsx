import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject, Workflow } from '../components/Shell'
import { studioApi, useStore } from '../store'
import AssetMentionInput from '../components/AssetMentionInput'
import DialogueEditor from '../components/DialogueEditor'
import { assetMentionCandidates, mentionedAssets } from '../../../asset-mentions'

function ShotVideo({ source, projectId, episodeId, shotId, index }) {
  const [visible, setVisible] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  if (!source?.fileId) return <span>原片不可用</span>
  const params = new URLSearchParams({ projectId, episodeId, shotId })
  const poster = `/api/video-editing/thumbnail?${new URLSearchParams({ url: `/api/files/${source.fileId}`, start: String(source.start) })}`
  return visible ? <><video src={`/api/video-redraw/clip?${params}`} poster={posterFailed ? undefined : poster} controls autoPlay playsInline preload="none" onError={() => setPlaybackFailed(true)} aria-label={`镜头 ${index + 1} 原片片段`} />{playbackFailed && <button type="button" className="redraw-shot-preview" onClick={() => { setVisible(false); setPlaybackFailed(false) }}>片段加载失败，点击重试</button>}</>
    : <button type="button" className="redraw-shot-preview" aria-label={`播放镜头 ${index + 1} 原片片段`} onClick={() => setVisible(true)}>{!posterFailed && <img src={poster} alt={`镜头 ${index + 1} 首帧`} loading="lazy" decoding="async" onError={() => setPosterFailed(true)} />}<span className="redraw-shot-play">▶</span><small>{posterFailed ? '首帧加载失败，点击播放' : `${Number(source.start).toFixed(2)}–${Number(source.end).toFixed(2)} 秒`}</small></button>
}

function ShotRow({ shot, index, projectId, episodeId, assets, onPatch, onSplit, onMerge, onEditDialogue, canMerge }) {
  const [start, setStart] = useState(String(shot.source?.start ?? ''))
  const [end, setEnd] = useState(String(shot.source?.end ?? ''))
  const [description, setDescription] = useState(shot.description || '')
  const candidates = assetMentionCandidates(assets)
  return <tr>
    <td data-label="镜头"><strong>{String(index + 1).padStart(2, '0')}</strong><ShotVideo source={shot.source} projectId={projectId} episodeId={episodeId} shotId={shot.id} index={index} /></td>
    <td data-label="时间与时长"><div className="redraw-shot-times"><input aria-label="开始秒" type="number" step="0.001" value={start} onChange={e => setStart(e.target.value)} onBlur={() => onPatch(shot, { start: Number(start), end: Number(end) })} /><span>–</span><input aria-label="结束秒" type="number" step="0.001" value={end} onChange={e => setEnd(e.target.value)} onBlur={() => onPatch(shot, { start: Number(start), end: Number(end) })} /></div><small>{Number(shot.duration).toFixed(2)} 秒</small></td>
    <td data-label="景别"><input aria-label="景别" defaultValue={shot.scale || ''} onBlur={e => onPatch(shot, { scale: e.target.value })} /></td>
    <td data-label="画面描述"><AssetMentionInput value={description} label="画面描述" candidates={candidates} onChange={setDescription} onBlur={value => onPatch(shot, { description: value })} />{(shot.source?.description || shot.source?.dialogue) && <div className="redraw-shot-source"><span>原片画面与对白</span>{shot.source.description && <p>{shot.source.description}</p>}{shot.source.dialogue && <p>{shot.source.dialogue}</p>}</div>}</td>
    <td data-label="对白与旁白"><button type="button" className="segment-dialogue-summary redraw-dialogue-summary" aria-label={`编辑镜头 ${index + 1} 对白与旁白`} onClick={() => onEditDialogue(shot.id)}>{shot.dialogue?.length ? shot.dialogue.map(line => <div key={line.id}><p>{line.type === '旁白' ? '旁白' : assets.find(asset => asset.id === line.assetId)?.name || line.speaker}：{line.text}</p>{line.description && <p className="redraw-dialogue-description">怎么说：{line.description}</p>}</div>) : <span className="muted">本镜无台词</span>}<em>编辑台词</em></button></td>
    <td data-label="音效"><textarea aria-label="音效" rows={2} defaultValue={shot.effects || ''} onBlur={e => onPatch(shot, { effects: e.target.value })} /></td>
    <td data-label="操作"><div className="redraw-shot-actions"><button type="button" onClick={() => onSplit(shot)}>拆分</button><button type="button" disabled={!canMerge} onClick={() => onMerge(shot)}>合并下一镜</button></div></td>
  </tr>
}

export default function RedrawStoryboard() {
  const context = useProject(), { data, update, notify, requestAgent } = useStore(), navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [editingDialogue, setEditingDialogue] = useState(null)
  const { project, episode, episodes, projectId } = context
  const shots = data.shots.filter(item => item.episodeId === episode?.id).sort((a, b) => Number(a._position || 0) - Number(b._position || 0))
  const assets = data.assets.filter(item => item.projectId === projectId)
  const scenes = episode?.scenes || []
  const sceneAssets = assets.filter(item => item.type === '场景')
  const groups = shots.reduce((result, shot, index) => { const last = result[result.length - 1]; if (last?.sceneId === shot.sceneId) last.shots.push({ shot, index }); else result.push({ sceneId: shot.sceneId, shots: [{ shot, index }] }); return result }, [])
  async function updateScene(id, values) { await update(draft => { const scene = draft.episodes.find(item => item.id === episode.id)?.scenes.find(item => item.id === id); if (scene) Object.assign(scene, values) }) }
  async function addScene() { await update(draft => { draft.episodes.find(item => item.id === episode.id).scenes.push({ id: crypto.randomUUID(), location: '待确认', setting: '内外', time: '待确认', content: '', suggestedDuration: '' }) }) }
  const video = episode?.sourceVideo || (episode?.id === episodes[0]?.id ? project?.sourceVideo : null)
  async function patchShot(shot, values) {
    if ('start' in values) {
      if (values.start === Number(shot.source?.start) && values.end === Number(shot.source?.end)) return
      const index = shots.findIndex(item => item.id === shot.id), previous = shots[index - 1], next = shots[index + 1]
      if (!Number.isFinite(values.start) || !Number.isFinite(values.end) || values.start < 0 || values.end <= values.start || values.end > Number(video?.duration) || (previous && values.start <= Number(previous.source?.start)) || (next && values.end >= Number(next.source?.end))) { notify('镜头时间无效，调整切点不能越过相邻镜头'); return }
    }
    if ('description' in values && values.description === shot.description) return
    const saved = await update(draft => {
      const current = draft.shots.find(item => item.id === shot.id)
      if (!current) return
      if ('start' in values) {
        const index = shots.findIndex(item => item.id === shot.id), previous = draft.shots.find(item => item.id === shots[index - 1]?.id), next = draft.shots.find(item => item.id === shots[index + 1]?.id)
        current.source = { ...current.source, start: values.start, end: values.end }; current.duration = values.end - values.start
        if (previous) { previous.source = { ...previous.source, end: values.start }; previous.duration = values.start - previous.source.start }
        if (next) { next.source = { ...next.source, start: values.end }; next.duration = next.source.end - values.end }
      }
      else { Object.assign(current, values); if ('description' in values) current.assetIds = [...new Set(mentionedAssets(values.description, assets).map(item => item.assetId))] }
    })
    if (!saved) notify('修改未保存')
  }
  async function splitShot(shot) {
    const start = Number(shot.source?.start), end = Number(shot.source?.end)
    const input = window.prompt(`输入拆分时间（${start}–${end} 秒）`, String(Number(((start + end) / 2).toFixed(3))))
    if (input === null) return
    const split = Number(input)
    if (!(split > start && split < end)) { notify('拆分时间必须在镜头区间内'); return }
    await update(draft => {
      const index = draft.shots.findIndex(item => item.id === shot.id), current = draft.shots[index]
      const next = { ...structuredClone(current), id: crypto.randomUUID(), _version: 0, source: { ...current.source, start: split, frames: [], dialogue: '', notes: '拆分后请核对画面和对白' }, duration: end - split, dialogue: [] }
      delete next._position; current.source = { ...current.source, end: split, frames: [], notes: '拆分后请核对画面和对白' }; current.duration = split - start
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
      left.duration = left.source.end - left.source.start; left.description = [...new Set([left.description, right.description].filter(Boolean))].join('\n'); left.dialogue = [...left.dialogue, ...right.dialogue]; left.assetIds = [...new Set([...left.assetIds, ...right.assetIds])]
      draft.shots = draft.shots.filter(item => item.id !== right.id)
    })
  }
  async function next() {
    if (busy || !shots.length) return
    setBusy(true)
    try { await studioApi('video-redraw/action', { action: 'extract-assets', projectId, episodeId: episode.id, requestId: crypto.randomUUID(), version: context.project._version }); navigate(`/art?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(episode.id)}`) }
    catch (error) { notify(error.message) } finally { setBusy(false) }
  }
  return <Workflow context={context}><header className="workspace-toolbar"><div><h2>原片分镜表</h2><p className="muted">根据原片生成；可调整时间、拆分、合并，或让 Agent 修改。</p></div><button className="btn primary" disabled={!shots.length || busy} onClick={next}>确认分镜，进入转绘资产</button></header>
    <div className="redraw-shot-list"><button type="button" className="btn" onClick={addScene}>添加场次</button>{!shots.length ? <p>暂无分镜，请在原片页生成。</p> : <table className="redraw-shot-table"><thead><tr>{['镜头', '时间与时长', '景别', '画面描述', '对白与旁白', '音效', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead>{groups.map((group, groupIndex) => { const scene = scenes.find(item => item.id === group.sceneId); const sceneAsset = sceneAssets.find(item => item.id === scene?.assetId); return <tbody key={`${group.sceneId}-${groupIndex}`}><tr className="redraw-scene-row"><td colSpan={7}><div className="redraw-scene-header"><strong>第 {scenes.findIndex(item => item.id === group.sceneId) + 1} 场</strong><input key={`${group.sceneId}-location-${scene?.location}`} aria-label="场次地点" defaultValue={scene?.location || ''} onBlur={e => { if (e.target.value !== scene?.location) updateScene(group.sceneId, { location: e.target.value }) }} /><select aria-label="场次场景资产" value={scene?.assetId || ''} onChange={e => updateScene(group.sceneId, { assetId: e.target.value, variantId: '' })}><option value="">场景待确认</option>{sceneAssets.map(asset => <option key={asset.id} value={asset.id}>@{asset.name}</option>)}</select>{sceneAsset?.variants?.length > 0 && <select aria-label="场景状态" value={scene?.variantId || ''} onChange={e => updateScene(group.sceneId, { variantId: e.target.value })}><option value="">默认状态</option>{sceneAsset.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select>}<select aria-label="内外景" value={scene?.setting || '内外'} onChange={e => updateScene(group.sceneId, { setting: e.target.value })}>{['内', '外', '内外'].map(value => <option key={value}>{value}</option>)}</select><input key={`${group.sceneId}-time-${scene?.time}`} aria-label="场次时间" defaultValue={scene?.time || ''} onBlur={e => { if (e.target.value !== scene?.time) updateScene(group.sceneId, { time: e.target.value }) }} /></div></td></tr>{group.shots.map(({ shot, index }) => <ShotRow key={`${shot.id}:${shot._version}`} shot={shot} index={index} projectId={projectId} episodeId={episode.id} assets={assets} onPatch={patchShot} onSplit={splitShot} onMerge={mergeShot} onEditDialogue={setEditingDialogue} canMerge={index < shots.length - 1 && shots[index + 1]?.sceneId === shot.sceneId} />)}</tbody> })}</table>}</div>
    {editingDialogue && shots.find(shot => shot.id === editingDialogue) && <DialogueEditor shot={shots.find(shot => shot.id === editingDialogue)} characters={assets.filter(asset => asset.type === '角色')} onClose={() => setEditingDialogue(null)} onSave={async lines => { const saved = await update(draft => { const shot = draft.shots.find(item => item.id === editingDialogue); if (shot) shot.dialogue = lines }); if (saved) setEditingDialogue(null); else notify('台词未保存') }} />}
  </Workflow>
}
