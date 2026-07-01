export type Shape = 'circle' | 'box'

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

export interface Doc {
  nodes: DiagNode[]
  edges: DiagEdge[]
}

export type Mode = 'select' | 'node' | 'edge' | 'delete'

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null
