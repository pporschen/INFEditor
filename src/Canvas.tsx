import { forwardRef, useMemo } from 'react'
import type { Doc, DiagEdge, Mode, Selection, Shape } from './types'
import { GRID, W, H, center, anchor, halfExtents } from './geometry'
import { GATES } from './gates'

const LOOP_BASE = 30 // base bulge distance of a self-loop, in px
const LOOP_W = 20 // half-width of the self-loop

// Map a relationship type to its markers and line style.
// diamonds sit at the SOURCE end; arrows/triangles at the TARGET end.
function relStyle(rel: DiagEdge['rel']): {
  start?: string
  end?: string
  dashed: boolean
} {
  switch (rel) {
    case 'association':
      return { end: 'arrowOpen', dashed: false }
    case 'dependency':
      return { end: 'arrowOpen', dashed: true }
    case 'inheritance':
      return { end: 'triangle', dashed: false }
    case 'realization':
      return { end: 'triangle', dashed: true }
    case 'aggregation':
      return { start: 'diamondOpen', dashed: false }
    case 'composition':
      return { start: 'diamondFilled', dashed: false }
    default:
      return { end: 'arrow', dashed: false } // automata default
  }
}

interface Props {
  doc: Doc
  mode: Mode
  selection: Selection
  pendingFrom: string | null
  pendingCorner: { x: number; y: number } | null
  hoverCell: { x: number; y: number } | null
  drawShape: Shape
  onBgClick: (gx: number, gy: number) => void
  onBgMove: (gx: number, gy: number) => void
  onNodeClick: (id: string) => void
  onEdgeClick: (id: string) => void
  onLineClick: (id: string) => void
}

