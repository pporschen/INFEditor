import {
  forwardRef,
  useMemo,
  Fragment,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Doc, DiagEdge, TableLoop, Mode, Selection, Shape } from './types'
import {
  GRID,
  center,
  anchor,
  halfExtents,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  pageTop,
} from './geometry'
import { GATES } from './gates'

const LOOP_BASE = 30 // base bulge distance of a self-loop, in px
const LOOP_W = 20 // half-width of the self-loop


// Render a small LaTeX subset used for logic/boolean formatting:
//   sub/superscript  q_0  x^2  a_{10}
//   negation bar     \overline{A+B}  (\bar works too, nesting supported)
//   operators        \cdot · \oplus ⊕ \lnot/\neg ¬ \lor/\vee ∨ \land/\wedge ∧
// Anything else passes through unchanged.
const OP: Record<string, string> = {
  cdot: '·',
  oplus: '⊕',
  lnot: '¬',
  neg: '¬',
  lor: '∨',
  vee: '∨',
  land: '∧',
  wedge: '∧',
}

const OVERBAR = '̅' // combining overline — draws a bar over the preceding glyph

// Two KV group loops overlap if their cell rectangles share any cell.
function loopsOverlap(a: TableLoop, b: TableLoop): boolean {
  return !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2)
}

function opsToUnicode(s: string): string {
  return s
    .replace(/\\left\.?/g, '')
    .replace(/\\right\.?/g, '')
    .replace(/\\cdot/g, '·')
    .replace(/\\oplus/g, '⊕')
    .replace(/\\lnot/g, '¬')
    .replace(/\\neg/g, '¬')
    .replace(/\\lor/g, '∨')
    .replace(/\\vee/g, '∨')
    .replace(/\\land/g, '∧')
    .replace(/\\wedge/g, '∧')
}

// Render a negated group as combining overlines — reliable in every browser
// and in the PNG export, unlike text-decoration on a <tspan>.
function overlineString(inner: string): string {
  const flat = opsToUnicode(
    inner.replace(/\\(?:overline|bar)\{([^{}]*)\}/g, (_, g) => overlineString(g)),
  ).replace(/[{}]/g, '')
  return Array.from(flat)
    .map((c) => (c === OVERBAR ? c : c + OVERBAR))
    .join('')
}

// Render a small LaTeX subset: sub/superscript, \overline / \bar negation
// bars, and boolean operators. Braces group (and are invisible).
function renderRich(s: string): ReactNode {
  const out: ReactNode[] = []
  let buf = ''
  let key = 0
  let i = 0
  const flush = () => {
    if (buf) {
      out.push(buf)
      buf = ''
    }
  }
  const readArg = (): string => {
    if (s[i] === '{') {
      i++
      let depth = 1
      const start = i
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') {
          depth--
          if (depth === 0) break
        }
        i++
      }
      const inner = s.slice(start, i)
      if (s[i] === '}') i++
      return inner
    }
    return i < s.length ? s[i++] : ''
  }
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const m =
        /^\\(overline|bar|cdot|oplus|lnot|neg|lor|vee|land|wedge|left|right)/.exec(
          s.slice(i),
        )
      if (m) {
        const cmd = m[1]
        i += m[0].length
        if (cmd === 'overline' || cmd === 'bar') {
          const inner = readArg()
          if (/[_^]/.test(inner)) {
            // sub/superscript inside a bar: fall back to text-decoration
            flush()
            out.push(
              <tspan key={key++} style={{ textDecoration: 'overline' }}>
                {renderRich(inner)}
              </tspan>,
            )
          } else {
            buf += overlineString(inner)
          }
        } else if (cmd === 'left' || cmd === 'right') {
          // delimiter sizing hint — keep the bracket, drop an invisible '.'
          if (s[i] === '.') i++
        } else {
          buf += OP[cmd]
        }
        continue
      }
      buf += ch
      i++
      continue
    }
    if ((ch === '_' || ch === '^') && i + 1 < s.length) {
      flush()
      i++
      const inner = readArg()
      out.push(
        <tspan
          key={key++}
          baselineShift={ch === '^' ? 'super' : 'sub'}
          fontSize="0.7em"
        >
          {renderRich(inner)}
        </tspan>,
      )
      continue
    }
    if (ch === '{') {
      // bare group — render its contents, braces are invisible
      flush()
      out.push(<Fragment key={key++}>{renderRich(readArg())}</Fragment>)
      continue
    }
    buf += ch
    i++
  }
  flush()
  return out
}

