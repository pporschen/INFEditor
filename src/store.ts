import { useReducer } from 'react'
import type { Doc, DiagNode, Shape } from './types'

export type Action =
  | { type: 'ADD_NODE'; x: number; y: number; shape: Shape }
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
    case 'ADD_NODE': {
      if (occupied(doc, a.x, a.y)) return doc
      const node: DiagNode = {
        id: uid(),
        x: a.x,
        y: a.y,
        label: '',
        shape: a.shape,
        accepting: false,
        start: false,
      }
      return { ...doc, nodes: [...doc.nodes, node] }
    }
    case 'MOVE_NODE': {
      if (occupied(doc, a.x, a.y, a.id)) return doc
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === a.id ? { ...n, x: a.x, y: a.y } : n)),
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
