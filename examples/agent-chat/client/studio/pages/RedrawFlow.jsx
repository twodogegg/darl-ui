import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, getBezierPath, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/redraw-flow.css'
import { useProject, Workflow } from '../components/Shell'
import { RedrawFlowPanel } from '../components/RedrawFlowPanel'
import { studioApi, useStore } from '../store'
import { startPolling } from '../../polling'
import { FLOW_KIND_LABELS, FLOW_STATUS_LABELS, redrawFlow } from '../redraw-flow'
import { scriptFlow } from '../script-flow'

// 列距留出连线文字的位置，避免文字压到节点上。
const COLUMN = 300, ROW = 250
const handle = (type, position, id, style) => <Handle key={id} type={type} position={position} id={id} isConnectable={false} className="rf-handle" style={style} />
// 每个节点都有主数据流端口（左入右出、上入下出）和顶部的上游报告端口。
const HANDLES = [handle('target', Position.Left, 'in'), handle('source', Position.Right, 'out'), handle('target', Position.Top, 'up'), handle('source', Position.Bottom, 'down'), handle('target', Position.Bottom, 'bottom-in'), handle('source', Position.Top, 'report-out', { left: '26%' }), handle('target', Position.Top, 'report-in', { left: '74%' })]

// 画布里点击由 React Flow 处理；列表里标题按钮铺满整张卡片，便于触屏点按。
function NodeCard({ node, selected, children, onOpen }) {
  return <article className={`rf-node rf-node--${node.kind} is-${node.status}${selected ? ' is-selected' : ''}`} aria-label={`${node.title}：${FLOW_STATUS_LABELS[node.status]}`}>
    {children}
    <header><span className="rf-node-kind">{FLOW_KIND_LABELS[node.kind]}</span><span className={`rf-chip is-${node.status}`}>{FLOW_STATUS_LABELS[node.status]}</span></header>
    <h3>{onOpen ? <button type="button" className="rf-node-open" onClick={onOpen}>{node.title}</button> : node.title}</h3>
    {node.status === 'running' && node.phase && <p className="rf-node-note">{node.phase}</p>}
    {node.status === 'failed' && <p className="rf-node-note rf-error">{node.failureStage ? `${node.failureStage}未完成` : '最近一次运行未完成'}</p>}
    {node.note && <p className="rf-node-note">{node.note}</p>}
    <dl><dt>输入</dt><dd>{node.input.join(' · ')}</dd><dt>输出</dt><dd>{node.output.join(' · ') || '—'}</dd></dl>
  </article>
}
const StepNode = ({ data, selected }) => <NodeCard node={data.node} selected={selected}>{HANDLES}</NodeCard>
// 手机屏幕放不下横向画布，窄屏改为按流程顺序排列的节点列表。
const NARROW = '(max-width: 800px)'
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const media = matchMedia(NARROW), update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}
function DataEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }) {
  const [curve, curveX, curveY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const top = Math.min(sourceY, targetY) - 48 - (data.lane || 0) * 16
  const bottom = Math.max(sourceY, targetY) + 80
  const path = data.below ? `M ${sourceX} ${sourceY} C ${sourceX} ${bottom} ${targetX} ${bottom} ${targetX} ${targetY}` : data.lane === undefined ? curve : `M ${sourceX} ${sourceY} C ${sourceX} ${top} ${targetX} ${top} ${targetX} ${targetY}`
  const labelX = data.below || data.lane !== undefined ? (sourceX + targetX) / 2 : curveX
  const labelY = data.below ? (sourceY + targetY) / 8 + bottom * 0.75 : data.lane === undefined ? curveY : (sourceY + targetY) / 8 + top * 0.75
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} className={`rf-edge${data.active ? ' is-active' : ''}`} />
    <EdgeLabelRenderer><span className={`rf-edge-label${data.active ? ' is-active' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data.label}</span></EdgeLabelRenderer></>
}
// 上游报告画成从节点顶部拱起的虚线，跨度越大拱得越高，避免穿过中间节点。
function ReportEdge({ id, sourceX, sourceY, targetX, targetY, data }) {
  const lift = 36 + Math.abs(targetX - sourceX) * 0.12
  const path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY - lift} ${targetX} ${targetY - lift} ${targetX} ${targetY}`
  return <><BaseEdge id={id} path={path} className={`rf-report${data.stale ? ' is-stale' : ''}`} />
    {data.stale && <EdgeLabelRenderer><span className="rf-edge-label rf-edge-label--stale" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2 - lift * 0.75}px)` }}>旧版报告</span></EdgeLabelRenderer>}</>
}
const nodeTypes = { step: StepNode }, edgeTypes = { data: DataEdge, report: ReportEdge }
const toNodes = (flowNodes, selectedId, current = []) => flowNodes.map(node => ({ ...current.find(item => item.id === node.id), id: node.id, type: 'step', position: { x: node.position[0] * COLUMN, y: node.position[1] * ROW }, data: { node }, selected: node.id === selectedId, draggable: false, connectable: false }))

function FlowCanvas({ context }) {
  const { projectId, link } = context
  const episode = context.episode || { id: '', number: '', title: '全项目' }
  const { data, mediaJobs } = useStore()
  const [jobs, setJobs] = useState([]), [details, setDetails] = useState({}), [error, setError] = useState(''), [selectedId, setSelectedId] = useState(''), [instance, setInstance] = useState(null)
  const canvas = useRef(null)
  // 面板盖在画布右侧，选中节点时把它移到面板左边的可见区域中间。
  function select(node) {
    setSelectedId(node.id)
    if (!instance) return
    const { zoom } = instance.getViewport(), panel = Math.min(500, canvas.current?.clientWidth || 0)
    instance.setCenter(node.position.x + (node.measured?.width || 204) / 2 + panel / 2 / zoom, node.position.y + (node.measured?.height || 150) / 2, { zoom, duration: 300 })
  }
  useEffect(() => startPolling(async signal => {
    const [result, outline] = await Promise.all([
      episode.id ? studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId: episode.id })}`, undefined, signal) : Promise.resolve({ jobs: [] }),
      context.project.creationMode !== 'video-redraw' ? studioApi(`video-redraw/outline?${new URLSearchParams({ projectId })}`, undefined, signal) : Promise.resolve({ job: null }),
    ])
    setJobs([...result.jobs, ...(outline.job ? [outline.job] : [])]); setError('')
  }, 3000, reason => setError(`读取工作流任务失败：${reason.message}`)), [projectId, episode.id, context.project.creationMode])
  const loadDetail = useCallback(async (jobId, signal) => {
    const outline = jobs.find(job => job.id === jobId && job.kind === 'novel-outline')
    const value = outline ? (await studioApi(`video-redraw/outline?${new URLSearchParams({ projectId, jobId, input: '1' })}`, undefined, signal)).job : await studioApi(`video-redraw/status?${new URLSearchParams({ projectId, episodeId: episode.id, jobId, input: '1' })}`, undefined, signal)
    setDetails(current => ({ ...current, [jobId]: value }))
    return value
  }, [projectId, episode.id, jobs])
  const flow = useMemo(() => (context.project.creationMode === 'video-redraw' ? redrawFlow : scriptFlow)({ data, jobs, mediaJobs, details, projectId, episodeId: episode.id }), [data, jobs, mediaJobs, details, projectId, episode.id, context.project.creationMode])
  // 各 Agent 节点最近一次运行的详情用来画出实际收到的上游报告；状态或阶段变化时重新读取。
  const latest = flow.nodes.filter(node => node.jobId).map(node => node.runs[0])
  const signature = latest.map(job => `${job.id}:${job.status}:${job.phase}`).join('|')
  useEffect(() => {
    const controller = new AbortController()
    latest.forEach(job => loadDetail(job.id, controller.signal).catch(() => undefined))
    return () => controller.abort()
  }, [signature, loadDetail])
  // 节点交给 React Flow 的节点状态管理：数据刷新时保留它量好的尺寸，否则节点会被重新隐藏等待测量。
  const [nodes, setNodes, onNodesChange] = useNodesState(toNodes(flow.nodes, selectedId))
  useEffect(() => { setNodes(current => toNodes(flow.nodes, selectedId, current)) }, [flow.nodes, selectedId, setNodes])
  const edges = useMemo(() => flow.edges.map(edge => edge.type === 'data' ? { ...edge, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edge.data.active ? 'var(--rf-edge-active)' : 'var(--rf-edge)' } } : edge), [flow.edges])
  const selected = flow.nodes.find(node => node.id === selectedId)
  const source = flow.source, narrow = useNarrow()
  const sourceName = context.project.creationMode === 'video-redraw' ? (source.fileId ? `原片 ${source.name || ''}` : '尚未上传原片') : '剧本创作流程'
  // 列表里每个节点上方注明它收到的数据：不是来自上一个节点的注明来源，实际交接的上游报告单独列出。
  const title = id => flow.nodes.find(item => item.id === id)?.title
  const incoming = (node, previous) => {
    const into = flow.edges.filter(edge => edge.target === node.id)
    const reports = into.filter(edge => edge.type === 'report').map(edge => `${title(edge.source)}${edge.data.stale ? '（旧版）' : ''}`)
    return [...into.filter(edge => edge.type === 'data').map(edge => `${edge.data.label}${edge.source === previous?.id ? '' : `（来自${title(edge.source)}）`}`), ...(reports.length ? [`上游报告：${reports.join('、')}`] : [])].join(' · ')
  }
  return <div className="rf-page">
    {narrow ? <div className="rf-list">
      <p className="rf-list-intro">{sourceName} · 点节点查看实际输入和输出</p>
      {error && <p className="rf-error" role="alert">{error}</p>}
      <ol aria-label="创作流程节点">{flow.nodes.map((node, index) => {
        const via = incoming(node, flow.nodes[index - 1])
        return <li key={node.id}>{via && <p className="rf-list-link">{via}</p>}<NodeCard node={node} selected={node.id === selectedId} onOpen={() => setSelectedId(node.id)} /></li>
      })}</ol>
    </div> : <div className="rf-canvas" ref={canvas}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.16 }} minZoom={0.3} maxZoom={1.6} onInit={setInstance}
        nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} onNodeClick={(_, node) => select(node)} onPaneClick={() => setSelectedId('')}>
        <Background gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <Panel position="top-left" className="rf-legend">
          <strong>{episode.id ? `第${episode.number}集 · ${episode.title}` : '全项目'}</strong>
          <span>{sourceName}</span>
          <span><i className="rf-legend-line" />页面数据依赖，灰色表示上游还没有输出</span>
          <span><i className="rf-legend-line rf-legend-line--report" />实际交接的上游完整报告</span>
          <span>点击节点查看实际输入和输出</span>
          {error && <span className="rf-error" role="alert">{error}</span>}
        </Panel>
      </ReactFlow>
    </div>}
    {selected && <RedrawFlowPanel key={selected.id} node={selected} flow={flow} link={link} details={details} loadDetail={loadDetail} onClose={() => setSelectedId('')} />}
  </div>
}

export default function RedrawFlow() {
  const context = useProject()
  return <Workflow context={context} projectLevel={!context.episode && context.project?.creationMode !== 'video-redraw'}>{(context.episode || context.project?.creationMode !== 'video-redraw') && <FlowCanvas key={`${context.projectId}:${context.episode?.id || ''}`} context={context} />}</Workflow>
}