// Render text that may contain `\\` line breaks (like LaTeX) as stacked lines,
// anchored at x. Single-line text renders inline as before.
function renderLines(
  s: string,
  x: number,
  lineHeight: number | string = '1.6em',
): ReactNode {
  const lines = s.split(/\\\\/)
  if (lines.length === 1) return renderRich(s)
  return lines.map((ln, i) => (
    <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeight}>
      {renderRich(ln.trim())}
    </tspan>
  ))
}

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

export interface View {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  doc: Doc
  mode: Mode
  selection: Selection
  pendingFrom: string | null
  pendingCorner: { x: number; y: number } | null
  hoverCell: { x: number; y: number } | null
  drawShape: Shape
  view: View
  labelScale: number
  onBgClick: (gx: number, gy: number) => void
  onBgMove: (gx: number, gy: number) => void
  onNodeClick: (id: string) => void
  onEdgeClick: (id: string) => void
  onLineClick: (id: string) => void
  onTextClick: (id: string) => void
  cellSel: { id: string; row: number; col: number } | null
  loopFirst: { id: string; row: number; col: number } | null
  onCellClick: (id: string, row: number, col: number) => void
  derivStep: number | null
  onDerivRowClick: (id: string, index: number) => void
  onExprCaret: (id: string, index: number, srcIndex: number) => void
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
    view,
    labelScale,
    onBgClick,
    onBgMove,
    onNodeClick,
    onEdgeClick,
    onLineClick,
    onTextClick,
    cellSel,
    loopFirst,
    onCellClick,
    derivStep,
    onDerivRowClick,
    onExprCaret,
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
  const placing =
    mode === 'node' ||
    mode === 'line' ||
    mode === 'text' ||
    mode === 'table' ||
    mode === 'deriv'
  const hitProps = placing ? { pointerEvents: 'none' as const } : {}

