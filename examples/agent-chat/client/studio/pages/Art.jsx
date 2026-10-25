import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StyleSelector } from '@darl/ui'
import { createWorkspaceStyle, styleOptionsFromCatalog } from '../../workspace-styles'
import { Workflow, useProject } from '../components/Shell'
import { VoiceModal, Confirm } from '../components/ui'
import { studioApi, useStore } from '../store'
import { types } from '../data'
import ArtAssetDrawer from '../components/ArtAssetDrawer'
import { assetJob, canBatchGenerate, generateAssetBatch, jobLabel, pendingJob } from '../art'
import { SourceEvidence, SupplementAsset, MergeAsset } from '../components/VideoRedraw'

export default function Art() {
  const context = useProject()
  return (
    <Workflow context={context} projectLevel>
      {context.project && (
        <ArtWorkspace key={context.projectId} context={context} />
      )}
    </Workflow>
  )
}
function ArtWorkspace({ context }) {
  const { projectId } = context
  const { data, update, patch, notify, generateMedia, mediaJobs, models, getModel, setModelSelections, reload } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState('全部')
  const [episodeId, setEpisodeId] = useState('')
  const [editor, setEditor] = useState(null)
  const [voice, setVoice] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [merging, setMerging] = useState(null)
  const [generationView, setGenerationView] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [styles, setStyles] = useState([])
  const [styleOpen, setStyleOpen] = useState(false)
  const [styleBusy, setStyleBusy] = useState(false)
  const selectedStyle = styles.find(style => style.id === String(context.project.style_catalog_id))
  useEffect(() => {
    const controller = new AbortController()
    studioApi('workspace/styles', undefined, controller.signal).then(value => setStyles(styleOptionsFromCatalog(value.data))).catch(reason => { if (!controller.signal.aborted) notify(reason.message) })
    return () => controller.abort()
  }, [styleOpen])
  async function saveStyle(style) {
    if (!style || style.id === String(context.project.style_catalog_id)) return
    setStyleBusy(true)
    try {
      const saved = await patch('projects', projectId, { style_catalog_id: Number(style.id) })
      if (saved) notify(`项目视觉风格已设为「${style.name}」`)
    } finally { setStyleBusy(false) }
  }
  const assets = data.assets.filter((a) => a.projectId === projectId && (!episodeId || a.episodeIds?.includes(episodeId) || data.clips.some((clip) => clip.episodeId === episodeId && clip.assetIds.includes(a.id)) || data.shots.some((shot) => shot.episodeId === episodeId && shot.dialogue.some((line) => line.assetId === a.id))))
  const [batchBusy, setBatchBusy] = useState(false)
  const batch = useRef(null)
  useEffect(() => () => batch.current?.abort(), [])
  const visibleAssets = assets.filter(asset => tab === '全部' || asset.type === tab)
  async function generateBatch() {
    if (batch.current) return
    const controller = new AbortController()
    batch.current = controller
    setBatchBusy(true)
    try {
      const { submitted, failed } = await generateAssetBatch(visibleAssets, {
        jobs: mediaJobs, generateMedia, reload, view: generationView, customPrompt, styleId: context.project.style_catalog_id, signal: controller.signal,
        readJob: (id, signal) => studioApi(`media-generation/jobs/${id}`, undefined, signal),
      })
      if (!controller.signal.aborted) notify(`已提交 ${submitted.length} 项${failed.length ? `；失败 ${failed.length} 项：${failed.join('；')}` : ''}`)
    } catch (reason) {
      if (!controller.signal.aborted) notify(reason.message)
    } finally {
      if (!controller.signal.aborted) setBatchBusy(false)
      if (batch.current === controller) batch.current = null
    }
  }
  return (
    <div className={`page-art ${context.project.creationMode === 'video-redraw' ? 'page-art--redraw' : ''}`}>
      <div className="art-page">
        <div className="art-workspace">
          <main className="art-main">
            <header className="art-toolbar">
              <div className="art-toolbar__left">
                <label className="sb-episode-pick art-episode-filter"><span>范围</span><select aria-label="筛选资产剧集" value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}><option value="">全项目资产</option>{context.episodes.map((item) => <option key={item.id} value={item.id}>第{item.number}集 · {item.title}</option>)}</select></label>
                <nav className="asset-tabs" aria-label="资产类型">
                  {['全部', ...types].map((t) => (
                    <button
                      key={t}
                      className={tab === t ? 'active' : ''}
                      onClick={() => setTab(t)}
                    >
                      {t}｜
                      {String(
                        assets.filter((a) => t === '全部' || a.type === t)
                          .length,
                      ).padStart(2, '0')}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="art-toolbar__right">
                <button className="tool-btn art-style-select" aria-label="选择项目视觉风格" title={selectedStyle?.description} disabled={batchBusy || styleBusy} onClick={() => setStyleOpen(true)}>
                  {styleBusy ? '正在保存风格…' : `视觉风格：${selectedStyle?.name || '请选择'}`}
                </button>
                <select
                  className="batch-view-select"
                  aria-label="批量生成模式"
                  value={generationView}
                  onChange={(e) => setGenerationView(e.target.value)}
                  disabled={batchBusy}
                >
                  <option value="">{{ 角色: '一致性图', 场景: '场景空镜', 道具: '道具图' }[tab] || '角色一致性图 / 场景空镜 / 道具图'}</option>
                  {[
                    '一致性图',
                    '面部特写',
                    '场景四视图',
                    '自定义',
                  ].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                {generationView === '自定义' && (
                  <input
                    className="batch-custom-input"
                    aria-label="自定义提示词"
                    maxLength={5000}
                    placeholder="请输入自定义提示词"
                    value={customPrompt}
                    disabled={batchBusy}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                  />
                )}
                <select className="model-select" aria-label="图片模型" disabled={batchBusy} value={getModel('image')?.id || ''} onChange={event => setModelSelections(current => ({ ...current, image: event.target.value }))}>
                  {!getModel('image') && <option value="">请选择图片模型</option>}
                  {models.filter(model => model.type === 'image').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <button
                  className="tool-btn"
                  disabled={
                    !visibleAssets.some(asset => canBatchGenerate(asset, mediaJobs)) || batchBusy || styleBusy || !selectedStyle ||
                    (generationView === '自定义' && !customPrompt.trim())
                  }
                  onClick={() =>
                    generateBatch()
                  }
                >
                  {batchBusy ? '批量补图中…' : '☷　批量补齐缺图'}
                </button>
              </div>
            </header>
            <section className="asset-scroll">
              {!visibleAssets.length && <p className="empty">当前范围暂无{tab === '全部' ? '资产，请切换分类添加资产' : `${tab}，可添加资产`}。</p>}
              <div className="asset-grid">
                {assets
                  .filter((a) => tab === '全部' || a.type === tab)
                  .map((a) => {
                    const job = assetJob(mediaJobs, a.id)
                    const generating = pendingJob(job)
                    return (
                    <article
                      className={`asset-card asset-card--${{ 角色: 'character', 场景: 'scene', 道具: 'prop' }[a.type]}`}
                      key={a.id}
                    >
                      <div
                        className={`asset-card__preview ${!a.image ? 'empty' : ''} ${generating ? 'generating' : ''} ${job?.error ? 'failed' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`编辑${a.name}`}
                        onClick={() => setEditor(a)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditor(a) }
                        }}
                      >
                        {a.image ? (
                          <img
                            src={imageUrl(a.image, 320)}
                            alt={a.name}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="empty-mark">+</span>
                        )}
                        {generating && <span className="generation-status" role="status"><i />{jobLabel(job)}</span>}
                        {a.variants.length > 0 && (
                          <span className="asset-card__costumes">
                            {a.variants.length} 个
                            {a.type === '角色' ? '服饰' : '衍生形态'}
                          </span>
                        )}
                        <span className="asset-card__actions">
                          <button
                            title="删除"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleting(a)
                            }}
                          >
                            删除
                          </button>
                        </span>
                      </div>
                      <div className="asset-card__meta">
                        <div className="asset-card__name">
                          {a.type === '角色' && (
                            <span className="role-tag">{a.role || '角色'}</span>
                          )}
                          <b>{a.name}</b>
                          {a.alias && <span>（别名：{a.alias}）</span>}
                        </div>
                        <p>{a.description}</p>
                        {a.source && <SourceEvidence source={a.source} />}
                        {a.source && <button className="btn" onClick={() => setMerging(a.id)}>合并重复主体</button>}
                        {job?.error && <p className="asset-card__error" role="alert">{jobLabel(job)}：{job.error}</p>}
                        {a.type === '角色' && (
                          <button
                            className="voice-btn"
                            onClick={() => setVoice(a)}
                          >
                            {a.voiceId ? '已配置音色' : '配置音色'}
                          </button>
                        )}
                      </div>
                    </article>
                  )})}
                {tab !== '全部' && (
                  <button
                    className="asset-card asset-card--add"
                    onClick={() => setEditor('new')}
                  >
                    <span className="add-plus">＋</span>
                    <span>添加{tab}</span>
                  </button>
                )}
              </div>
            </section>
            <div className="next-actions">
              <button
                className="next-btn"
                onClick={() => {
                  context.episodes.forEach((e) =>
                    patch('episodes', e.id, { stage: Math.max(e.stage, 4) }),
                  )
                  navigate(
                    `/storyboard?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(context.episodes[0]?.id || '')}`,
                  )
                }}
              >
                ▦　进入下一步
              </button>
            </div>
          </main>
        </div>
        {editor === 'new' && context.project.creationMode === 'video-redraw' ? <SupplementAsset context={context} onClose={() => setEditor(null)} /> : editor && (
          <ArtAssetDrawer
            asset={
              editor === 'new'
                ? null
                : data.assets.find((a) => a.id === editor.id)
            }
            projectId={projectId}
            episodeIds={episodeId ? [episodeId] : context.episodes.map((item) => item.id)}
            defaultType={tab === '全部' ? '角色' : tab}
            onClose={() => setEditor(null)}
            onDelete={setDeleting}
          />
        )}
        {voice && data.assets.some(a => a.id === voice.id) && (
          <VoiceModal
            asset={data.assets.find((a) => a.id === voice.id)}
            onClose={() => setVoice(null)}
          />
        )}
        {merging && data.assets.find(asset => asset.id === merging) && <MergeAsset context={context} asset={data.assets.find(asset => asset.id === merging)} onClose={() => setMerging(null)} />}
        {deleting && (
          <Confirm
            danger
            title="删除资产"
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              if (data.shots.some(shot => shot.dialogue.some(line => line.assetId === deleting.id))) return notify('该角色已用于分镜对白，请先移除对白关联')
              const saved = await update((d) => {
                d.assets = d.assets.filter((a) => a.id !== deleting.id)
                d.clips.forEach((s) => {
                  s.assetIds = s.assetIds.filter((a) => a !== deleting.id)
                })
                d.shots.forEach(shot => { if (shot.assetIds) shot.assetIds = shot.assetIds.filter(id => id !== deleting.id) })
              })
              if (!saved) return
              setDeleting(null)
              setEditor(null)
              notify('资产已删除')
            }}
          >
            确认删除「{deleting.name}」？关联视频片段也会移除该资产。
          </Confirm>
        )}
      </div>
      <StyleSelector styles={styles} open={styleOpen} onOpenChange={setStyleOpen} value={String(context.project.style_catalog_id)} onChange={saveStyle} onCreate={async input => {
        await createWorkspaceStyle(input)
        const catalog = await studioApi('workspace/styles')
        setStyles(styleOptionsFromCatalog(catalog.data))
      }} />
    </div>
  )
}
