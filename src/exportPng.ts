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

function setStyle(root: SVGSVGElement, selector: string, attrs: Record<string, string>) {
  root.querySelectorAll(selector).forEach((el) => {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  })
}

export function exportPng(svg: SVGSVGElement, filename = 'diagram.png') {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  // drop editor-only decorations
  clone.querySelectorAll('.ui-only').forEach((el) => el.remove())
  clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'))

  // bake the light palette onto the elements
  setStyle(clone, '.canvas-bg', { fill: LIGHT.bg })
  setStyle(clone, '.grid-line', { stroke: LIGHT.grid, 'stroke-width': '1' })
  setStyle(clone, '.arrow-head', { fill: LIGHT.stroke })
  setStyle(clone, '.uml-fill', { fill: LIGHT.stroke })
  setStyle(clone, '.uml-hollow', {
    fill: LIGHT.bg,
    stroke: LIGHT.stroke,
    'stroke-width': '1.5',
  })
  setStyle(clone, '.uml-open', {
    fill: 'none',
    stroke: LIGHT.stroke,
    'stroke-width': '1.5',
  })
  setStyle(clone, '.node-fill', {
    fill: LIGHT.nodeFill,
    stroke: LIGHT.stroke,
    'stroke-width': '2',
  })
  setStyle(clone, '.node-inner', { stroke: LIGHT.stroke, 'stroke-width': '2', fill: 'none' })
  setStyle(clone, '.edge-line', { stroke: LIGHT.stroke, 'stroke-width': '2', fill: 'none' })
  setStyle(clone, '.node-label', {
    fill: LIGHT.ink,
    'font-size': '16',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'sans-serif',
  })
  setStyle(clone, '.edge-label', {
    fill: LIGHT.ink,
    'font-size': '15',
    'text-anchor': 'middle',
    'paint-order': 'stroke',
    stroke: LIGHT.bg,
    'stroke-width': '4',
    'stroke-linejoin': 'round',
    'font-family': 'sans-serif',
  })

  const data = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const scale = 2 // crisp 2x raster
    const vb = svg.viewBox.baseVal
    const canvas = document.createElement('canvas')
    canvas.width = vb.width * scale
    canvas.height = vb.height * scale
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
