import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconArrowUpRight,
  IconMovie,
  IconSettings,
  IconFileText,
  IconNotebook,
  IconScript,
  IconLayoutList,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-react'
import { studioApi, useStore } from '../store'
import { steps, makeOutline } from '../data'
import { StyleSelector } from '@darl/ui'
import { createWorkspaceStyle, styleOptionsFromCatalog } from '../../workspace-styles'
import { FileButton, Processing, DirectorSelect, TextModelSelect } from '../components/ui'
import { parseSource } from '../files'
import { CreateRedraw } from '../components/VideoRedraw'

export default function Home() {
  const { data, update, notify, reload, requestAgent, cancelAgent } = useStore()
  const navigate = useNavigate()
  const [requirements, setRequirements] = useState('')
  const [creationMode, setCreationMode] = useState('script')
  const [script, setScript] = useState('')
  const [images, setImages] = useState([])
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [ratio, setRatio] = useState('9:16')
  const [generationMode, setGenerationMode] = useState('故事版')
  const [planned, setPlanned] = useState('')
  const [durationMin, setDurationMin] = useState(2)
  const [durationMax, setDurationMax] = useState(5)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [busy, setBusy] = useState(false)
  const [styles, setStyles] = useState([])
  const [styleId, setStyleId] = useState(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const cancel = cancelAgent
  useEffect(() => { studioApi('workspace/styles').then(value => setStyles(styleOptionsFromCatalog(value.data))).catch(reason => notify(reason.message)) }, [])
  async function createStyle(input) {
    await createWorkspaceStyle(input)
    const catalog = await studioApi('workspace/styles')
    setStyles(styleOptionsFromCatalog(catalog.data))
  }
  async function importFile(file) {
    if (!file || reading) return
    setReading(true)
    try {
      const text = await parseSource(file)
      if (alive.current) {
        setScript(text)
        setFileName(file.name)
        notify('原始素材已在浏览器中读取')
      }
    } catch (e) {
      if (alive.current) notify(e.message)
    }
    if (alive.current) setReading(false)
  }
  async function create(e) {
    e.preventDefault()
    if (busy || reading) return
    const text = script.trim()
    if (!text) return notify('请先上传原始素材')
    if (!styleId) return notify('请选择视觉风格')
    if (planned !== '' && (!Number.isInteger(Number(planned)) || planned < 1 || planned > 100)) return notify('计划集数应为1—100的整数')
    if (![durationMin, durationMax].every(value => Number.isInteger(Number(value)) && value >= 1 && value <= 60) || Number(durationMin) > Number(durationMax)) return notify('请填写有效的单集时长范围')
    setBusy(true)
    let projectId
    try {
      const result = await studioApi('workspace/projects', { name: text.split('\n').find(line => line.trim()).slice(0,30), description: text.slice(0,2000), aspect_ratio: ratio, style_catalog_id: Number(styleId) })
      projectId = String(result.data.project_id)
      if (images[0]?.fileId) await studioApi(`workspace/projects/${projectId}/covers/files/${images[0].fileId}/select`, {})
      await reload()
      await update(draft => {
        Object.assign(draft.projects.find(item => item.id === projectId), { sourceScript: text, requirements: requirements.trim(), generationMode, planned: planned === '' ? null : Number(planned), durationMin: Number(durationMin), durationMax: Number(durationMax), duration: Number(durationMin)*60, outline: makeOutline({ summary: text.slice(0,2000) }) })
      })
      navigate(`/outline?projectId=${projectId}`)
      await requestAgent({ action: 'outline', projectId, draftOnly: true })
      notify('已填入项目大纲提示词，请确认后发送')
    } catch (reason) { notify(reason.message + (projectId ? '。项目已创建，可在我的项目中继续。' : '')) }
    finally { if (alive.current) setBusy(false) }
  }

  return (
    <div className="page-home"><StyleSelector styles={styles} open={styleOpen} onOpenChange={setStyleOpen} value={styleId} onChange={style => setStyleId(style?.id || null)} onCreate={createStyle} />
      <div className="br-section-top">
        <div>
          <p className="br-eyebrow">YOUR CREATIVE WORKSPACE</p>
          <h1 className="br-title">你的下一部作品，从这里开始。</h1>
          <p className="br-title-sub">
            一份原始素材，让故事逐步成为可以观看的影片。
          </p>
        </div>
        <Link className="br-text-link" to="/projects">
          查看全部项目 <IconArrowUpRight size={15} />
        </Link>
      </div>
      <nav className="redraw-mode-tabs" aria-label="创作入口"><button aria-pressed={creationMode === 'script'} onClick={() => setCreationMode('script')}>剧本创作</button><button aria-pressed={creationMode === 'video-redraw'} onClick={() => setCreationMode('video-redraw')}>视频转绘</button></nav>
      {creationMode === 'video-redraw' ? <CreateRedraw /> : <section className="br-hero" aria-label="新建创作">
        <div className="br-hero-left">
          <p className="br-overline">NEW PROJECT / 创作起点</p>
          <h2 className="br-hero-title">本入剧出，让故事开场。</h2>
          <p className="br-hero-desc">
            上传小说或剧本等原始素材，填写创作要求，开始从故事到影像的创作。
          </p>
          <form className="br-creator" onSubmit={create}>
            <div className="br-composer">
              <label
                className="home-script-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!busy && !reading) importFile(e.dataTransfer.files[0])
                }}
              >
                <IconFileText size={24} />
                <strong>{reading ? '读取中…' : fileName || '上传原始素材'}</strong>
                <span>{fileName ? '点击或拖入文件可重新上传' : '点击选择或拖入文件 · TXT / DOCX / MD / XLSX'}</span>
                <input
                  type="file"
                  aria-label="上传原始素材"
                  accept=".txt,.md,.docx,.xlsx"
                  disabled={busy || reading}
                  onChange={(e) => {
                    importFile(e.target.files[0])
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="home-requirements-label" htmlFor="home-requirements">
                创作要求 <span>（可选）</span>
              </label>
              <textarea
                id="home-requirements"
                rows={3}
                maxLength={10000}
                value={requirements}
                disabled={busy}
                placeholder="例如：保留主要人物和主线，突出人物冲突，整体节奏紧凑…"
                onChange={(e) => setRequirements(e.target.value)}
              />
              <div className="home-references">
                {images.map((item) => (
                  <div key={item.id}>
                    <img src={item.url} alt={item.name} />
                    <button
                      type="button"
                      aria-label={`移除${item.name}`}
                      onClick={() =>
                        setImages((old) => old.filter((i) => i.id !== item.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="br-composer-controls">
                <FileButton
                  multiple
                  onSelect={(item) =>
                    setImages((old) => {
                      if (old.length >= 9) return old
                      return [...old, item]
                    })
                  }
                >
                  ＋ 参考图（最多9张）
                </FileButton>
                <button
                  className="br-primary"
                  type="submit"
                  disabled={busy || reading}
                >
                  <IconMovie size={16} />
                  {busy ? '正在创建…' : '开始创作'}
                  <IconArrowUpRight size={16} />
                </button>
              </div>
            </div>
            <p className="br-settings-title">
              <IconSettings size={16} /> 项目设置
            </p>
            <p className="br-setting-hint">
              选择视觉风格，按需设置创作导演、生成模式、画幅、集数和时长。
            </p>
            <div className="br-settings">
              <div className="br-field">
                <label htmlFor="home-generation-mode">生成模式</label>
                <select id="home-generation-mode" value={generationMode} onChange={(e) => setGenerationMode(e.target.value)}>
                  <option>故事版</option>
                  <option>全能参考</option>
                </select>
              </div>
              <div className="br-field"><DirectorSelect label="剧本导演" /></div>
              <div className="br-field"><TextModelSelect label="剧本模型" /></div>
              <div className="br-field"><label>视觉风格 *</label><button type="button" className="btn" onClick={() => setStyleOpen(true)}>{styles.find(item => item.id === styleId)?.name || '选择视觉风格'}</button></div>
              <div className="br-field">
                <label htmlFor="home-aspect">视频画幅</label>
                <select
                  id="home-aspect"
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  <option value="9:16">9:16（竖版）</option>
                  <option value="16:9">16:9（横版）</option>
                </select>
              </div>
              <div className="br-field">
                <label htmlFor="home-episodes">计划集数</label>
                <input
                  id="home-episodes"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="不填则 Agent 填写"
                  value={planned}
                  onChange={(e) => setPlanned(e.target.value)}
                />
              </div>
              <fieldset className="home-duration-range">
                <legend>单集时长范围 <span>默认 2–5 分钟</span></legend>
                <div className="home-duration-inputs">
                  <div className="br-field">
                    <label htmlFor="home-duration-min">最短</label>
                    <div className="home-minute-input">
                      <input
                        id="home-duration-min"
                        type="number"
                        min="1"
                        max="60"
                        step="1"
                        required
                        value={durationMin}
                        onChange={(e) => setDurationMin(e.target.value)}
                      />
                      <span>分钟</span>
                    </div>
                  </div>
                  <span className="home-duration-separator">–</span>
                  <div className="br-field">
                    <label htmlFor="home-duration-max">最长</label>
                    <div className="home-minute-input">
                      <input
                        id="home-duration-max"
                        type="number"
                        min="1"
                        max="60"
                        step="1"
                        required
                        value={durationMax}
                        onChange={(e) => setDurationMax(e.target.value)}
                      />
                      <span>分钟</span>
                    </div>
                  </div>
                </div>
              </fieldset>
            </div>
            <Processing busy={busy} cancel={cancel} />
          </form>
        </div>
        <div className="br-hero-right" role="img" aria-label="电影片场">
          <span className="br-hero-image-note">FROM SCRIPT TO SCREEN / 01</span>
        </div>
      </section>}
      <section>
        <div className="br-section-header">
          <div>
            <h2>继续你的创作</h2>
            <small>近期修改的作品，快速回到创作现场</small>
          </div>
          <Link className="br-text-link" to="/projects">
            全部项目 ↗
          </Link>
        </div>
        <div className="br-cards">
          {data.projects.slice(0, 3).map((p) => (
            <Link
              className="br-project-card"
              key={p.id}
              to={`/${p.creationMode === 'video-redraw' ? 'source' : 'outline'}?projectId=${encodeURIComponent(p.id)}`}
            >
              <span className="br-cover">
                <>{p.cover ? <img src={p.cover} alt={p.title} /> : <div className="studio-cover-empty">未上传封面</div>}</>
                <span className="br-cover-label">{p.title}</span>
              </span>
              <span className="br-project-info">
                <span className="br-project-meta">
                  {data.episodes.filter((e) => e.projectId === p.id).length} 集
                  · 创作中
                </span>
                <IconArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="br-workflow" aria-label="五步创作流程">
        <h2 className="br-workflow-title">五步创作，一部作品</h2>
        <p className="br-workflow-sub">从剧本到成片，让好故事被看见。</p>
        <ol className="br-steps">
          {steps.map((s, i) => {
            const Icon = [IconNotebook, IconScript, IconLayoutList, IconPhoto, IconVideo][i]
            return (
              <li className="br-step" key={s.path}>
                <Icon size={22} aria-hidden="true" />
                <span>
                  <span className="br-step-num">
                    0{i + 1} / {s.english}
                  </span>
                  <span className="br-step-name">{s.label}</span>
                </span>
              </li>
            )
          })}
        </ol>
      </section>
      <p className="br-bottom-note">本入剧出 · AI FILM STUDIO</p>
    </div>
  )
}
