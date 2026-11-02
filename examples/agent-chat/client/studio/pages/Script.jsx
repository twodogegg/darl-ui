import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProject, Workflow } from '../components/Shell'
import { Button, Confirm, Field, Modal } from '../components/ui'
import { studioApi, useStore } from '../store'
import { WorkflowRunDetails } from '../components/WorkflowRunDetails'
import { WorkflowAdjustment } from '../components/WorkflowAdjustment'
import { id } from '../data'
import { episodeScenes, sceneLabel, scenesToScript, removeEpisode, unmatchedSentences } from '../scenes'
import ProjectOutline from '../components/ProjectOutline'
import { startPolling } from '../../polling'

export function Outline() {
  const context = useProject()
  const navigate = useNavigate()
  const { update, reload, ensureWritable, notify } = useStore()
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  async function writeScript() {
    if (startingRef.current) return
    startingRef.current = true; setStarting(true)
    try {
      await ensureWritable()
      let state = await reload()
      let first = state.episodes.find(item => item.projectId === context.projectId)
      if (!first) {
        const episodeId = id()
        const saved = await update(draft => draft.episodes.push({ id: episodeId, projectId: context.projectId, number: 1, title: '第1集', cover: '', script: '', scenes: [], duration: null, stage: 1 }))
        if (!saved) throw new Error('第一集创建失败，请检查保存状态后重试')
        state = await reload()
        first = state.episodes.find(item => item.id === episodeId)
        if (!first) throw new Error('未找到新建的第一集，请刷新后重试')
      }
      let scriptStartError = ''
      try {
        if (!String(first.script || '').trim() && !(first.scenes || []).some(scene => String(scene.content || '').trim())) {
          const params = new URLSearchParams({ projectId: context.projectId, episodeId: first.id })
          const status = await studioApi(`video-redraw/status?${params}`)
          if (!status.jobs.some(job => job.kind === 'novel-script')) {
            const current = state.projects.find(item => item.id === context.projectId)
            await studioApi('video-redraw/action', { action: 'novel-script', projectId: context.projectId, episodeId: first.id, requestId: crypto.randomUUID(), version: current._version })
          }
        }
      } catch (error) { scriptStartError = error.message }
      navigate(`/script?${new URLSearchParams({ projectId: context.projectId, episodeId: first.id })}`, { state: scriptStartError ? { scriptStartError } : undefined })
    } catch (error) { notify(`进入剧本失败：${error.message}`) }
    finally { startingRef.current = false; setStarting(false) }
  }
  return (
    <Workflow key={context.projectId} context={context} projectLevel>
      {context.project && (
        <div className="script-workspace">
          <ProjectOutline
            project={context.project}
            onWrite={writeScript}
            writing={starting}
          />
        </div>
      )}
    </Workflow>
  )
}

export default function Script() {
  const context = useProject()
  return (
    <Workflow key={context.projectId} context={context} projectLevel>
      {context.project && (context.episodes.length ? <ScriptList context={context} /> : <ScriptImport context={context} />)}
    </Workflow>
  )
}

// No episodes yet: build them from the submitted source instead of an empty page.
function ScriptImport({ context }) {
  const { project } = context
  const { update } = useStore()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  async function createEpisode() {
    setCreating(true)
    try { await update(draft => draft.episodes.push({ id: id(), projectId: project.id, number: 1, title: '第1集', cover: '', script: '', scenes: [], duration: null, stage: 1 })) }
    finally { setCreating(false) }
  }
  return <><header className="workspace-toolbar"><div><h2>剧本</h2><p className="muted">全项目暂无剧集，可先添加剧集再编辑或从小说生成剧本。</p></div></header><div className="toolbar"><Button onClick={() => navigate(`/source?projectId=${encodeURIComponent(project.id)}`)}>查看原始素材</Button><Button primary disabled={creating} onClick={createEpisode}>{creating ? '正在创建…' : '添加第一集'}</Button></div></>
}

