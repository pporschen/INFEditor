import type { DiagTable, DiagDerivation } from './types'

// Generate a LaTeX `tabular` from a table. Cell text is emitted verbatim so the
// user can put math (e.g. $\bar a$) in cells. Header-row cells are bolded.
export function tableToLatex(t: DiagTable): string {
  const colspec = '|' + 'c|'.repeat(t.cols)
  let out = `\\begin{tabular}{${colspec}}\n\\hline\n`
  t.cells.forEach((row, r) => {
    const cells = row.map((cell) => {
      let txt = (cell ?? '').trim()
      if (!txt) return ''
      if (t.math) txt = '$' + txt + '$' // so \overline{} etc. compile
      return t.header && r === 0 ? `\\textbf{${txt}}` : txt
    })
    out += cells.join(' & ') + ' \\\\\n\\hline\n'
  })
  out += '\\end{tabular}'
  return out
}

// Generate a LaTeX align* block from a derivation. Expressions are emitted
// verbatim (already math inside align*); reasons go in \text{} on the right.
export function derivToLatex(d: DiagDerivation): string {
  const s = d.steps
  if (s.length === 0) return ''
  const reasonPart = (r: string) =>
    r && r.trim() ? ` && \\text{${r.trim()}}` : ''
  if (s.length === 1) {
    return `\\begin{align*}\n  ${s[0].expr}\n\\end{align*}`
  }
  let out = '\\begin{align*}\n'
  out += `  ${s[0].expr} &${s[1].rel || '='} ${s[1].expr}${reasonPart(s[1].reason)}`
  for (let i = 2; i < s.length; i++) {
    out += ` \\\\\n  &${s[i].rel || '='} ${s[i].expr}${reasonPart(s[i].reason)}`
  }
  out += '\n\\end{align*}'
  return out
}
