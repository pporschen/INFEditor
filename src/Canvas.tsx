import { forwardRef, useMemo } from 'react'
import type { Doc, Mode, Selection } from './types'
import {
  GRID,
  W,
  H,
  R,
  center,
  anchor,
  topAnchor,
  boxHalf,
} from './geometry'

interface Props {
  doc: Doc
  mode: Mode
  selection: Selection
  pendingFrom: string | null
  pendingCorner: { x: number; y: number } | null
  hoverCell: { x: number; y: number } | null
  onBgClick: (gx: number, gy: number) => void
  onBgMove: (gx: number, gy: number) => void
  onNodeClick: (id: string) => void
  onEdgeClick: (id: string) => void
}

export const Canvas = forwardRef<SVGSVGElement, Props>(function Canvas(
  {
    doc,
    mode,
    selection,
    pendingFrom,
    pendingCorner,
    hoverCell,
    onBgClick,
    onBgMove,
    onNodeClick,
    onEdgeClick,
  },
  ref,
) {
  const nodeById = useMemo(() => {
    const m = new Map<string, Doc['nodes'][number]>()
    for (const n of doc.nodes) m.set(n.id, n)
    return m
  }, [doc.nodes])

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

      {/* edges */}
      <g>
        {doc.edges.map((e) => {
          const a = nodeById.get(e.from)
          const b = nodeById.get(e.to)
          if (!a || !b) return null
          const selected = selection?.kind === 'edge' && selection.id === e.id

          if (e.from === e.to) {
            // self-loop
            const t = topAnchor(a)
            const d = `M ${t.x - 10},${t.y} C ${t.x - 36},${t.y - 48} ${
              t.x + 36
            },${t.y - 48} ${t.x + 10},${t.y}`
            return (
              <g key={e.id} onClick={() => onEdgeClick(e.id)} className="edge">
                <path d={d} className="edge-hit" />
                <path
                  d={d}
                  className={`edge-line${selected ? ' selected' : ''}`}
                  markerEnd="url(#arrow)"
                  fill="none"
                />
                {e.label && (
                  <text x={t.x} y={t.y - 54} className="edge-label">
                    {e.label}
                  </text>
                )}
              </g>
            )
          }

          const ca = center(a)
          const cb = center(b)
          const pa = anchor(a, cb.x, cb.y)
          const pb = anchor(b, ca.x, ca.y)
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2
          return (
            <g key={e.id} onClick={() => onEdgeClick(e.id)} className="edge">
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className="edge-hit"
              />
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className={`edge-line${selected ? ' selected' : ''}`}
                markerEnd="url(#arrow)"
              />
              {e.label && (
                <text x={mx} y={my - 8} className="edge-label">
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
      <g>
        {doc.nodes.map((n) => {
          const c = center(n)
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
              {n.shape === 'circle' ? (
                <>
                  <circle cx={c.x} cy={c.y} r={R} className="node-fill" />
                  {n.accepting && (
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={R - 5}
                      className="node-inner"
                      fill="none"
                    />
                  )}
                </>
              ) : (
                <rect
                  x={c.x - boxHalf(n).hw}
                  y={c.y - boxHalf(n).hh}
                  width={boxHalf(n).hw * 2}
                  height={boxHalf(n).hh * 2}
                  rx={4}
                  className="node-fill"
                />
              )}

              {(isSel || isPending) && (
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={(n.shape === 'circle' ? R : Math.max(boxHalf(n).hw, boxHalf(n).hh)) + 8}
                  className={`ui-only ring ${isPending ? 'ring-pending' : 'ring-sel'}`}
                  fill="none"
                />
              )}

              <text x={c.x} y={c.y} className="node-label">
                {n.label}
              </text>
            </g>
          )
        })}
      </g>

      {/* box-drawing preview (first corner marker + rubber-band rectangle) */}
      {pendingCorner && (
        <g className="ui-only" pointerEvents="none">
          {hoverCell && (
            <rect
              x={Math.min(pendingCorner.x, hoverCell.x) * GRID}
              y={Math.min(pendingCorner.y, hoverCell.y) * GRID}
              width={Math.abs(hoverCell.x - pendingCorner.x) * GRID}
              height={Math.abs(hoverCell.y - pendingCorner.y) * GRID}
              rx={4}
              className="preview-box"
            />
          )}
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
