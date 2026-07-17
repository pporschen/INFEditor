// Serialize the live SVG to a PNG download.
//
// Two things matter here:
//  1. UI-only decorations (selection rings, pending highlights) are stripped.
//  2. When an SVG is loaded as an <img>, the external stylesheet does NOT
//     apply — so we must bake the visual style onto the clone as presentation
//     attributes. We deliberately pin a LIGHT palette (dark strokes on white)
//     so exported diagrams are clean and submittable regardless of the editor
//     theme.
const LIGHT = {
  bg: '#ffffff',
  stroke: '#1d2433',
  nodeFill: '#ffffff',
  ink: '#1d2433',
  grid: '#e3e8f0',
}

function setStyle(root: Element, selector: string, attrs: Record<string, string>) {
  root.querySelectorAll(selector).forEach((el) => {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  })
}

export const LIGHT_BG = LIGHT.bg

// Bake the light palette onto a clone (or content group) as presentation
// attributes, since exported/printed SVG doesn't get the stylesheet. Shared by
// PNG export and A4 print. `ls` is the label scale to fold into font sizes.
export function applyLightStyles(root: Element, ls: number) {
  setStyle(root, '.canvas-bg', { fill: LIGHT.bg })
  setStyle(root, '.arrow-head', { fill: LIGHT.stroke })
  setStyle(root, '.uml-fill', { fill: LIGHT.stroke })
  setStyle(root, '.uml-hollow', { fill: LIGHT.bg, stroke: LIGHT.stroke, 'stroke-width': '1.5' })
  setStyle(root, '.uml-open', { fill: 'none', stroke: LIGHT.stroke, 'stroke-width': '1.5' })
  setStyle(root, '.node-fill', { fill: LIGHT.nodeFill, stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.node-inner', { stroke: LIGHT.stroke, 'stroke-width': '2', fill: 'none' })
  setStyle(root, '.gate-sym', {
    fill: LIGHT.ink,
    'font-size': String(22 * ls),
    'font-weight': '600',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.gate-bubble', { fill: LIGHT.nodeFill, stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.dot-fill', { fill: LIGHT.stroke })
  setStyle(root, '.dot-outline', {
    fill: LIGHT.nodeFill,
    stroke: LIGHT.stroke,
    'stroke-width': '2',
  })
  setStyle(root, '.free-text', {
    fill: LIGHT.ink,
    'font-size': String(16 * ls),
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  // .text-block keeps its own inline font-size; just fix colour/baseline/family
  setStyle(root, '.text-block', {
    fill: LIGHT.ink,
    'dominant-baseline': 'hanging',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.text-block.bold', { 'font-weight': '700' })
  setStyle(root, '.table-cell', { fill: LIGHT.bg, stroke: LIGHT.stroke, 'stroke-width': '1.5' })
  setStyle(root, '.qm-group-sep', { stroke: LIGHT.stroke, 'stroke-width': '3' })
  setStyle(root, '.pi-cover-line', { stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.pi-circle', { fill: 'none', stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.cell-strike', { stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.table-bold-sep', { stroke: LIGHT.stroke, 'stroke-width': '3' })
  setStyle(root, '.table-highlight', { fill: '#facc15', opacity: '0.3' })
  setStyle(root, '.table-cell.table-header', { fill: '#f0f2f7' })
  setStyle(root, '.table-text', {
    fill: LIGHT.ink,
    'font-size': String(15 * ls),
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.table-header-text', { 'font-weight': '600' })
  setStyle(root, '.kv-bar', { fill: 'none', stroke: LIGHT.stroke, 'stroke-width': '2' })
  setStyle(root, '.kv-bar-label', {
    fill: LIGHT.ink,
    'font-size': String(13 * ls),
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.deriv-rel', {
    fill: LIGHT.ink,
    'font-size': String(16 * ls),
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.deriv-expr', {
    fill: LIGHT.ink,
    'font-size': String(16 * ls),
    'text-anchor': 'start',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.deriv-reason', {
    fill: '#555',
    'font-size': String(13 * ls),
    'text-anchor': 'start',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.edge-line', { stroke: LIGHT.stroke, 'stroke-width': '2', fill: 'none' })
  setStyle(root, '.node-label', {
    fill: LIGHT.ink,
    'font-size': String(16 * ls),
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(root, '.edge-label', {
    fill: LIGHT.ink,
    'font-size': String(15 * ls),
    'text-anchor': 'middle',
    'paint-order': 'stroke',
    stroke: LIGHT.bg,
    'stroke-width': '4',
    'stroke-linejoin': 'round',
    'font-family': 'sans-serif',
  })
}

export function exportPng(svg: SVGSVGElement, filename = 'diagram.png') {
  // measure the actual content (independent of the current pan/zoom) so the
  // export captures everything, not just what's on screen.
  const P = 24 // padding around the content
  const contentEl = svg.querySelector('#content') as SVGGraphicsElement | null
  let bb: { x: number; y: number; width: number; height: number } | null = null
  try {
    const b = contentEl?.getBBox()
    if (b && b.width > 0 && b.height > 0) bb = b
  } catch {
    /* getBBox can throw if nothing is rendered */
  }
  const vb = svg.viewBox.baseVal
  const box = bb
    ? { x: bb.x - P, y: bb.y - P, w: bb.width + 2 * P, h: bb.height + 2 * P }
    : { x: vb.x, y: vb.y, w: vb.width, h: vb.height }

  // current label scale set on the live svg (CSS var); bake it into font sizes
  const ls = parseFloat(getComputedStyle(svg).getPropertyValue('--label-scale')) || 1

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`)

  // drop editor-only decorations, the grid, and empty-text placeholders
  clone.querySelectorAll('.ui-only').forEach((el) => el.remove())
  clone.querySelectorAll('.grid-line, .grid-minor').forEach((el) => el.remove())
  clone.querySelectorAll('.free-text.placeholder').forEach((el) => el.remove())
  clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'))

  // make the white background cover the exported region
  const bg = clone.querySelector('.canvas-bg')
  if (bg) {
    bg.setAttribute('x', String(box.x))
    bg.setAttribute('y', String(box.y))
    bg.setAttribute('width', String(box.w))
    bg.setAttribute('height', String(box.h))
  }

  applyLightStyles(clone, ls)

  // Prepend an explicit UTF-8 XML declaration: when the serialized SVG is
  // reloaded through an <img>, the decoder otherwise guesses the encoding and
  // can mangle non-ASCII (umlauts → "Ã¤"). Force UTF-8.
  const data =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const scale = 2 // crisp 2x raster
    const canvas = document.createElement('canvas')
    canvas.width = box.w * scale
    canvas.height = box.h * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }
  img.src = url
}
