import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from './Canvas'
import type { View } from './Canvas'
import { useEditor } from './store'
import { exportPng } from './exportPng'
import { GATES, GATE_ORDER } from './gates'
import { W, H } from './geometry'
import type {
  Doc,
  LabelPos,
  LineArrow,
  Mode,
  RelType,
  Selection,
  Shape,
} from './types'

const STORAGE_KEY = 'infeditor.doc.v1'
const CURVE_STEP = 24 // pixels of bow added per button press
const CURVE_MAX = 168 // clamp so arcs stay reasonable
const LOOP_SIZE_MIN = -18 // clamp for self-loop extra size (keeps a visible loop)
const LOOP_SIZE_MAX = 160
const LOOP_ANGLE_STEP = 30 // degrees the loop rotates per button press
const LINE_STEP = 1 / 4 // 1/4 of a grid cell — nudge/resize step for wires
const ZOOM_MIN = W * 0.25 // most zoomed-in (smallest viewBox)
const ZOOM_MAX = W * 8 // most zoomed-out (largest viewBox)

// UML relationship picker. Glyphs mark the end where the marker sits.
// Direction: draw from the "source" of the arrow to its head — subclass→super
// for inheritance, whole→part for composition/aggregation.
const REL_TYPES: { rel: RelType; label: string }[] = [
  { rel: 'arrow', label: '→  Directed (automata)' },
  { rel: 'association', label: '→  Association' },
  { rel: 'dependency', label: '⇢  Dependency (dashed)' },
  { rel: 'inheritance', label: '▷  Inheritance (→ super)' },
  { rel: 'realization', label: '▷  Realization (dashed)' },
  { rel: 'aggregation', label: '◇  Aggregation (whole→part)' },
  { rel: 'composition', label: '◆  Composition (whole→part)' },
]

function loadInitial(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      // tolerate saves from before a collection existed
      return { nodes: d.nodes ?? [], edges: d.edges ?? [], lines: d.lines ?? [] }
    }
  } catch {
    /* ignore corrupt autosave */
  }
  return { nodes: [], edges: [], lines: [] }
}

