export type Shape = "circle" | "box" | "asm" | "diamond" | "dot";

export type GateType = "and" | "nand" | "or" | "nor" | "xor" | "xnor" | "not" | "buffer";
export type LabelRotation = 0 | 90 | 180 | 270;

export interface DiagNode {
	id: string;
	x: number; // grid coordinates of the node CENTER (may be a half-cell for boxes)
	y: number;
	label: string;
	shape: Shape;
	accepting: boolean; // double-circle for automata accepting states
	start: boolean; // draw an incoming "start" arrow
	w?: number; // shape width in grid cells (circle/box/asm/diamond)
	h?: number; // shape height in grid cells (circle/box/asm/diamond)
	gate?: GateType; // boxes only: render as an IEC logic-gate symbol
	hollow?: boolean; // dots only: draw outlined instead of filled
	transparent?: boolean; // boxes only: draw outline without fill
	negPos?: 0 | 1 | 2 | 3; // boxes only: negation bubble side (right, bottom, left, top)
	labelRot?: LabelRotation; // node label rotation in 90-degree steps
}

// UML relationship end-types (plus 'arrow' = the default automata arrowhead).
export type RelType =
	| "arrow"
	| "association"
	| "dependency"
	| "inheritance"
	| "realization"
	| "aggregation"
	| "composition";

export interface DiagEdge {
	id: string;
	from: string;
	to: string; // === from means a self-loop
	label: string;
	curve?: number; // normal edges: perpendicular bow in px. self-loops: extra size in px.
	angle?: number; // self-loops only: direction of the loop around the state, in degrees
	rel?: RelType; // arrowhead / line style (undefined = 'arrow')
	labelRot?: LabelRotation; // edge label rotation in 90-degree steps
}

export type LineArrow = "none" | "start" | "end" | "both";
export type LabelPos = "start" | "middle" | "end";

// A free wire segment between two grid points (not tied to nodes).
export interface DiagLine {
	id: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	arrow?: Exclude<LineArrow, "none">; // arrowhead placement (undefined = none)
	label?: string;
	labelPos?: LabelPos; // where the label sits along the wire (default 'middle')
	labelRot?: LabelRotation; // line label rotation in 90-degree steps
}

// A free-standing text item. 'label' = short, math markup (renderRich, `\\`).
// 'text' = a multi-line plain-text block (real newlines, no markup).
export interface DiagText {
	id: string;
	x: number;
	y: number;
	text: string;
	kind?: "label" | "text";
	size?: number; // font-size multiplier (default 1)
	align?: "left" | "center";
	bold?: boolean;
	labelRot?: LabelRotation; // label rotation in 90-degree steps (for kind='label')
}

// A KV/Karnaugh group loop: a rounded outline around a rectangular cell block
// (r1..r2, c1..c2 inclusive). Wrap-around groups are drawn as two same-color loops.
export interface TableLoop {
	id: string;
	r1: number;
	c1: number;
	r2: number;
	c2: number;
	color: string;
	label: string;
	wrapH?: boolean; // group wraps across the left/right edges
	wrapV?: boolean; // group wraps across the top/bottom edges
}

// A table / truth-table. Purely a formatting grid — the user fills all values.
export interface DiagTable {
	id: string;
	x: number; // top-left grid column
	y: number; // top-left grid row
	cols: number;
	rows: number;
	cw: number; // cell width in grid cells (each cell is 1 grid row tall)
	header: boolean; // first row rendered as a header
	cells: string[][]; // [row][col] contents (verbatim, may contain LaTeX)
	inputCols?: number; // truth tables: how many left columns are inputs
	math?: boolean; // wrap cell contents in $…$ on LaTeX export
	loops?: TableLoop[]; // KV/Karnaugh group markings
	kv?: number; // 3 or 4: KV map variable count (for the DNF/KNF form switch)
	cellToggle?: boolean; // clicking a value cell toggles 0/1 (KV maps)
	cellToggleLocked?: boolean; // when true, KV cell clicks no longer auto-flip 0/1
	checkCol?: number; // body cells in this column toggle empty/✓ on click (QM ✓)
	pi?: boolean; // prime-implicant chart: coverage cells toggle empty/X, joined
	// by a per-row line spanning the covered minterms
	struck?: string[]; // "row:col" keys of cells drawn with a strikethrough
	boldCols?: number[]; // columns with a bold separator drawn on their right edge
	boldRows?: number[]; // rows with a bold separator drawn on their bottom edge
	hlCols?: number[]; // columns tinted for visibility
	hlRows?: number[]; // rows tinted for visibility
	cellColors?: Record<string, string>; // per-cell fill color, key = "row:col"
	colColors?: Record<string, string>; // per-column fill color, key = column index
	rowColors?: Record<string, string>; // per-row fill color, key = row index
	form?: "dnf" | "knf"; // KV map normal form (header labels + cell polarity)
	kvVars?: string[]; // KV map variable names for x_1..x_n labels
}

// One line of a boolean-algebra derivation. Row 0 is the initial expression
// (its rel/reason are unused); later rows are "<rel> <expr>  (reason)".
export interface DerivStep {
	rel: string; // relation to the previous line, e.g. '=' (LaTeX, no backslash for '=')
	expr: string;
	reason: string;
}

export type ImageAnnotation =
	| { id: string; kind: "line"; x1: number; y1: number; x2: number; y2: number }
	| { id: string; kind: "text"; x: number; y: number; text: string; size?: number };

// A pasted image (PNG data URL) placed on the canvas. Annotation coordinates
// are normalized to its bounds, so they follow image movement and resizing.
export interface DiagImage {
	id: string;
	x: number; // top-left grid column
	y: number; // top-left grid row
	w: number; // width in grid cells
	h: number; // height in grid cells
	dataUrl: string; // base64 PNG data URL
	annotations?: ImageAnnotation[];
}

// A multi-line derivation → exports to a LaTeX align* block. Formatting only.
export interface DiagDerivation {
	id: string;
	x: number;
	y: number;
	exprW: number; // width of the expression column, in grid cells
	steps: DerivStep[];
}

export interface Doc {
	nodes: DiagNode[];
	edges: DiagEdge[];
	lines: DiagLine[];
	texts: DiagText[];
	images: DiagImage[];
	tables: DiagTable[];
	derivations: DiagDerivation[];
	pages: number; // number of stacked A4 pages
	name?: string; // optional user-given diagram name, used as the default save filename
}

export type DerivField = "rel" | "expr" | "reason";

export type Mode = "select" | "node" | "edge" | "line" | "text" | "table" | "image" | "deriv" | "delete";

export type Selection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string }
	| { kind: "line"; id: string }
	| { kind: "text"; id: string }
	| { kind: "image"; id: string }
	| { kind: "table"; id: string }
	| { kind: "deriv"; id: string }
	| null;
