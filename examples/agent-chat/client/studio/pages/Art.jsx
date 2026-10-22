import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Workflow, useProject } from '../components/Shell'
import {
  Button,
  VoiceModal,
  Confirm,
  Modal,
  Field,
  Processing,
} from '../components/ui'
import { useStore, useAgentTask } from '../store'
import { types } from '../data'
import ArtAssetDrawer from '../components/ArtAssetDrawer'
import { assetImageRequest, assetJob, jobLabel, pendingJob } from '../art'

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
  const { data, update, patch, notify, generateMedia, mediaJobs, models, modelSelections, setModelSelections } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState('全部')
  const [episodeId, setEpisodeId] = useState('')
  const episode = context.episodes.find((item) => item.id === episodeId)
  const [editor, setEditor] = useState(null)
  const [voice, setVoice] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [extraction, setExtraction] = useState(false)
  const [mode, setMode] = useState('保留已有图片')
  const [extractionMode, setExtractionMode] = useState('智能创建')
  const [notes, setNotes] = useState('')
  const [generationView, setGenerationView] = useState('按资产默认方案')
  const [customPrompt, setCustomPrompt] = useState('')
  const { busy, run, cancel } = useAgentTask()
  const assets = data.assets.filter((a) => a.projectId === projectId && (!episodeId || a.episodeIds?.includes(episodeId) || data.clips.some((clip) => clip.episodeId === episodeId && clip.assetIds.includes(a.id)) || data.shots.some((shot) => shot.episodeId === episodeId && shot.dialogue.some((line) => line.assetId === a.id))))
  function extract() {
    const scriptText = episode?.script || context.episodes.map((e) => e.script).join('\n')
    if (!scriptText.trim()) return notify('请先填写剧本正文')
    run({ action: 'extract-assets', projectId, episodeId, notes, mode, extractionMode })
  }
  const [batchBusy, setBatchBusy] = useState(false)
  const visibleAssets = assets.filter(asset => tab === '全部' || asset.type === tab)
  async function generateBatch() {
    if (batchBusy) return
    setBatchBusy(true)
    const failed = [], succeeded = []
    for (const asset of visibleAssets.filter(asset => !pendingJob(assetJob(mediaJobs, asset.id)))) {
      try { await generateMedia({ ...assetImageRequest(asset, { view: generationView, customPrompt }), target: { resource: 'assets', id: asset.id, field: 'image' } }); succeeded.push(asset.id) }
      catch (reason) { failed.push(`${asset.name}：${reason.message}`) }
    }
    notify(`已提交 ${succeeded.length} 项${failed.length ? `；失败 ${failed.length} 项：${failed.join('；')}` : ''}`)
    setBatchBusy(false)
  }
  return (
    <div className="page-art">
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
                <select
                  className="model-select"
                  aria-label="资产提取模式"
                  value={extractionMode}
                  onChange={event => setExtractionMode(event.target.value)}
                  disabled={busy}
                >
                  <option>智能创建</option>
                  <option>已有资产优先</option>
                </select>
                <select
                  className="batch-view-select"
                  aria-label="批量生成模式"
                  value={generationView}
                  onChange={(e) => setGenerationView(e.target.value)}
                  disabled={busy}
                >
                  {[
                    '按资产默认方案',
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
                    onChange={(e) => setCustomPrompt(e.target.value)}
                  />
                )}
                <select className="model-select" aria-label="图片模型" disabled={busy || batchBusy} value={modelSelections.image || ''} onChange={event => setModelSelections(current => ({ ...current, image: event.target.value }))}>
                  <option value="">使用默认图片模型</option>
                  {models.filter(model => model.type === 'image').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <button
                  className="tool-btn"
                  disabled={busy}
                  onClick={() => setExtraction(true)}
                >
                  ↻　重新提取
                </button>
                <button
                  className="tool-btn"
                  disabled={
                    busy ||
                    !visibleAssets.some(asset => !pendingJob(assetJob(mediaJobs, asset.id))) || batchBusy ||
                    (generationView === '自定义' && !customPrompt.trim())
                  }
                  onClick={() =>
                    generateBatch()
                  }
                >
                  {batchBusy ? '正在提交…' : '☷　批量生成'}
                </button>
              </div>
            </header>
            <Processing busy={busy && !extraction} cancel={cancel} />
            <section className="asset-scroll">
              {!assets.some((asset) => tab === '全部' || asset.type === tab) && <p className="empty">当前范围暂无{tab === '全部' ? '资产' : tab}，可重新提取或添加资产。</p>}
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
                            src={a.image}
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
        {editor && (
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
        {extraction && (
          <Modal
            title="重新提取资产"
            onClose={() => {
              cancel()
              setExtraction(false)
            }}
            footer={
              <>
                <Button
                  onClick={() => {
                    cancel()
                    setExtraction(false)
                  }}
                >
                  取消
                </Button>
                <Button primary disabled={busy} onClick={extract}>
                  开始提取
                </Button>
              </>
            }
          >
            <p className="muted">
              从真实剧本提取设定，同一主体复用已有资产。
            </p>
            <Field label="提取方式">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option>保留已有图片</option>
                <option>完全重做</option>
              </select>
            </Field>
            <Field label="修改意见">
              <textarea
                rows={4}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Processing busy={busy} cancel={cancel} />
          </Modal>
        )}
      </div>
    </div>
  )
}
