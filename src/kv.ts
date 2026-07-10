// KV/Karnaugh header-term generation for both normal forms.
//  DNF: minterm products — 1 → x_i, 0 → \overline{x}_i, juxtaposed (x_1x_2).
//  KNF: maxterm sums — 1 → \overline{x}_i, 0 → x_i, joined by '+' in parens.
export type KvForm = 'dnf' | 'knf'

// Gray-code assignments (must match the KV template column/row order).
const GRAY2 = [
  [1, 1],
  [1, 0],
  [0, 0],
  [0, 1],
]
const GRAY1 = [[1], [0]]

function term(vars: number[], bits: number[], form: KvForm): string {
  if (form === 'dnf') {
    return vars.map((v, i) => (bits[i] ? `x_${v}` : `\\overline{x}_${v}`)).join('')
  }
  const parts = vars.map((v, i) => (bits[i] ? `\\overline{x}_${v}` : `x_${v}`))
  return parts.length > 1 ? `(${parts.join(' \\lor ')})` : parts[0]
}

// The 4 column headers (variables x_1, x_2).
export function kvHeaderRow(form: KvForm): string[] {
  return GRAY2.map((bits) => term([1, 2], bits, form))
}

// The row headers: x_3 for KV3, x_3 x_4 for KV4.
export function kvHeaderCol(kv: number, form: KvForm): string[] {
  return kv === 3
    ? GRAY1.map((b) => term([3], b, form))
    : GRAY2.map((b) => term([3, 4], b, form))
}
