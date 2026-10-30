import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Download,
  ExternalLink,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { DetailPanel } from './components/DetailPanel'
import { FlowEdge } from './flow/FlowEdge'
import { PhaseNode } from './flow/PhaseNode'
import { WorkflowNode } from './flow/WorkflowNode'
import type {
  FlowEdgeData,
  PhaseId,
  PhaseNode as PhaseNodeType,
  WorkflowNodeData,
  WorkflowNode as WorkflowNodeType,
} from './flow/types'
import {
  createCopySnapshot,
  flowEdges,
  initialNodes,
  phaseById,
  phases,
} from './flow/workflow'

const nodeTypes = {
  workflow: WorkflowNode,
  phase: PhaseNode,
}

const edgeTypes = {
  flow: FlowEdge,
}

const COPY_STORAGE_KEY = 'video-redraw-flow:copy:v1'

type CopySnapshot = {
  nodes: (WorkflowNodeType | PhaseNodeType)[]
  edges: Edge<FlowEdgeData>[]
}

function readCopySnapshot(): CopySnapshot | null {
  try {
    const raw = window.localStorage.getItem(COPY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CopySnapshot>
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.length || !Array.isArray(parsed.edges)) {
      return null
    }
    return { nodes: parsed.nodes, edges: parsed.edges }
  } catch {
    return null
  }
}

