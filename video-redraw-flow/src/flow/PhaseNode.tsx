import type { CSSProperties } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { PhaseNode as PhaseNodeType } from './types'

type BandStyle = CSSProperties & {
  '--phase': string
  '--phase-soft': string
}

export function PhaseNode({ data }: NodeProps<PhaseNodeType>) {
  const { phase, count } = data
  const style: BandStyle = {
    '--phase': phase.color,
    '--phase-soft': phase.soft,
  }

  return (
    <section className="phase-band" style={style} aria-label={`${phase.title}阶段`}>
      <header className="phase-band__head">
        <span className="phase-band__index">{phase.order}</span>
        <div className="phase-band__name">
          <strong>{phase.title}</strong>
          <span>{phase.en}</span>
        </div>
        <em>{String(count).padStart(2, '0')} NODES</em>
      </header>
      <span className="phase-band__caption">{phase.caption}</span>
      <span className="phase-band__watermark" aria-hidden="true">
        {phase.order}
      </span>
    </section>
  )
}
