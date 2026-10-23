import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProject, Workflow } from '../components/Shell'
import { Button, Field, Modal, Confirm, FileButton, MediaPreview, Processing } from '../components/ui'
import ClipReferences from '../components/ClipReferences'
import { studioApi, useStore } from '../store'
import { id, makeClips, imageColumns } from '../data'
import { clipMediaReferences, clipPrompt, clipVoices, shotNumber, totalDuration, videoDuration } from '../storyboard'
import { jobLabel, pendingJob } from '../art'
import { isH3Model } from '../../../../../src/components/media-workspace/model'
import { optimizeMediaPrompt } from '../../prompt-optimization'
import { styleOptionsFromCatalog } from '../../workspace-styles'
import { download } from '../files'
import { episodeScenes, orderedShots, sceneLabel } from '../scenes'

export default function VideoProduction() {
  const context = useProject()
  return <Workflow context={context}>{context.episode && <Production key={context.episode.id} context={context} />}</Workflow>
}
function Production({ context }) {
  const navigate = useNavigate()
  const { data, patch, update, notify, generateMedia, models, getModel, mediaDefaults, mediaJobs } = useStore()
  const { episode, projectId, link } = context
  const [busy, setBusy] = useState(false)
  const [submission, setSubmission] = useState(null)
  const scenes = episodeScenes(episode)
  const shots = orderedShots(data.shots.filter((shot) => shot.episodeId === episode.id), scenes)
  const clips = scenes.flatMap((scene) => data.clips.filter((clip) => clip.episodeId === episode.id && clip.sceneId === scene.id))
  const [activeId, setActiveId] = useState(clips[0]?.id)
  const active = clips.find((clip) => clip.id === activeId) || clips[0]
  const linked = shots.filter((shot) => active?.shotIds.includes(shot.id))
  const [group, setGroup] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [preview, setPreview] = useState(null)
  const [historyKind, setHistoryKind] = useState('video')
  const [imageEdit, setImageEdit] = useState(null)
  const [imageNotes, setImageNotes] = useState('')
  const [promptEdit, setPromptEdit] = useState(null)
  const [optimizing, setOptimizing] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const promptBackupKey = `studio-prompt-optimization:${episode.id}`
  const [promptBackups, setPromptBackups] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(promptBackupKey) || '{}') || {} } catch { return {} }
  })
  useEffect(() => {
    try { sessionStorage.setItem(promptBackupKey, JSON.stringify(promptBackups)) } catch {}
  }, [promptBackupKey, promptBackups])
  const promptBackup = promptBackups[active?.id]
  const optimization = useRef(null)
  useEffect(() => () => optimization.current?.abort(), [])
  const model = getModel('video', active?.model)
  const resolution = active?.resolution || (mediaDefaults.video?.modelId === model?.id ? mediaDefaults.video?.resolution : model?.defaults?.resolution) || model?.capabilities?.resolutions?.[0]
  const ratio = active?.ratio || context.project.ratio || mediaDefaults.video?.aspectRatio || model?.defaults?.aspectRatio
  const references = active ? clipMediaReferences(active, data) : { images: [], additional: [] }
  const mode = active?.mode === '全能参考' ? '多模态参考' : active?.mode || (references.images.length ? '多模态参考' : '文本生成')
  let duration, durationError
  try { duration = videoDuration(totalDuration(linked), model) } catch (reason) { durationError = reason.message }
  const activeJobs = mediaJobs.filter(job => job.options?.studioTarget?.resource === 'clips' && job.options.studioTarget.id === active?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const historyField = historyKind === 'video' ? 'videos' : historyKind
  const historyJobs = activeJobs.filter(job => job.options.studioTarget.field === historyField && (job.status !== 'completed' || job.error))
  const videoJob = activeJobs.find(job => job.options.studioTarget.field === 'videos')
  const generatingVideo = pendingJob(videoJob)
  const currentVideo = active && ('currentVideo' in active ? active.currentVideo : active.videos[0])
  const historyColumn = imageColumns.find((column) => column.key === historyKind)
  const history = active ? historyColumn ? active[historyColumn.history] : active.videos : []
  const occupiedShots = new Map(data.clips.filter((clip) => clip.episodeId === episode.id && clip.id !== group?.id).flatMap((clip) => clip.shotIds.map((shotId) => [shotId, clip.title])))
  function editGroup(clip = null, sceneId = active?.sceneId || scenes[0]?.id) {
    setGroup({ id: clip?.id, version: clip?._version, sceneId: clip?.sceneId || sceneId, title: clip?.title || `视频片段 ${clips.length + 1}`, shotIds: clip ? [...clip.shotIds] : [] })
  }
  function saveGroup() {
    if (group.id && data.clips.find(clip => clip.id === group.id)?._version !== group.version) return notify('片段已被其他操作修改，当前组合草稿已保留，请核对后重新打开')
    const selected = shots.filter((shot) => shot.sceneId === group.sceneId && group.shotIds.includes(shot.id))
    if (!group.title.trim() || !selected.length) return notify('请填写片段名称，并选择至少一个分镜')
    if (selected.some((shot) => occupiedShots.has(shot.id))) return notify('所选分镜已用于其他视频片段，请先调整原片段释放分镜')
    const values = { sceneId: group.sceneId, sourceSignature: clipPrompt(selected, shots, scenes), title: group.title.trim(), shotIds: selected.map((shot) => shot.id), duration: totalDuration(selected), description: selected.map((shot) => shot.description).join('\n'), prompt: clipPrompt(selected, shots, scenes) }
    if (group.id) patch('clips', group.id, values)
    else {
      const clip = { ...makeClips(episode.id, [])[0], ...values, ratio: context.project.ratio, id: id(), assetIds: [], image: '', imageHistory: [], storyboardImage: '', storyboardHistory: [], blockingImage: '', blockingHistory: [], videos: [] }
      update((draft) => draft.clips.push(clip))
      setActiveId(clip.id)
    }
    setGroup(null)
  }
  function saveImage(column, url, clipId = active.id) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === clipId)
      if (!clip) return
      clip[column.key] = url
      clip[column.history].unshift(url)
    })
  }
  function deleteVersion(index) {
    update((draft) => {
      const clip = draft.clips.find((item) => item.id === active.id)
      const versions = historyColumn ? clip[historyColumn.history] : clip.videos
      const current = historyColumn ? clip[historyColumn.key] : 'currentVideo' in clip ? clip.currentVideo : versions[0]
      const deletingCurrent = versions.indexOf(current) === index
      versions.splice(index, 1)
      if (deletingCurrent) clip[historyColumn?.key || 'currentVideo'] = versions[0] || ''
    })
    notify('历史版本已删除')
  }
  async function generateImage(column) {
    if (busy) return
    setBusy(true)
    setSubmission({ id: active.id, field: column.key })
    try {
      await generateMedia({ prompt: [active.prompt, column.label, imageNotes].filter(Boolean).join('\n'), target: { resource: 'clips', id: active.id, field: column.key }, references: imageEdit?.source ? [imageEdit.source] : data.assets.filter(asset => active.assetIds.includes(asset.id) && asset.image).map(asset => asset.image) })
    } catch (reason) { notify(reason.message) }
    finally { setBusy(false); setSubmission(null) }
  }
  async function generateVideo() {
    if (busy || !active?.prompt.trim() || !linked.length) return
    setBusy(true)
    setSubmission({ id: active.id, field: 'videos' })
    setHistoryKind('video')
    try {
      if (!model) throw new Error('请先选择视频模型')
      if (durationError) throw new Error(durationError)
      if (mode === '首尾帧') throw new Error('当前视频适配器尚未接通首尾帧，请使用已支持的生成方式')
      if (clipVoices(active, data).some(voice => voice.enabled)) throw new Error('当前视频适配器尚未接通音色引用，请取消音色勾选后生成')
      if (references.additional.some(ref => ['audio', 'video'].includes(ref.kind))) throw new Error('当前视频适配器尚未接通音视频参考，请先移除这些引用')
      if (mode === '多模态参考' && !references.images.length) throw new Error('请先生成或添加参考图片')
      await generateMedia({ type: 'video', modelId: model.id, prompt: active.prompt, target: { resource: 'clips', id: active.id, field: 'videos' }, references: mode === '文本生成' ? [] : references.images.map(ref => ref.url), options: { duration, resolution, aspectRatio: ratio } })
    } catch (reason) { notify(reason.message) }
    finally { setBusy(false); setSubmission(null) }
  }
  function closePrompt() {
    if (savingPrompt) return
    optimization.current?.abort()
    optimization.current = null
    setOptimizing(false)
    setPromptEdit(null)
  }
  function openPromptOptimization(backup) {
    setPromptEdit({ id: active.id, currentPrompt: active.prompt, text: backup?.after ?? active.prompt, before: backup?.before ?? active.prompt, sourceSignature: backup?.sourceSignature ?? active.sourceSignature, optimization: backup?.optimization || (isH3Model(model) ? 'h3' : 'general') })
  }
  function rememberOptimization(text) {
    setPromptBackups(current => ({ ...current, [promptEdit.id]: { before: promptEdit.before, after: text, sourceSignature: promptEdit.sourceSignature, optimization: promptEdit.optimization } }))
  }
  async function savePrompt() {
    if (savingPrompt) return
    if (active?.id !== promptEdit.id) return notify('片段已变更，请重新打开描述')
    setSavingPrompt(true)
    try {
      const saved = await update(draft => {
        const clip = draft.clips.find(clip => clip.id === promptEdit.id)
        if (!clip || clip.prompt !== promptEdit.currentPrompt) throw new Error('视频描述已被其他操作修改，当前草稿已保留，请核对后重新打开')
        clip.prompt = promptEdit.text
        clip.sourceSignature = promptEdit.optimization ? promptEdit.sourceSignature : clipPrompt(linked, shots, scenes)
      })
      if (saved) {
        if (promptEdit.optimization && promptEdit.text !== promptEdit.before) rememberOptimization(promptEdit.text)
        setPromptEdit(null)
      }
    } catch (reason) { notify(reason.message) }
    finally { setSavingPrompt(false) }
  }
  async function restorePrompt() {
    if (savingPrompt || !promptBackup) return
    setSavingPrompt(true)
    try {
      const saved = await update(draft => {
        const clip = draft.clips.find(clip => clip.id === active.id)
        if (!clip || clip.prompt !== promptBackup.after) throw new Error('视频描述已修改，请先打开优化对比核对原文')
        clip.prompt = promptBackup.before
        clip.sourceSignature = promptBackup.sourceSignature
      })
      if (saved) notify('已还原优化前的原文')
    } catch (reason) { notify(reason.message) }
    finally { setSavingPrompt(false) }
  }
  async function optimizePrompt() {
    if (!model || !promptEdit?.text.trim() || optimization.current) return
    const controller = new AbortController()
    optimization.current = controller
    setOptimizing(true)
    setPromptEdit(current => ({ ...current, error: '' }))
    try {
      if (durationError) throw new Error(durationError)
      const catalog = await studioApi('workspace/styles', undefined, controller.signal)
      const style = styleOptionsFromCatalog(catalog.data).find(style => style.id === String(context.project.style_catalog_id))
      const text = await optimizeMediaPrompt({ model, modelId: model.id, optimization: promptEdit.optimization, prompt: promptEdit.text, mode: mode === '文本生成' ? 'text-to-video' : 'reference', options: { count: 1, resolution, aspectRatio: ratio, duration }, ...(style ? { style } : {}), ...(mode !== '文本生成' ? { references: { images: references.images } } : {}) }, { signal: controller.signal })
      if (!controller.signal.aborted) {
        rememberOptimization(text)
        setPromptEdit(current => ({ ...current, text }))
      }
    } catch (reason) {
      if (!controller.signal.aborted) setPromptEdit(current => ({ ...current, error: reason.message }))
    } finally {
      if (optimization.current === controller) { optimization.current = null; setOptimizing(false) }
    }
  }
  function moveClip(offset) {
    const sceneClips = clips.filter((clip) => clip.sceneId === active.sceneId)
    const other = sceneClips[sceneClips.indexOf(active) + offset]
    if (!other) return
    update((draft) => {
      const a = draft.clips.findIndex((clip) => clip.id === active.id), b = draft.clips.findIndex((clip) => clip.id === other.id)
      ;[draft.clips[a], draft.clips[b]] = [draft.clips[b], draft.clips[a]]
    })
  }
  return (
    <div className="page-storyboard production-page">
      <header className="workspace-toolbar"><div className="sb-toolbar-head"><h2>视频制作</h2><label className="sb-episode-pick"><span>剧集</span><select aria-label="选择剧集" value={episode.id} onChange={(e) => navigate(`/video?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(e.target.value)}`)}>{context.episodes.map((e) => <option key={e.id} value={e.id}>第{e.number}集 · {e.title}</option>)}</select></label><p className="muted">共 {clips.length} 个视频片段 · 同一场的多个分镜组合成一个视频片段</p></div><Link className="btn" to={link('/storyboard')}>查看分镜脚本 ↗</Link></header>
      <div className="production-layout">
        <aside className="production-list" aria-label="视频片段列表">
          <h3>视频片段</h3>
          {scenes.map((scene, sceneIndex) => {
            const sceneClips = clips.filter((clip) => clip.sceneId === scene.id)
            return <div className="production-scene-group" key={scene.id}>
              <div className="production-scene-title"><strong>第{sceneIndex + 1}场 · {scene.location || '地点待填写'}</strong><span>{scene.setting} · {scene.time}</span></div>
              <div className="production-list-items">{sceneClips.map((clip) => {
                const source = shots.filter((shot) => clip.shotIds.includes(shot.id))
                return <button key={clip.id} className={`production-clip ${active?.id === clip.id ? 'active' : ''}`} aria-pressed={active?.id === clip.id} onClick={() => { setActiveId(clip.id); setHistoryKind('video') }}>
                  <span className="production-clip-number">{shotNumber(clips.indexOf(clip))}</span><strong>{clip.title}</strong><small>{source.length} 个分镜 · {totalDuration(source)} 秒</small><span className="production-clip-shots">{source.length ? source.map((shot) => shotNumber(shots.indexOf(shot))).join(' / ') : '尚未关联分镜'}</span>
                </button>
              })}</div>
              <Button disabled={!shots.some((shot) => shot.sceneId === scene.id) || busy} onClick={() => editGroup(null, scene.id)}>＋ 创建视频片段</Button>
            </div>
          })}
          {!shots.length && <p className="muted">请先在分镜表添加镜头。</p>}
        </aside>
        {active ? <>
          <div className="production-center">
            <section className="production-preview" aria-label="视频预览">
              <div className="row"><div><p className="production-scene-caption">{sceneLabel(scenes.find((scene) => scene.id === active.sceneId), scenes.findIndex((scene) => scene.id === active.sceneId))}</p><h3>{active.title}</h3><p className="muted">关联分镜 {linked.map((shot) => shotNumber(shots.indexOf(shot))).join(' / ') || '—'} · 预计 {totalDuration(linked)} 秒</p></div><Button disabled={busy} onClick={() => editGroup(active)}>调整分镜组合</Button></div>
              {currentVideo ? <video key={`${active.id}-${currentVideo}`} className="production-video" src={currentVideo} controls playsInline preload="metadata" /> : <div className="production-video-empty">{generatingVideo ? <Processing busy text={jobLabel(videoJob)} /> : '尚未生成视频'}</div>}
              <div className="toolbar">{currentVideo && <><Button onClick={() => download(currentVideo, `${active.title}.mp4`)}>下载视频</Button><Button onClick={() => patch('clips', active.id, { currentVideo: '' })}>移除当前视频</Button></>}<small>选择或上传的视频均保存在项目中</small></div>
            </section>
            <section className="production-history" aria-label="生成历史">
              <div className="row"><h3>生成历史</h3><select aria-label="历史类型" value={historyKind} onChange={(e) => setHistoryKind(e.target.value)}><option value="video">视频</option>{imageColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></div>
              <div className="toolbar production-image-actions" aria-label="图片生成">
                {imageColumns.map((column) => <Button key={column.key} disabled={busy || !linked.length} onClick={() => { setHistoryKind(column.key); generateImage(column) }}>生成{column.label}</Button>)}
                {historyColumn && <FileButton key={`${active.id}-${historyKind}`} disabled={busy} onSelect={(item) => saveImage(historyColumn, item.url)}>{`上传${historyColumn.label}`}</FileButton>}
              </div>
              <Processing busy={busy && submission?.id === active.id && submission.field === historyField} />
              <div className="production-history-items">{historyJobs.map(job => <article key={job.id} className={`production-job production-job--${job.status}`} aria-label={`${historyColumn?.label || '视频'}${jobLabel(job)}`}>
                {pendingJob(job) ? <><Processing busy text={jobLabel(job)} />{typeof job.progress === 'number' && <span role="status">{job.progress}%</span>}</> : <p role="alert">{jobLabel(job)}{job.error && `：${job.error}`}</p>}
              </article>)}{history.map((url, index) => {
                const name = `${historyColumn?.label || '视频'}历史版本${history.length - index}`
                const current = historyColumn ? active[historyColumn.key] : currentVideo
                const selected = history.indexOf(current) === index
                const showPreview = () => setPreview({ name, url, kind: historyColumn ? 'image' : 'video' })
                return <article key={`${active.id}-${historyKind}-${index}`} aria-label={name} className={selected ? 'current' : ''}>
                  <button aria-label={`${historyColumn ? '放大' : '预览'}${name}`} onClick={showPreview}>{historyColumn ? <img src={url} alt={name} /> : <video src={url} muted preload="metadata" />}</button>
                  <div className="production-history-meta"><small>版本 {history.length - index}</small>{selected && <span>当前使用</span>}</div>
                  <div className="production-history-actions">
                    <Button onClick={showPreview}>{historyColumn ? '放大' : '预览'}</Button>
                    {historyColumn && <>
                      <Button disabled={busy} onClick={() => { setImageNotes(''); setImageEdit({ ...historyColumn, source: url }) }}>改图</Button>
                      <FileButton disabled={busy} onSelect={(item) => saveImage(historyColumn, item.url)}>上传替换</FileButton>
                    </>}
                    <Button disabled={busy || selected} onClick={() => patch('clips', active.id, historyColumn ? { [historyColumn.key]: url } : { currentVideo: url })}>使用此版本</Button>
                    <Button danger disabled={busy} onClick={() => deleteVersion(index)}>删除</Button>
                  </div>
                </article>
              })}{!history.length && !historyJobs.length && !busy && <p className="muted">暂无生成历史</p>}</div>
            </section>
          </div>
          <aside className="production-settings" aria-label="片段生成参数与引用">
            <h3>生成参数</h3>
            <section className="production-description" aria-label="视频描述">
              <div className="row"><h3>视频描述</h3><div className="toolbar"><Button disabled={!linked.length || busy} onClick={() => setPromptEdit({ id: active.id, currentPrompt: active.prompt, text: clipPrompt(linked, shots, scenes), rebuild: true })}>从分镜表更新</Button><Button disabled={busy} onClick={() => setPromptEdit({ id: active.id, currentPrompt: active.prompt, text: active.prompt, rebuild: false })}>编辑描述</Button><Button disabled={busy || !model || !active.prompt.trim()} onClick={() => openPromptOptimization()}>提示词优化</Button>{promptBackup && <><Button onClick={() => openPromptOptimization(promptBackup)}>优化对比</Button><Button disabled={savingPrompt || active.prompt !== promptBackup.after || promptBackup.before === promptBackup.after} onClick={restorePrompt}>还原原文</Button></>}</div></div>
              <p className="muted">{active.sourceSignature !== clipPrompt(linked, shots, scenes) ? '分镜表已有修改，点击“从分镜表更新”同步视频描述。' : '可按需要调整组合镜头的视频描述。'}</p>
              <pre>{active.prompt || '请关联分镜后填写视频描述。'}</pre>
            </section>

            <Field label="视频模型"><select aria-label="视频模型" value={model?.id || ''} onChange={event => patch('clips', active.id, { model: event.target.value, resolution: '', ratio: context.project.ratio })}>{!model && <option value="">请选择视频模型</option>}{models.filter(model => model.type === 'video').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></Field>
            {[['mode', '生成方式', mode, ['文本生成', '多模态参考']], ['resolution', '分辨率', resolution, model?.capabilities?.resolutions || []], ['ratio', '视频画幅', ratio, model?.capabilities?.aspectRatios || []]].map(([key, label, value, options]) => <Field key={key} label={label}><select aria-label={label} value={value || ''} onChange={event => patch('clips', active.id, { [key]: event.target.value })}>{!options.includes(value) && <option value={value || ''} disabled>{value ? `${value}（不支持）` : '暂无可用选项'}</option>}{options.map(value => <option key={value}>{value}</option>)}</select></Field>)}
            <p className="production-duration">生成时长 <strong>{duration ? `${duration} 秒` : '无法生成'}</strong><small>{durationError || `分镜合计 ${totalDuration(linked)} 秒${duration !== totalDuration(linked) ? '，按模型要求向上取整' : ''}`}</small></p>
            {active.mode === '首尾帧' && <div className="production-frame-inputs">{[['firstFrame', '首帧'], ['lastFrame', '尾帧']].map(([key, label]) => <div key={key}><span>{label}</span>{active[key] && <img src={active[key]} alt={label} />}<FileButton onSelect={(item) => patch('clips', active.id, { [key]: item.url })}>上传{label}</FileButton>{active[key] && <Button onClick={() => patch('clips', active.id, { [key]: '' })}>移除</Button>}</div>)}</div>}
            <h3>引用资产与音色</h3><ClipReferences key={active.id} clip={active} projectId={projectId} />
            <Button className="production-generate" primary disabled={busy || !model || !!durationError || !linked.length || !active.prompt.trim()} onClick={generateVideo}>{busy ? '正在提交…' : '生成视频'}</Button>
            <div className="production-clip-actions"><Button disabled={busy || clips.filter((clip) => clip.sceneId === active.sceneId).indexOf(active) === 0} onClick={() => moveClip(-1)}>上移片段</Button><Button disabled={busy || clips.filter((clip) => clip.sceneId === active.sceneId).at(-1)?.id === active.id} onClick={() => moveClip(1)}>下移片段</Button><Button danger disabled={busy} onClick={() => setDeleting(active)}>删除片段</Button></div>
          </aside>
        </> : <div className="empty"><h3>还没有视频片段</h3><p>选择分镜，组合成一个视频生成单元。</p><Button primary disabled={!shots.length} onClick={() => editGroup()}>创建视频片段</Button></div>}
      </div>
      {group && <Modal title={group.id ? '调整分镜组合' : '创建视频片段'} wide onClose={() => setGroup(null)} footer={<><Button onClick={() => setGroup(null)}>取消</Button><Button primary disabled={!group.shotIds.length || !group.title.trim()} onClick={saveGroup}>保存并更新描述</Button></>}>
        <Field label="所属场次"><select value={group.sceneId} onChange={(e) => setGroup({ ...group, sceneId: e.target.value, shotIds: [] })}>{scenes.map((scene, index) => <option key={scene.id} value={scene.id}>{sceneLabel(scene, index)}</option>)}</select></Field>
        <Field label="片段名称"><input value={group.title} maxLength={100} onChange={(e) => setGroup({ ...group, title: e.target.value })} /></Field><p className="muted">选择本场未被其他片段使用的分镜，按分镜表顺序组合。</p>
        <div className="clip-shot-picker">{shots.filter((shot) => shot.sceneId === group.sceneId).map((shot) => <label key={shot.id}><input type="checkbox" checked={group.shotIds.includes(shot.id)} disabled={occupiedShots.has(shot.id)} aria-label={`选择分镜${shotNumber(shots.indexOf(shot))}`} onChange={(e) => setGroup({ ...group, shotIds: e.target.checked ? [...group.shotIds, shot.id] : group.shotIds.filter((shotId) => shotId !== shot.id) })} /><span><strong>{shotNumber(shots.indexOf(shot))} · {shot.scale || '景别待定'} · {shot.duration} 秒</strong><small>{shot.camera || '运镜待填写'}</small>{occupiedShots.has(shot.id) && <small className="clip-shot-assignment">已用于「{occupiedShots.get(shot.id)}」</small>}<p>{shot.description || '画面待填写'}</p></span></label>)}</div>
        <p className="muted">已选 {group.shotIds.length} 个分镜 · 预计 {totalDuration(shots.filter((shot) => group.shotIds.includes(shot.id)))} 秒</p>
      </Modal>}
      {promptEdit && <Modal title={promptEdit.optimization ? '视频提示词优化对比' : promptEdit.rebuild ? '从分镜表更新视频描述' : '编辑视频描述'} wide onClose={closePrompt} footer={<><Button disabled={savingPrompt} onClick={closePrompt}>取消</Button><Button primary disabled={optimizing || savingPrompt || !promptEdit.text.trim()} onClick={savePrompt}>{savingPrompt ? '正在保存…' : promptEdit.optimization ? '应用结果' : '保存描述'}</Button></>}>
        {promptEdit.optimization && <><div className="toolbar"><Field label="优化方式"><select aria-label="优化方式" disabled={optimizing || savingPrompt} value={promptEdit.optimization} onChange={event => setPromptEdit({ ...promptEdit, optimization: event.target.value })}><option value="general">普通优化</option>{model && isH3Model(model) && <option value="h3">H3 提示优化</option>}</select></Field><Button disabled={optimizing || savingPrompt || !model || !promptEdit.text.trim()} onClick={optimizePrompt}>开始优化</Button>{optimizing && <Button onClick={() => { optimization.current?.abort(); optimization.current = null; setOptimizing(false) }}>取消优化</Button>}<Button disabled={optimizing || savingPrompt || promptEdit.text === promptEdit.before} onClick={() => setPromptEdit({ ...promptEdit, text: promptEdit.before, error: '' })}>还原原文</Button></div><p className="muted">对照原文检查优化结果，也可继续编辑。点击“应用结果”后更新视频描述。</p><Processing busy={optimizing} text="正在优化提示词…" />{promptEdit.error && <p role="alert">{promptEdit.error}</p>}</>}
        <div className={promptEdit.optimization ? 'production-prompt-comparison' : ''}>
          {promptEdit.optimization && <Field label="原文"><textarea aria-label="原文" readOnly rows={16} value={promptEdit.before} /></Field>}
          <Field label={promptEdit.optimization ? '优化后' : '视频描述'}><textarea aria-label={promptEdit.optimization ? '优化后' : '视频描述'} disabled={optimizing || savingPrompt} rows={16} maxLength={16000} value={promptEdit.text} onChange={event => setPromptEdit({ ...promptEdit, text: event.target.value })} /></Field>
        </div>
      </Modal>}
      {imageEdit && <Modal title={`修改${imageEdit.label}`} onClose={() => { setImageEdit(null) }} footer={<><Button onClick={() => { setImageEdit(null) }}>取消</Button><Button primary disabled={busy || !imageNotes.trim()} onClick={() => { generateImage(imageEdit); setImageEdit(null) }}>生成改图</Button></>}><img className="production-edit-source" src={imageEdit.source} alt="本次修改的原图" /><Field label="修改要求"><textarea rows={5} maxLength={5000} value={imageNotes} onChange={(e) => setImageNotes(e.target.value)} /></Field></Modal>}
      {deleting && <Confirm title="删除视频片段" danger onClose={() => setDeleting(null)} onConfirm={() => { update((draft) => { draft.clips = draft.clips.filter((clip) => clip.id !== deleting.id) }); setDeleting(null) }}>删除“{deleting.title}”及其生成历史？分镜表中的原始镜头保留。</Confirm>}
      {preview && <MediaPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
