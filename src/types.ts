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

export interface DiagEdge {
  id: string
  from: string
  to: string // === from means a self-loop
  label: string
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
