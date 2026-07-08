import { PAGE_W, PAGE_H, pageTop } from './geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Print the diagram as true vector A4 pages. Each page is one A4 sheet showing
// its slice of the canvas. The live stylesheet still cascades in print, and
// @media print pins the light palette — so we rely on CSS (not baked styles),
// only forwarding the label scale onto the print root.
export function printA4(svg: SVGSVGElement, pages: number) {
  const content = svg.querySelector('#content')
  if (!content) return
  const ls = getComputedStyle(svg).getPropertyValue('--label-scale') || '1'

  const root = document.createElement('div')
  root.className = 'print-root'
  root.style.setProperty('--label-scale', ls)

  for (let i = 0; i < pages; i++) {
    const top = pageTop(i)

    const pageDiv = document.createElement('div')
    pageDiv.className = 'print-page'

    const psvg = document.createElementNS(SVG_NS, 'svg')
    psvg.setAttribute('xmlns', SVG_NS)
    psvg.setAttribute('viewBox', `0 ${top} ${PAGE_W} ${PAGE_H}`)
    psvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')

    // white page background
    const bg = document.createElementNS(SVG_NS, 'rect')
    bg.setAttribute('x', '0')
    bg.setAttribute('y', String(top))
    bg.setAttribute('width', String(PAGE_W))
    bg.setAttribute('height', String(PAGE_H))
    bg.setAttribute('fill', '#ffffff')
    psvg.appendChild(bg)

    // the diagram content (clipped to the page by the svg viewport)
    const c = content.cloneNode(true) as Element
    c.querySelectorAll('.ui-only').forEach((el) => el.remove())
    c.querySelectorAll('.free-text.placeholder').forEach((el) => el.remove())
    c.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'))
    psvg.appendChild(c)

    pageDiv.appendChild(psvg)
    root.appendChild(pageDiv)
  }

  document.body.appendChild(root)
  const cleanup = () => {
    root.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
