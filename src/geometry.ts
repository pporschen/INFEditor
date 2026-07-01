import type { DiagNode } from './types'

// Pixel size of one grid cell. Large cells = large dwell targets for gaze.
export const GRID = 48
export const COLS = 24
export const ROWS = 16
export const W = COLS * GRID
export const H = ROWS * GRID

export const R = 20 // circle node radius
export const BW = 76 // box width
export const BH = 44 // box height

export interface Pt {
  x: number
  y: number
}

export function center(n: DiagNode): Pt {
  return { x: n.x * GRID, y: n.y * GRID }
}

// Half-extents (in pixels) of a node's bounding box. Sized shapes carry w/h in
// grid cells; legacy nodes fall back to their old fixed size.
export function halfExtents(n: DiagNode): { hw: number; hh: number } {
  if (n.w != null && n.h != null) {
    return { hw: (n.w * GRID) / 2, hh: (n.h * GRID) / 2 }
  }
  return n.shape === 'circle' ? { hw: R, hh: R } : { hw: BW / 2, hh: BH / 2 }
}

// Point on the node boundary in the direction of (tx, ty), so edges touch the
// outline rather than the center.
export function anchor(n: DiagNode, tx: number, ty: number): Pt {
  const c = center(n)
  let dx = tx - c.x
  let dy = ty - c.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len

  const { hw, hh } = halfExtents(n)
  if (n.shape === 'circle') {
    // point where the ray leaves the ellipse
    const s = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
    return { x: c.x + dx * s, y: c.y + dy * s }
  }
  // box: scale the direction vector until it hits a rectangle edge
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

// Topmost boundary point — used to anchor self-loops.
export function topAnchor(n: DiagNode): Pt {
  const c = center(n)
  return { x: c.x, y: c.y - halfExtents(n).hh }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
