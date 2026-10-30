import type { Node } from '@xyflow/react'

export type PhaseId = 'intake' | 'breakdown' | 'assets' | 'production' | 'delivery'

export type NodeKind = 'input' | 'process' | 'gate' | 'output'

export type IconName =
  | 'sliders'
  | 'upload'
  | 'scan'
  | 'brain'
  | 'clipboard'
  | 'boxes'
  | 'image'
  | 'shield'
  | 'clapper'
  | 'play'
  | 'scissors'
  | 'badge'

export type PhaseInfo = {
  id: PhaseId
  order: string
  title: string
  en: string
  color: string
  soft: string
  caption: string
}

export type WorkflowNodeData = {
  step: string
  phaseId: PhaseId
  title: string
  subtitle: string
  summary: string
  chips: string[]
  kind: NodeKind
  icon: IconName
  outputLabel: string
  surface: string
  inputs: string[]
  actions: string[]
  outputs: string[]
  gates: string[]
  tools: string[]
  note?: string
  [key: string]: unknown
}

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

export type PhaseNodeData = {
  phase: PhaseInfo
  count: number
  [key: string]: unknown
}

export type PhaseNode = Node<PhaseNodeData, 'phase'>

export type FlowEdgeData = {
  color: string
  label?: string
  animated?: boolean
  [key: string]: unknown
}