export default function App() {
  const { doc, canUndo, dispatch } = useEditor(loadInitial)
  const [mode, setMode] = useState<Mode>('node')
  const [shape, setShape] = useState<Shape>('circle')
  const [selection, setSelection] = useState<Selection>(null)
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [pendingCorner, setPendingCorner] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, w: W, h: H })
  const svgRef = useRef<SVGSVGElement>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const focusLabelRef = useRef(false) // request to focus the label after box creation

  // autosave on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
  }, [doc])

  // after a box is created we select it and focus its label input for typing
  useEffect(() => {
    if (focusLabelRef.current && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
      focusLabelRef.current = false
    }
  }, [selection])

  const selectedNode =
    selection?.kind === 'node'
      ? doc.nodes.find((n) => n.id === selection.id) ?? null
      : null
  const selectedEdge =
    selection?.kind === 'edge'
      ? doc.edges.find((e) => e.id === selection.id) ?? null
      : null
  const selectedLine =
    selection?.kind === 'line'
      ? doc.lines.find((l) => l.id === selection.id) ?? null
      : null
  const selectedLineId = selectedLine?.id ?? null

  const changeMode = useCallback((m: Mode) => {
    setMode(m)
    setPendingFrom(null)
    setPendingCorner(null)
    setHoverCell(null)
    setSelection(null)
  }, [])

  // pan by a fraction of the visible area (so it scales with zoom)
  function panBy(fx: number, fy: number) {
    setView((v) => ({ ...v, x: v.x + v.w * fx, y: v.y + v.h * fy }))
  }

  // zoom around the view center; factor > 1 zooms out
  function zoomBy(factor: number) {
    setView((v) => {
      const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * factor))
      const h = w * (v.h / v.w)
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }
    })
  }

  function resetView() {
    setView({ x: 0, y: 0, w: W, h: H })
  }

  function handleBgClick(gx: number, gy: number) {
    if (mode === 'node') {
      // Junction dots drop with a single dwell; stay in the mode to place more.
      if (shape === 'dot') {
        dispatch({ type: 'ADD_DOT', id: crypto.randomUUID(), x: gx, y: gy })
        return
      }
      // States and boxes are drawn from two opposite corners.
      if (pendingCorner === null) {
        setPendingCorner({ x: gx, y: gy }) // first corner
        setHoverCell({ x: gx, y: gy })
      } else {
        // opposite corner → create, then jump straight to labeling it
        setPendingCorner(null)
        setHoverCell(null)
        if (pendingCorner.x !== gx && pendingCorner.y !== gy) {
          const id = crypto.randomUUID()
          dispatch({
            type: 'ADD_SHAPE',
            id,
            shape,
            ax: pendingCorner.x,
            ay: pendingCorner.y,
            bx: gx,
            by: gy,
          })
          setMode('select')
          setSelection({ kind: 'node', id })
          focusLabelRef.current = true
        }
      }
    } else if (mode === 'line') {
      // wires are drawn from two grid points
      if (pendingCorner === null) {
        setPendingCorner({ x: gx, y: gy })
        setHoverCell({ x: gx, y: gy })
      } else {
        setPendingCorner(null)
        setHoverCell(null)
        if (pendingCorner.x !== gx || pendingCorner.y !== gy) {
          // create the wire, then select it so its move/length buttons appear
          const id = crypto.randomUUID()
          dispatch({
            type: 'ADD_LINE',
            id,
            x1: pendingCorner.x,
            y1: pendingCorner.y,
            x2: gx,
            y2: gy,
          })
          setMode('select')
          setSelection({ kind: 'line', id })
        }
      }
    } else if (mode === 'select' && selection?.kind === 'node') {
      dispatch({ type: 'MOVE_NODE', id: selection.id, x: gx, y: gy })
    } else if (mode === 'edge') {
      setPendingFrom(null)
    }
  }

  function handleBgMove(gx: number, gy: number) {
    // only track the cursor while actively drawing a shape/line (keeps re-renders scoped)
    if ((mode === 'node' || mode === 'line') && pendingCorner) {
      setHoverCell((h) => (h && h.x === gx && h.y === gy ? h : { x: gx, y: gy }))
    }
  }

  function handleLineClick(id: string) {
    if (mode === 'select') {
      setSelection({ kind: 'line', id })
    } else if (mode === 'delete') {
      dispatch({ type: 'DELETE_LINE', id })
      setSelection(null)
    }
  }

  function handleNodeClick(id: string) {
    if (mode === 'edge') {
      if (pendingFrom === null) {
        setPendingFrom(id)
      } else {
        // create the arrow, then open its edit menu (label + curvature)
        const edgeId = crypto.randomUUID()
        dispatch({ type: 'ADD_EDGE', id: edgeId, from: pendingFrom, to: id })
        setPendingFrom(null)
        setMode('select')
        setSelection({ kind: 'edge', id: edgeId })
        focusLabelRef.current = true
      }
    } else if (mode === 'select') {
      setSelection({ kind: 'node', id })
    } else if (mode === 'delete') {
      dispatch({ type: 'DELETE_NODE', id })
      setSelection(null)
    }
  }

  function handleEdgeClick(id: string) {
    if (mode === 'select') {
      setSelection({ kind: 'edge', id })
    } else if (mode === 'delete') {
      dispatch({ type: 'DELETE_EDGE', id })
      setSelection(null)
    }
  }

  // Leave edit mode: blur the label field and deselect. Used by the Done
  // button so the on-screen keyboard is never required just to exit.
  function finishEditing() {
    ;(document.activeElement as HTMLElement | null)?.blur()
    setSelection(null)
  }

  function setEdgeCurve(id: string, curve: number) {
    dispatch({ type: 'SET_EDGE_CURVE', id, curve })
  }

  function setEdgeRel(id: string, rel: RelType) {
    dispatch({ type: 'SET_EDGE_REL', id, rel })
  }

  function moveLine(id: string, dx: number, dy: number) {
    dispatch({ type: 'MOVE_LINE', id, dx, dy })
  }

  function resizeLine(id: string, delta: number) {
    dispatch({ type: 'RESIZE_LINE', id, delta })
  }

  function setLineArrow(id: string, arrow: LineArrow) {
    dispatch({ type: 'SET_LINE_ARROW', id, arrow })
  }

  function setLineLabelPos(id: string, pos: LabelPos) {
    dispatch({ type: 'SET_LINE_LABEL_POS', id, pos })
  }

  // Nudge an edge's curvature by a step, clamped to a sane range.
  function bendEdge(id: string, delta: number) {
    const edge = doc.edges.find((e) => e.id === id)
    if (!edge) return
    const next = Math.max(-CURVE_MAX, Math.min(CURVE_MAX, (edge.curve ?? 0) + delta))
    setEdgeCurve(id, next)
  }

  // Self-loop size (reuses the edge's `curve` field), clamped so it can't invert.
  function resizeLoop(id: string, delta: number) {
    const edge = doc.edges.find((e) => e.id === id)
    if (!edge) return
    const next = Math.max(LOOP_SIZE_MIN, Math.min(LOOP_SIZE_MAX, (edge.curve ?? 0) + delta))
    setEdgeCurve(id, next)
  }

  // Rotate a self-loop around its state.
  function rotateLoop(id: string, deltaDeg: number) {
    const edge = doc.edges.find((e) => e.id === id)
    if (!edge) return
    dispatch({ type: 'SET_EDGE_ANGLE', id, angle: (edge.angle ?? -90) + deltaDeg })
  }

  // Enter or Escape leaves the label field (Escape also deselects).
  function handleLabelKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.currentTarget.blur()
      if (e.key === 'Escape') setSelection(null)
    }
  }

  // keyboard shortcuts (also usable via an on-screen keyboard)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        dispatch({ type: 'UNDO' })
        return
      }
      switch (e.key) {
        case 's':
          changeMode('select')
          break
        case 'p':
          changeMode('node')
          break
        case 'c':
          changeMode('edge')
          break
        case 'l':
          changeMode('line')
          break
        case 'd':
          changeMode('delete')
          break
        case 'Escape':
          setPendingFrom(null)
          setPendingCorner(null)
          setHoverCell(null)
          setSelection(null)
          break
        case 'Delete':
        case 'Backspace':
          if (selection?.kind === 'node')
            dispatch({ type: 'DELETE_NODE', id: selection.id })
          else if (selection?.kind === 'edge')
            dispatch({ type: 'DELETE_EDGE', id: selection.id })
          else if (selection?.kind === 'line')
            dispatch({ type: 'DELETE_LINE', id: selection.id })
          setSelection(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [changeMode, dispatch, selection])

  return (
    <div className="app">
      <aside className="toolbar">
        <h1>INFEditor</h1>

        <div className="group">
          <span className="group-title">Mode</span>
          <button
            className={mode === 'select' ? 'active' : ''}
            onClick={() => changeMode('select')}
          >
            Select / Move <kbd>s</kbd>
          </button>
          <button
            className={mode === 'node' ? 'active' : ''}
            onClick={() => changeMode('node')}
          >
            Place node <kbd>p</kbd>
          </button>
          <button
            className={mode === 'edge' ? 'active' : ''}
            onClick={() => changeMode('edge')}
          >
            Connect <kbd>c</kbd>
          </button>
          <button
            className={mode === 'line' ? 'active' : ''}
            onClick={() => changeMode('line')}
          >
            Line / wire <kbd>l</kbd>
          </button>
          <button
            className={mode === 'delete' ? 'active danger' : 'danger'}
            onClick={() => changeMode('delete')}
          >
            Delete <kbd>d</kbd>
          </button>
        </div>

        {mode === 'node' && (
          <div className="group">
            <span className="group-title">Shape</span>
            <button
              className={shape === 'circle' ? 'active' : ''}
              onClick={() => {
                setShape('circle')
                setPendingCorner(null)
                setHoverCell(null)
              }}
            >
              ◯ State (2 corners)
            </button>
            <button
              className={shape === 'box' ? 'active' : ''}
              onClick={() => {
                setShape('box')
                setPendingCorner(null)
                setHoverCell(null)
              }}
            >
              ▭ Box (2 corners)
            </button>
            <button
              className={shape === 'dot' ? 'active' : ''}
              onClick={() => {
                setShape('dot')
                setPendingCorner(null)
                setHoverCell(null)
              }}
            >
              ● Junction dot
            </button>
          </div>
        )}

        <div className="group">
          <span className="group-title">Edit</span>
          <button disabled={!canUndo} onClick={() => dispatch({ type: 'UNDO' })}>
            Undo <kbd>Ctrl+Z</kbd>
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Clear the whole diagram?')) {
                dispatch({ type: 'CLEAR' })
                setSelection(null)
              }
            }}
          >
            Clear all
          </button>
        </div>

        <div className="group">
          <span className="group-title">View (pan / zoom)</span>
          <div className="dpad">
            <span />
            <button onClick={() => panBy(0, -0.3)} title="Pan up">↑</button>
            <span />
            <button onClick={() => panBy(-0.3, 0)} title="Pan left">←</button>
            <button onClick={resetView} title="Reset view">⌂</button>
            <button onClick={() => panBy(0.3, 0)} title="Pan right">→</button>
            <span />
            <button onClick={() => panBy(0, 0.3)} title="Pan down">↓</button>
            <span />
          </div>
          <div className="curve-row">
            <button onClick={() => zoomBy(0.8)} title="Zoom in">＋</button>
            <button onClick={() => zoomBy(1.25)} title="Zoom out">－</button>
          </div>
        </div>

        <div className="group">
          <span className="group-title">Export</span>
          <button
            onClick={() => svgRef.current && exportPng(svgRef.current)}
          >
            Download PNG
          </button>
          <button onClick={() => window.print()}>Print → PDF</button>
        </div>

        <div className="hint">
          {mode === 'node' &&
            shape === 'dot' &&
            'Dwell a grid point to drop a junction dot (place as many as you like).'}
          {mode === 'node' &&
            shape !== 'dot' &&
            (pendingCorner
              ? `Now dwell on the opposite corner to finish the ${
                  shape === 'circle' ? 'state' : 'box'
                }.`
              : `Dwell on the first corner of the ${
                  shape === 'circle' ? 'state' : 'box'
                }.`)}
          {mode === 'edge' &&
            (pendingFrom
              ? 'Now dwell on the target node (same node = self-loop).'
              : 'Dwell on the source node.')}
          {mode === 'line' &&
            (pendingCorner
              ? 'Now dwell on the end point of the wire.'
              : 'Dwell on the start point of the wire. After drawing, use the buttons to nudge it by 1/4 cell.')}
          {mode === 'select' &&
            'Dwell a node to select; dwell an empty cell to move it (boxes anchor by their top-left corner).'}
          {mode === 'delete' && 'Dwell a node, edge, or wire to delete it.'}
        </div>
      </aside>

      <main className="stage">
        <Canvas
          ref={svgRef}
          doc={doc}
          mode={mode}
          selection={selection}
          pendingFrom={pendingFrom}
          pendingCorner={pendingCorner}
          hoverCell={hoverCell}
          drawShape={shape}
          view={view}
          onBgClick={handleBgClick}
          onBgMove={handleBgMove}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onLineClick={handleLineClick}
        />
      </main>

      <aside className="inspector">
        <span className="group-title">Properties</span>
        {selectedNode && (
          <>
            {selectedNode.shape !== 'dot' && (
              <label>
                Label
                <input
                  ref={labelInputRef}
                  value={selectedNode.label}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_NODE_LABEL',
                      id: selectedNode.id,
                      label: e.target.value,
                    })
                  }
                  onKeyDown={handleLabelKey}
                  autoFocus
                />
              </label>
            )}
            {selectedNode.shape === 'dot' && (
              <p className="muted">Junction dot — move or delete it.</p>
            )}
            {selectedNode.shape === 'circle' && (
              <>
                <button
                  className={selectedNode.accepting ? 'active' : ''}
                  onClick={() =>
                    dispatch({ type: 'TOGGLE_ACCEPTING', id: selectedNode.id })
                  }
                >
                  Accepting (double circle)
                </button>
                <button
                  className={selectedNode.start ? 'active' : ''}
                  onClick={() =>
                    dispatch({ type: 'TOGGLE_START', id: selectedNode.id })
                  }
                >
                  Start state
                </button>
              </>
            )}
            {selectedNode.shape === 'box' && (
              <>
                <span className="group-title">Logic gate (Schaltnetz)</span>
                <div className="gate-grid">
                  <button
                    className={!selectedNode.gate ? 'active' : ''}
                    onClick={() =>
                      dispatch({ type: 'SET_NODE_GATE', id: selectedNode.id, gate: 'none' })
                    }
                  >
                    None
                  </button>
                  {GATE_ORDER.map((g) => (
                    <button
                      key={g}
                      className={selectedNode.gate === g ? 'active' : ''}
                      onClick={() =>
                        dispatch({ type: 'SET_NODE_GATE', id: selectedNode.id, gate: g })
                      }
                      title={GATES[g].name}
                    >
                      {GATES[g].name}
                      <span className="gate-hint">{GATES[g].sym}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {selectedEdge && (
          <>
            <label>
              Transition label
              <input
                ref={labelInputRef}
                value={selectedEdge.label}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_EDGE_LABEL',
                    id: selectedEdge.id,
                    label: e.target.value,
                  })
                }
                onKeyDown={handleLabelKey}
                autoFocus
              />
            </label>
            {selectedEdge.from !== selectedEdge.to && (
              <>
                <span className="group-title">Relationship</span>
                {REL_TYPES.map(({ rel, label }) => (
                  <button
                    key={rel}
                    className={(selectedEdge.rel ?? 'arrow') === rel ? 'active' : ''}
                    onClick={() => setEdgeRel(selectedEdge.id, rel)}
                  >
                    {label}
                  </button>
                ))}
                <span className="group-title">Curvature</span>
                <div className="curve-row">
                  <button
                    onClick={() => bendEdge(selectedEdge.id, -CURVE_STEP)}
                    title="Bend one way"
                  >
                    ↶
                  </button>
                  <button onClick={() => setEdgeCurve(selectedEdge.id, 0)}>
                    Straight
                  </button>
                  <button
                    onClick={() => bendEdge(selectedEdge.id, CURVE_STEP)}
                    title="Bend the other way"
                  >
                    ↷
                  </button>
                </div>
              </>
            )}
            {selectedEdge.from === selectedEdge.to && (
              <>
                <span className="group-title">Loop size</span>
                <div className="curve-row">
                  <button onClick={() => resizeLoop(selectedEdge.id, -CURVE_STEP)}>
                    −
                  </button>
                  <button onClick={() => resizeLoop(selectedEdge.id, CURVE_STEP)}>
                    +
                  </button>
                </div>
                <span className="group-title">Loop position</span>
                <div className="curve-row">
                  <button
                    onClick={() => rotateLoop(selectedEdge.id, -LOOP_ANGLE_STEP)}
                    title="Rotate loop around the state"
                  >
                    ↺
                  </button>
                  <button
                    onClick={() => rotateLoop(selectedEdge.id, LOOP_ANGLE_STEP)}
                    title="Rotate loop around the state"
                  >
                    ↻
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {selectedLineId && (
          <>
            <label>
              Label
              <input
                value={selectedLine?.label ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_LINE_LABEL',
                    id: selectedLineId,
                    label: e.target.value,
                  })
                }
                onKeyDown={handleLabelKey}
              />
            </label>
            <span className="group-title">Label position</span>
            <div className="curve-row">
              {(['start', 'middle', 'end'] as LabelPos[]).map((p) => (
                <button
                  key={p}
                  className={(selectedLine?.labelPos ?? 'middle') === p ? 'active' : ''}
                  onClick={() => setLineLabelPos(selectedLineId, p)}
                >
                  {p === 'start' ? 'Start' : p === 'middle' ? 'Middle' : 'End'}
                </button>
              ))}
            </div>
            <span className="group-title">Move (1/4 cell)</span>
            <div className="dpad">
              <span />
              <button onClick={() => moveLine(selectedLineId, 0, -LINE_STEP)}>↑</button>
              <span />
              <button onClick={() => moveLine(selectedLineId, -LINE_STEP, 0)}>←</button>
              <span />
              <button onClick={() => moveLine(selectedLineId, LINE_STEP, 0)}>→</button>
              <span />
              <button onClick={() => moveLine(selectedLineId, 0, LINE_STEP)}>↓</button>
              <span />
            </div>
            <span className="group-title">Length (1/4 cell)</span>
            <div className="curve-row">
              <button onClick={() => resizeLine(selectedLineId, -LINE_STEP)}>−</button>
              <button onClick={() => resizeLine(selectedLineId, LINE_STEP)}>+</button>
            </div>
            <span className="group-title">Arrowhead</span>
            <div className="gate-grid">
              {(
                [
                  { a: 'none', label: 'None' },
                  { a: 'end', label: 'End →' },
                  { a: 'start', label: 'Start ←' },
                  { a: 'both', label: 'Both ↔' },
                ] as { a: LineArrow; label: string }[]
              ).map(({ a, label }) => (
                <button
                  key={a}
                  className={(selectedLine?.arrow ?? 'none') === a ? 'active' : ''}
                  onClick={() => setLineArrow(selectedLineId, a)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {selection && (
          <button className="done" onClick={finishEditing}>
            ✓ Done
          </button>
        )}
        {!selection && (
          <p className="muted">
            Select something (Select mode) to edit its label and properties.
          </p>
        )}
      </aside>
    </div>
  )
}
