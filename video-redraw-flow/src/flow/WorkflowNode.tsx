import type { CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowUpRight } from 'lucide-react'
import { iconMap } from './icons'
import type { WorkflowNode as WorkflowNodeType } from './types'
import { phaseById } from './workflow'

const kindLabel = {
  input: '入口',
  process: '工序',
  gate: '质量门',
  output: '交付',
} as const

type NodeStyle = CSSProperties & {
  '--phase': string
  '--phase-soft': string
  '--stagger': string
}

export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
  const phase = phaseById[data.phaseId]
  const Icon = iconMap[data.icon]
  const style: NodeStyle = {
    '--phase': phase.color,
    '--phase-soft': phase.soft,
    '--stagger': `${Math.max(0, Number(data.step) - 1) * 34}ms`,
  }

  return (
    <article
      className={`workflow-card${selected ? ' is-selected' : ''}`}
      style={style}
      title={`输入：${data.inputs.join('、')}\n输出：${data.outputs.join('、')}`}
    >
      <div className="workflow-card__top">
        <span className="workflow-card__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="workflow-card__step">{data.step}</span>
        <span className={`workflow-card__kind workflow-card__kind--${data.kind}`}>
          {kindLabel[data.kind]}
        </span>
      </div>

      <h3>{data.title}</h3>
      <p className="workflow-card__subtitle">{data.subtitle}</p>
      <p className="workflow-card__summary">{data.summary}</p>

      <div className="workflow-card__io">
        <span className="io-pill io-pill--in">
          输入 {String(data.inputs.length).padStart(2, '0')}
        </span>
        <span className="io-pill io-pill--out">
          输出 {String(data.outputs.length).padStart(2, '0')}
        </span>
      </div>

      <div className="workflow-card__footer">
        <span>{data.outputLabel}</span>
        <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
      </div>

      {data.inputs.map((input, index) => (
        <Handle
          key={`in-${index}`}
          type="target"
          position={Position.Left}
          id={`in-${index}`}
          className="flow-port"
          style={{ top: `${((index + 1) / (data.inputs.length + 1)) * 100}%` }}
          aria-label={`输入端口 ${index + 1}：${input}`}
        />
      ))}
      {data.outputs.map((output, index) => (
        <Handle
          key={`out-${index}`}
          type="source"
          position={Position.Right}
          id={`out-${index}`}
          className="flow-port"
          style={{ top: `${((index + 1) / (data.outputs.length + 1)) * 100}%` }}
          aria-label={`输出端口 ${index + 1}：${output}`}
        />
      ))}
    </article>
  )
}
