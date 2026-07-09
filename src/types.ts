export type Shape = 'circle' | 'box' | 'dot'

export type GateType =
  | 'and'
  | 'nand'
  | 'or'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'not'
  | 'buffer'

export interface DiagNode {
  id: string
  x: number // grid coordinates of the node CENTER (may be a half-cell for boxes)
  y: number
  label: string
  shape: Shape
  accepting: boolean // double-circle for automata accepting states
  start: boolean // draw an incoming "start" arrow
  w?: number // box width in grid cells (boxes only)
  h?: number // box height in grid cells (boxes only)
  gate?: GateType // boxes only: render as an IEC logic-gate symbol
}

// UML relationship end-types (plus 'arrow' = the default automata arrowhead).
export type RelType =
  | 'arrow'
  | 'association'
  | 'dependency'
  | 'inheritance'
  | 'realization'
  | 'aggregation'
  | 'composition'

export interface DiagEdge {
  id: string
  from: string
  to: string // === from means a self-loop
  label: string
  curve?: number // normal edges: perpendicular bow in px. self-loops: extra size in px.
  angle?: number // self-loops only: direction of the loop around the state, in degrees
  rel?: RelType // arrowhead / line style (undefined = 'arrow')
}

export type LineArrow = 'none' | 'start' | 'end' | 'both'
export type LabelPos = 'start' | 'middle' | 'end'

// A free wire segment between two grid points (not tied to nodes).
export interface DiagLine {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  arrow?: Exclude<LineArrow, 'none'> // arrowhead placement (undefined = none)
  label?: string
  labelPos?: LabelPos // where the label sits along the wire (default 'middle')
}

// A free-standing text label placed anywhere on the grid.
export interface DiagText {
  id: string
  x: number
  y: number
  text: string
}

// A KV/Karnaugh group loop: a rounded outline around a rectangular cell block
// (r1..r2, c1..c2 inclusive). Wrap-around groups are drawn as two same-color loops.
export interface TableLoop {
  id: string
  r1: number
  c1: number
  r2: number
  c2: number
  color: string
  label: string
}

// A table / truth-table. Purely a formatting grid — the user fills all values.
export interface DiagTable {
  id: string
  x: number // top-left grid column
  y: number // top-left grid row
  cols: number
  rows: number
  cw: number // cell width in grid cells (each cell is 1 grid row tall)
  header: boolean // first row rendered as a header
  cells: string[][] // [row][col] contents (verbatim, may contain LaTeX)
  inputCols?: number // truth tables: how many left columns are inputs
  math?: boolean // wrap cell contents in $…$ on LaTeX export
  loops?: TableLoop[] // KV/Karnaugh group markings
  kv?: number // 3 or 4: render Veitch variable bars (x_i) along the axes
}

// One line of a boolean-algebra derivation. Row 0 is the initial expression
// (its rel/reason are unused); later rows are "<rel> <expr>  (reason)".
export interface DerivStep {
  rel: string // relation to the previous line, e.g. '=' (LaTeX, no backslash for '=')
  expr: string
  reason: string
}

// A multi-line derivation → exports to a LaTeX align* block. Formatting only.
export interface DiagDerivation {
  id: string
  x: number
  y: number
  exprW: number // width of the expression column, in grid cells
  steps: DerivStep[]
}

export interface Doc {
  nodes: DiagNode[]
  edges: DiagEdge[]
  lines: DiagLine[]
  texts: DiagText[]
  tables: DiagTable[]
  derivations: DiagDerivation[]
  pages: number // number of stacked A4 pages
}

export type DerivField = 'rel' | 'expr' | 'reason'

export type Mode =
  | 'select'
  | 'node'
  | 'edge'
  | 'line'
  | 'text'
  | 'table'
  | 'deriv'
  | 'delete'

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'table'; id: string }
  | { kind: 'deriv'; id: string }
  | null
