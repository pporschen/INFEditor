import type { GateType } from './types'

// IEC / DIN 40900 (EN 60617) rectangular gate symbols used in German
// "Schaltnetze" courses: a qualifying symbol inside the box, plus an output
// negation bubble for the inverting gates.
export const GATES: Record<GateType, { sym: string; neg: boolean; name: string }> = {
  and: { sym: '&', neg: false, name: 'AND' },
  nand: { sym: '&', neg: true, name: 'NAND' },
  or: { sym: '≥1', neg: false, name: 'OR' },
  nor: { sym: '≥1', neg: true, name: 'NOR' },
  xor: { sym: '=1', neg: false, name: 'XOR' },
  xnor: { sym: '=1', neg: true, name: 'XNOR' },
  not: { sym: '1', neg: true, name: 'NOT' },
  buffer: { sym: '1', neg: false, name: 'Buffer' },
}

// order shown in the toolbar
export const GATE_ORDER: GateType[] = [
  'and',
  'nand',
  'or',
  'nor',
  'xor',
  'xnor',
  'not',
]
