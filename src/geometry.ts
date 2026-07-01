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

// Box size in grid cells, with a fallback for boxes saved before two-corner
// drawing existed.
export function boxCells(n: DiagNode): { w: number; h: number } {
  return { w: n.w ?? BW / GRID, h: n.h ?? BH / GRID }
}

// Half-extents of a box in pixels.
export function boxHalf(n: DiagNode): { hw: number; hh: number } {
  const { w, h } = boxCells(n)
  return { hw: (w * GRID) / 2, hh: (h * GRID) / 2 }
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

  if (n.shape === 'circle') {
    return { x: c.x + dx * R, y: c.y + dy * R }
  }
  // box: scale the direction vector until it hits a rectangle edge
  const { hw, hh } = boxHalf(n)
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

// Topmost boundary point — used to anchor self-loops.
export function topAnchor(n: DiagNode): Pt {
  const c = center(n)
  return { x: c.x, y: c.y - (n.shape === 'circle' ? R : boxHalf(n).hh) }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
