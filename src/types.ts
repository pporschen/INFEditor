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

export interface Doc {
  nodes: DiagNode[]
  edges: DiagEdge[]
  lines: DiagLine[]
}

export type Mode = 'select' | 'node' | 'edge' | 'line' | 'delete'

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'line'; id: string }
  | null