export const Canvas = forwardRef<SVGSVGElement, Props>(function Canvas(
  {
    doc,
    mode,
    selection,
    pendingFrom,
    pendingCorner,
    hoverCell,
    drawShape,
    onBgClick,
    onBgMove,
    onNodeClick,
    onEdgeClick,
    onLineClick,
  },
  ref,
) {
  const nodeById = useMemo(() => {
    const m = new Map<string, Doc['nodes'][number]>()
    for (const n of doc.nodes) m.set(n.id, n)
    return m
  }, [doc.nodes])

  // While placing shapes/dots or drawing wires, let every click fall through to
  // the grid — otherwise existing nodes/edges/lines would swallow the click and
  // you couldn't place, e.g., a dot on top of a line intersection.
  const placing = mode === 'node' || mode === 'line'
  const hitProps = placing ? { pointerEvents: 'none' as const } : {}

  function toCell(e: React.MouseEvent<SVGRectElement>): { gx: number; gy: number } | null {
    const svg = (e.currentTarget.ownerSVGElement ?? null) as SVGSVGElement | null
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const p = pt.matrixTransform(ctm.inverse())
    return { gx: Math.round(p.x / GRID), gy: Math.round(p.y / GRID) }
  }

  function handleBg(e: React.MouseEvent<SVGRectElement>) {
    const c = toCell(e)
    if (c) onBgClick(c.gx, c.gy)
  }

  function handleBgMove(e: React.MouseEvent<SVGRectElement>) {
    const c = toCell(e)
    if (c) onBgMove(c.gx, c.gy)
  }

  return (
    <svg
      ref={ref}
      className={`canvas mode-${mode}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id="arrow"
          markerWidth="12"
          markerHeight="12"
          refX="9"
          refY="3.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L9,3.5 L0,7 Z" className="arrow-head" />
        </marker>
        {/* UML: open arrow (association / dependency) */}
        <marker
          id="arrowOpen"
          markerWidth="14"
          markerHeight="12"
          refX="9"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L9,4 L0,8" className="uml-open" />
        </marker>
        {/* UML: hollow triangle (inheritance / realization), at target end */}
        <marker
          id="triangle"
          markerWidth="16"
          markerHeight="14"
          refX="12"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L12,6 L0,12 Z" className="uml-hollow" />
        </marker>
        {/* UML: filled diamond (composition), at source end */}
        <marker
          id="diamondFilled"
          markerWidth="20"
          markerHeight="12"
          refX="0"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,5 L9,0 L18,5 L9,10 Z" className="uml-fill" />
        </marker>
        {/* UML: hollow diamond (aggregation), at source end */}
        <marker
          id="diamondOpen"
          markerWidth="20"
          markerHeight="12"
          refX="0"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,5 L9,0 L18,5 L9,10 Z" className="uml-hollow" />
        </marker>
      </defs>

      {/* canvas background (export forces this to white in exportPng) */}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        className="canvas-bg"
        onClick={handleBg}
        onMouseMove={handleBgMove}
      />

      {/* grid lines */}
      <g pointerEvents="none" className="grid">
        {Array.from({ length: W / GRID + 1 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={i * GRID}
            y1={0}
            x2={i * GRID}
            y2={H}
            className="grid-line"
          />
        ))}
        {Array.from({ length: H / GRID + 1 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * GRID}
            x2={W}
            y2={i * GRID}
            className="grid-line"
          />
        ))}
      </g>

      {/* free wire lines (under nodes/edges) */}
      <g {...hitProps}>
        {doc.lines.map((l) => {
          const selected = selection?.kind === 'line' && selection.id === l.id
          return (
            <g key={l.id} onClick={() => onLineClick(l.id)} className="edge">
              <line
                x1={l.x1 * GRID}
                y1={l.y1 * GRID}
                x2={l.x2 * GRID}
                y2={l.y2 * GRID}
                className="edge-hit"
              />
              <line
                x1={l.x1 * GRID}
                y1={l.y1 * GRID}
                x2={l.x2 * GRID}
                y2={l.y2 * GRID}
                className={`edge-line${selected ? ' selected' : ''}`}
              />
            </g>
          )
        })}
      </g>

      {/* edges */}
      <g {...hitProps}>
        {doc.edges.map((e) => {
          const a = nodeById.get(e.from)
          const b = nodeById.get(e.to)
          if (!a || !b) return null
          const selected = selection?.kind === 'edge' && selection.id === e.id

          if (e.from === e.to) {
            // self-loop: a bump pointing in direction `angle`, sized by `curve`
            const c = center(a)
            const ang = ((e.angle ?? -90) * Math.PI) / 180 // default: up
            const ux = Math.cos(ang)
            const uy = Math.sin(ang)
            const perpx = -uy
            const perpy = ux
            const spread = 0.42 // angular offset of the two attach points (~24°)
            const p1 = anchor(a, c.x + Math.cos(ang - spread), c.y + Math.sin(ang - spread))
            const p2 = anchor(a, c.x + Math.cos(ang + spread), c.y + Math.sin(ang + spread))
            const ext = LOOP_BASE + (e.curve ?? 0) // how far the loop bulges out
            const c1 = { x: p1.x + ux * ext - perpx * LOOP_W, y: p1.y + uy * ext - perpy * LOOP_W }
            const c2 = { x: p2.x + ux * ext + perpx * LOOP_W, y: p2.y + uy * ext + perpy * LOOP_W }
            const d = `M ${p1.x},${p1.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`
            const base = anchor(a, c.x + ux, c.y + uy)
            const lx = base.x + ux * (ext + 16)
            const ly = base.y + uy * (ext + 16)
            return (
              <g key={e.id} onClick={() => onEdgeClick(e.id)} className="edge">
                <path d={d} className="edge-hit" fill="none" />
                <path
                  d={d}
                  className={`edge-line${selected ? ' selected' : ''}`}
                  markerEnd="url(#arrow)"
                  fill="none"
                />
                {e.label && (
                  <text x={lx} y={ly} className="edge-label">
                    {e.label}
                  </text>
                )}
              </g>
            )
          }

          const ca = center(a)
          const cb = center(b)
          const curve = e.curve ?? 0
          // control point = midpoint pushed along the perpendicular by `curve`
          const dx = cb.x - ca.x
          const dy = cb.y - ca.y
          const len = Math.hypot(dx, dy) || 1
          const px = -dy / len
          const py = dx / len
          const ctrl = {
            x: (ca.x + cb.x) / 2 + px * curve,
            y: (ca.y + cb.y) / 2 + py * curve,
          }
          // anchor toward the control point so the arc meets the boundary cleanly
          const pa = anchor(a, ctrl.x, ctrl.y)
          const pb = anchor(b, ctrl.x, ctrl.y)
          const d = `M ${pa.x},${pa.y} Q ${ctrl.x},${ctrl.y} ${pb.x},${pb.y}`
          // label at the quadratic-bezier midpoint (t = 0.5)
          const lx = 0.25 * pa.x + 0.5 * ctrl.x + 0.25 * pb.x
          const ly = 0.25 * pa.y + 0.5 * ctrl.y + 0.25 * pb.y
          const rs = relStyle(e.rel)
          return (
            <g key={e.id} onClick={() => onEdgeClick(e.id)} className="edge">
              <path d={d} className="edge-hit" fill="none" />
              <path
                d={d}
                className={`edge-line${selected ? ' selected' : ''}`}
                markerStart={rs.start ? `url(#${rs.start})` : undefined}
                markerEnd={rs.end ? `url(#${rs.end})` : undefined}
                strokeDasharray={rs.dashed ? '7 5' : undefined}
                fill="none"
              />
              {e.label && (
                <text x={lx} y={ly - 6} className="edge-label">
                  {e.label}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* start arrows (drawn under nodes) */}
      <g pointerEvents="none">
        {doc.nodes
          .filter((n) => n.start)
          .map((n) => {
            const c = center(n)
            const tip = anchor(n, c.x - 1000, c.y) // leftmost boundary
            return (
              <line
                key={`start-${n.id}`}
                x1={tip.x - 34}
                y1={tip.y}
                x2={tip.x}
                y2={tip.y}
                className="edge-line"
                markerEnd="url(#arrow)"
              />
            )
          })}
      </g>

      {/* nodes */}
      <g {...hitProps}>
        {doc.nodes.map((n) => {
          const c = center(n)
          const { hw, hh } = halfExtents(n)
          const gate = n.gate ? GATES[n.gate] : null
          const isSel = selection?.kind === 'node' && selection.id === n.id
          const isPending = pendingFrom === n.id
          return (
            <g
              key={n.id}
              onClick={(ev) => {
                ev.stopPropagation()
                onNodeClick(n.id)
              }}
              className="node"
            >
              {n.shape === 'dot' ? (
                <circle cx={c.x} cy={c.y} r={hw} className="dot-fill" />
              ) : n.shape === 'circle' ? (
                <>
                  <ellipse
                    cx={c.x}
                    cy={c.y}
                    rx={hw}
                    ry={hh}
                    className="node-fill"
                  />
                  {n.accepting && (
                    <ellipse
                      cx={c.x}
                      cy={c.y}
                      rx={hw - 5}
                      ry={hh - 5}
                      className="node-inner"
                      fill="none"
                    />
                  )}
                </>
              ) : (
                <rect
                  x={c.x - hw}
                  y={c.y - hh}
                  width={hw * 2}
                  height={hh * 2}
                  rx={4}
                  className="node-fill"
                />
              )}

              {gate?.neg && (
                <circle
                  cx={c.x + hw + 5}
                  cy={c.y}
                  r={5}
                  className="gate-bubble"
                />
              )}

              {(isSel || isPending) && (
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={Math.max(hw, hh) + 8}
                  className={`ui-only ring ${isPending ? 'ring-pending' : 'ring-sel'}`}
                  fill="none"
                />
              )}

              {n.shape === 'dot' ? null : gate ? (
                <>
                  <text x={c.x} y={c.y} className="gate-sym">
                    {gate.sym}
                  </text>
                  {n.label && (
                    <text x={c.x} y={c.y - hh - 8} className="node-label">
                      {n.label}
                    </text>
                  )}
                </>
              ) : (
                <text x={c.x} y={c.y} className="node-label">
                  {n.label}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* shape/line-drawing preview (first corner marker + rubber-band) */}
      {pendingCorner && (
        <g className="ui-only" pointerEvents="none">
          {hoverCell && mode === 'line' && (
            <line
              x1={pendingCorner.x * GRID}
              y1={pendingCorner.y * GRID}
              x2={hoverCell.x * GRID}
              y2={hoverCell.y * GRID}
              className="preview-line"
            />
          )}
          {hoverCell &&
            mode === 'node' &&
            (drawShape === 'circle' ? (
              <ellipse
                cx={((pendingCorner.x + hoverCell.x) / 2) * GRID}
                cy={((pendingCorner.y + hoverCell.y) / 2) * GRID}
                rx={(Math.abs(hoverCell.x - pendingCorner.x) * GRID) / 2}
                ry={(Math.abs(hoverCell.y - pendingCorner.y) * GRID) / 2}
                className="preview-box"
              />
            ) : (
              <rect
                x={Math.min(pendingCorner.x, hoverCell.x) * GRID}
                y={Math.min(pendingCorner.y, hoverCell.y) * GRID}
                width={Math.abs(hoverCell.x - pendingCorner.x) * GRID}
                height={Math.abs(hoverCell.y - pendingCorner.y) * GRID}
                rx={4}
                className="preview-box"
              />
            ))}
          <circle
            cx={pendingCorner.x * GRID}
            cy={pendingCorner.y * GRID}
            r={5}
            className="preview-corner"
          />
        </g>
      )}
    </svg>
  )
})
