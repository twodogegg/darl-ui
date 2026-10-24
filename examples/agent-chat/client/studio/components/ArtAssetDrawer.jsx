import { resolveAssetDependencies, assetDependenciesChanged, validateAssetDependencies } from '../../../asset-dependencies'
import { useEffect, useRef, useState } from 'react'
import { SourceEvidence } from './VideoRedraw'
import { useStore } from '../store'
import { id } from '../data'
import { download, readMedia } from '../files'
import { assetImageRequest, assetJob, assetViews, jobLabel, pendingJob } from '../art'
import {
  Modal,
  Field,
  Button,
  FileButton,
  MediaPreview,
  Confirm,
  ReferencePicker,
} from './ui'

export default function ArtAssetDrawer({
  asset,
  projectId,
  episodeIds = [],
  defaultType,
  onClose,
}) {
  const { update, notify, generateMedia, reload, data, models, getModel, mediaJobs, mediaDefaults, setModelSelections } = useStore()
  const [form, setForm] = useState(
    asset || {
      id: id(),
      projectId,
      episodeIds,
      name: '',
      type: defaultType,
      description: '',
      appearance: '',
      costume: '',
      voiceDescription: '',
      prompt: '',
      image: '',
      dependencies: [],
      imageDependencies: {},
      variants: [],
      history: [],
    },
  )
  const [selected, setSelected] = useState(null)
  const [historyIndex, setHistoryIndex] = useState(null)
  const [variantForm, setVariantForm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [preview, setPreview] = useState(null)
  const [picker, setPicker] = useState(false)
  const [editImage, setEditImage] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [view, setView] = useState(
    form.type === '角色'
      ? '一致性图'
      : form.type === '场景'
        ? '场景空镜'
        : '道具图',
  )
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadPending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [options, setOptions] = useState({})
  const savedForm = useRef(form)
  const liveAsset = data.assets.find(item => item.id === form.id) || asset
  useEffect(() => {
    if (!liveAsset || liveAsset._version === savedForm.current._version) return
    if (JSON.stringify(form) !== JSON.stringify(savedForm.current)) return
    savedForm.current = liveAsset
    setForm(liveAsset)
    setHistoryIndex(null)
  }, [liveAsset, form])
  const model = getModel('image')
  const resolution = options.resolution || (mediaDefaults.image?.modelId === model?.id ? mediaDefaults.image?.resolution : model?.defaults?.resolution) || model?.capabilities?.resolutions?.[0]
  const aspectRatio = options.aspectRatio || '16:9'
  const job = assetJob(mediaJobs, form.id, selected)
  const generating = busy || uploading || pendingJob(job)
  const stale = liveAsset && liveAsset._version !== form._version

  const variant = form.variants.find((v) => v.id === selected)
  const current = variant || form
  const history = [...new Set([...(current.history || []), current.image].filter(Boolean))]
  const image = historyIndex === null ? current.image : history[historyIndex] || ''
  const dependencyAssets = data.assets.filter(item => item.projectId === projectId && item.id !== form.id)
  const dependencyChoices = dependencyAssets.flatMap(item => [{ assetId: item.id, name: `${item.name} / 主形象` }, ...item.variants.map(variant => ({ assetId: item.id, variantId: variant.id, name: `${item.name} / ${variant.name}` }))])
  let dependencyError = ''
  try {
    validateAssetDependencies([...data.assets.filter(item => item.id !== form.id), form])
    resolveAssetDependencies(form, data.assets)
  } catch (reason) { dependencyError = reason.message }
  const dependencyChanged = assetDependenciesChanged(form, current, data.assets, image)
  const change = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const changeCurrent = (key, value) => selected
    ? setForm(f => ({ ...f, variants: f.variants.map(v => v.id === selected ? { ...v, [key]: value } : v) }))
    : change(key, value)
  function changeImage(url) {
    setForm(f => selected
      ? { ...f, variants: f.variants.map(v => v.id === selected ? { ...v, image: url, history: [...new Set([url, ...(v.history || []), v.image].filter(Boolean))] } : v) }
      : { ...f, image: url, history: [...new Set([url, ...f.history, f.image].filter(Boolean))] })
    setHistoryIndex(null)
  }
  async function pasteImage(event) {
    if (generating || uploadPending.current || !event.currentTarget.contains(event.target)
      || event.target.closest('input, textarea, select') || event.target.isContentEditable) return
    const file = Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    uploadPending.current = true
    setUploading(true)
    try {
      const item = await readMedia(file)
      if (mounted.current) changeImage(item.url)
    } catch (reason) { if (mounted.current) notify(reason.message) }
    finally { uploadPending.current = false; if (mounted.current) setUploading(false) }
  }
  async function persist() {
    if (!form.name.trim()) throw new Error('请输入资产名称')
    const exists = data.assets.find(item => item.id === form.id)
    if (!exists && form._version) throw new Error('资产已被删除，请关闭后重新选择')
    if (exists && exists._version !== form._version) throw new Error('资产已被其他操作修改，草稿已保留，请核对后重新打开')
    const result = { ...form, name: form.name.trim(), ...(selected ? { variants: form.variants.map(v => v.id === selected ? { ...v, image } : v) } : { image }) }
    const saved = await update(draft => {
      const index = draft.assets.findIndex(item => item.id === result.id)
      if (index >= 0) draft.assets[index] = result
      else draft.assets.push(result)
    })
    if (!saved) throw new Error('资产未保存，请先处理保存错误')
    const latest = (await reload()).assets.find(item => item.id === form.id)
    savedForm.current = latest
    setForm(latest)
    setHistoryIndex(null)
    return latest
  }
  async function save() {
    if (generating) return
    setBusy(true)
    try { await persist(); notify(`已确认${form.type}，保存到当前项目`); onClose() }
    catch (reason) { notify(reason.message) }
    finally { setBusy(false) }
  }
  async function generate() {
    if (generating) return
    setBusy(true)
    try {
      if (dependencyError) throw new Error(dependencyError)
      const request = assetImageRequest(form, { variantId: selected, view, customPrompt: current.prompt || '', ...(editImage ? { editPrompt, image } : {}) })
      const latest = await persist()
      await generateMedia({ ...request, target: { resource: 'assets', id: latest.id, field: 'image', ...(selected ? { variantId: selected } : {}) }, options })
      setEditImage(false)
      setEditPrompt('')
    } catch (reason) { notify(reason.message) }
    finally { setBusy(false) }
  }
  return (
    <>
      <Modal
        title={form.name || '添加资产'}
        onClose={onClose}
        onPaste={pasteImage}
        drawer
        panelClassName="asset-drawer__panel"
        maskClassName="asset-drawer"
        bodyClassName="asset-drawer__content"
        header={
          <header className="asset-drawer__header">
            <div>
              <h3>
                {form.name || `添加${form.type}`}
                {variant && `｜${variant.name}`}
              </h3>
              <div className="asset-drawer__episodes">项目共享资产</div>
            </div>
            <div className="asset-drawer__header-actions">
              <button className="primary" disabled={generating} onClick={save}>
                确认{form.type}
              </button>
              <button disabled={generating} onClick={() => setPicker(true)}>从资产库提取</button>
              <button
                disabled={!image}
                onClick={() => {
                  download(image, `${form.name || '示例'}-${form.type}.png`)
                  notify('已下载当前图片')
                }}
              >
                下载{form.type}图
              </button>
              {selected && (
                <button onClick={() => setVariantForm({ ...variant })}>
                  改名
                </button>
              )}
              <button className="icon" aria-label="关闭" onClick={onClose}>
                ×
              </button>
            </div>
          </header>
        }
      >
        {form.source && <div className="redraw-drawer-source"><SourceEvidence source={form.source} /><label><input type="checkbox" checked={form.source.confirmed === true} onChange={event => change('source', { ...form.source, confirmed: event.target.checked })} />已核对原片主体与目标设定</label><Field label="原片主体描述"><textarea value={form.source.description || ''} onChange={event => change('source', { ...form.source, description: event.target.value })} /></Field></div>}
        {!liveAsset && <fieldset className="asset-drawer__fields" disabled={generating}>
          <div className="new-asset-fields">
            <Field label="资产名称">
              <input
                aria-label="资产名称"
                maxLength={100}
                value={form.name}
                onChange={(e) => change('name', e.target.value)}
              />
            </Field>
          </div>
          </fieldset>}
        <div className="asset-drawer__workspace">
          <div className="asset-drawer__preview" role="region" aria-label="图片预览区，可粘贴图片" tabIndex={0}>
            {image ? (
              <button
                className="asset-drawer__image"
                aria-label="查看大图"
                onClick={() => setPreview({ name: form.name, url: image })}
              >
                <img src={image} alt={form.name} />
              </button>
            ) : (
              <div className="asset-drawer__empty">
                <span>暂无形象</span>
                <small>可直接粘贴图片上传</small>
                <FileButton disabled={generating} onSelect={(item) => changeImage(item.url)}>
                  选择本地图片
                </FileButton>
              </div>
            )}
            {generating && (
              <div className="asset-drawer__loading" role="status">
                <i />
                <span>{uploading ? '正在上传…' : busy ? '正在提交…' : jobLabel(job)}</span>
              </div>
            )}
        {stale && <p className="asset-drawer__status" role="alert">资产已更新，当前草稿已保留。请核对后重新打开。</p>}
        {job && !pendingJob(job) && <p className={`asset-drawer__status ${job.error ? 'error' : ''}`} role="status">{jobLabel(job)}{job.error ? `：${job.error}` : job.status === 'completed' ? '，可从历史图片选择并确认保存。' : ''}</p>}
            <div className="asset-drawer__image-actions">
              <button
                disabled={!image || generating}
                onClick={() => setEditImage(true)}
              >
                改图
              </button>
              <button
                className="danger"
                disabled={!image || generating}
                onClick={() => setDeleting('image')}
              >
                删除
              </button>
            </div>
          </div>
          <aside className="asset-drawer__history">
            {history.map((url, i) => (
              <button
                className={image === url ? 'active' : ''}
                key={i}
                onClick={() => setHistoryIndex(i)}
              >
                <span>
                  {i === 0 ? '最新图片' : `历史图片 ${history.length - i}`}
                </span>
                <img src={url} alt={`历史图片${i + 1}`} />
              </button>
            ))}
          </aside>
        </div>
        <fieldset className="asset-drawer__fields" disabled={generating}><div className="asset-drawer__variants">
          <button
            className={`variant ${!selected ? 'active' : ''}`}
            onClick={() => {
              setSelected(null)
              setHistoryIndex(null)
            }}
          >
            {form.image ? <img src={form.image} alt="主形象" /> : <i />}
            <span>
              {form.type === '角色'
                ? '主形象'
                : form.type === '场景'
                  ? '主场景图'
                  : '主道具图'}
            </span>
          </button>
          {form.variants.map((v) => (
            <button
              key={v.id}
              className={`variant ${selected === v.id ? 'active' : ''}`}
              onClick={() => {
                setSelected(v.id)
                setHistoryIndex(null)
              }}
            >
              {v.image ? <img src={v.image} alt={v.name} /> : <i />}
              <span>{v.name}</span>
              <b
                role="button"
                aria-label={`删除${v.name}`}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleting(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    setDeleting(v)
                  }
                }}
              >
                ×
              </b>
            </button>
          ))}
          <button
            className="variant add"
            onClick={() =>
              setVariantForm({
                id: id(),
                name: '',
                description: '',
                prompt: '',
                image: '',
                history: [],
              })
            }
          >
            <span className="plus">＋</span>
            <span>
              {form.type === '角色'
                ? '添加变装'
                : form.type === '场景'
                  ? '添加衍生场景'
                  : '添加衍生道具'}
            </span>
          </button>
        </div>
        <section className="asset-drawer__generator" aria-label="依赖资产">
          <div className="row"><h4>{form.dependencies?.length ? '融合资产 · 依赖图片' : '依赖资产'}</h4><Button disabled={!dependencyChoices.some(choice => !(form.dependencies || []).some(item => item.assetId === choice.assetId && (item.variantId || '') === (choice.variantId || '')))} onClick={() => {
            const choice = dependencyChoices.find(choice => !(form.dependencies || []).some(item => item.assetId === choice.assetId && (item.variantId || '') === (choice.variantId || '')))
            if (choice) { const { name, ...reference } = choice; change('dependencies', [...(form.dependencies || []), { ...reference, purpose: '' }]) }
          }}>添加依赖资产</Button></div>
          <p className="muted">引用人物或物体形象时选择对应资产。依赖图片准备好后才能生成，参考图将自动传入。</p>
          {(form.dependencies || []).map((dependency, index) => {
            const source = dependencyAssets.find(item => item.id === dependency.assetId)
            const reference = dependency.variantId ? source?.variants.find(item => item.id === dependency.variantId) : source
            const edit = patch => change('dependencies', form.dependencies.map((item, i) => i === index ? { ...item, ...patch } : item))
            return <div key={index} className="asset-drawer__dependency">
              {reference?.image && <img src={reference.image} alt="依赖参考图" style={{ width: 64, height: 64, objectFit: 'contain' }} />}
              <Field label={`依赖形象 ${index + 1}`}><select aria-label={`依赖形象 ${index + 1}`} value={JSON.stringify({ assetId: dependency.assetId, ...(dependency.variantId ? { variantId: dependency.variantId } : {}) })} onChange={event => {
                const value = JSON.parse(event.target.value); edit({ ...value, variantId: value.variantId || '' })
              }}><option value="" disabled>选择资产与形态</option>{dependencyChoices.map(({ name, ...value }) => <option key={JSON.stringify(value)} value={JSON.stringify(value)}>{name}</option>)}</select></Field>
              <Field label={`参考用途 ${index + 1}`}><input aria-label={`参考用途 ${index + 1}`} placeholder="例如：仅作为照片内人物的身份参考" value={dependency.purpose} maxLength={1000} onChange={event => edit({ purpose: event.target.value })} /></Field>
              <Button onClick={() => change('dependencies', form.dependencies.filter((_, i) => i !== index))}>移除依赖 {index + 1}</Button>
              {!reference?.image && <p role="status">等待依赖图片</p>}
            </div>
          })}
          {dependencyError && <p role="alert">{dependencyError}</p>}
          {dependencyChanged && <p role="status">当前图片的依赖形象已更新或尚未记录引用，请重新生成后核对。</p>}
        </section>
        <section className="asset-drawer__generator">
          <div
            className={`asset-drawer__parameters ${form.type === '角色' ? 'asset-drawer__character-parameters' : ''}`}
          >
            {(form.type === '角色'
              ? [
                  ['description', '主体人物（性别 / 年龄 / 身份 / 性格）'],
                  ['appearance', '外貌特征（五官 / 体型 / 发型 / 肤色）'],
                  ['costume', `服饰（${variant?.name || '主形象'}）`],
                  ['voiceDescription', '声音描述（音色 / 语速 / 语气）'],
                ]
              : [
                  ['description', `${form.type}描述`],
                  ['prompt', `${form.type}生图提示词`],
                ]
            ).map(([key, label]) => (
              <label
                className={
                  key === 'voiceDescription'
                    ? 'asset-drawer__voice-description'
                    : ''
                }
                key={key}
              >
                <span>{label}</span>
                <textarea
                  aria-label={label}
                  maxLength={key === 'voiceDescription' ? 1000 : 5000}
                  value={
                    variant && (key === 'costume' || (key === 'description' && form.type !== '角色') || key === 'prompt')
                      ? variant[key === 'costume' ? 'description' : key] || ''
                      : form[key] || ''
                  }
                  onChange={(e) => {
                    if (key === 'costume' && variant) changeCurrent('description', e.target.value)
                    else if ((key === 'description' && form.type !== '角色') || key === 'prompt') changeCurrent(key, e.target.value)
                    else change(key, e.target.value)
                  }}
                />
              </label>
            ))}
          </div>
          {view === '自定义' && (
            <label className="asset-drawer__custom-prompt">
              <span>提示词设置</span>
              <textarea
                aria-label="自定义生图提示词"
                maxLength={5000}
                value={current.prompt || ''}
                onChange={(e) => changeCurrent('prompt', e.target.value)}
              />
            </label>
          )}
          <div className="asset-drawer__generator-row">
            <select aria-label="图片模型" value={model?.id || ''} onChange={event => { setModelSelections(current => ({ ...current, image: event.target.value })); setOptions({}) }}>{!model && <option value="">请选择图片模型</option>}{models.filter(model => model.type === 'image').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
            <select
              aria-label="生成视图"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              {assetViews(form.type).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {model?.capabilities?.resolutions?.length > 0 && <select aria-label="图片清晰度" value={resolution} onChange={event => setOptions(current => ({ ...current, resolution: event.target.value }))}>{model.capabilities.resolutions.map(value => <option key={value}>{value}</option>)}</select>}
            {model?.capabilities?.aspectRatios?.length > 0 && <select aria-label="图片画幅" value={aspectRatio} onChange={event => setOptions(current => ({ ...current, aspectRatio: event.target.value }))}>{model.capabilities.aspectRatios.map(value => <option key={value}>{value}</option>)}</select>}
            {generating ? (
              <button className="cancel-generation" disabled>
                {busy ? '正在提交…' : jobLabel(job)}
              </button>
            ) : (
              <button className="generate" disabled={Boolean(dependencyError)} onClick={generate}>
                生成图片
              </button>
            )}
          </div>
        </section></fieldset>

      </Modal>
      {variantForm && (
        <Modal
          title={form.type === '角色' ? '编辑变装' : '编辑衍生形态'}
          onClose={() => setVariantForm(null)}
          footer={
            <>
              <Button onClick={() => setVariantForm(null)}>取消</Button>
              <Button
                primary
                disabled={!variantForm.name.trim()}
                onClick={() => {
                  change('variants', [
                    ...form.variants.filter((v) => v.id !== variantForm.id),
                    variantForm,
                  ])
                  setSelected(variantForm.id)
                  setHistoryIndex(null)
                  setVariantForm(null)
                }}
              >
                确认
              </Button>
            </>
          }
        >
          <Field label="名称">
            <input
              aria-label="名称"
              maxLength={100}
              value={variantForm.name}
              onChange={(e) =>
                setVariantForm((v) => ({ ...v, name: e.target.value }))
              }
            />
          </Field>
          <Field label="描述">
            <textarea
              aria-label="描述"
              maxLength={5000}
              value={variantForm.description}
              onChange={(e) =>
                setVariantForm((v) => ({ ...v, description: e.target.value }))
              }
            />
          </Field>
        </Modal>
      )}
      {picker && (
        <ReferencePicker
          projectId={projectId}
          onClose={() => setPicker(false)}
          onApply={(items) => {
            const item = items.find((i) => i.kind === 'image')
            if (!item) return notify('请选择一张图片')
            changeImage(item.url)
            setPicker(false)
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={deleting === 'image' ? '删除图片' : '删除形态'}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting === 'image') {
              const next = history.filter(url => url !== image)
              if (selected)
                change(
                  'variants',
                  form.variants.map((v) =>
                    v.id === selected
                      ? { ...v, image: next[0] || '', history: next }
                      : v,
                  ),
                )
              else
                setForm((f) => ({ ...f, image: next[0] || '', history: next }))
              setHistoryIndex(null)
            } else {
              change(
                'variants',
                form.variants.filter((v) => v.id !== deleting.id),
              )
              if (selected === deleting.id) setSelected(null)
            }
            setDeleting(null)
          }}
        >
          确认删除当前{deleting === 'image' ? '图片' : '形态'}
          ？确认资产后保存到项目。
        </Confirm>
      )}
      {editImage && (
        <Modal
          title="改图"
          onClose={() => {
            setEditImage(false)
          }}
          wide
          footer={
            <>
              <Button
                onClick={() => {
                  setEditImage(false)
                }}
              >
                取消
              </Button>
              <Button
                primary
                disabled={generating || !editPrompt.trim()}
                onClick={generate}
              >
                生成改图
              </Button>
            </>
          }
        >
          <div className="image-edit-layout">
            <img src={image} alt="原图" />
            <Field label="修改要求">
              <textarea
                aria-label="修改要求"
                value={editPrompt}
                maxLength={5000}
                rows={8}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      )}
      {preview && (
        <MediaPreview item={preview} onClose={() => setPreview(null)} />
      )}
    </>
  )
}
