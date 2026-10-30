import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { FlowEdgeData } from './types'

export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps) {
  const edgeData = data as FlowEdgeData | undefined
  const color = edgeData?.color ?? '#FF9B52'
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.24,
  })

  return (
    <>
      <path
        d={path}
        className="flow-edge-glow"
        stroke={color}
        strokeWidth={selected ? 10 : 7}
        fill="none"
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className="flow-edge-line"
        style={{ stroke: color, strokeWidth: selected ? 2 : 1.35 }}
      />
      {edgeData?.animated && (
        <path
          d={path}
          className="flow-edge-pulse"
          stroke={color}
          strokeWidth={1.5}
          fill="none"
        />
      )}
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <span
            className="flow-edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: `${color}55`,
              color,
            }}
          >
            {edgeData.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