  // grid line positions covering the visible view (world coordinates)
  const gridLines = (step: number) => {
    const xs: number[] = []
    const ys: number[] = []
    for (let x = Math.floor(view.x / step) * step; x <= view.x + view.w; x += step)
      xs.push(x)
    for (let y = Math.floor(view.y / step) * step; y <= view.y + view.h; y += step)
      ys.push(y)
    return { xs, ys }
  }
  const major = gridLines(GRID)
  const showSubGrid =
    mode === 'line' ||
    mode === 'text' ||
    selection?.kind === 'line' ||
    selection?.kind === 'text'

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
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ '--label-scale': labelScale } as CSSProperties}
    >
      <defs>
        <marker
          id="arrow"
          markerWidth="12"
          markerHeight="12"
          refX="9"
          refY="3.5"
          orient="auto-start-reverse"
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
        x={view.x}
        y={view.y}
        width={view.w}
        height={view.h}
        className="canvas-bg"
        onClick={handleBg}
        onMouseMove={handleBgMove}
      />

      {/* fine 1/4 sub-grid: shown while drawing wires or adjusting a selected one */}
      {showSubGrid && (
        <g pointerEvents="none">
          {gridLines(GRID / 4).xs.map((x, i) =>
            Math.round(x / (GRID / 4)) % 4 === 0 ? null : (
              <line
                key={`mv${i}`}
                x1={x}
                y1={view.y}
                x2={x}
                y2={view.y + view.h}
                className="grid-minor"
              />
            ),
          )}
          {gridLines(GRID / 4).ys.map((y, i) =>
            Math.round(y / (GRID / 4)) % 4 === 0 ? null : (
              <line
                key={`mh${i}`}
                x1={view.x}
                y1={y}
                x2={view.x + view.w}
                y2={y}
                className="grid-minor"
              />
            ),
          )}
        </g>
      )}

      {/* grid lines */}
      <g pointerEvents="none" className="grid">
        {major.xs.map((x, i) => (
          <line
            key={`v${i}`}
            x1={x}
            y1={view.y}
            x2={x}
            y2={view.y + view.h}
            className="grid-line"
          />
        ))}
        {major.ys.map((y, i) => (
          <line
            key={`h${i}`}
            x1={view.x}
            y1={y}
            x2={view.x + view.w}
            y2={y}
            className="grid-line"
          />
        ))}
      </g>

      {/* A4 page frames + printable-margin guides (kept OUT of #content) */}
      <g pointerEvents="none">
        {Array.from({ length: doc.pages }).map((_, i) => {
          const top = pageTop(i)
          return (
            <g key={`page-${i}`}>
              <rect x={0} y={top} width={PAGE_W} height={PAGE_H} className="page-frame" />
              <rect
                x={PAGE_MARGIN}
                y={top + PAGE_MARGIN}
                width={PAGE_W - 2 * PAGE_MARGIN}
                height={PAGE_H - 2 * PAGE_MARGIN}
                className="page-margin"
              />
            </g>
          )
        })}
      </g>

      {/* all diagram content (measured by exportPng via getBBox) */}
      <g id="content">
      {/* free wire lines (under nodes/edges) */}
      <g {...hitProps}>
        {doc.lines.map((l) => {
          const selected = selection?.kind === 'line' && selection.id === l.id
          const x1 = l.x1 * GRID
          const y1 = l.y1 * GRID
          const x2 = l.x2 * GRID
          const y2 = l.y2 * GRID
          // label anchor along the line, nudged to one side so it clears the wire
          const pos = l.labelPos ?? 'middle'
          const t = pos === 'start' ? 0.12 : pos === 'end' ? 0.88 : 0.5
          const len = Math.hypot(x2 - x1, y2 - y1) || 1
          const off = 9
          const lx = x1 + (x2 - x1) * t + (-(y2 - y1) / len) * off
          const ly = y1 + (y2 - y1) * t + ((x2 - x1) / len) * off
          return (
            <g key={l.id} onClick={() => onLineClick(l.id)} className="edge">
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="edge-hit" />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={`edge-line${selected ? ' selected' : ''}`}
                markerStart={
                  l.arrow === 'start' || l.arrow === 'both'
                    ? 'url(#arrow)'
                    : undefined
                }
                markerEnd={
                  l.arrow === 'end' || l.arrow === 'both'
                    ? 'url(#arrow)'
                    : undefined
                }
              />
              {l.label && (
                <text x={lx} y={ly} className="edge-label">
                  {renderRich(l.label)}
                </text>
              )}
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
                    {renderRich(e.label)}
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
                  {renderRich(e.label)}
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
                      {renderLines(n.label, c.x)}
                    </text>
                  )}
                </>
              ) : (
                <text x={c.x} y={c.y} className="node-label">
                  {renderLines(n.label, c.x)}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* tables / truth tables */}
      <g>
        {doc.tables.map((tb) => {
          const tableSel = selection?.kind === 'table' && selection.id === tb.id
          const cw = tb.cw * GRID
          const ch = GRID
          const px = tb.x * GRID
          const py = tb.y * GRID
          return (
            <g key={tb.id}>
              {tableSel && (
                <rect
                  className="ui-only ring ring-sel"
                  x={px - 4}
                  y={py - 4}
                  width={tb.cols * cw + 8}
                  height={tb.rows * ch + 8}
                  fill="none"
                />
              )}
              {tb.cells.map((row, r) =>
                row.map((cellText, c) => {
                  const isHeader = tb.header && r === 0
                  const cx = px + c * cw
                  const cy = py + r * ch
                  const sel =
                    cellSel &&
                    cellSel.id === tb.id &&
                    cellSel.row === r &&
                    cellSel.col === c
                  const loopSel =
                    loopFirst &&
                    loopFirst.id === tb.id &&
                    loopFirst.row === r &&
                    loopFirst.col === c
                  return (
                    <g
                      key={`${r}-${c}`}
                      {...hitProps}
                      onClick={() => onCellClick(tb.id, r, c)}
                    >
                      <rect
                        x={cx}
                        y={cy}
                        width={cw}
                        height={ch}
                        className={`table-cell${isHeader ? ' table-header' : ''}${
                          sel || loopSel ? ' selected' : ''
                        }`}
                      />
                      <text
                        x={cx + cw / 2}
                        y={cy + ch / 2}
                        className={`table-text${isHeader ? ' table-header-text' : ''}`}
                      >
                        {renderRich(cellText)}
                      </text>
                    </g>
                  )
                }),
              )}

              {/* KV group loops — inset by overlap depth, so independent loops
                  are identical and overlapping ones nest consistently */}
              {(tb.loops ?? []).map((lp, li, arr) => {
                const depth = arr.slice(0, li).filter((o) => loopsOverlap(o, lp)).length
                const inset = 5 + depth * 6
                const x1 = (tb.x + lp.c1 * tb.cw) * GRID + inset
                const y1 = (tb.y + lp.r1) * GRID + inset
                const w = (lp.c2 - lp.c1 + 1) * cw - 2 * inset
                const h = (lp.r2 - lp.r1 + 1) * ch - 2 * inset
                return (
                  <g key={lp.id} pointerEvents="none">
                    <rect
                      x={x1}
                      y={y1}
                      width={w}
                      height={h}
                      rx={12}
                      fill="none"
                      stroke={lp.color}
                      strokeWidth={2.5}
                    />
                    {lp.label && (
                      <text
                        x={x1 + 4}
                        y={y1 + 2}
                        className="loop-label"
                        fill={lp.color}
                      >
                        {renderRich(lp.label)}
                      </text>
                    )}
                  </g>
                )
              })}

            </g>
          )
        })}
      </g>

      {/* boolean-algebra derivations (align* blocks) */}
      <g>
        {doc.derivations.map((d) => {
          const dsel = selection?.kind === 'deriv' && selection.id === d.id
          const relX = (d.x + 0.5) * GRID
          const exprX = (d.x + 1) * GRID
          const reasonX = (d.x + 1 + d.exprW) * GRID
          // each step is as tall as its expression's line count; steps stack
          const lineCount = (s: string) => Math.max(1, s.split(/\\\\/).length)
          const offsets: number[] = []
          let acc = 0
          for (const st of d.steps) {
            offsets.push(acc)
            acc += lineCount(st.expr)
          }
          const totalRows = acc
          return (
            <g key={d.id}>
              {dsel && (
                <rect
                  className="ui-only ring ring-sel"
                  x={d.x * GRID - 4}
                  y={d.y * GRID - 4}
                  width={(1 + d.exprW + 6) * GRID + 8}
                  height={totalRows * GRID + 8}
                  fill="none"
                />
              )}
              {d.steps.map((st, i) => {
                const top = d.y + offsets[i]
                const rowH = lineCount(st.expr)
                const cy = (top + 0.5) * GRID
                const rowSel = dsel && derivStep === i
                return (
                  <g key={i} {...hitProps} onClick={() => onDerivRowClick(d.id, i)}>
                    <rect
                      x={d.x * GRID}
                      y={top * GRID}
                      width={(1 + d.exprW + 6) * GRID}
                      height={rowH * GRID}
                      className={`deriv-row${rowSel ? ' selected' : ''}`}
                    />
                    {i > 0 && (
                      <text x={relX} y={cy} className="deriv-rel">
                        {renderRich(st.rel || '=')}
                      </text>
                    )}
                    <text
                      x={exprX}
                      y={cy}
                      className="deriv-expr"
                      style={{ pointerEvents: mode === 'select' ? 'auto' : undefined }}
                      onClick={(e) => {
                        e.stopPropagation()
                        const el = e.currentTarget
                        const svg = el.ownerSVGElement
                        const ctm = svg?.getScreenCTM()
                        if (!svg || !ctm) return
                        const p = svg.createSVGPoint()
                        p.x = e.clientX
                        p.y = e.clientY
                        const wx = p.matrixTransform(ctm.inverse()).x
                        const w = el.getComputedTextLength() || 1
                        const frac = Math.max(0, Math.min(1, (wx - exprX) / w))
                        onExprCaret(d.id, i, Math.round(frac * st.expr.length))
                      }}
                    >
                      {renderLines(st.expr, exprX, GRID)}
                    </text>
                    {i > 0 && st.reason && (
                      <text x={reasonX} y={cy} className="deriv-reason">
                        {renderRich(`(${st.reason})`)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </g>

      {/* free-standing text labels */}
      <g {...hitProps}>
        {doc.texts.map((t) => {
          const selected = selection?.kind === 'text' && selection.id === t.id
          return (
            <text
              key={t.id}
              x={t.x * GRID}
              y={t.y * GRID}
              onClick={() => onTextClick(t.id)}
              className={`free-text${selected ? ' selected' : ''}${
                t.text ? '' : ' placeholder'
              }`}
            >
              {t.text ? renderLines(t.text, t.x * GRID) : 'Text…'}
            </text>
          )
        })}
      </g>
      </g>
      {/* end #content */}

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
          {hoverCell && mode === 'table' && (
            <rect
              x={Math.min(pendingCorner.x, hoverCell.x) * GRID}
              y={Math.min(pendingCorner.y, hoverCell.y) * GRID}
              width={Math.abs(hoverCell.x - pendingCorner.x) * GRID}
              height={Math.abs(hoverCell.y - pendingCorner.y) * GRID}
              className="preview-box"
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
