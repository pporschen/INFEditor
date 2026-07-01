import { useReducer } from 'react'
import type { Doc, DiagNode, Shape } from './types'

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
  | { type: 'MOVE_NODE'; id: string; x: number; y: number }
  | { type: 'ADD_EDGE'; from: string; to: string }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'DELETE_EDGE'; id: string }
  | { type: 'SET_NODE_LABEL'; id: string; label: string }
  | { type: 'SET_EDGE_LABEL'; id: string; label: string }
  | { type: 'TOGGLE_ACCEPTING'; id: string }
  | { type: 'TOGGLE_START'; id: string }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; doc: Doc }
  | { type: 'UNDO' }

interface History {
  past: Doc[]
  present: Doc
}

function uid(): string {
  // crypto.randomUUID is available in all modern browsers / exam machines.
  return crypto.randomUUID()
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
        edges: [...doc.edges, { id: uid(), from: a.from, to: a.to, label: '' }],
      }
    case 'DELETE_NODE':
      return {
        nodes: doc.nodes.filter((n) => n.id !== a.id),
        edges: doc.edges.filter((e) => e.from !== a.id && e.to !== a.id),
      }
    case 'DELETE_EDGE':
      return { ...doc, edges: doc.edges.filter((e) => e.id !== a.id) }
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
      return { nodes: [], edges: [] }
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