function ScriptList({ context }) {
  const { project, episodes } = context
  const { data, patch, notify, update, reload, onNavigate } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeId, setActiveId] = useState(context.episode?.id || episodes[0]?.id)
  const active = episodes.find((e) => e.id === activeId) || episodes[0]
  const [scenes, setScenes] = useState(() => active ? episodeScenes(active) : [])
  const editors = useRef({})
  const [deleting, setDeleting] = useState(null)
  const [deletingEpisode, setDeletingEpisode] = useState(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const script = scenesToScript(scenes)
  const [duration, setDuration] = useState(active?.duration ?? '')
  const [transitioning, setTransitioning] = useState(false)
  const [scriptJob, setScriptJob] = useState(null)
  const [scriptRefresh, setScriptRefresh] = useState(0)
  const [novelOpen, setNovelOpen] = useState(false)
  const [novelSubmitting, setNovelSubmitting] = useState(false)
  const [novelNotes, setNovelNotes] = useState('')
  const [scriptStartError, setScriptStartError] = useState(location.state?.scriptStartError || '')

  const base = useRef({ id: active?.id, version: active?._version, scenes: JSON.stringify(active ? episodeScenes(active) : []), duration: active?.duration ?? '' })
  useEffect(() => {
    const previous = base.current
    if (active?.id !== previous.id || (JSON.stringify(scenes) === previous.scenes && String(duration) === String(previous.duration))) {
      setScenes(active ? episodeScenes(active) : [])
      setDuration(active?.duration ?? '')
      base.current = { id: active?.id, version: active?._version, scenes: JSON.stringify(active ? episodeScenes(active) : []), duration: active?.duration ?? '' }
    }
  }, [active?.id, active?._version])

  useEffect(() => {
    if (!active?.id) return
    setScriptJob(null)
    let reloaded = ''
    return startPolling(async signal => {
      const params = new URLSearchParams({ projectId: project.id, episodeId: active.id })
      const result = await studioApi(`video-redraw/status?${params}`, undefined, signal)
      const job = result.jobs.find(item => item.kind === (project.creationMode === 'video-redraw' ? 'write-script' : 'novel-script'))
      if (!job) { setScriptJob(null); return }
      if (job.status === 'completed') {
        params.set('jobId', job.id)
        setScriptJob(await studioApi(`video-redraw/status?${params}`, undefined, signal))
        if (reloaded !== job.id) { reloaded = job.id; await reload(signal) }
      } else setScriptJob(job)
    }, 3000, error => setScriptJob({ status: 'failed', error: error.message }))
  }, [project.id, project.creationMode, active?.id, scriptRefresh, reload])

  async function writeRedrawScript() {
    try {
      const latest = await reload()
      const currentProject = latest.projects.find(item => item.id === project.id)
      const job = await studioApi('video-redraw/action', { action: 'write-script', projectId: project.id, episodeId: active.id, requestId: crypto.randomUUID(), version: currentProject._version })
      setScriptJob(job); setScriptRefresh(value => value + 1)
    } catch (error) { setScriptJob({ status: 'failed', error: error.message }) }
  }

  async function writeNovelScript() {
    if (novelSubmitting) return
    setNovelSubmitting(true); setScriptStartError('')
    try {
      const latest = await reload()
      const currentProject = latest.projects.find(item => item.id === project.id)
      const job = await studioApi('video-redraw/action', { action: 'novel-script', projectId: project.id, episodeId: active.id, requirements: novelNotes, requestId: crypto.randomUUID(), version: currentProject._version })
      setNovelOpen(false); setScriptJob(job); setScriptRefresh(value => value + 1)
    } catch (error) { notify(error.message) } finally { setNovelSubmitting(false) }
  }

  async function cancelRedrawScript() {
    try {
      await studioApi('video-redraw/action', { action: 'cancel', projectId: project.id, episodeId: active.id, jobId: scriptJob.id || scriptJob.jobId })
      setScriptRefresh(value => value + 1)
    } catch (error) { notify(error.message) }
  }

  const dirty =
    !!active &&
    (JSON.stringify(scenes) !== JSON.stringify(episodeScenes(active)) || String(duration) !== String(active.duration ?? ''))

  function save(quiet = false) {
    if (!dirty) return true
    if (!active) return false
    if (active._version !== base.current.version) { notify('剧本已被其他操作修改，当前草稿已保留。请核对后重新打开本集。'); return false }
    if (scenes.some((scene) => !scene.content.trim() || !scene.location.trim() || !scene.time.trim())) {
      notify('请填写每场的地点、时间和正文')
      return false
    }
    if (scenes.some((scene) => scene.suggestedDuration !== '' && scene.suggestedDuration != null && (!Number.isInteger(Number(scene.suggestedDuration)) || scene.suggestedDuration < 1 || scene.suggestedDuration > 3600))) {
      notify('场次建议时长应为 1—3600 秒的整数，也可留空')
      return false
    }
    if (duration !== '' && (!Number.isInteger(Number(duration)) || duration < 15 || duration > 3600)) {
      notify('目标时长应为 15—3600 秒的整数，也可留空')
      return false
    }
    const savedDuration = duration === '' ? null : Number(duration)
    patch('episodes', active.id, { script, scenes, duration: savedDuration })
    base.current = { id: active.id, version: active._version + 1, scenes: JSON.stringify(scenes), duration: savedDuration ?? '' }
    if (!quiet) notify('剧本正文已保存')
    return true
  }

  function changeScene(sceneId, values) {
    setScenes((old) => old.map((scene) => scene.id === sceneId ? { ...scene, ...values } : scene))
  }
  function addScene() {
    const scene = { id: id(), location: '', setting: '内', time: '待定', suggestedDuration: '', content: '' }
    setScenes((old) => [...old, scene])
  }
  function splitScene(scene) {
    const position = editors.current[scene.id]?.selectionStart
    if (!position || position >= scene.content.length) return notify('请先把光标放在正文需要拆分的位置')
    const before = scene.content.slice(0, position).trimEnd(), after = scene.content.slice(position).trimStart()
    if (!before || !after) return notify('拆分位置前后都需要有正文')
    setScenes((old) => old.flatMap((item) => item.id === scene.id ? [{ ...item, content: before }, { ...item, id: id(), suggestedDuration: '', content: after }] : [item]))
  }
  function selectEpisode(episodeId) {
    if (dirty && !save(true)) return
    setScriptStartError('')
    setActiveId(episodeId)
  }
  function addEpisode() { const episodeId = id(); update(draft => draft.episodes.push({ id: episodeId, projectId: project.id, number: Math.max(0, ...episodes.map(episode => episode.number)) + 1, title: '新剧集', cover: '', script: '', scenes: [], duration: null, stage: 1 })); setActiveId(episodeId) }
  async function confirmAll() {
    if (transitioning) return
    if (!episodes.length) return notify('暂无剧集，请先编写剧本')
    if (dirty && !save(true)) return
    setTransitioning(true)
    try {
      const redraw = project.creationMode === 'video-redraw'
      const saved = await update(draft => {
        draft.episodes.filter(episode => episode.projectId === project.id).forEach(episode => { episode.stage = Math.max(episode.stage, 2) })
      })
      if (!saved) return
      if (redraw) {
        const params = new URLSearchParams({ projectId: project.id, episodeId: active.id })
        const status = await studioApi(`video-redraw/status?${params}`)
        const alreadyExtracted = status.source.fileId && status.jobs.some(job => job.kind === 'extract-assets' && job.sourceFileId === status.source.fileId && ['queued', 'running', 'completed'].includes(job.status))
        if (!alreadyExtracted) {
          const latest = await reload()
          const currentProject = latest.projects.find(item => item.id === project.id)
          await studioApi('video-redraw/action', { action: 'extract-assets', projectId: project.id, episodeId: active.id, requestId: crypto.randomUUID(), version: currentProject._version })
        }
        navigate(`/art?projectId=${encodeURIComponent(project.id)}&episodeId=${encodeURIComponent(active.id)}`)
      } else {
        let extractionError = ''
        try {
          const latest = await reload()
          const first = latest.episodes.find(item => item.id === episodes[0].id)
          if (!latest.assets.some(item => item.projectId === project.id) && first) {
            const params = new URLSearchParams({ projectId: project.id, episodeId: first.id })
            const status = await studioApi(`video-redraw/status?${params}`)
            if (!status.jobs.some(job => job.kind === 'script-assets')) {
              const currentProject = latest.projects.find(item => item.id === project.id)
              await studioApi('video-redraw/action', { action: 'script-assets', projectId: project.id, episodeId: first.id, requestId: crypto.randomUUID(), version: currentProject._version })
            }
          }
        } catch (error) { extractionError = error.message }
        navigate(`/art?projectId=${encodeURIComponent(project.id)}`, { state: extractionError ? { extractionError } : undefined })
        if (!extractionError) notify('全部剧集已确认，进入美术资产')
      }
    } catch (reason) { notify(`进入下一步失败：${reason.message}`) }
    finally { setTransitioning(false) }
  }

  return (
    <>
      <header className="workspace-toolbar">
        <div>
          <h2>剧本</h2>
          <p className="muted">
            全项目共 {episodes.length} 集 · 逐集按场次编写，确认后进入{project.creationMode === 'video-redraw' ? '转绘资产' : '美术资产'}
          </p>
        </div>
        <Field label="本集目标时长（秒）">
          <input
            aria-label="本集目标时长"
            type="number"
            min={15}
            max={3600}
            value={duration}
            placeholder="未设置"
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        {project.creationMode !== 'video-redraw' && <div className="muted">项目单集时长 {project.durationMin}–{project.durationMax} 分钟</div>}
      </header>
      {project.creationMode === 'video-redraw' && <div className="toolbar">
        <Button disabled={dirty || !active || !data.shots.some(shot => shot.episodeId === active.id) || scenes.some(scene => scene.content.trim()) || ['queued', 'running'].includes(scriptJob?.status)} onClick={writeRedrawScript}>生成本集剧本</Button>
        {['queued', 'running'].includes(scriptJob?.status) && <Button onClick={cancelRedrawScript}>取消生成</Button>}
        <WorkflowAdjustment projectId={project.id} episodeId={active?.id} kind="script" reload={reload} disabled={dirty || !active || !scenes.some(scene => scene.content.trim())} />
        <WorkflowRunDetails projectId={project.id} episodeId={active?.id} job={scriptJob} reload={reload} onStarted={() => setScriptRefresh(value => value + 1)} />
        <span role="status">{['queued', 'running'].includes(scriptJob?.status) ? `正在生成剧本：${scriptJob.phase || '排队'}…` : scriptJob?.status === 'completed' ? '剧本已生成，请核对待确认事项。' : ['failed', 'cancelled', 'interrupted'].includes(scriptJob?.status) ? `剧本生成未完成：${scriptJob.error || '任务已取消'}` : '基于已确认目标对白生成，已有正文不会覆盖。'}</span>
        {scriptJob?.openItems?.length > 0 && <details><summary>待确认事项（{scriptJob.openItems.length}）</summary><ul>{scriptJob.openItems.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      </div>}
      {project.creationMode !== 'video-redraw' && <div className="toolbar">
        <Button disabled={dirty || !active || !String(project.sourceScript || '').trim() || !!String(active.script || '').trim() || scenes.some(scene => scene.content.trim()) || ['queued', 'running'].includes(scriptJob?.status)} onClick={() => setNovelOpen(true)}>从小说生成本集</Button>
        {['queued', 'running'].includes(scriptJob?.status) && <Button onClick={cancelRedrawScript}>取消生成</Button>}
        <WorkflowRunDetails projectId={project.id} episodeId={active?.id} job={scriptJob} reload={reload} onStarted={() => setScriptRefresh(value => value + 1)} />
        <span role="status">{['queued', 'running'].includes(scriptJob?.status) ? `正在生成剧本：${scriptJob.phase || '排队'}…` : scriptJob?.status === 'completed' ? '剧本已生成，请核对待确认事项。' : ['failed', 'cancelled', 'interrupted'].includes(scriptJob?.status) ? `剧本生成未完成：${scriptJob.error || '任务已取消'}` : '使用小说转剧本工作流 Agent，已有正文不会覆盖。'}</span>
        {scriptJob?.openItems?.length > 0 && <details><summary>待确认事项（{scriptJob.openItems.length}）</summary><ul>{scriptJob.openItems.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {!String(project.sourceScript || '').trim() && <span className="muted">请先在原始素材中添加小说原文。</span>}
        {dirty && <span className="muted">请先保存本集草稿。</span>}
        {scriptStartError && <span role="alert">自动启动剧本失败：{scriptStartError}。请处理原因后重试。</span>}
      </div>}
      <div className="script-split">
        <aside className="script-episodes" aria-label="剧集列表">
          <p className="script-episodes-title">剧集</p><Button onClick={addEpisode}>＋ 添加剧集</Button>
          {episodes.map((e) => (
            <div className={`script-episode-row ${e.id === active?.id ? 'active' : ''}`} key={e.id}>
              <button className={`script-episode ${e.id === active?.id ? 'active' : ''}`} onClick={() => selectEpisode(e.id)}>
                <span className="script-episode-num">第{e.number}集</span>
                <span className="script-episode-name">{e.title}</span>
                <span className="script-episode-len">{e.script.trim().length} 字</span>
              </button>
              <button className="script-episode-delete" aria-label={`删除第${e.number}集`} title="删除剧集" onClick={() => setDeletingEpisode(e)}>×</button>
            </div>
          ))}
          {!episodes.length && <p className="muted">暂无剧集</p>}
        </aside>
        <div className="script-detail">
          {active ? (
            <>
              <div className="script-detail-head">
                <h3>
                  第{active.number}集 · {active.title}
                </h3>
              </div>
              <div className="script-stage script-scenes">
                <div className="row"><div><div className="script-body-title">剧本正文 <span className="muted">/ {scenes.length} 场</span></div><p className="muted">每场独立编写，分镜与视频片段沿用场次。{project.sourceScript && <span className="muted"> · 原文 {project.sourceScript.length} 字</span>}</p></div><Button onClick={() => addScene()}>＋ 添加场次</Button></div>
                <nav className="scene-navigation" aria-label="本集场次">{scenes.map((scene, index) => <a key={scene.id} href={`#script-scene-${scene.id}`}>第{index + 1}场 · {scene.location || '新场次'}</a>)}</nav>
                {project.sourceScript && scenes.some(scene => unmatchedSentences(scene.content, project.sourceScript).length) && <details className="script-source-diff">
                  <summary>原文对照：{scenes.reduce((sum, scene) => sum + unmatchedSentences(scene.content, project.sourceScript).length, 0)} 句与原始素材不是逐字一致（润色、合并或原文缺失）</summary>
                  {scenes.map((scene, index) => {
                    const missing = unmatchedSentences(scene.content, project.sourceScript)
                    return missing.length ? <div key={scene.id}><strong>第{index + 1}场</strong>{missing.map((sentence, i) => <p key={i}>{sentence}</p>)}</div> : null
                  })}
                </details>}
                {scenes.map((scene, index) => (
                  <section className="script-scene-card" id={`script-scene-${scene.id}`} key={scene.id} aria-label={sceneLabel(scene, index)}>
                    <header className="script-scene-head"><span className="scene-number">{String(index + 1).padStart(2, '0')}</span><h4>第{index + 1}场</h4><span className="muted">{scene.content.trim().length} 字</span><div className="toolbar"><Button onClick={() => splitScene(scene)}>从光标拆分</Button><Button aria-label={`删除第${index + 1}场`} disabled={scenes.length === 1} onClick={() => {
                      if (data.shots.some((shot) => shot.sceneId === scene.id) || data.clips.some((clip) => clip.sceneId === scene.id)) return notify('该场已有关联分镜或片段，请先移除关联内容再删除')
                      setDeleting(scene)
                    }}>删除</Button></div></header>
                    <div className="script-scene-meta">
                      <Field label={`第${index + 1}场地点`}><input value={scene.location} maxLength={100} placeholder="场景地点" onChange={(e) => changeScene(scene.id, { location: e.target.value })} /></Field>
                      <Field label={`第${index + 1}场内外景`}><select value={scene.setting} onChange={(e) => changeScene(scene.id, { setting: e.target.value })}><option>内</option><option>外</option><option>内外</option></select></Field>
                      <Field label={`第${index + 1}场时间`}><input value={scene.time} maxLength={100} placeholder="日 / 夜 / 待定" onChange={(e) => changeScene(scene.id, { time: e.target.value })} /></Field>
                      <Field label={`第${index + 1}场建议时长（秒）`}><input type="number" min={1} max={3600} step={1} value={scene.suggestedDuration ?? ''} placeholder="选填" onChange={(e) => changeScene(scene.id, { suggestedDuration: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
                    </div>
                    <textarea ref={(node) => { editors.current[scene.id] = node }} className="script-text" spellCheck="false" aria-label={`第${index + 1}场正文`} rows={Math.max(6, Math.min(18, scene.content.split('\n').length + 1))} value={scene.content} maxLength={100000} placeholder="编写这一场的动作与对白…" onChange={(e) => changeScene(scene.id, { content: e.target.value })} />
                  </section>
                ))}
                {!scenes.length && <p className="empty">暂无场次，点击“添加场次”开始编写。</p>}
              </div>
            </>
          ) : (
            <div className="empty">
              <h2>暂无剧集</h2>
              <p>请先在项目大纲中规划分集，再编写各集正文。</p>
            </div>
          )}
        </div>
      </div>
      <footer className="workspace-footer">
        <span className="muted">
          {dirty ? '有未保存修改' : `全项目 ${episodes.length} 集剧本`}
        </span>
        <div className="toolbar">
          <Button disabled={!active} onClick={() => save()}>
            保存草稿
          </Button>
          <Button primary disabled={transitioning || !episodes.length} onClick={confirmAll}>
            {transitioning ? '正在进入下一步…' : project.creationMode === 'video-redraw' ? '确认剧本，进入转绘资产 ↗' : '确认全部剧本，进入美术资产 ↗'}
          </Button>
        </div>
      </footer>
      {deletingEpisode && <Modal title={`删除第${deletingEpisode.number}集`} onClose={() => { if (!deletingBusy) setDeletingEpisode(null) }} footer={<><Button disabled={deletingBusy} onClick={() => setDeletingEpisode(null)}>取消</Button><Button danger disabled={deletingBusy} onClick={async () => {
        setDeletingBusy(true)
        try {
          const saved = await update(draft => removeEpisode(draft, deletingEpisode.id))
          if (!saved) return
          if (active?.id === deletingEpisode.id) setActiveId(episodes.find(item => item.id !== deletingEpisode.id)?.id)
          setDeletingEpisode(null)
          notify('剧集已删除')
        } finally { setDeletingBusy(false) }
      }}>{deletingBusy ? '正在删除…' : '确认删除'}</Button></>}>
        <p>确认删除第{deletingEpisode.number}集「{deletingEpisode.title}」？本集剧本、分镜、视频片段及成片记录会一并删除，项目共享资产保留。</p>
        {dirty && active?.id === deletingEpisode.id && <p className="muted">本集尚未保存的修改也会丢弃。</p>}
      </Modal>}
      {deleting && <Confirm title="删除场次" danger onClose={() => setDeleting(null)} onConfirm={() => { setScenes((old) => old.filter((scene) => scene.id !== deleting.id)); setDeleting(null) }}>删除“{deleting.location || '未命名场次'}”及其正文？保存草稿后生效。</Confirm>}
      {novelOpen && active && <Modal title={`从小说生成第${active.number}集剧本`} onClose={() => setNovelOpen(false)} footer={<>
        <Button onClick={() => setNovelOpen(false)}>取消</Button>
        <Button primary disabled={novelSubmitting} onClick={writeNovelScript}>{novelSubmitting ? '正在提交…' : '开始生成'}</Button>
      </>}>
        <p className="muted">独立的小说转剧本 Agent 读取原文、大纲和分集信息，生成后由整理模型校验并写入本集。已有正文不会覆盖。</p>
        <Field label="本集改编要求（可选）"><textarea value={novelNotes} maxLength={2000} rows={4} placeholder="例如：本集从主角回家开始，在收到来电时结束。" onChange={event => setNovelNotes(event.target.value)} /></Field>
        <p className="muted">执行模型、整理模型、提示词和 Skills 在工作流 Agents 的“小说转剧本”中配置。 <Button onClick={() => { setNovelOpen(false); onNavigate('workflow-agents') }}>前往设置</Button></p>
      </Modal>}
    </>
  )
}
