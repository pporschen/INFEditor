import { useReducer } from 'react'
import { kvHeaderRow, kvHeaderCol } from './kv'
import type {
  Doc,
  DiagNode,
  DiagTable,
  TableLoop,
  DiagDerivation,
  DerivField,
  Shape,
  RelType,
  GateType,
  LineArrow,
  LabelPos,
} from './types'

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
  | { type: 'SET_LINE_LABEL'; id: string; label: string }
  | { type: 'SET_LINE_LABEL_POS'; id: string; pos: LabelPos }
  | { type: 'ADD_TEXT'; id: string; x: number; y: number; kind: 'label' | 'text' }
  | { type: 'SET_TEXT'; id: string; text: string }
  | { type: 'SET_TEXT_SIZE'; id: string; delta: number }
  | { type: 'SET_TEXT_ALIGN'; id: string; align: 'left' | 'center' }
  | { type: 'TOGGLE_TEXT_BOLD'; id: string }
  | { type: 'MOVE_TEXT'; id: string; x: number; y: number }
  | { type: 'DELETE_TEXT'; id: string }
  | { type: 'ADD_TABLE'; table: DiagTable }
  | { type: 'SET_TABLE_CELL'; id: string; row: number; col: number; text: string }
  | { type: 'TABLE_ROWS'; id: string; delta: number }
  | { type: 'TABLE_COLS'; id: string; delta: number }
  | { type: 'TABLE_WIDTH'; id: string; delta: number }
  | { type: 'QM_VARS'; id: string; delta: number }
  | { type: 'TOGGLE_TABLE_HEADER'; id: string }
  | { type: 'TOGGLE_TABLE_MATH'; id: string }
  | { type: 'TOGGLE_TABLE_FORM'; id: string }
  | { type: 'FILL_TABLE_INPUTS'; id: string }
  | { type: 'MOVE_TABLE'; id: string; x: number; y: number }
  | { type: 'DELETE_TABLE'; id: string }
  | { type: 'ADD_TABLE_LOOP'; id: string; loop: TableLoop }
  | { type: 'SET_LOOP_LABEL'; id: string; loopId: string; label: string }
  | { type: 'SET_LOOP_COLOR'; id: string; loopId: string; color: string }
  | { type: 'TOGGLE_LOOP_WRAP'; id: string; loopId: string; axis: 'h' | 'v' }
  | { type: 'DEL_TABLE_LOOP'; id: string; loopId: string }
  | { type: 'ADD_DERIV'; derivation: DiagDerivation }
  | { type: 'SET_DERIV'; id: string; index: number; field: DerivField; value: string }
  | { type: 'ADD_DERIV_STEP'; id: string; after: number }
  | { type: 'DEL_DERIV_STEP'; id: string; index: number }
  | { type: 'MOVE_DERIV'; id: string; x: number; y: number }
  | { type: 'MOVE_MANY'; refs: { kind: string; id: string }[]; dx: number; dy: number }
  | { type: 'DELETE_DERIV'; id: string }
  | { type: 'SET_PAGES'; count: number }
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
    case 'SET_LINE_LABEL':
      return {
        ...doc,
        lines: doc.lines.map((l) => (l.id === a.id ? { ...l, label: a.label } : l)),
      }
    case 'SET_LINE_LABEL_POS':
      return {
        ...doc,
        lines: doc.lines.map((l) => (l.id === a.id ? { ...l, labelPos: a.pos } : l)),
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
    case 'ADD_TEXT':
      return {
        ...doc,
        texts: [
          ...doc.texts,
          {
            id: a.id,
            x: a.x,
            y: a.y,
            text: '',
            kind: a.kind,
            ...(a.kind === 'text' ? { size: 1, align: 'left' as const } : {}),
          },
        ],
      }
    case 'SET_TEXT':
      return {
        ...doc,
        texts: doc.texts.map((t) => (t.id === a.id ? { ...t, text: a.text } : t)),
      }
    case 'SET_TEXT_SIZE':
      return {
        ...doc,
        texts: doc.texts.map((t) =>
          t.id === a.id
            ? { ...t, size: Math.max(0.6, Math.min(4, (t.size ?? 1) + a.delta)) }
            : t,
        ),
      }
    case 'SET_TEXT_ALIGN':
      return {
        ...doc,
        texts: doc.texts.map((t) => (t.id === a.id ? { ...t, align: a.align } : t)),
      }
    case 'TOGGLE_TEXT_BOLD':
      return {
        ...doc,
        texts: doc.texts.map((t) => (t.id === a.id ? { ...t, bold: !t.bold } : t)),
      }
    case 'MOVE_TEXT':
      return {
        ...doc,
        texts: doc.texts.map((t) => (t.id === a.id ? { ...t, x: a.x, y: a.y } : t)),
      }
    case 'DELETE_TEXT':
      return { ...doc, texts: doc.texts.filter((t) => t.id !== a.id) }
    case 'ADD_TABLE':
      return { ...doc, tables: [...doc.tables, a.table] }
    case 'SET_TABLE_CELL':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id
            ? {
                ...t,
                cells: t.cells.map((row, r) =>
                  r === a.row
                    ? row.map((c, ci) => (ci === a.col ? a.text : c))
                    : row,
                ),
              }
            : t,
        ),
      }
    case 'TABLE_ROWS':
      return {
        ...doc,
        tables: doc.tables.map((t) => {
          if (t.id !== a.id) return t
          const rows = Math.max(1, t.rows + a.delta)
          const cells = t.cells.slice(0, rows)
          while (cells.length < rows) {
            const row = Array(t.cols).fill('')
            // QM combination tables: keep the bit columns prefilled with 0
            if (t.checkCol != null) for (let c = 1; c <= t.cols - 3; c++) row[c] = '0'
            cells.push(row)
          }
          return { ...t, rows, cells }
        }),
      }
    case 'TABLE_COLS':
      return {
        ...doc,
        tables: doc.tables.map((t) => {
          if (t.id !== a.id) return t
          const cols = Math.max(1, t.cols + a.delta)
          const cells = t.cells.map((row) => {
            const r = row.slice(0, cols)
            while (r.length < cols) r.push('')
            return r
          })
          const inputCols = t.inputCols ? Math.min(t.inputCols, cols) : t.inputCols
          return { ...t, cols, cells, inputCols }
        }),
      }
    case 'QM_VARS':
      // add/remove a variable (bit) column in a QM combination table. The bit
      // block sits between the Dez. column and the ✓/Gruppe columns; adding
      // inserts a new highest bit at its left and relabels x_n…x_1.
      return {
        ...doc,
        tables: doc.tables.map((t) => {
          if (t.id !== a.id || t.checkCol == null) return t
          const vars = t.cols - 3 // Dez. + ✓ + Gruppe are the 3 fixed columns
          const next = Math.max(2, Math.min(6, vars + a.delta))
          if (next === vars) return t
          const cells = t.cells.map((row, r) => {
            if (r === 0) return row // header rebuilt below
            const copy = row.slice()
            if (a.delta > 0) copy.splice(1, 0, '0') // new bit column (prefilled 0)
            else copy.splice(1, 1) // drop the leftmost (highest) bit column
            return copy
          })
          const bits = Array.from({ length: next }, (_, i) => `x_${next - i}`)
          cells[0] = ['Dez.', ...bits, '', 'Gruppe']
          return { ...t, cols: next + 3, cells, checkCol: next + 1 }
        }),
      }
    case 'TABLE_WIDTH':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id ? { ...t, cw: Math.max(1, t.cw + a.delta) } : t,
        ),
      }
    case 'TOGGLE_TABLE_HEADER':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id ? { ...t, header: !t.header } : t,
        ),
      }
    case 'TOGGLE_TABLE_MATH':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id ? { ...t, math: !t.math } : t,
        ),
      }
    case 'TOGGLE_TABLE_FORM':
      return {
        ...doc,
        tables: doc.tables.map((t) => {
          if (t.id !== a.id || !t.kv || !t.form) return t
          const form = t.form === 'dnf' ? 'knf' : 'dnf'
          const colHead = kvHeaderRow(form)
          const rowHead = kvHeaderCol(t.kv, form)
          const cells = t.cells.map((row, r) =>
            row.map((cell, c) => {
              if (r === 0 && c === 0) return '' // corner
              if (r === 0) return colHead[c - 1] ?? cell // header row
              if (c === 0) return rowHead[r - 1] ?? cell // header column
              return cell === '0' ? '1' : cell === '1' ? '0' : cell // flip value
            }),
          )
          return { ...t, form, cells }
        }),
      }
    case 'FILL_TABLE_INPUTS':
      return {
        ...doc,
        tables: doc.tables.map((t) => {
          if (t.id !== a.id || !t.inputCols) return t
          const n = t.inputCols
          const first = t.header ? 1 : 0
          const cells = t.cells.map((row) => row.slice())
          const dataRows = t.rows - first
          for (let i = 0; i < dataRows && i < 1 << n; i++) {
            for (let j = 0; j < n; j++) {
              cells[first + i][j] = String((i >> (n - 1 - j)) & 1)
            }
          }
          return { ...t, cells }
        }),
      }
    case 'MOVE_TABLE':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id ? { ...t, x: a.x, y: a.y } : t,
        ),
      }
    case 'DELETE_TABLE':
      return { ...doc, tables: doc.tables.filter((t) => t.id !== a.id) }
    case 'ADD_TABLE_LOOP':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id ? { ...t, loops: [...(t.loops ?? []), a.loop] } : t,
        ),
      }
    case 'SET_LOOP_LABEL':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id
            ? {
                ...t,
                loops: (t.loops ?? []).map((l) =>
                  l.id === a.loopId ? { ...l, label: a.label } : l,
                ),
              }
            : t,
        ),
      }
    case 'SET_LOOP_COLOR':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id
            ? {
                ...t,
                loops: (t.loops ?? []).map((l) =>
                  l.id === a.loopId ? { ...l, color: a.color } : l,
                ),
              }
            : t,
        ),
      }
    case 'TOGGLE_LOOP_WRAP':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id
            ? {
                ...t,
                loops: (t.loops ?? []).map((l) =>
                  l.id === a.loopId
                    ? a.axis === 'h'
                      ? { ...l, wrapH: !l.wrapH }
                      : { ...l, wrapV: !l.wrapV }
                    : l,
                ),
              }
            : t,
        ),
      }
    case 'DEL_TABLE_LOOP':
      return {
        ...doc,
        tables: doc.tables.map((t) =>
          t.id === a.id
            ? { ...t, loops: (t.loops ?? []).filter((l) => l.id !== a.loopId) }
            : t,
        ),
      }
    case 'ADD_DERIV':
      return { ...doc, derivations: [...doc.derivations, a.derivation] }
    case 'SET_DERIV':
      return {
        ...doc,
        derivations: doc.derivations.map((d) =>
          d.id === a.id
            ? {
                ...d,
                steps: d.steps.map((s, i) =>
                  i === a.index ? { ...s, [a.field]: a.value } : s,
                ),
              }
            : d,
        ),
      }
    case 'ADD_DERIV_STEP':
      return {
        ...doc,
        derivations: doc.derivations.map((d) => {
          if (d.id !== a.id) return d
          const steps = d.steps.slice()
          steps.splice(a.after + 1, 0, { rel: '=', expr: '', reason: '' })
          return { ...d, steps }
        }),
      }
    case 'DEL_DERIV_STEP':
      return {
        ...doc,
        derivations: doc.derivations.map((d) => {
          if (d.id !== a.id || d.steps.length <= 1) return d
          return { ...d, steps: d.steps.filter((_, i) => i !== a.index) }
        }),
      }
    case 'MOVE_DERIV':
      return {
        ...doc,
        derivations: doc.derivations.map((d) =>
          d.id === a.id ? { ...d, x: a.x, y: a.y } : d,
        ),
      }
    case 'MOVE_MANY': {
      // shift several items by the same (dx, dy) in one history entry. Edges
      // ride along with their nodes, so only free-moving items are listed.
      const ids = (k: string) =>
        new Set(a.refs.filter((r) => r.kind === k).map((r) => r.id))
      const nodeIds = ids('node')
      const lineIds = ids('line')
      const textIds = ids('text')
      const tableIds = ids('table')
      const derivIds = ids('deriv')
      const { dx, dy } = a
      return {
        ...doc,
        nodes: doc.nodes.map((n) =>
          nodeIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
        ),
        lines: doc.lines.map((l) =>
          lineIds.has(l.id)
            ? { ...l, x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy }
            : l,
        ),
        texts: doc.texts.map((t) =>
          textIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
        ),
        tables: doc.tables.map((t) =>
          tableIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
        ),
        derivations: doc.derivations.map((d) =>
          derivIds.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d,
        ),
      }
    }
    case 'DELETE_DERIV':
      return { ...doc, derivations: doc.derivations.filter((d) => d.id !== a.id) }
    case 'SET_PAGES':
      return { ...doc, pages: Math.max(1, a.count) }
    case 'CLEAR':
      return {
        ...doc,
        nodes: [],
        edges: [],
        lines: [],
        texts: [],
        tables: [],
        derivations: [],
      }
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
