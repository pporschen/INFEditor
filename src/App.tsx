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
  const svgRef = useRef<SVGSVGElement>(null)

  // autosave on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
  }, [doc])

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
    setSelection(null)
  }, [])

  function handleBgClick(gx: number, gy: number) {
    if (mode === 'node') {
      dispatch({ type: 'ADD_NODE', x: gx, y: gy, shape })
    } else if (mode === 'select' && selection?.kind === 'node') {
      dispatch({ type: 'MOVE_NODE', id: selection.id, x: gx, y: gy })
    } else if (mode === 'edge') {
      setPendingFrom(null)
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
              onClick={() => setShape('circle')}
            >
              ◯ State
            </button>
            <button
              className={shape === 'box' ? 'active' : ''}
              onClick={() => setShape('box')}
            >
              ▭ Box
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
          {mode === 'node' && 'Look at a grid point and dwell to place a node.'}
          {mode === 'edge' &&
            (pendingFrom
              ? 'Now dwell on the target node (same node = self-loop).'
              : 'Dwell on the source node.')}
          {mode === 'select' &&
            'Dwell a node to select; dwell an empty cell to move it here.'}
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
          onBgClick={handleBgClick}
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
                value={selectedNode.label}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_NODE_LABEL',
                    id: selectedNode.id,
                    label: e.target.value,
                  })
                }
                autoFocus
              />
            </label>
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
              autoFocus
            />
          </label>
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
