import type { DiagTable } from './types'

// Generate a LaTeX `tabular` from a table. Cell text is emitted verbatim so the
// user can put math (e.g. $\bar a$) in cells. Header-row cells are bolded.
export function tableToLatex(t: DiagTable): string {
  const colspec = '|' + 'c|'.repeat(t.cols)
  let out = `\\begin{tabular}{${colspec}}\n\\hline\n`
  t.cells.forEach((row, r) => {
    const cells = row.map((cell) => {
      const txt = (cell ?? '').trim()
      return t.header && r === 0 && txt ? `\\textbf{${txt}}` : txt
    })
    out += cells.join(' & ') + ' \\\\\n\\hline\n'
  })
  out += '\\end{tabular}'
  return out
}
