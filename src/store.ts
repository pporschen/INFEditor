import { useReducer } from 'react'
import type { Doc, DiagNode, Shape, RelType, GateType, LineArrow } from './types'

export type Action =
  | {
      type: 'ADD_SHAPE'
      id: string
      shape: Shape
      ax: number
      ay: number
      bx: number
      by: number
    }
  | { type: 'ADD_DOT'; id: string; x: number; y: number }
  | { type: 'MOVE_NODE'; id: string; x: number; y: number }
  | { type: 'ADD_EDGE'; id: string; from: string; to: string }
  | { type: 'ADD_LINE'; id: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'DELETE_EDGE'; id: string }
  | { type: 'DELETE_LINE'; id: string }
  | { type: 'MOVE_LINE'; id: string; dx: number; dy: number }
  | { type: 'RESIZE_LINE'; id: string; delta: number }
  | { type: 'SET_LINE_ARROW'; id: string; arrow: LineArrow }
  | { type: 'SET_NODE_LABEL'; id: string; label: string }
  | { type: 'SET_EDGE_LABEL'; id: string; label: string }
  | { type: 'SET_EDGE_CURVE'; id: string; curve: number }
  | { type: 'SET_EDGE_ANGLE'; id: string; angle: number }
  | { type: 'SET_EDGE_REL'; id: string; rel: RelType }
  | { type: 'SET_NODE_GATE'; id: string; gate: GateType | 'none' }
  | { type: 'TOGGLE_ACCEPTING'; id: string }
  | { type: 'TOGGLE_START'; id: string }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; doc: Doc }
  | { type: 'UNDO' }

interface History {
  past: Doc[]
  present: Doc
}

function occupied(doc: Doc, x: number, y: number, exceptId?: string): boolean {
  return doc.nodes.some((n) => n.id !== exceptId && n.x === x && n.y === y)
}

function docReducer(doc: Doc, a: Action): Doc {
  switch (a.type) {
    case 'ADD_SHAPE': {
      // Both states (ellipses) and boxes are drawn from two opposite corners.
      const w = Math.abs(a.bx - a.ax)
      const h = Math.abs(a.by - a.ay)
      if (w === 0 || h === 0) return doc // degenerate → ignore
      const node: DiagNode = {
        id: a.id, // supplied by caller so it can select + focus the new node
        x: (a.ax + a.bx) / 2, // center (may land on a half-cell)
        y: (a.ay + a.by) / 2,
        label: '',
        shape: a.shape,
        accepting: false,
        start: false,
        w,
        h,
      }
      return { ...doc, nodes: [...doc.nodes, node] }
    }
    case 'ADD_DOT': {
      if (occupied(doc, a.x, a.y)) return doc
      const node: DiagNode = {
        id: a.id,
        x: a.x,
        y: a.y,
        label: '',
        shape: 'dot',
        accepting: false,
        start: false,
      }
      return { ...doc, nodes: [...doc.nodes, node] }
    }
    case 'MOVE_NODE': {
      const node = doc.nodes.find((n) => n.id === a.id)
      if (!node) return doc
      // Anchor moves by the TOP-LEFT corner: the clicked grid point becomes the
      // node's upper-left, keeping sized shapes aligned to the grid lines.
      // Legacy nodes without w/h fall back to centering on the clicked point.
      let cx = a.x
      let cy = a.y
      if (node.w != null && node.h != null) {
        cx = a.x + node.w / 2
        cy = a.y + node.h / 2
      }
      if (occupied(doc, cx, cy, a.id)) return doc
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === a.id ? { ...n, x: cx, y: cy } : n)),
      }
    }
    case 'ADD_EDGE':
      return {
        ...doc,
        edges: [...doc.edges, { id: a.id, from: a.from, to: a.to, label: '' }],
      }
    case 'ADD_LINE':
      return {
        ...doc,
        lines: [...doc.lines, { id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }],
      }
    case 'DELETE_NODE':
      return {
        ...doc,
        nodes: doc.nodes.filter((n) => n.id !== a.id),
        edges: doc.edges.filter((e) => e.from !== a.id && e.to !== a.id),
      }
    case 'DELETE_EDGE':
      return { ...doc, edges: doc.edges.filter((e) => e.id !== a.id) }
    case 'DELETE_LINE':
      return { ...doc, lines: doc.lines.filter((l) => l.id !== a.id) }
    case 'MOVE_LINE':
      return {
        ...doc,
        lines: doc.lines.map((l) =>
          l.id === a.id
            ? {
                ...l,
                x1: l.x1 + a.dx,
                y1: l.y1 + a.dy,
                x2: l.x2 + a.dx,
                y2: l.y2 + a.dy,
              }
            : l,
        ),
      }
    case 'RESIZE_LINE':
      return {
        ...doc,
        lines: doc.lines.map((l) => {
          if (l.id !== a.id) return l
          const dx = l.x2 - l.x1
          const dy = l.y2 - l.y1
          const len = Math.hypot(dx, dy) || 1
          const next = len + a.delta
          if (next < 0.2) return l // keep a minimum length
          const ux = dx / len
          const uy = dy / len
          return { ...l, x2: l.x1 + ux * next, y2: l.y1 + uy * next }
        }),
      }
    case 'SET_LINE_ARROW':
      return {
        ...doc,
        lines: doc.lines.map((l) =>
          l.id === a.id
            ? { ...l, arrow: a.arrow === 'none' ? undefined : a.arrow }
            : l,
        ),
      }
    case 'SET_NODE_LABEL':
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === a.id ? { ...n, label: a.label } : n)),
      }
    case 'SET_EDGE_LABEL':
      return {
        ...doc,
        edges: doc.edges.map((e) => (e.id === a.id ? { ...e, label: a.label } : e)),
      }
    case 'SET_EDGE_CURVE':
      return {
        ...doc,
        edges: doc.edges.map((e) => (e.id === a.id ? { ...e, curve: a.curve } : e)),
      }
    case 'SET_EDGE_ANGLE':
      return {
        ...doc,
        edges: doc.edges.map((e) => (e.id === a.id ? { ...e, angle: a.angle } : e)),
      }
    case 'SET_EDGE_REL':
      return {
        ...doc,
        edges: doc.edges.map((e) => (e.id === a.id ? { ...e, rel: a.rel } : e)),
      }
    case 'SET_NODE_GATE':
      return {
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.id === a.id
            ? { ...n, gate: a.gate === 'none' ? undefined : a.gate }
            : n,
        ),
      }
    case 'TOGGLE_ACCEPTING':
      return {
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.id === a.id ? { ...n, accepting: !n.accepting } : n,
        ),
      }
    case 'TOGGLE_START':
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === a.id ? { ...n, start: !n.start } : n)),
      }
    case 'CLEAR':
      return { nodes: [], edges: [], lines: [] }
    default:
      return doc
  }
}

function reducer(h: History, a: Action): History {
  if (a.type === 'UNDO') {
    if (h.past.length === 0) return h
    const past = h.past.slice()
    const present = past.pop()!
    return { past, present }
  }
  if (a.type === 'LOAD') {
    return { past: [], present: a.doc }
  }
  const present = docReducer(h.present, a)
  if (present === h.present) return h // no-op (e.g. occupied cell) → no history entry
  return { past: [...h.past.slice(-99), h.present], present }
}

export function useEditor(init: () => Doc) {
  const [hist, dispatch] = useReducer(
    reducer,
    undefined,
    (): History => ({ past: [], present: init() }),
  )
  return { doc: hist.present, canUndo: hist.past.length > 0, dispatch }
}
