import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StyleSelector } from '@darl/ui'
import { createWorkspaceStyle, styleOptionsFromCatalog } from '../../workspace-styles'
import { Workflow, useProject } from '../components/Shell'
import { VoiceModal, Confirm, Modal, Button, Field } from '../components/ui'
import { studioApi, useStore } from '../store'
import { types } from '../data'
import ArtAssetDrawer from '../components/ArtAssetDrawer'
import { assetJob, canBatchGenerate, generateAssetBatch, jobLabel, pendingJob } from '../art'
import { AssetSourceEvidence, SupplementAsset } from '../components/VideoRedraw'

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
  const [transitioning, setTransitioning] = useState(false)
  const [extraction, setExtraction] = useState(null)
  const [extractionOpen, setExtractionOpen] = useState(false), [extractionRequirements, setExtractionRequirements] = useState('')
  const extractionEpisode = episodeId || new URLSearchParams(window.location.search).get('episodeId') || context.episodes[0]?.id
  useEffect(() => {
    if (context.project.creationMode !== 'video-redraw' || !extractionEpisode) return
    const controller = new AbortController()
    const params = new URLSearchParams({ projectId, episodeId: extractionEpisode })
    studioApi(`video-redraw/status?${params}`, undefined, controller.signal).then(async result => {
      const job = result.jobs.find(item => item.kind === 'extract-assets')
      if (!job) { setExtraction(null); return }
      setExtraction(job)
      if (['queued', 'running'].includes(job.status)) {
        params.set('jobId', job.id)
        const done = await studioApi(`video-redraw/wait?${params}`, undefined, controller.signal)
        setExtraction(done)
        if (done.status === 'completed') await reload()
      }
    }).catch(error => { if (!controller.signal.aborted) setExtraction({ status: 'failed', error: error.message }) })
    return () => controller.abort()
  }, [projectId, extractionEpisode, extraction?.refresh])
  async function extractAssets() {
    try {
      const latest = await reload()
      const project = latest.projects.find(item => item.id === projectId)
      const job = await studioApi('video-redraw/action', { action: 'extract-assets', projectId, episodeId: extractionEpisode, requestId: crypto.randomUUID(), version: project._version, requirements: extractionRequirements.trim() })
      setExtraction({ ...job, refresh: Date.now() }); setExtractionOpen(false)
    } catch (error) { setExtraction({ status: 'failed', error: error.message }) }
  }
  const isRedraw = context.project.creationMode === 'video-redraw'
  const imageReadiness = (allAssets, jobs) => {
    const projectAssets = allAssets.filter(asset => asset.projectId === projectId)
    const ids = new Set(projectAssets.map(asset => asset.id))
    const missing = projectAssets.reduce((count, asset) => count + (asset.image ? 0 : 1) + (asset.variants || []).filter(variant => !variant.image).length, 0)
    const running = jobs.some(job => job.type === 'image' && pendingJob(job) && job.options?.studioTarget?.resource === 'assets' && ids.has(job.options.studioTarget.id))
    return { ready: projectAssets.length > 0 && missing === 0 && !running, missing, running }
  }
  const readiness = imageReadiness(data.assets, mediaJobs)
  async function nextStep() {
    if (transitioning) return
    setTransitioning(true)
    try {
      if (isRedraw) {
        const [latest, jobs] = await Promise.all([reload(), studioApi('media-generation/jobs')])
        if (!imageReadiness(latest.assets, jobs).ready) { notify('请先完成所有资产主图和衍生形态图片'); return }
      }
      const episode = context.episodes.find(item => item.id === extractionEpisode) || context.episodes[0]
      if (!episode) { notify('请先创建剧集'); return }
      const saved = await update(draft => {
        draft.episodes.filter(item => item.projectId === projectId && (!isRedraw || item.id === episode.id)).forEach(item => { item.stage = Math.max(item.stage, 4) })
      })
      if (!saved) return
      navigate(`/video?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(episode.id)}${isRedraw ? '&promptSetup=1' : ''}`)
    } catch (reason) { notify(`进入下一步失败：${reason.message}`) }
    finally { setTransitioning(false) }
  }
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
                {isRedraw && <><span role="status">{['queued', 'running'].includes(extraction?.status) ? '正在提取美术资产…' : extraction?.status === 'failed' || extraction?.status === 'interrupted' || extraction?.status === 'cancelled' ? `资产提取${extraction.status === 'cancelled' ? '已取消' : '失败'}：${extraction.error || '请重试'}` : extraction?.status === 'completed' ? '资产提取完成' : ''}</span><button className="tool-btn" disabled={!extractionEpisode || ['queued', 'running'].includes(extraction?.status)} onClick={() => setExtractionOpen(true)}>重新提取资产</button></>}
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
                        {a.source && <AssetSourceEvidence source={a.source} />}
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
              {isRedraw && !readiness.ready && <span className="next-hint" role="status">{readiness.running || batchBusy ? '图片生成中，请等待完成' : readiness.missing ? `还有 ${readiness.missing} 张资产图片未生成` : '请先添加资产并生成图片'}</span>}
              <button
                className="next-btn"
                disabled={transitioning || (isRedraw && (!readiness.ready || batchBusy || ['queued', 'running'].includes(extraction?.status)))}
                onClick={nextStep}
              >
                {transitioning ? '正在进入…' : '▦　进入下一步'}
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
        {extractionOpen && <Modal title="重新提取资产" onClose={() => setExtractionOpen(false)} footer={<><Button onClick={() => setExtractionOpen(false)}>取消</Button><Button primary onClick={extractAssets}>开始提取</Button></>}><Field label="补充要求（选填）"><textarea aria-label="资产提取补充要求" maxLength={2000} rows={3} value={extractionRequirements} onChange={event => setExtractionRequirements(event.target.value)} placeholder="例如：重点补充本集出现的关键道具" /></Field><p className="muted">已有资产设定和图片会保留；如需修改已有内容，可交给 Agent 调整。</p></Modal>}
        {voice && data.assets.some(a => a.id === voice.id) && (
          <VoiceModal
            asset={data.assets.find((a) => a.id === voice.id)}
            onClose={() => setVoice(null)}
          />
        )}
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
