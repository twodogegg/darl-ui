import { imageUrl } from '../../image-url'
import * as Dialog from '@radix-ui/react-dialog'
import { Button as DarlButton } from '../../../../../src/components/ui/Button'
import {
  useEffect,
  useRef,
  useState,
  useId,
  isValidElement,
  cloneElement,
} from 'react'
import { useLocation } from 'react-router-dom'
import { IconX } from '@tabler/icons-react'
import { useStore, useAgentTask } from '../store'
import { readMedia, download } from '../files'
import { loadVoiceCatalog } from '../../VoiceSettings'
import { jobResults } from '../../media-job-view'


export function Button({
  primary,
  danger,
  className = '',
  children,
  ...props
}) {
  return (
    <DarlButton
      variant={danger ? 'destructive' : primary ? 'default' : 'outline'}
      type="button"
      className={`btn ${primary ? 'primary' : ''} ${danger ? 'danger' : ''} ${className}`}
      {...props}
    >
      {children}
    </DarlButton>
  )
}
export function Field({ label, children }) {
  const generatedId = useId()
  const control =
    isValidElement(children) &&
    ['input', 'textarea', 'select'].includes(children.type)
  const controlId = children?.props?.id || generatedId
  return (
    <div className="field">
      {control ? (
        <label htmlFor={controlId}>{label}</label>
      ) : (
        <span>{label}</span>
      )}
      {control ? cloneElement(children, { id: controlId }) : children}
    </div>
  )
}
export function Tabs({ items, value, onChange, label = '分类' }) {
  return (
    <nav className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => {
        const key = typeof item === 'string' ? item : item.value
        return (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={value === key}
            className={value === key ? 'active' : ''}
            onClick={() => onChange(key)}
          >
            {typeof item === 'string' ? item : item.label}
          </button>
        )
      })}
    </nav>
  )
}
export function Modal({ title, onClose, children, footer, drawer = false, wide = false, header, panelClassName = '', maskClassName = '', bodyClassName = '', onPaste }) {
  const { pathname } = useLocation()
  const scope = pathname === '/art' ? 'page-art' : ['/video', '/storyboard'].includes(pathname) ? 'page-storyboard' : ''
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal><div className="rn-studio"><div className={scope}><div className={`modal-portal ${maskClassName}`}><Dialog.Overlay className="studio-dialog-overlay" /><Dialog.Content onPaste={onPaste} aria-describedby={undefined} className={`dialog studio-dialog-content ${drawer ? 'drawer' : ''} ${wide ? 'wide' : ''} ${panelClassName}`}><Dialog.Title asChild><span className="studio-sr-only">{title}</span></Dialog.Title>{header || <header><h2>{title}</h2><Dialog.Close asChild><button className="icon-btn" aria-label="关闭"><IconX size={20} /></button></Dialog.Close></header>}<div className={`dialog-body ${bodyClassName}`}>{children}</div>{footer && <footer>{footer}</footer>}</Dialog.Content></div></div></div></Dialog.Portal></Dialog.Root>
}
export function Confirm({ title, children, onClose, onConfirm, danger }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button primary={!danger} danger={danger} onClick={onConfirm}>
            确认
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
export function TextDialog({
  title,
  label = '名称',
  value = '',
  multiline,
  onClose,
  onSave,
  maxLength = 100,
}) {
  const [text, setText] = useState(value)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            primary
            disabled={!text.trim()}
            onClick={() => onSave(text.trim())}
          >
            保存
          </Button>
        </>
      }
    >
      <Field label={label}>
        {multiline ? (
          <textarea
            aria-label={label}
            rows={7}
            maxLength={maxLength}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            autoFocus
            maxLength={maxLength}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  )
}
export function FileButton({
  kind = 'image',
  children,
  onSelect,
  multiple = false,
  className = '',
  disabled = false,
}) {
  const { notify } = useStore()
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return (
    <label className={`btn file-btn ${className}`} aria-disabled={loading || disabled}>
      {loading ? '读取中…' : children}
      <input
        aria-label={typeof children === 'string' ? children : `选择${kind}文件`}
        type="file"
        accept={`${kind}/*`}
        multiple={multiple}
        disabled={loading || disabled}
        onChange={async (e) => {
          const files = [...e.target.files]
          e.target.value = ''
          setLoading(true)
          for (const file of files) {
            try {
              const item = await readMedia(file, kind)
              if (alive.current) await onSelect(item)
            } catch (error) {
              if (alive.current) notify(error.message)
            }
          }
          if (alive.current) setLoading(false)
        }}
      />
    </label>
  )
}
export function MediaPreview({ item, onClose }) {
  const { notify } = useStore()
  const kind = item.kind || (item.url?.endsWith('.mp4') ? 'video' : 'image')
  const url = item.url || item.image
  return (
    <Modal
      title={item.name || '素材预览'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          <Button
            primary
            onClick={() => {
              download(
                url,
                /\.[a-z0-9]{2,5}$/i.test(item.name || '')
                  ? item.name
                  : `${item.name || '素材'}.${kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png'}`,
              )
              notify('已下载当前素材')
            }}
          >
            下载素材
          </Button>
        </>
      }
    >
      {kind === 'image' ? (
        <a href={url} target="_blank" rel="noreferrer"><img loading="lazy" className="preview-image" src={imageUrl(url, 1024)} alt={item.name || '素材'} /></a>
      ) : kind === 'video' ? (
        <video className="preview-video" src={url} controls playsInline />
      ) : (
        <audio controls src={url} />
      )}
    </Modal>
  )
}
export function Models({ image = false, video = false }) {
  return <div className="model-fields"><DirectorSelect /><TextModelSelect type={video ? 'video' : image ? 'image' : 'text'} label={video ? '视频模型' : image ? '图片模型' : '文本模型'} /></div>
}
export function DirectorSelect({ label = '创作导演', disabled }) {
  const { agents, agentSelection, setAgentSelection, currentAgentId } = useStore()
  const available = agents.filter(agent => agent.type !== 'sub_agent' && agent.enabled !== false)
  const selectedId = available.find(agent => agent.id === (agentSelection || currentAgentId))?.id || ''
  return <label className="creative-director-select"><span>{label}</span><select aria-label={label} disabled={disabled} value={selectedId} onChange={event => setAgentSelection(event.target.value)}>{!selectedId && <option value="">请选择 Agent</option>}{available.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
}
export function TextModelSelect({ label = '文本模型', type = 'text', disabled }) {
  const { models, getModel, setModelSelections } = useStore()
  return <label className="text-model-select"><span>{label}</span><select aria-label={label} disabled={disabled} value={getModel(type)?.id || ''} onChange={event => setModelSelections(current => ({ ...current, [type]: event.target.value }))}>{!getModel(type) && <option value="">请选择模型</option>}{models.filter(model => model.type === type && model.enabled !== false).map(model => <option key={model.id} value={model.id}>{model.name || model.displayName}</option>)}</select></label>
}
export function Processing({ busy, cancel, text = '正在提交…' }) {
  return (
    busy && (
      <div className="processing" role="status">
        <span className="spinner" />
        {text}
        {cancel && <Button onClick={cancel}>取消</Button>}
      </div>
    )
  )
}
export function Empty({ children = '暂无内容', action }) {
  return (
    <div className="empty">
      {children}
      {action}
    </div>
  )
}

export function ReferencePicker({
  projectId,
  selected = [],
  onClose,
  onApply,
  assetSelection = false,
  initialKind,
  kinds = ['图片', '视频', '音频', '音色'],
}) {
  const { data, mediaJobs } = useStore()
  const [source, setSource] = useState('资产库')
  const [kind, setKind] = useState(
    initialKind || (assetSelection ? '关联资产' : kinds[0]),
  )
  const [picked, setPicked] = useState([...selected])
  const [uploads, setUploads] = useState([])
  const libraryOptions =
    kind === '关联资产'
      ? data.assets
          .filter((a) => !projectId || a.projectId === projectId)
          .map((a) => ({
            id: a.id,
            name: a.name,
            kind: 'image',
            url: a.image,
            asset: true,
          }))
      : kind === '图片'
        ? [
            ...data.assets
              .filter((a) => !projectId || a.projectId === projectId)
              .map((a) => ({
                id: a.id,
                name: a.name,
                kind: 'image',
                url: a.image,
              })),
            ...data.library.map((a) => ({
              id: a.id,
              name: a.name,
              kind: 'image',
              url: a.image,
            })),
          ]
        : kind === '视频'
          ? data.films.map(item => ({ ...item, name: item.title || item.name, kind: 'video' }))
          : kind === '音色'
            ? data.voices.map((a) => ({ ...a, kind: 'audio' }))
            : data.audio.map((a) => ({ ...a, kind: 'audio' }))
  const generated = mediaJobs.filter(job => job.status === 'completed' && job.type === (kind === '图片' ? 'image' : 'video')).flatMap(job =>
    jobResults(job).filter(result => result.status === 'completed' && result.url).map(result => ({ ...result, kind: job.type, name: job.prompt.trim().slice(0, 80) || '生成结果' })),
  )
  const options = source === '生成记录' ? generated : libraryOptions
  const all = [
    ...options.filter(item => assetSelection || item.url),
    ...uploads.filter(
      (a) =>
        source === '资产库' && a.kind ===
        { 图片: 'image', 视频: 'video', 音频: 'audio', 音色: 'audio' }[kind],
    ),
  ]
  const same = (a, b) => a.id === b.id || (!assetSelection && a.url === b.url)
  function toggle(item) {
    setPicked((old) =>
      old.some((x) => same(x, item))
        ? old.filter((x) => !same(x, item))
        : [...old, item],
    )
  }
  return (
    <Modal
      title={assetSelection ? '关联角色 / 场景 / 道具' : '选择参考素材'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted">已选 {picked.length} 项</span>
          <Button onClick={onClose}>取消</Button>
          <Button primary onClick={() => onApply(picked)}>
            应用选择
          </Button>
        </>
      }
    >
      {!assetSelection && (
        <Tabs
          items={kinds}
          value={kind}
          onChange={value => { setKind(value); setSource('资产库') }}
        />
      )}
      {!assetSelection && ['图片', '视频'].includes(kind) && <Tabs label="素材来源" items={['资产库', '生成记录']} value={source} onChange={setSource} />}
      {!assetSelection && source === '资产库' && (
        <FileButton
          kind={
            { 图片: 'image', 视频: 'video', 音频: 'audio', 音色: 'audio' }[kind]
          }
          onSelect={(item) => {
            setUploads((o) => o.some(existing => same(existing, item)) ? o : [...o, item])
            setPicked((o) => o.some(existing => same(existing, item)) ? o : [...o, item])
          }}
        >
          选择本地文件
        </FileButton>
      )}
      <div className="picker-grid">
        {all.map((item) => (
          <article
            key={item.id}
            className={`picker-card ${picked.some((p) => same(p, item)) ? 'selected' : ''}`}
          >
            {item.kind === 'image' ? (
              item.url ? <img src={imageUrl(item.url, 320)} alt={item.name} loading="lazy" /> : <span className="studio-cover-empty">暂无图片</span>
            ) : item.kind === 'video' ? (
              <video src={item.url} controls playsInline preload="none" />
            ) : (
              <audio src={item.url} controls />
            )}
            <label>
              <input
                type="checkbox"
                checked={picked.some((p) => same(p, item))}
                onChange={() => toggle(item)}
              />
              {item.name}
            </label>
          </article>
        ))}
      </div>
      {!all.length && <Empty>{source === '生成记录' ? '暂无已完成的生成记录' : '暂无内容'}</Empty>}
    </Modal>
  )
}

export function VoiceModal({ asset, onClose }) {
  const { data, update, notify } = useStore()
  const [tab, setTab] = useState('选择已有')
  const [search, setSearch] = useState('')
  const [gender, setGender] = useState('全部')
  const [language, setLanguage] = useState('zh')
  const [selection, setSelection] = useState(asset.voiceId)
  const [description, setDescription] = useState(asset.voiceDescription || '')
  const [name, setName] = useState('')
  const [upload, setUpload] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const { busy, run, cancel } = useAgentTask()
  useEffect(() => {
    if (tab !== '公共音色库') return
    const controller = new AbortController()
    setLoading(true); setError(''); setCatalog([]); setHasMore(false)
    const timer = setTimeout(() => {
      loadVoiceCatalog(search, page, controller.signal, {
        language,
        tags: gender === '全部' ? [] : [gender === '女声' ? 'female' : 'male'],
      }).then(value => {
        if (controller.signal.aborted) return
        setCatalog(value.voices.map(voice => ({ id: voice.id, name: voice.name, url: voice.previewUrl || '', language: voice.languages?.join(' / ') || '', gender: voice.tags?.includes('female') ? '女声' : voice.tags?.includes('male') ? '男声' : '' })))
        setHasMore(value.hasMore)
      }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [tab, search, gender, language, page, revision])
  const selectedVoice = data.voices.find(voice => voice.id === selection) || catalog.find(voice => voice.id === selection)
  async function apply() {
    if (!selectedVoice || saving) return
    setSaving(true)
    try {
      const saved = await update(draft => {
        const current = draft.assets.find(item => item.id === asset.id)
        if (!current) throw new Error('角色已不存在，请重新打开资产页面')
        if (!draft.voices.some(voice => voice.id === selectedVoice.id)) draft.voices.push({ ...selectedVoice, favorite: false })
        current.voiceId = selectedVoice.id
      })
      if (!saved) { setError('音色未保存，请关闭弹窗并重新加载最新数据后重试'); return }
      notify('角色音色已保存')
      onClose()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }
  const voices = tab === '公共音色库' ? catalog.map(voice => ({ ...voice, favorite: data.voices.find(item => item.id === voice.id)?.favorite })) : data.voices.filter(
    (v) =>
      (tab !== '我的收藏' || v.favorite) &&
      v.name.includes(search),
  )
  async function favorite(voice) {
    const saved = await update(draft => {
      const saved = draft.voices.find(item => item.id === voice.id)
      if (saved) saved.favorite = !saved.favorite
      else draft.voices.push({ ...voice, favorite: true })
    })
    if (!saved) setError('收藏未保存，请关闭弹窗并重新加载最新数据后重试')
  }
  function create() {
    if (tab === 'AI 设计' && !description.trim())
      return notify('请填写声音描述')
    if (tab === '上传音频' && (!upload || !name.trim()))
      return notify('请选择有效音频并填写音色名称')
    run({ action: 'voice', projectId: asset.projectId, assetId: asset.id, assetName: asset.name, provider: 'fish', mode: tab, name, description, referenceAudio: upload?.url })
  }
  return (
    <Modal
      title={`${asset.name} · 配置音色`}
      onClose={() => { if (!saving) { cancel(); onClose() } }}
      wide
      footer={
        <>
          <Button disabled={saving} onClick={() => { cancel(); onClose() }}>取消</Button>
          <Button primary disabled={!selectedVoice || busy || saving} onClick={apply}>
            {saving ? '保存中…' : '应用音色'}
          </Button>
        </>
      }
    >
      <Tabs
        items={['选择已有', '公共音色库', '我的收藏', 'AI 设计', '上传音频']}
        value={tab}
        onChange={(v) => {
          cancel()
          setPage(1)
          setGender('全部')
          setError('')
          setTab(v)
        }}
      />
      {['选择已有', '公共音色库', '我的收藏'].includes(tab) ? (
        <>
          <div className="toolbar">
            <input
              aria-label="搜索音色"
              placeholder="搜索音色名称…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {tab === '公共音色库' && (
              <>
                <select
                  aria-label="语言"
                  value={language}
                  onChange={(e) => { setLanguage(e.target.value); setPage(1) }}
                >
                  <option value="zh">中文</option>
                  <option value="en">英文</option>
                  <option value="ja">日语</option>
                </select>
                <select
                  aria-label="性别"
                  value={gender}
                  onChange={(e) => { setGender(e.target.value); setPage(1) }}
                >
                  <option>全部</option>
                  <option>女声</option>
                  <option>男声</option>
                </select>
              </>
            )}
          </div>
          <div className="voice-grid">
            {voices.map((v) => (
              <article
                className={`voice-card ${selection === v.id ? 'selected' : ''}`}
                key={v.id}
              >
                <div className="row">
                  <strong>{v.name}</strong>
                  <Button
                    aria-label={v.favorite ? '取消收藏' : '收藏音色'}
                    onClick={() => favorite(v)}
                  >
                    {v.favorite ? '★' : '☆'}
                  </Button>
                </div>
                <small>
                  {v.language} · {v.gender}
                </small>
                {v.url ? <audio controls preload="none" src={v.url} /> : <small>暂无试听音频</small>}
                <Button
                  primary={selection === v.id}
                  onClick={() => setSelection(v.id)}
                >
                  {selection === v.id ? '已选择' : '选择音色'}
                </Button>
              </article>
            ))}
          </div>
          {loading && <p role="status">正在读取公共音色…</p>}
          {!loading && !error && !voices.length && <Empty>暂无匹配的音色</Empty>}
          {tab === '公共音色库' && <div className="toolbar">
            <Button disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
            <span>第 {page} 页</span>
            <Button disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>下一页</Button>
          </div>}
        </>
      ) : (
        <div className="form-stack">
          {tab === 'AI 设计' ? (
            <>
              <Field label="声音描述">
                <textarea
                  aria-label="声音描述"
                  rows={4}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="试听文本">
                <textarea
                  defaultValue="有些故事，值得再讲一次。"
                  maxLength={500}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="音色名称">
                <input
                  aria-label="音色名称"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <FileButton kind="audio" onSelect={setUpload}>
                选择本地音频
              </FileButton>
              {upload && (
                <div>
                  <audio controls src={upload.url} />
                  <Button onClick={() => setUpload(null)}>移除音频</Button>
                </div>
              )}
            </>
          )}
          <Button primary disabled={busy} onClick={create}>
            {tab === 'AI 设计' ? '设计音色' : '克隆音色'}
          </Button>
          <Processing busy={busy} cancel={cancel} />

        </div>
      )}
      {error && <p role="alert">{error}{tab === '公共音色库' && <Button disabled={loading} onClick={() => setRevision(value => value + 1)}>重试</Button>}</p>}
    </Modal>
  )
}
