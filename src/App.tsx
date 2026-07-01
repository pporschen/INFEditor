import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from './Canvas'
import { useEditor } from './store'
import { exportPng } from './exportPng'
import type { Doc, Mode, Selection, Shape } from './types'

const STORAGE_KEY = 'infeditor.doc.v1'

function loadInitial(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Doc
  } catch {
    /* ignore corrupt autosave */
  }
  return { nodes: [], edges: [] }
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

  const changeMode = useCallback((m: Mode) => {
    setMode(m)
    setPendingFrom(null)
    setPendingCorner(null)
    setHoverCell(null)
    setSelection(null)
  }, [])

  function handleBgClick(gx: number, gy: number) {
    if (mode === 'node') {
      // Both states and boxes are drawn from two opposite corners.
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
    } else if (mode === 'select' && selection?.kind === 'node') {
      dispatch({ type: 'MOVE_NODE', id: selection.id, x: gx, y: gy })
    } else if (mode === 'edge') {
      setPendingFrom(null)
    }
  }

  function handleBgMove(gx: number, gy: number) {
    // only track the cursor while actively drawing a shape (keeps re-renders scoped)
    if (mode === 'node' && pendingCorner) {
      setHoverCell((h) => (h && h.x === gx && h.y === gy ? h : { x: gx, y: gy }))
    }
  }

  function handleNodeClick(id: string) {
    if (mode === 'edge') {
      if (pendingFrom === null) {
        setPendingFrom(id)
      } else {
        dispatch({ type: 'ADD_EDGE', from: pendingFrom, to: id })
        setPendingFrom(null)
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
          {mode === 'select' &&
            'Dwell a node to select; dwell an empty cell to move it (boxes anchor by their top-left corner).'}
          {mode === 'delete' && 'Dwell a node or edge to delete it.'}
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
          onBgClick={handleBgClick}
          onBgMove={handleBgMove}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
        />
      </main>

      <aside className="inspector">
        <span className="group-title">Properties</span>
        {selectedNode && (
          <>
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
          </>
        )}
        {selectedEdge && (
          <label>
            Transition label
            <input
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
