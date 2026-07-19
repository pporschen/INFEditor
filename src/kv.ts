// KV/Karnaugh header-term generation for both normal forms.
//  DNF: minterm products — 1 → x_i, 0 → \overline{x}_i, juxtaposed (x_1x_2).
//  KNF: maxterm sums — 1 → \overline{x}_i, 0 → x_i, joined by '+' in parens.
export type KvForm = "dnf" | "knf";

// Gray-code assignments, starting at the all-negated corner (00 → 01 → 11 → 10).
const GRAY2 = [
	[0, 0],
	[0, 1],
	[1, 1],
	[1, 0],
];
const GRAY1 = [[0], [1]];

function term(vars: number[], bits: number[], form: KvForm): string {
	const varName = (v: number) => `x_${v}`;
	if (form === "dnf") {
		return vars.map((v, i) => (bits[i] ? varName(v) : negVar(varName(v)))).join("");
	}
	const parts = vars.map((v, i) => (bits[i] ? negVar(varName(v)) : varName(v)));
	return parts.length > 1 ? `(${parts.join(" \\lor ")})` : parts[0];
}

function namedTerm(vars: number[], bits: number[], form: KvForm, names: string[]): string {
	const varName = (v: number) => names[v - 1] ?? `x_${v}`;
	if (form === "dnf") {
		return vars.map((v, i) => (bits[i] ? varName(v) : negVar(varName(v)))).join("");
	}
	const parts = vars.map((v, i) => (bits[i] ? negVar(varName(v)) : varName(v)));
	return parts.length > 1 ? `(${parts.join(" \\lor ")})` : parts[0];
}
function negVar(name: string): string {
	const i = name.indexOf("_");
	if (i <= 0) return `\\overline{${name}}`;
	const head = name.slice(0, i);
	const tail = name.slice(i + 1);
	if (!tail) return `\\overline{${name}}`;
	return `\\overline{${head}}_${tail}`;
}

// The 4 column headers, higher variable first: x_2 then x_1.
export function kvHeaderRow(form: KvForm, names?: string[]): string[] {
	return GRAY2.map((bits) => (names ? namedTerm([2, 1], bits, form, names) : term([2, 1], bits, form)));
}

// The row headers, higher variable first: x_3 for KV3, x_4 x_3 for KV4.
export function kvHeaderCol(kv: number, form: KvForm, names?: string[]): string[] {
	return kv === 3
		? GRAY1.map((b) => (names ? namedTerm([3], b, form, names) : term([3], b, form)))
		: GRAY2.map((b) => (names ? namedTerm([4, 3], b, form, names) : term([4, 3], b, form)));
}
