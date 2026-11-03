import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { imageUrl } from '../../image-url'
import { assetJob, jobLabel } from '../art'
import { clipMediaReferences } from '../storyboard'
import { studioApi } from '../store'
import { FLOW_STATUS_LABELS, contextSummary } from '../redraw-flow'
import { KIND_LABELS } from './ChangeLog'
import { Tabs } from './ui'

const JOB_STATUS = { queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
const CONTEXT_LABELS = { project: '项目设定', availableStyles: '可用视觉风格', feedback: '修改意见', episode: '剧集', requirements: '补充要求', extractionRequirements: '提取要求', duration: '原片时长', candidates: '候选切镜', script: '剧本', scenes: '场次', shots: '镜头', clips: '片段关联', assets: '资产', originalReport: '原任务报告', feedbackHistory: '历史反馈与答复', mode: '生成方式', videoModel: '视频模型时长', sourceAnalysis: '原片分析报告' }
const RESULT_LABELS = { shots: '镜头', assets: '资产', scenes: '场次', openItems: '待确认事项', created: '新增资产', linkedShots: '关联镜头', skippedLinks: '未写入的角色关联', clips: '片段', plan: '片段规划', readyToApply: '待审核', applied: '已应用', appliedCount: '应用数量' }
const HIDDEN_CONTEXT = new Set(['projectId', 'episodeId'])
const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const json = value => JSON.stringify(value, null, 2)
const seconds = value => `${Math.round(Number(value || 0) * 10) / 10} 秒`
const referenceUrl = item => typeof item === 'string' ? item : item?.url
function parseJson(text) {
  try { return JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return undefined }
}
/** 上游交接给下游的报告：与服务端一致，优先使用结果里的完整报告，否则用完整的原始输出。 */
const reportOf = detail => {
  const latest = typeof detail?.analysis === 'string' && detail.analysis.trim() ? detail.analysis : detail?.outputs?.find(output => output.output_type === 'raw' && !output.incomplete)?.content
  const original = ['revise-cuts', 'revise-script'].includes(detail?.kind) && detail?.executionInput?.context?.originalReport
  return original && latest ? `${original}\n\n${latest}` : latest
}

function Section({ title, hint, children }) {
  return <section className="rf-section"><h3>{title}</h3>{hint && <p className="rf-hint">{hint}</p>}{children}</section>
}
function Report({ content }) {
  return /^\s*(```json|[[{])/.test(content) ? <pre className="rf-pre">{content}</pre> : <div className="rf-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown></div>
}
function Fold({ title, note, children, open = false }) {
  return <details className="rf-fold" open={open}><summary>{title}{note && <em>{note}</em>}</summary>{children}</details>
}
function Text({ title, text }) {
  return text?.trim() ? <Fold title={title} note={`${text.length} 字`}><pre className="rf-pre">{text}</pre></Fold> : <p className="rf-empty">{title}：空</p>
}
function Thumbs({ items }) {
  const urls = (items || []).map(referenceUrl).filter(Boolean)
  return urls.length ? <div className="rf-thumbs">{urls.map((url, index) => <img key={`${url}-${index}`} src={imageUrl(url, 160)} alt={`参考 ${index + 1}`} loading="lazy" onError={event => { event.currentTarget.hidden = true }} />)}</div> : <p className="rf-empty">无参考图</p>
}
function Video({ url, label }) {
  if (!url) return <p className="rf-empty">无视频</p>
  return <video className="rf-video" src={url} poster={`/api/video-editing/thumbnail?${new URLSearchParams({ url, start: '0' })}`} controls playsInline preload="none" aria-label={label} />
}

function UpstreamReport({ item, latestId, details, loadDetail }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const report = reportOf(details[item.jobId])
  useEffect(() => {
    if (!open || details[item.jobId]) return
    const controller = new AbortController()
    loadDetail(item.jobId, controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [open, !!details[item.jobId]])
  return <details className="rf-fold" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{KIND_LABELS[item.kind] || item.kind}<em>{formatTime(item.createdAt)}{latestId && latestId !== item.jobId ? ' · 旧版，上游之后又完成过' : ''}</em></summary>
    {report ? <Report content={report} /> : <p className="rf-empty">{error || (details[item.jobId] ? '该任务没有完整报告。' : '正在读取…')}</p>}
  </details>
}

function CurrentWorkflowSkills({ kind }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([studioApi('workflow-agents', undefined, controller.signal), studioApi('skills?summary=1', undefined, controller.signal)]).then(([agents, skills]) => {
      const config = agents.find(item => item.kind === kind)
      setState({ names: (config?.skillIds || []).map(id => skills.find(skill => skill.id === id)?.name || `未找到：${id}`) })
    }).catch(error => { if (!controller.signal.aborted) setState({ error: error.message }) })
    return () => controller.abort()
  }, [kind])
  return <Section title="当前 Agent 配置" hint="这是当前保存的设置，供后续运行使用；不能代表下方历史任务或先前调整实际加载的 Skill。">
    {!state ? <p className="rf-empty">正在读取…</p> : state.error ? <p className="rf-error">{state.error}</p> : state.names.length ? <p className="rf-tags">当前 Skill{state.names.map(name => <span key={name}>{name}</span>)}</p> : <p className="rf-meta">当前未配置 Skill</p>}
  </Section>
}

function AgentInput({ node, flow, detail, details, loadDetail }) {
  const input = detail.executionInput || {}
  const context = input.context && typeof input.context === 'object' ? Object.entries(input.context).filter(([key]) => !HIDDEN_CONTEXT.has(key)) : []
  const latestCompleted = kind => flow.nodes.find(item => item.jobKind === kind)?.runs.find(run => run.status === 'completed')?.id
  const source = flow.source
  return <>
    {node.id === 'script-storyboard' && <CurrentWorkflowSkills kind="script-storyboard" />}
    {node.id === 'analyze' && <Section title="原片视频" hint="视频模型通过原片的 COS 地址读取画面与声音。">{source.fileId ? <><Video url={source.url || `/api/files/${source.fileId}`} label="原片" /><p className="rf-meta">{[source.name, seconds(source.duration), source.width && `${source.width}×${source.height}`, source.fps && `${source.fps} fps`].filter(Boolean).join(' · ')}</p></> : <p className="rf-empty">尚未上传原片。</p>}</Section>}
    <Section title="执行模型"><p className="rf-meta">{detail.model || '—'}{detail.formatterModel ? ` · 整理：${detail.formatterModel}` : ''}</p>{detail.requirements && <p className="rf-meta">补充要求：{detail.requirements}</p>}</Section>
    <Section title={`上游报告（${detail.handoff?.length || 0}）`} hint="执行 Agent 收到的上游节点完整报告；与页面记录冲突时以页面记录为准。">
      {detail.handoff?.length ? detail.handoff.map(item => <UpstreamReport key={item.jobId} item={item} latestId={latestCompleted(item.kind)} details={details} loadDetail={loadDetail} />) : <p className="rf-empty">本次没有收到上游报告。</p>}
    </Section>
    <Section title="页面上下文" hint="执行 Agent 实际收到的页面数据；整理 Agent 也基于同一份上下文整理页面字段。">
      {context.length ? context.map(([key, value]) => <Fold key={key} title={CONTEXT_LABELS[key] || key} note={contextSummary(value)}><pre className="rf-pre">{typeof value === 'string' ? value : json(value)}</pre></Fold>) : <p className="rf-empty">该任务没有保存输入上下文。</p>}
    </Section>
    <Section title="本次历史任务的指令" hint={`以下是 ${formatTime(detail.createdAt) || '该次'} 任务开始时的配置，不会随之后的设置更改。`}>
      {input.instructions?.trim() ? <Text title="Agent 指令" text={input.instructions} /> : <p className="rf-meta">未单独填写 Agent 指令</p>}
      {input.skills?.length > 0 ? input.skills.map(skill => <div key={skill.id}><p className="rf-tags">Skill <span>{skill.name}</span></p>{Array.isArray(skill.resources) ? <p className="rf-meta">参考文件：{skill.resources.length ? skill.resources.join('、') : '无'}</p> : <p className="rf-meta">该历史任务未记录参考文件</p>}</div>) : <p className="rf-meta">该次任务未配置 Skill</p>}
      {input.tools?.length > 0 && <p className="rf-tags">工具{input.tools.map(tool => <span key={tool}>{tool}</span>)}</p>}
    </Section>
  </>
}

function AgentOutput({ node, flow, detail }) {
  const raws = (detail.outputs || []).filter(output => output.output_type === 'raw')
  const raw = raws.find(output => !output.incomplete) || raws.at(-1)
  const structured = detail.outputs?.find(output => output.output_type === 'structured')
  const fields = structured && parseJson(structured.content)
  const results = Object.entries(detail).filter(([key]) => RESULT_LABELS[key] && !(key === 'readyToApply' && detail.applied))
  return <>
    <Section title="运行状态">
      <p className="rf-meta">{JOB_STATUS[detail.status] || detail.status}{detail.status === 'running' && detail.phase ? ` · ${detail.phase}` : ''} · {formatTime(detail.createdAt)}</p>
      {detail.error && <p className="rf-error" role="alert">{detail.failureStage ? `${detail.failureStage}：` : ''}{detail.error}</p>}
    </Section>
    <Section title="执行报告" hint={node.id === 'outline' ? '执行 Agent 的完整大纲报告，供整理 Agent 转换为页面字段。' : '执行 Agent 的完整报告，会原样交给下游 Agent 节点。'}>
      {raw ? <>{raw.incomplete && <p className="rf-error">输出不完整：任务中断时保存的部分内容。</p>}<Report content={raw.content} /></> : <p className="rf-empty">执行 Agent 尚未输出报告。</p>}
    </Section>
    <Section title="页面字段" hint={node.id === 'outline' && !detail.applied ? '整理后的大纲草稿；需在大纲页面核对、填入并保存。' : '整理 Agent 按页面格式整理的结果，校验通过后写入页面。'}>
      {structured ? <Fold title="整理结果 JSON" note={`${structured.content.length} 字`} open><pre className="rf-pre">{fields ? json(fields) : structured.content}</pre></Fold> : <p className="rf-empty">尚未生成页面字段。</p>}
    </Section>
    {results.length > 0 && <Section title="写入结果"><dl className="rf-kv">{results.map(([key, value]) => <Fragment key={key}><dt>{RESULT_LABELS[key]}</dt><dd>{typeof value === 'boolean' ? (value ? '是' : '否') : Array.isArray(value) ? `${value.length} 项` : value && typeof value === 'object' ? json(value) : String(value)}</dd></Fragment>)}</dl></Section>}
    {detail.formatErrors?.length > 0 && <Section title="自动修正记录">{detail.formatErrors.map((item, index) => <p key={index} className="rf-meta">第 {index + 1} 次整理未通过校验：{item}</p>)}</Section>}
    {detail.steps?.length > 0 && <Section title="工具调用">{detail.steps.map((step, index) => <p key={index} className="rf-meta">{step.tool} · {step.status === 'completed' ? '完成' : step.status === 'failed' ? `失败：${step.error || ''}` : '调用中'}</p>)}</Section>}
    <Section title="页面当前内容" hint="页面记录可能在任务完成后被人工修改或经反馈调整；下游节点以页面记录为准。"><Records node={node} flow={flow} /></Section>
  </>
}

function Records({ node, flow }) {
  if (node.id === 'outline') return <Section title="当前项目大纲"><pre className="rf-pre">{json(flow.project?.outline || {})}</pre></Section>
  if (node.id === 'novel-script') return <Records node={{ id: 'write-script' }} flow={flow} />
  if (node.id === 'script-assets') return <><p className="rf-meta">项目视觉风格：{flow.project?.style_catalog_id ? '已确定，可在美术资产页查看或调整' : '未指定，由美术资产 Agent 根据剧本确定'}。</p><Records node={{ id: 'extract-assets' }} flow={flow} /></>
  if (node.id === 'script-storyboard') return <Records node={{ id: 'video-prompts' }} flow={flow} />
  if (node.id === 'analyze') return <ShotList shots={flow.shots} side="target" />
  if (node.id === 'write-script') return <><Text title="剧本" text={flow.episode.script} />{flow.scenes.map((scene, index) => <Text key={scene.id} title={`第 ${index + 1} 场 · ${[scene.setting, scene.location, scene.time].filter(Boolean).join(' ')}`} text={scene.content} />)}</>
  if (node.id === 'extract-assets') return flow.assets.length ? flow.assets.map(asset => <div key={asset.id} className="rf-item rf-item--plain"><div><strong>{asset.name}</strong><span className="rf-meta"> · {asset.type}{asset.type === '角色' && asset.visualMode === 'voice-only' ? ' · 仅声音' : ''}{asset.variants?.length ? ` · 衍生形态 ${asset.variants.length}` : ''}</span><Text title="生图提示词" text={asset.prompt || [asset.appearance, asset.costume].filter(Boolean).join('\n')} /></div></div>) : <p className="rf-empty">暂无资产。</p>
  if (node.id === 'storyboard-prompts' || node.id === 'video-prompts') return flow.clips.length ? flow.clips.map(clip => <div key={clip.id} className="rf-item rf-item--plain"><div><strong>{clip.title || '未命名片段'}</strong><span className="rf-meta"> · {seconds(clip.duration)} · {clip.mode === '分镜图' ? '分镜图' : '参考生成'}</span>{node.id === 'storyboard-prompts' ? (clip.mode === '分镜图' ? <Text title="分镜提示词" text={clip.storyboardPrompt} /> : <p className="rf-meta">参考生成无需分镜提示词</p>) : <Text title="视频提示词" text={clip.prompt} />}</div></div>) : <p className="rf-empty">暂无片段。</p>
  return null
}

function ShotList({ shots, side }) {
  if (!shots.length) return <p className="rf-empty">暂无镜头。</p>
  return shots.map((shot, index) => <div key={shot.id} className="rf-shot">
    <strong>{String(index + 1).padStart(2, '0')}</strong>
    {side === 'source' ? <div><p className="rf-meta">{shot.source ? `原片 ${Number(shot.source.start).toFixed(1)}–${Number(shot.source.end).toFixed(1)} 秒` : '原创续写 · 无原片时间'}</p><p>{shot.source?.description || '（无原片画面描述）'}</p>{shot.source?.dialogue && <p className="rf-meta">原对白：{shot.source.dialogue}</p>}</div>
      : <div><p className="rf-meta">{[seconds(shot.duration), shot.scale, shot.camera].filter(Boolean).join(' · ')}</p><p>{shot.description || '（无画面描述）'}</p>{shot.dialogue?.map(line => <p key={line.id} className="rf-meta">{line.type === '旁白' ? '旁白' : line.speaker || '角色'}：{line.text}</p>)}</div>}
  </div>)
}

function PromptInputs({ node, flow, details, loadDetail }) {
  const analysis = flow.nodes.find(item => item.id === 'analyze')?.runs.find(run => run.status === 'completed')
  return <>
    <p className="rf-hint">这里展示当前可用的页面数据，可能与历史 Agent 对话实际读取的内容不同；对话运行记录需在 Agent 对话中查看。</p>
    <Section title="原片分析报告">
      {analysis ? <UpstreamReport item={{ kind: 'analyze', jobId: analysis.id, createdAt: analysis.createdAt }} details={details} loadDetail={loadDetail} /> : <p className="rf-empty">没有当前原片的已完成分析记录。</p>}
    </Section>
    <Section title="剧本与场次">
      <Text title="当前剧本" text={flow.episode.script} />
      <Fold title="当前场次" note={`${flow.scenes.length} 项`}><pre className="rf-pre">{json(flow.scenes)}</pre></Fold>
    </Section>
    <Section title="镜头和资产">
      <Fold title="当前镜头" note={`${flow.shots.length} 项`}><ShotList shots={flow.shots} side="target" /></Fold>
      <Fold title="当前资产" note={`${flow.assets.length} 项`}><Records node={{ id: 'extract-assets' }} flow={flow} /></Fold>
    </Section>
    <Section title="当前片段">
      {flow.clips.length ? flow.clips.map(clip => <div key={clip.id} className="rf-item rf-item--plain"><div>
        <strong>{clip.title || '未命名片段'}</strong><span className="rf-meta"> · {seconds(clip.duration)} · {clip.mode === '分镜图' ? '分镜图' : '参考生成'}</span>
        {clip.mode === '分镜图' && <Text title="当前分镜提示词" text={clip.storyboardPrompt} />}
        {node.id === 'video-prompts' && <><Text title="当前视频提示词" text={clip.prompt} />{clip.mode === '分镜图' && <Thumbs items={clip.image ? [clip.image] : []} />}</>}
      </div></div>) : <p className="rf-empty">暂无片段。</p>}
    </Section>
  </>
}

function AgentData({ node, flow, tab, details, loadDetail }) {
  const [runId, setRunId] = useState(node.jobId || ''), [error, setError] = useState('')
  useEffect(() => { setRunId(node.jobId || '') }, [node.jobId])
  const detail = details[runId]
  useEffect(() => {
    if (!runId || detail) return
    const controller = new AbortController()
    loadDetail(runId, controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [runId, !!detail])
  if (node.id === 'storyboard-prompts') return <><p className="rf-meta">分镜提示词在页面填写或调用模型按要求调整；调整进度显示在窗口中。参考生成模式跳过此步骤。</p>{tab === 'input' ? <PromptInputs node={node} flow={flow} details={details} loadDetail={loadDetail} /> : <Records node={node} flow={flow} />}</>
  if (!node.runs.length && ['outline', 'novel-script', 'script-assets', 'script-storyboard'].includes(node.id)) return <>{node.id === 'script-storyboard' && tab === 'input' && <CurrentWorkflowSkills kind="script-storyboard" />}<p className="rf-meta">没有对应的工作流运行记录；以下是页面当前内容。</p>{node.id === 'outline' && tab === 'input' ? <><Text title="小说原文" text={flow.project.sourceScript} /><Text title="创作要求" text={flow.project.requirements} /><Records node={node} flow={flow} /></> : <Records node={node} flow={flow} />}</>
  if (!node.runs.length && node.id === 'video-prompts') return <><p className="rf-meta">工作流先生成片段与视频提示词；分镜图模式随后填写分镜提示词并生成分镜图。视频提示词调整复用视频提示词工作流，进度显示在调整窗口中。</p>{tab === 'input' ? <PromptInputs node={node} flow={flow} details={details} loadDetail={loadDetail} /> : <Records node={node} flow={flow} />}</>
  if (!node.runs.length) return <p className="rf-empty">这一集还没有运行记录。{node.status === 'done' ? '页面上已有这一步的内容（可能由 Agent 工具或旧流程写入），可打开页面查看。' : ''}</p>
  return <>
    {node.id === 'outline' && detail?.status === 'completed' && <p className="rf-meta">{detail.applied ? '大纲已自动保存到项目。' : '生成的是待审核草稿，请在大纲页查看、填入并保存。'}</p>}
    {node.id === 'script-storyboard' && <p className="rf-meta">这里显示首次生成分镜的历史任务，开始时间为 {formatTime(node.runs[0]?.createdAt) || '未知'}；视频提示词调整是独立操作，不会更新这条历史记录。</p>}
    {node.id === 'write-script' && <p className="rf-meta">当前剧集目标时长：{flow.episode.duration == null ? '未设置' : seconds(flow.episode.duration)}；历史运行以下方实际输入为准。</p>}
    {node.id === 'extract-assets' && <p className="rf-meta">资产分析编写生图提示词，整理 Agent 将结果整理并校验后保存；当前目标时长{flow.episode.duration == null ? '未设置' : `为 ${seconds(flow.episode.duration)}`}，历史运行以下方实际输入为准。</p>}
    {node.id === 'video-prompts' && <p className="rf-meta">视频提示词调整复用工作流 Agent、整理模型及上游报告，结合页面数据、视频模型、当前片段和修改要求；进度显示在调整窗口中。</p>}
    {node.runs.length > 1 && <label className="rf-run">运行记录<select value={runId} onChange={event => setRunId(event.target.value)}>{node.runs.map((run, index) => <option key={run.id} value={run.id}>{index === 0 ? '最近 · ' : ''}{formatTime(run.createdAt)} · {JOB_STATUS[run.status] || run.status}</option>)}</select></label>}
    {!detail ? <p className="rf-empty">{error || '正在读取…'}</p> : tab === 'input' ? <AgentInput node={node} flow={flow} detail={detail} details={details} loadDetail={loadDetail} /> : <AgentOutput node={node} flow={flow} detail={detail} />}
  </>
}

function ImageData({ flow, tab }) {
  if (!flow.imageSlots.length) return <p className="rf-empty">暂无需要生成的资产图片；仅声音角色不需要图片。</p>
  return flow.imageSlots.map(({ asset, variant, image }) => {
    const job = assetJob(flow.imageJobs, asset.id, variant?.id)
    const name = `${asset.name}${variant ? ` · ${variant.name}` : ''}`
    return <div key={`${asset.id}:${variant?.id || ''}`} className="rf-item">
      {tab === 'output' ? (image ? <img src={imageUrl(image, 320)} alt={name} loading="lazy" /> : <span className="rf-item-empty">{jobLabel(job) || '未生成'}</span>) : <span className="rf-item-empty">{asset.type}</span>}
      <div><strong>{name}</strong>
        {tab === 'input' ? <>{job ? <><p className="rf-meta">{formatTime(job.createdAt)} · {job.modelId}</p><Text title="实际提交的提示词" text={job.prompt} /><Thumbs items={job.options?.references} /></> : <><p className="rf-meta">没有找到生图任务记录</p><Text title="当前生图提示词" text={(variant || asset).prompt} /></>}</>
          : job && <p className="rf-meta">最近一次：{jobLabel(job)}{job.error ? ` · ${job.error}` : ''}</p>}
      </div>
    </div>
  })
}

function VideoData({ flow, tab }) {
  if (!flow.clips.length) return <p className="rf-empty">暂无片段，视频提示词完成后这里会列出每个片段。</p>
  return flow.clips.map(clip => {
    const job = flow.videoJobs.filter(item => item.options.studioTarget.id === clip.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    return <div key={clip.id} className="rf-item rf-item--plain"><div>
      <strong>{clip.title || '未命名片段'}</strong><span className="rf-meta"> · {seconds(clip.duration)}</span>
      {tab === 'input' ? (job ? <><p className="rf-meta">{formatTime(job.createdAt)} · {job.modelId}{job.options?.resolution ? ` · ${job.options.resolution}` : ''}{job.options?.duration ? ` · ${job.options.duration} 秒` : ''}</p><Text title="实际提交的提示词" text={job.prompt} /><Thumbs items={job.options?.references} /></> : <><p className="rf-meta">没有找到视频生成任务记录</p><Text title="当前视频提示词" text={clip.prompt} /></>)
        : <><p className="rf-meta">已生成 {clip.videos?.length || 0} 个{job ? ` · 最近一次：${jobLabel(job)}${job.error ? ` · ${job.error}` : ''}` : ''}</p>{clip.currentVideo ? <Video url={clip.currentVideo} label={`${clip.title || '片段'}已选用视频`} /> : <p className="rf-empty">尚未选用视频</p>}</>}
    </div></div>
  })
}

function StoryboardImageData({ flow, tab }) {
  if (!flow.storyboardClips.length) return <p className="rf-empty">当前没有分镜图模式片段。</p>
  return flow.storyboardClips.map(clip => {
    const job = flow.storyboardJobs.filter(item => item.options.studioTarget.id === clip.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    return <div key={clip.id} className="rf-item"><div>{tab === 'output' && clip.image && <img src={imageUrl(clip.image, 320)} alt={clip.title || '分镜图'} loading="lazy" />}</div><div><strong>{clip.title || '未命名片段'}</strong>
      {tab === 'input' ? (job ? <><Text title="实际提交的提示词" text={job.prompt} /><Thumbs items={job.options?.references} /></> : <><Text title="当前分镜提示词" text={clip.storyboardPrompt} /><Thumbs items={clipMediaReferences(clip, flow.data, { includeFrames: false, selectedOnly: true }).images} /></>) : <p className="rf-meta">{clip.image ? '已选用分镜图' : job ? `${jobLabel(job)}${job.error ? ` · ${job.error}` : ''}` : '尚未选用分镜图'}</p>}
    </div></div>
  })
}

function FilmData({ flow, tab }) {
  if (tab === 'input') {
    const selected = flow.clips.filter(clip => clip.currentVideo)
    return selected.length ? selected.map(clip => <div key={clip.id} className="rf-item rf-item--plain"><div><strong>{clip.title || '未命名片段'}</strong><span className="rf-meta"> · {seconds(clip.duration)}</span><Video url={clip.currentVideo} label={`${clip.title || '片段'}已选用视频`} /></div></div>) : <p className="rf-empty">还没有选用视频的片段。</p>
  }
  return flow.films.length ? flow.films.map(film => <div key={film.id} className="rf-item rf-item--plain"><div><strong>{film.title || film.name || '成片'}</strong><Video url={film.url} label={film.title || '成片'} /></div></div>) : <p className="rf-empty">还没有保存成片。</p>
}

/** 只读面板：查看节点实际收到的输入和产出的输出。 */
export function RedrawFlowPanel({ node, flow, link, details, loadDetail, onClose }) {
  const [tab, setTab] = useState('input')
  return <aside className="rf-panel" aria-label={`${node.title}的输入与输出`}>
    <header className="rf-panel-head">
      <div><span className={`rf-chip is-${node.status}`}>{FLOW_STATUS_LABELS[node.status]}</span><h2>{node.title}</h2></div>
      <Link to={link(node.page)}>打开页面</Link>
      <button type="button" className="rf-close" aria-label="关闭" onClick={onClose}>×</button>
    </header>
    <div className="rf-panel-tabs"><Tabs label="节点数据" value={tab} onChange={setTab} items={[{ value: 'input', label: '输入' }, { value: 'output', label: '输出' }]} /></div>
    <div className="rf-panel-body">
      {node.kind === 'agent' ? <AgentData node={node} flow={flow} tab={tab} details={details} loadDetail={loadDetail} />
        : node.id === 'outline' ? (tab === 'input' ? <><Text title="小说原文" text={flow.project.sourceScript} /><Text title="创作要求" text={flow.project.requirements} /></> : <Section title="当前项目大纲"><pre className="rf-pre">{json(flow.project.outline || {})}</pre></Section>)
        : node.id === 'shots' ? (tab === 'input' ? <Section title="原片分析写入的原片事实" hint="每个镜头的原片时间、画面与对白，来自原片分析。"><ShotList shots={flow.shots} side="source" /></Section> : <Section title="校对后的目标镜头" hint="页面上当前的目标时长、景别、画面描述与台词，剧本编写以此为准。"><ShotList shots={flow.shots} side="target" /></Section>)
        : node.id === 'asset-images' ? <ImageData flow={flow} tab={tab} />
        : node.id === 'storyboard-images' ? <StoryboardImageData flow={flow} tab={tab} />
        : node.id === 'video-generation' ? <VideoData flow={flow} tab={tab} />
        : <FilmData flow={flow} tab={tab} />}
    </div>
  </aside>
}
