// KV/Karnaugh header-term generation for both normal forms.
//  DNF: minterm products — 1 → x_i, 0 → \overline{x}_i, juxtaposed (x_1x_2).
//  KNF: maxterm sums — 1 → \overline{x}_i, 0 → x_i, joined by '+' in parens.
export type KvForm = 'dnf' | 'knf'

// Gray-code assignments, starting at the all-negated corner (00 → 01 → 11 → 10).
const GRAY2 = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
]
const GRAY1 = [[0], [1]]

function term(vars: number[], bits: number[], form: KvForm): string {
  if (form === 'dnf') {
    return vars.map((v, i) => (bits[i] ? `x_${v}` : `\\overline{x}_${v}`)).join('')
  }
  const parts = vars.map((v, i) => (bits[i] ? `\\overline{x}_${v}` : `x_${v}`))
  return parts.length > 1 ? `(${parts.join(' \\lor ')})` : parts[0]
}

// The 4 column headers, higher variable first: x_2 then x_1.
export function kvHeaderRow(form: KvForm): string[] {
  return GRAY2.map((bits) => term([2, 1], bits, form))
}

// The row headers, higher variable first: x_3 for KV3, x_4 x_3 for KV4.
export function kvHeaderCol(kv: number, form: KvForm): string[] {
  return kv === 3
    ? GRAY1.map((b) => term([3], b, form))
    : GRAY2.map((b) => term([4, 3], b, form))
}