type PhaseButtonStyle = CSSProperties & {
  '--phase': string
  '--phase-soft': string
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)
  const [mode, setMode] = useState<'original' | 'copy'>('original')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activePhase, setActivePhase] = useState<PhaseId>('intake')
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  const activeWorkflowNodes = useMemo(
    () => nodes.filter((node): node is WorkflowNodeType => node.type === 'workflow'),
    [nodes],
  )

  const orderedNodes = useMemo(
    () =>
      [...activeWorkflowNodes].sort(
        (a, b) => Number(a.data.step || 99) - Number(b.data.step || 99),
      ),
    [activeWorkflowNodes],
  )

  const activeStats = useMemo(
    () => ({
      nodes: activeWorkflowNodes.length,
      phases: phases.length,
      gates: activeWorkflowNodes.filter((node) => node.data.kind === 'gate').length,
    }),
    [activeWorkflowNodes],
  )

  const selectedNode = useMemo(
    () =>
      selectedId
        ? (nodes.find((node) => node.id === selectedId) as WorkflowNodeType | undefined)
        : undefined,
    [nodes, selectedId],
  )

  const selectedIndex = selectedNode
    ? orderedNodes.findIndex((node) => node.id === selectedNode.id)
    : -1
  const previousNode = selectedIndex > 0 ? orderedNodes[selectedIndex - 1] : undefined
  const nextNode =
    selectedIndex >= 0 && selectedIndex < orderedNodes.length - 1
      ? orderedNodes[selectedIndex + 1]
      : undefined

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const color = (edge.data as { color?: string } | undefined)?.color ?? '#FF9B52'
        return {
          ...edge,
          markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color },
        }
      }),
    [edges],
  )

  // 编辑副本改动自动写入本地存储；原始流程常量永远只读。
  useEffect(() => {
    if (mode !== 'copy') return
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          COPY_STORAGE_KEY,
          JSON.stringify({ version: 1, savedAt: new Date().toISOString(), nodes, edges }),
        )
      } catch {
        // 本地存储不可用时保持内存中的副本，不阻塞编辑。
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [mode, nodes, edges])

  const switchMode = useCallback(
    (next: 'original' | 'copy') => {
      if (next === mode) return
      if (next === 'copy') {
        const snapshot = readCopySnapshot() ?? createCopySnapshot()
        setNodes(snapshot.nodes)
        setEdges(snapshot.edges)
      } else {
        setNodes(initialNodes)
        setEdges(flowEdges)
      }
      setMode(next)
      setSelectedId(null)
    },
    [mode, setNodes, setEdges],
  )

  const resetCopy = useCallback(() => {
    if (!window.confirm('重置副本将丢弃所有本地修改，恢复为原始流程。继续？')) return
    window.localStorage.removeItem(COPY_STORAGE_KEY)
    const snapshot = createCopySnapshot()
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
    setSelectedId(null)
  }, [setNodes, setEdges])

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (mode !== 'copy' || connection.source === connection.target) return
      const sourceNode = nodes.find((node) => node.id === connection.source)
      const sourceData = sourceNode?.data as WorkflowNodeData | undefined
      const color = sourceData ? phaseById[sourceData.phaseId].color : '#FF9B52'
      const outputIndex = Number((connection.sourceHandle ?? 'out-0').split('-')[1] ?? 0)
      const label = sourceData?.outputs[outputIndex] ?? ''
      setEdges((current) =>
        addCopyEdge(current, connection, color, label),
      )
    },
    [mode, nodes, setEdges],
  )

  const handleSaveNodeData = useCallback(
    (nodeId: string, data: WorkflowNodeData) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? ({ ...node, data } as WorkflowNodeType | PhaseNodeType) : node,
        ),
      )
    },
    [setNodes],
  )

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (!window.confirm('删除该节点及其连线？此操作只影响编辑副本。')) return
      setNodes((current) =>
        current.filter((node) => !(node.id === nodeId && node.type === 'workflow')),
      )
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
      setSelectedId(null)
    },
    [setNodes, setEdges],
  )

  const handleAddNode = useCallback(() => {
    const laneIndex = phases.findIndex((phase) => phase.id === activePhase)
    const stepNumber =
      activeWorkflowNodes.reduce((max, node) => Math.max(max, Number(node.data.step) || 0), 0) + 1
    const id = `custom-${Date.now()}`
    const node: WorkflowNodeType = {
      id,
      type: 'workflow',
      position: { x: laneIndex * 286 + 12, y: 660 },
      draggable: true,
      connectable: true,
      zIndex: 2,
      style: { width: 226, height: 204 },
      data: {
        step: String(stepNumber).padStart(2, '0'),
        phaseId: activePhase,
        title: '新节点',
        subtitle: '自定义工序',
        summary: '在编辑副本里新增的节点，可继续修改内容和连线。',
        actions: ['编辑本节点内容', '拖动到合适位置', '从端口拉线连接上下游'],
        chips: ['自定义'],
        kind: 'process',
        icon: 'boxes',
        outputLabel: '输出 · 待定义',
        surface: '编辑副本',
        inputs: ['输入'],
        outputs: ['输出'],
        gates: ['待补充'],
        tools: [],
        note: '副本节点，不影响原始流程。',
      },
    }
    setNodes((current) => [...current, node])
    setSelectedId(id)
  }, [activePhase, activeWorkflowNodes, setNodes])

  const focusPhase = useCallback(
    (phaseId: PhaseId) => {
      setActivePhase(phaseId)
      setSelectedId(null)
      const ids = activeWorkflowNodes
        .filter((node) => node.data.phaseId === phaseId)
        .map((node) => ({ id: node.id }))
      window.requestAnimationFrame(() => {
        flow?.fitView({ nodes: ids, padding: 0.16, duration: 620, maxZoom: 1.05 })
      })
    },
    [activeWorkflowNodes, flow],
  )

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedId(node.id)
    setActivePhase((node.data as WorkflowNodeData).phaseId)
  }, [])

  const closeDetail = useCallback(() => setSelectedId(null), [])

  const navigateTo = useCallback(
    (nodeId: string) => {
      const target = orderedNodes.find((node) => node.id === nodeId)
      if (!target) return
      setSelectedId(nodeId)
      setActivePhase(target.data.phaseId)
      flow?.setCenter(target.position.x + 113, target.position.y + 102, {
        zoom: Math.max(flow.getZoom(), 0.95),
        duration: 520,
      })
    },
    [flow, orderedNodes],
  )

  const fitAll = useCallback(() => {
    flow?.fitView({ padding: 0.025, duration: 620, maxZoom: 0.95 })
  }, [flow])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // 浏览器或宿主禁用全屏时保持当前布局。
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedId) setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('node')
    const match = requested ? nodes.find((node) => node.id === requested) : undefined
    if (match && match.type === 'workflow') {
      setSelectedId(match.id)
      setActivePhase((match.data as WorkflowNodeData).phaseId)
    }
    // 仅在首次挂载时读取 URL。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set('node', selectedId)
    else url.searchParams.delete('node')
    window.history.replaceState(null, '', url)
  }, [selectedId])

  useEffect(() => {
    if (!flow) return
    const timer = window.setTimeout(() => {
      if (window.matchMedia('(max-width: 1120px)').matches) {
        const ids = activeWorkflowNodes
          .filter((node) => node.data.phaseId === 'intake')
          .map((node) => ({ id: node.id }))
        flow.fitView({ nodes: ids, padding: 0.2, duration: 0, maxZoom: 1.02 })
      } else {
        flow.fitView({ padding: 0.025, duration: 0, maxZoom: 0.95 })
      }
    }, 160)
    return () => window.clearTimeout(timer)
    // 仅首次初始化视口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  function addCopyEdge(
    current: Edge<FlowEdgeData>[],
    connection: Connection,
    color: string,
    label: string,
  ): Edge<FlowEdgeData>[] {
    const id = `e-${connection.source}-${connection.sourceHandle ?? 'out-0'}-${connection.target}-${
      connection.targetHandle ?? 'in-0'
    }-${Date.now()}`
    return [
      ...current,
      {
        ...connection,
        id,
        type: 'flow',
        data: { color, label, animated: true },
      } as Edge<FlowEdgeData>,
    ]
  }

  function exportWorkflow() {
    const payload = {
      name: '视频转绘流程',
      version: mode === 'copy' ? '1.1.0-copy' : '1.0.0',
      mode,
      exportedAt: new Date().toISOString(),
      phases,
      nodes: activeWorkflowNodes.map((node) => ({
        id: node.id,
        step: node.data.step,
        phase: node.data.phaseId,
        title: node.data.title,
        subtitle: node.data.subtitle,
        summary: node.data.summary,
        chips: node.data.chips,
        inputs: node.data.inputs,
        actions: node.data.actions,
        outputs: node.data.outputs,
        gates: node.data.gates,
        tools: node.data.tools,
        surface: node.data.surface,
        note: node.data.note ?? null,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: (edge.data as { label?: string } | undefined)?.label ?? null,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = mode === 'copy' ? 'video-redraw-workflow-copy.json' : 'video-redraw-workflow.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const studioUrl = `${window.location.protocol}//${window.location.hostname}:5197/studio/`

  return (
    <div className={`app${selectedNode ? ' has-detail' : ''}`}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="brand-mark" aria-hidden="true">
            转
          </span>
          <div className="brand-copy">
            <strong>AI 影视工作流</strong>
            <span>/</span>
            <em>视频转绘流程</em>
          </div>
        </div>

        <div className="topbar__right">
          <div className="topbar__stat" aria-label="流程规模">
            <span>{String(activeStats.nodes).padStart(2, '0')}</span> 节点
            <i />
            <span>{String(activeStats.phases).padStart(2, '0')}</span> 阶段
            <i />
            <span>{String(activeStats.gates).padStart(2, '0')}</span> 质量门
          </div>
          <a
            className="ghost-button"
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="打开工作台"
          >
            <ExternalLink size={14} />
            打开工作台
          </a>
          <button type="button" className="primary-button" onClick={exportWorkflow}>
            <Download size={14} />
            导出流程
          </button>
        </div>
      </header>

      <div className="mobile-phases" aria-label="流程阶段">
        {phases.map((phase) => (
          <button
            key={phase.id}
            type="button"
            className={activePhase === phase.id ? 'is-active' : ''}
            style={{ '--phase': phase.color } as CSSProperties}
            onClick={() => focusPhase(phase.id)}
          >
            <span>{phase.order}</span>
            {phase.title}
          </button>
        ))}
      </div>

      <div className="workspace">
        <aside className="rail">
          <div className="rail__intro">
            <span className="eyebrow">VIDEO REDRAW · WORKFLOW MAP</span>
            <h1>
              转绘
              <br />
              <em>工序图</em>
            </h1>
            <p>
              原始流程只读；切换到「编辑副本」后可拖动节点、改内容、连线和增删，
              修改自动保存在本机，不影响原始版本。
            </p>
          </div>

          <div className="rail__stats" aria-label="流程统计">
            <div>
              <strong>{String(activeStats.nodes).padStart(2, '0')}</strong>
              <span>工序节点</span>
            </div>
            <div>
              <strong>{String(activeStats.phases).padStart(2, '0')}</strong>
              <span>制作阶段</span>
            </div>
            <div>
              <strong>{String(activeStats.gates).padStart(2, '0')}</strong>
              <span>质量门</span>
            </div>
          </div>

          <nav className="phase-nav" aria-label="阶段导航">
            <span className="phase-nav__label">制作链路 / STAGES</span>
            {phases.map((phase) => (
              <button
                key={phase.id}
                type="button"
                className={`phase-nav__item${activePhase === phase.id ? ' is-active' : ''}`}
                style={
                  {
                    '--phase': phase.color,
                    '--phase-soft': phase.soft,
                  } as PhaseButtonStyle
                }
                onClick={() => focusPhase(phase.id)}
              >
                <span className="phase-nav__order">{phase.order}</span>
                <span className="phase-nav__text">
                  <strong>{phase.title}</strong>
                  <em>{phase.caption}</em>
                </span>
                <span className="phase-nav__count">
                  {String(
                    activeWorkflowNodes.filter((node) => node.data.phaseId === phase.id).length,
                  ).padStart(2, '0')}
                </span>
              </button>
            ))}
          </nav>

          <div className="rail__legend">
            <span className="legend-title">图例 / LEGEND</span>
            <div className="legend-grid">
              <span>
                <i className="legend-port legend-port--in" /> 输入端口
              </span>
              <span>
                <i className="legend-port legend-port--out" /> 输出端口
              </span>
              <span>
                <i className="legend-dot legend-dot--node" /> 工序节点
              </span>
              <span>
                <i className="legend-dot legend-dot--gate" /> 质量门
              </span>
              <span>
                <i className="legend-line" /> 主链路
              </span>
              <span>
                <i className="legend-pulse" /> 数据流
              </span>
            </div>
          </div>

          <p className="rail__source">依据 video-redraw skill 与 darl-studio 的真实业务边界整理</p>

          <div className="rail__foot">
            <span>FLOW v1.0 · 2026.10</span>
            <a href="https://reactflow.dev" target="_blank" rel="noreferrer">
              @xyflow/react 12.12.0
            </a>
          </div>
        </aside>

        <main className="canvas-shell">
          <div className="canvas-toolbar">
            <div className="canvas-toolbar__title">
              <span className="signal-dot" aria-hidden="true" />
              <strong>流程总览</strong>
              <a
                className="engine-badge"
                href="https://reactflow.dev"
                target="_blank"
                rel="noreferrer"
                title="画布引擎：React Flow 官方包 @xyflow/react"
              >
                React Flow 12.12
              </a>
              <small>
                {mode === 'copy'
                  ? '编辑副本 · 拖动节点 / 拉端口连线 / Backspace 删除选中'
                  : '左右圆点 = 输入 / 输出端口 · 点击节点查看完整 I/O'}
              </small>
            </div>
            <div className="toolbar-right">
              <div className="mode-switch" role="tablist" aria-label="流程版本">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'original'}
                  className={mode === 'original' ? 'is-active' : ''}
                  onClick={() => switchMode('original')}
                >
                  原始流程
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'copy'}
                  className={mode === 'copy' ? 'is-active' : ''}
                  onClick={() => switchMode('copy')}
                >
                  编辑副本
                </button>
              </div>
              <div className="canvas-actions">
                {mode === 'copy' && (
                  <>
                    <button type="button" onClick={handleAddNode} title="在当前阶段添加节点">
                      <Plus size={14} />
                      添加节点
                    </button>
                    <button type="button" onClick={resetCopy} title="丢弃副本修改，恢复原始流程">
                      <RotateCcw size={14} />
                      重置副本
                    </button>
                  </>
                )}
                <button type="button" onClick={fitAll} title="适应画布">
                  <LocateFixed size={14} />
                  适应画布
                </button>
                <button
                  type="button"
                  className={showMiniMap ? 'is-on' : ''}
                  onClick={() => setShowMiniMap((value) => !value)}
                  title="切换小地图"
                >
                  <MapIcon size={14} />
                  小地图
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  title={fullscreen ? '退出全屏' : '全屏查看'}
                  aria-label={fullscreen ? '退出全屏' : '全屏查看'}
                >
                  {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="canvas-stage">
            <ReactFlow
              nodes={nodes}
              edges={styledEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={mode === 'copy' ? handleConnect : undefined}
              isValidConnection={(connection) => connection.source !== connection.target}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(instance) => setFlow(instance as unknown as ReactFlowInstance)}
              onNodeClick={handleNodeClick}
              onPaneClick={closeDetail}
              nodesDraggable={mode === 'copy'}
              nodesConnectable={mode === 'copy'}
              deleteKeyCode={mode === 'copy' ? ['Backspace', 'Delete'] : null}
              elementsSelectable
              panOnScroll
              selectionOnDrag={false}
              fitView
              fitViewOptions={{ padding: 0.025, minZoom: 0.2, maxZoom: 0.95 }}
              minZoom={0.2}
              maxZoom={1.7}
              proOptions={{ hideAttribution: false }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={26}
                size={1.15}
                color="rgba(255, 255, 255, 0.14)"
              />
              <Controls showInteractive={false} position="bottom-left" />
              {showMiniMap && (
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  ariaLabel="流程小地图"
                  maskColor="rgba(6, 7, 9, 0.74)"
                  nodeColor={(node) => {
                    if (node.type === 'phase') return 'rgba(255, 255, 255, 0.035)'
                    const phaseId = (node.data as WorkflowNodeData | undefined)?.phaseId
                    return phaseId ? phaseById[phaseId].color : '#777b83'
                  }}
                />
              )}
            </ReactFlow>

            <div className="canvas-legend">
              <span>
                <i className="legend-dot legend-dot--node" /> 工序
              </span>
              <span>
                <i className="legend-dot legend-dot--gate" /> 质量门
              </span>
              <span className="canvas-legend__hint">
                {mode === 'copy' ? '编辑副本 · 拖动节点与端口连线' : '左右圆点为输入 / 输出端口'}
              </span>
            </div>

            {selectedNode && (
              <DetailPanel
                node={selectedNode}
                phase={phaseById[selectedNode.data.phaseId]}
                previous={previousNode}
                next={nextNode}
                editable={mode === 'copy'}
                onClose={closeDetail}
                onPrevious={() => previousNode && navigateTo(previousNode.id)}
                onNext={() => nextNode && navigateTo(nextNode.id)}
                onSaveNode={(data) => handleSaveNodeData(selectedNode.id, data)}
                onDeleteNode={() => handleDeleteNode(selectedNode.id)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
