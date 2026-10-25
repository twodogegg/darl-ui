import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject, Workflow } from '../components/Shell'
import { Button, Confirm, Field, Modal, Models, Processing } from '../components/ui'
import { useStore, useAgentTask } from '../store'
import { id } from '../data'
import { episodeScenes, sceneLabel, scenesToScript, removeEpisode, sourceScenes, unmatchedSentences } from '../scenes'
import ProjectOutline from '../components/ProjectOutline'

export function Outline() {
  const context = useProject()
  const navigate = useNavigate()
  return (
    <Workflow key={context.projectId} context={context} projectLevel>
      {context.project && (
        <div className="script-workspace">
          <ProjectOutline
            project={context.project}
            onWrite={() => navigate(`/script?projectId=${context.projectId}`)}
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
  const navigate = useNavigate()
  const [planned, setPlanned] = useState(String(project.planned || ''))
  const [notes, setNotes] = useState(String(project.requirements || '').split('\n').filter(line => line.includes('集')).slice(0, 3).join('\n'))
  const { busy, run, cancel } = useAgentTask()
  const source = String(project.sourceScript || '').trim()
  const parsed = sourceScenes(source)
  const count = Number(planned)
  const valid = Number.isInteger(count) && count >= 1 && count <= 100
  return (
    <>
      <header className="workspace-toolbar">
        <div>
          <h2>剧本</h2>
          <p className="muted">全项目暂无剧集 · 按原文建集并拆分场次后逐集撰写</p>
        </div>
      </header>
      <div className="script-detail">
        <div className="script-stage script-scenes">
          <div className="row"><div><div className="script-body-title">按原文建集</div><p className="muted">{source ? `已提交原始素材 ${source.length} 字，原文自带 ${parsed.length} 个场次标题。` : '本项目还没有提交原始素材，请先回创作起点粘贴或上传。'}</p></div><Button onClick={() => navigate(`/source?projectId=${encodeURIComponent(project.id)}`)}>查看原始素材</Button></div>
          <div className="script-scene-meta">
            <Field label="计划集数"><input aria-label="计划集数" type="number" min={1} max={100} step={1} value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>
            <Field label="原文场次（参考）"><input readOnly value={parsed.length ? parsed.map(scene => `${String(scene.number).padStart(2, '0')} ${scene.location}`).join(' / ') : '未识别到场次标题'} /></Field>
          </div>
          <p className="muted">确认后交给 Agent 按原文与项目大纲建立 {valid ? `${count} ` : ''}集、拆分场次并直接写入网站；写入完成后可在这里逐集核对。</p>
          <Field label="分集要求（可选）"><textarea rows={4} maxLength={2000} value={notes} placeholder="例如：第 1 集完成超市重逢，第 4 集停在律所前台；每集 2–3 分钟。" onChange={(e) => setNotes(e.target.value)} /></Field>
          <Models />
          <Processing busy={busy} cancel={cancel} />
        </div>
      </div>
      <footer className="workspace-footer">
        <span className="muted">{source ? `原始素材 ${source.length} 字` : '原始素材缺失'}</span>
        <div className="toolbar">
          <Button primary disabled={busy || !source || !valid} onClick={() => run({ action: 'build-episodes', projectId: project.id, episodes: count, notes })}>
            {busy ? '正在写入网站…' : '按原文建集并写入网站 ↗'}
          </Button>
        </div>
      </footer>
    </>
  )
}

function ScriptList({ context }) {
  const { project, episodes } = context
  const { data, patch, notify, log, update } = useStore()
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState(context.episode?.id || episodes[0]?.id)
  const active = episodes.find((e) => e.id === activeId) || episodes[0]
  const [scenes, setScenes] = useState(() => active ? episodeScenes(active) : [])
  const editors = useRef({})
  const [deleting, setDeleting] = useState(null)
  const [deletingEpisode, setDeletingEpisode] = useState(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const script = scenesToScript(scenes)
  const [duration, setDuration] = useState(active?.duration || 60)
  const [regen, setRegen] = useState(false)
  const [notes, setNotes] = useState('')
  const { busy, run, cancel } = useAgentTask()

  const base = useRef({ id: active?.id, version: active?._version, scenes: JSON.stringify(active ? episodeScenes(active) : []), duration: active?.duration || 60 })
  useEffect(() => {
    const previous = base.current
    if (active?.id !== previous.id || (JSON.stringify(scenes) === previous.scenes && Number(duration) === previous.duration)) {
      setScenes(active ? episodeScenes(active) : [])
      setDuration(active?.duration || 60)
      base.current = { id: active?.id, version: active?._version, scenes: JSON.stringify(active ? episodeScenes(active) : []), duration: active?.duration || 60 }
    }
  }, [active?.id, active?._version])

  const dirty =
    !!active &&
    (JSON.stringify(scenes) !== JSON.stringify(episodeScenes(active)) || Number(duration) !== active.duration)

  function save(quiet = false) {
    if (!dirty) return true
    if (!active) return false
    if (active._version !== base.current.version) { notify('剧本已被其他操作修改，当前草稿已保留。请核对后重新打开本集。'); return false }
    if (!scenes.length || scenes.some((scene) => !scene.content.trim() || !scene.location.trim() || !scene.time.trim())) {
      notify('请填写每场的地点、时间和正文')
      return false
    }
    if (scenes.some((scene) => scene.suggestedDuration !== '' && scene.suggestedDuration != null && (!Number.isInteger(Number(scene.suggestedDuration)) || scene.suggestedDuration < 1 || scene.suggestedDuration > 3600))) {
      notify('场次建议时长应为 1—3600 秒的整数，也可留空')
      return false
    }
    if (!Number.isInteger(Number(duration)) || duration < 15 || duration > 3600) {
      notify('目标时长应为 15—3600 秒的整数')
      return false
    }
    patch('episodes', active.id, { script, scenes, duration: Number(duration) })
    base.current = { id: active.id, version: active._version + 1, scenes: JSON.stringify(scenes), duration: Number(duration) }
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
    setActiveId(episodeId)
  }
  function addEpisode() { const episodeId = id(); update(draft => draft.episodes.push({ id: episodeId, projectId: project.id, number: Math.max(0, ...episodes.map(episode => episode.number)) + 1, title: '新剧集', cover: '', script: '', scenes: [], duration: project.duration || 120, stage: 1 })); setActiveId(episodeId) }
  function confirmAll() {
    if (!episodes.length) return notify('暂无剧集，请先在项目大纲中规划分集')
    if (dirty && !save(true)) return
    update(draft => draft.episodes.filter(episode => episode.projectId === project.id).forEach(episode => { episode.stage = Math.max(episode.stage, 2) }))
    navigate(`/video?projectId=${project.id}&episodeId=${episodes[0].id}`)
    notify('全部剧集已确认，进入视频制作')
  }

  return (
    <>
      <header className="workspace-toolbar">
        <div>
          <h2>剧本</h2>
          <p className="muted">
            全项目共 {episodes.length} 集 · 逐集按场次编写，确认后进入视频制作，在同一页面设计镜头并制作视频
          </p>
        </div>
        <Field label="本集目标时长（秒）">
          <input
            aria-label="本集目标时长"
            type="number"
            min={15}
            max={3600}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
      </header>
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
          <Button disabled={busy || !active} onClick={() => save()}>
            保存草稿
          </Button>
          <Button disabled={busy || !active} onClick={() => setRegen(true)}>
            重新生成本集
          </Button>
          <Button primary disabled={busy || !episodes.length} onClick={confirmAll}>
            确认全部剧本，进入视频制作 ↗
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
      {regen && active && (
        <Modal
          title={`重新生成第${active.number}集剧本`}
          onClose={() => {
            cancel()
            setRegen(false)
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  cancel()
                  setRegen(false)
                }}
              >
                取消
              </Button>
              <Button
                primary
                disabled={busy}
                onClick={() =>
                  run({ action: 'rewrite-script', projectId: project.id, episodeId: active.id, notes })
                }
              >
                确认重写
              </Button>
            </>
          }
        >
          <p className="muted">
            根据调整要求改写本集剧本，保留场次关联；项目大纲保持已保存内容。
          </p>
          <Field label="调整意见（可选）">
            <textarea
              value={notes}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Models />
          <Processing busy={busy} cancel={cancel} />
        </Modal>
      )}
    </>
  )
}
