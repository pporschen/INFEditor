import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, renderLines } from "./Canvas";
import type { View } from "./Canvas";
import { useEditor } from "./store";
import { exportPng } from "./exportPng";
import { printA4 } from "./printA4";
import { GATES, GATE_ORDER } from "./gates";
import { GRID, W, H, PAGE_W, PAGE_H, PAGE_MARGIN, pageTop, halfExtents } from "./geometry";
import { tableToLatex, derivToLatex } from "./latex";
import { kvHeaderRow, kvHeaderCol } from "./kv";
import type { Doc, DiagTable, DerivField, LabelPos, LineArrow, Mode, RelType, Selection, Shape } from "./types";

const STORAGE_KEY = "infeditor.doc.v1";
const CURVE_STEP = 24; // pixels of bow added per button press
const CURVE_MAX = 168; // clamp so arcs stay reasonable
const LOOP_SIZE_MIN = -18; // clamp for self-loop extra size (keeps a visible loop)
const LOOP_SIZE_MAX = 160;
const LOOP_ANGLE_STEP = 30; // degrees the loop rotates per button press
const LINE_STEP = 1 / 4; // 1/4 of a grid cell — nudge/resize step for wires
// ordered so consecutive groups contrast strongly (hues jump around the wheel)
const LOOP_COLORS = [
	"#e6194b", // red
	"#3b82f6", // blue
	"#22c55e", // green
	"#f97316", // orange
	"#a855f7", // purple
	"#06b6d4", // cyan
	"#ec4899", // magenta
	"#ca8a04", // gold
	"#14b8a6", // teal
	"#6366f1", // indigo
	"#84cc16", // lime
	"#92400e", // brown
];

// Auto-convert typed operator words to LaTeX. Whole-word only; results
// (\land, \overline{…}) can't re-match, so it's idempotent. `not X` becomes
// \overline{X}. With atEnd=false the operand must be followed by a space (so
// the full token is captured); atEnd=true also converts a trailing operand.
function boolConvert(s: string, atEnd: boolean): string {
	const notEnd = atEnd ? "(?=\\s|$)" : "(?=\\s)";
	return s
		.replace(/\bnand\b/g, "\\overline{\\land} ")
		.replace(/\bnor\b/g, "\\overline{\\lor} ")
		.replace(/\bxnor\b/g, "\\overline{\\oplus} ")
		.replace(/\bxor\b/g, "\\oplus ")
		.replace(/\bimplies\b/g, "\\Rightarrow ")
		.replace(/\biff\b/g, "\\Leftrightarrow ")
		.replace(/\band\b/g, "\\land ")
		.replace(/\bor\b/g, "\\lor ")
		.replace(new RegExp("\\bnot\\s+(\\([^)]*\\)|\\S+)" + notEnd, "g"), "\\overline{$1}");
}
const ZOOM_MIN = W * 0.25; // most zoomed-in (smallest viewBox)
const ZOOM_MAX = W * 8; // most zoomed-out (largest viewBox)
const DEFAULT_VIEW_W = (PAGE_W + 2 * GRID) * Math.pow(1.25, 2); // default zoomed out by 2 steps

// UML relationship picker. Glyphs mark the end where the marker sits.
// Direction: draw from the "source" of the arrow to its head — subclass→super
// for inheritance, whole→part for composition/aggregation.
const REL_TYPES: { rel: RelType; label: string }[] = [
	{ rel: "arrow", label: "→  Directed (automata)" },
	{ rel: "association", label: "→  Association" },
	{ rel: "dependency", label: "⇢  Dependency (dashed)" },
	{ rel: "inheritance", label: "▷  Inheritance (→ super)" },
	{ rel: "realization", label: "▷  Realization (dashed)" },
	{ rel: "aggregation", label: "◇  Aggregation (whole→part)" },
	{ rel: "composition", label: "◆  Composition (whole→part)" },
];

// Coerce parsed JSON into a valid Doc, tolerating saves from before a
// collection existed. Shared by autosave restore and file open.
function normalizeDoc(d: unknown): Doc {
	const o = (d ?? {}) as Partial<Doc>;
	return {
		nodes: o.nodes ?? [],
		edges: o.edges ?? [],
		lines: o.lines ?? [],
		texts: o.texts ?? [],
		images: o.images ?? [],
		tables: o.tables ?? [],
		derivations: o.derivations ?? [],
		pages: o.pages ?? 1,
	};
}

function loadInitial(): Doc {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return normalizeDoc(JSON.parse(raw));
	} catch {
		/* ignore corrupt autosave */
	}
	return normalizeDoc(null);
}

type TablePreset = "blank" | "kv3" | "kv4" | "qmc" | "qmp";

function defaultKvVars(kv: number): string[] {
	return Array.from({ length: kv }, (_, i) => `x_${i + 1}`);
}

// Build a fresh table from a preset. Truth tables get n input columns + one
// output column and 2^n rows; KV maps get the Gray-code grid + variable-group
// labels. All VALUE cells start empty — the editor never fills in content.
// Tidy one imported LaTeX cell: collapse whitespace, unwrap a single {…}
// group, and unescape the common LaTeX character escapes.
function cleanCell(s: string): string {
	let t = s.replace(/\s+/g, " ").trim();
	if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1).trim();
	return t.replace(/\\([&%$#_{}])/g, "$1");
}

// Best-effort import of a LaTeX `tabular` into a table. Handles \hline,
// \multicolumn (expanded to N columns), and \multirow (content in the top
// cell). Returns the cells + geometry, or null if no tabular is found.
function parseLatexTable(src: string): Pick<DiagTable, "cols" | "rows" | "cw" | "header" | "cells"> | null {
	const m = /\\begin\{tabular\}\s*(?:\[[^\]]*\])?\s*\{[^}]*\}([\s\S]*?)\\end\{tabular\}/.exec(src);
	if (!m) return null;
	const body = m[1].replace(/\\hline/g, "").replace(/\\(?:top|mid|bottom)rule/g, "");
	const rowStrs = body
		.split(/\\\\(?:\s*\[[^\]]*\])?/)
		.map((r) => r.trim())
		.filter((r) => r.length > 0);
	const rows: string[][] = [];
	for (const rs of rowStrs) {
		const expanded: string[] = [];
		for (const raw of rs.split("&")) {
			const cell = raw.trim();
			const mc = /^\\multicolumn\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/.exec(cell);
			const mr = /^\\multirow\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/.exec(cell);
			if (mc) {
				expanded.push(cleanCell(mc[2]));
				for (let k = 1; k < parseInt(mc[1], 10); k++) expanded.push("");
			} else if (mr) {
				expanded.push(cleanCell(mr[2]));
			} else {
				expanded.push(cleanCell(cell));
			}
		}
		rows.push(expanded);
	}
	if (rows.length === 0) return null;
	const cols = Math.max(...rows.map((r) => r.length));
	const cells = rows.map((r) => {
		const rr = r.slice();
		while (rr.length < cols) rr.push("");
		return rr;
	});
	return { cols, rows: cells.length, cw: 1, header: true, cells };
}

function makeTable(
	id: string,
	x: number,
	y: number,
	preset: TablePreset,
	kvVars?: string[],
	kvForm: "dnf" | "knf" = "dnf",
): DiagTable {
	const base = { id, x, y, cw: 3, header: true };
	if (preset === "kv3" || preset === "kv4") {
		// DNF map: header cells spell out each column/row's minterm; value cells
		// prefilled 0 for click-to-toggle. Switchable to KNF later.
		const kv = preset === "kv3" ? 3 : 4;
		const names = kvVars ?? defaultKvVars(kv);
		const colHead = kvHeaderRow(kvForm, names);
		const rowHead = kvHeaderCol(kv, kvForm, names);
		const cells = [["", ...colHead], ...rowHead.map((rl) => [rl, "0", "0", "0", "0"])];
		return {
			...base,
			cw: 2,
			cols: 5,
			rows: cells.length,
			cells,
			cellToggle: true,
			kv,
			form: kvForm,
			kvVars: names,
		};
	}
	// Quine-McCluskey combination worksheet (German row-per-term layout):
	//   Dez. | x_n … x_1 | ✓ | Gruppe
	// One row per minterm/implicant — decimal index, the bits (write 0/1/- as you
	// combine), a check column, and the group (number of 1s). Starts at 4 vars;
	// add/remove variable columns with QM_VARS. Purely a blank scaffold; the
	// student does every grouping and combination by hand.
	if (preset === "qmc") {
		const vars = 4;
		const bits = Array.from({ length: vars }, (_, i) => `x_${vars - i}`); // x4…x1
		const head = ["Dez.", ...bits, "", "Gruppe"];
		const cols = head.length;
		// start with a single body row; Enter in a cell appends more
		const row0 = Array(cols).fill("");
		for (let c = 1; c <= vars; c++) row0[c] = "0"; // bit cells prefilled 0
		return { ...base, cw: 1.5, cols, rows: 2, cells: [head, row0], checkCol: vars + 1 };
	}
	// Prime-implicant chart: rows = the prime implicants you found, columns = the
	// minterms to cover. Corner labels the axes; the rest is blank for ticking
	// coverage and circling essentials by hand.
	if (preset === "qmp") {
		// start as a 2×2 shell; Enter adds a row, Tab adds a column. Decimals go
		// across the top row, prime-implicant terms down the left column.
		const cells = Array.from({ length: 2 }, () => Array(2).fill(""));
		return { ...base, cw: 1.5, cols: 2, rows: 2, cells, pi: true };
	}
	return { ...base, cols: 3, rows: 3, cells: Array.from({ length: 3 }, () => Array(3).fill("")) };
}

export default function App() {
	const { doc, canUndo, dispatch } = useEditor(loadInitial);
	const [mode, setMode] = useState<Mode>("node");
	const [shape, setShape] = useState<Shape>("circle");
	const [textKind, setTextKind] = useState<"label" | "text">("text");
	const [selection, setSelection] = useState<Selection>(null);
	// group multi-select: while `multiMode` is on, each dwell toggles a part into
	// `multi` (refs `{kind,id}`) so several items can be nudged together.
	const [multiMode, setMultiMode] = useState(false);
	const [multi, setMulti] = useState<{ kind: string; id: string }[]>([]);
	const [pendingFrom, setPendingFrom] = useState<string | null>(null);
	const [pendingCorner, setPendingCorner] = useState<{ x: number; y: number } | null>(null);
	const [pendingImage, setPendingImage] = useState<string | null>(null); // base64 PNG data URL after paste
	const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
	const [view, setView] = useState({ x: -GRID, y: -GRID, w: DEFAULT_VIEW_W });
	const [aspect, setAspect] = useState(H / W); // canvas height/width, keeps the grid full-bleed
	const [labelScale, setLabelScale] = useState(1.4);
	const [tablePreset, setTablePreset] = useState<TablePreset>("blank");
	const [tablesJumpOpen, setTablesJumpOpen] = useState(false);
	const [kvSetup, setKvSetup] = useState<{
		id: string;
		x: number;
		y: number;
		preset: "kv3" | "kv4";
		vars: string[];
		form: "dnf" | "knf";
	} | null>(null);
	const [cellSel, setCellSel] = useState<{
		id: string;
		row: number;
		col: number;
	} | null>(null);
	const [derivStep, setDerivStep] = useState<number | null>(null);
	const [derivField, setDerivField] = useState<DerivField>("expr");
	const [loopMode, setLoopMode] = useState(false); // marking a KV group loop
	const [pickerLoop, setPickerLoop] = useState<string | null>(null); // loop whose colour picker is open
	const [loopFirst, setLoopFirst] = useState<{
		id: string;
		row: number;
		col: number;
	} | null>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const labelInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	const expandedApplyRef = useRef<(value: string) => void>(() => {});
	const [expandedEditor, setExpandedEditor] = useState<{
		title: string;
		value: string;
		multiline: boolean;
	} | null>(null);
	const attachLabel = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
		labelInputRef.current = el;
	};
	const focusLabelRef = useRef(false); // request to focus the label after box creation
	const returnModeRef = useRef<Mode | null>(null); // creation mode to resume after Done
	const pendingCaretRef = useRef<number | null>(null); // caret to set after focusing

	// autosave on every change
	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
	}, [doc]);

	// track the canvas aspect ratio so the viewBox matches it (no letterboxing)
	useEffect(() => {
		const el = svgRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) setAspect(r.height / r.width);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const viewBox: View = { x: view.x, y: view.y, w: view.w, h: view.w * aspect };

	function openExpandedEditor(title: string, value: string, multiline: boolean, onChange: (next: string) => void) {
		expandedApplyRef.current = onChange;
		setExpandedEditor({ title, value, multiline });
	}

	function setExpandedValue(value: string) {
		setExpandedEditor((prev) => (prev ? { ...prev, value } : prev));
		expandedApplyRef.current(value);
	}

	const modalPreviewSource = expandedEditor ? expandedEditor.value.replace(/\n/g, "\\\\") : "";
	const modalPreviewLines = Math.max(1, modalPreviewSource.split(/\\\\/).length);
	const modalPreviewHeight = Math.min(220, modalPreviewLines * 30 + 20);

	function createKvFromSetup() {
		if (!kvSetup) return;
		const names = kvSetup.vars.map((v, i) => (v.trim() ? v.trim() : `x_${i + 1}`));
		dispatch({
			type: "ADD_TABLE",
			table: makeTable(kvSetup.id, kvSetup.x, kvSetup.y, kvSetup.preset, names, kvSetup.form),
		});
		returnModeRef.current = "table";
		setMode("select");
		setSelection({ kind: "table", id: kvSetup.id });
		setCellSel(null);
		setKvSetup(null);
	}

	// Keep the cell being edited in the top part of the view — the on-screen
	// gaze keyboard covers the lower half, so a cell that drifts below ~45% of
	// the viewport would be hidden. Re-pan to place it ~30% from the top.
	useEffect(() => {
		if (!cellSel) return;
		const tb = doc.tables.find((t) => t.id === cellSel.id);
		if (!tb) return;
		const cellX = (tb.x + cellSel.col + 0.5) * GRID;
		const cellY = (tb.y + cellSel.row + 0.5) * GRID;
		setView((v) => {
			const h = v.w * aspect;
			let { x, y } = v;
			let changed = false;
			const relY = (cellY - v.y) / h;
			if (relY < 0.05 || relY > 0.45) {
				y = cellY - h * 0.3;
				changed = true;
			}
			const relX = (cellX - v.x) / v.w;
			if (relX < 0.05 || relX > 0.95) {
				x = cellX - v.w * 0.5;
				changed = true;
			}
			return changed ? { ...v, x, y } : v;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cellSel, aspect]);

	// Same for the derivation line being edited: keep it in the top ~half so the
	// gaze keyboard doesn't cover it.
	useEffect(() => {
		if (derivStep == null || selection?.kind !== "deriv") return;
		const d = doc.derivations.find((x) => x.id === selection.id);
		if (!d) return;
		let off = 0;
		for (let k = 0; k < derivStep; k++) off += Math.max(1, d.steps[k].expr.split(/\\\\/).length);
		const lineY = (d.y + off + 0.5) * GRID;
		setView((v) => {
			const h = v.w * aspect;
			const relY = (lineY - v.y) / h;
			if (relY < 0.05 || relY > 0.45) return { ...v, y: lineY - h * 0.3 };
			return v;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [derivStep, selection, aspect]);

	// after a box is created we select it and focus its label input for typing
	useEffect(() => {
		if (focusLabelRef.current && labelInputRef.current) {
			const el = labelInputRef.current;
			el.focus();
			const caret = pendingCaretRef.current;
			if (caret != null) {
				const pos = Math.max(0, Math.min(el.value.length, caret));
				el.setSelectionRange(pos, pos);
				pendingCaretRef.current = null;
			} else {
				el.select();
			}
			focusLabelRef.current = false;
		}
	}, [selection]);

	const selectedNode = selection?.kind === "node" ? (doc.nodes.find((n) => n.id === selection.id) ?? null) : null;
	const selectedEdge = selection?.kind === "edge" ? (doc.edges.find((e) => e.id === selection.id) ?? null) : null;
	const selectedLine = selection?.kind === "line" ? (doc.lines.find((l) => l.id === selection.id) ?? null) : null;
	const selectedLineId = selectedLine?.id ?? null;
	const selectedText = selection?.kind === "text" ? (doc.texts.find((t) => t.id === selection.id) ?? null) : null;
	const selectedImage =
		selection?.kind === "image" ? (doc.images.find((img) => img.id === selection.id) ?? null) : null;
	const selectedTable = selection?.kind === "table" ? (doc.tables.find((t) => t.id === selection.id) ?? null) : null;
	const selectedDeriv =
		selection?.kind === "deriv" ? (doc.derivations.find((d) => d.id === selection.id) ?? null) : null;

	const changeMode = useCallback((m: Mode) => {
		returnModeRef.current = null; // explicit mode switch cancels any resume
		setMode(m);
		setPendingFrom(null);
		setPendingCorner(null);
		setHoverCell(null);
		setSelection(null);
		setLoopMode(false);
		setLoopFirst(null);
		setMultiMode(false); // any tool click ends group multi-select
		setMulti([]);
	}, []);

	// pan by a fraction of the visible area (so it scales with zoom)
	function panBy(fx: number, fy: number) {
		setView((v) => ({ ...v, x: v.x + v.w * fx, y: v.y + v.w * aspect * fy }));
	}

	// zoom around the view center; factor > 1 zooms out
	function zoomBy(factor: number) {
		setView((v) => {
			const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * factor));
			const cx = v.x + v.w / 2;
			const cy = v.y + (v.w * aspect) / 2;
			return { x: cx - w / 2, y: cy - (w * aspect) / 2, w };
		});
	}

	function resetView() {
		setView({ x: -GRID, y: -GRID, w: DEFAULT_VIEW_W });
	}

	function jumpToPage(index: number) {
		const page = Math.max(0, Math.min(doc.pages - 1, index));
		setView((v) => ({
			...v,
			y: pageTop(page) + PAGE_H / 2 - (v.w * aspect) / 2,
		}));
	}

	const activePage = useMemo(() => {
		const centerY = view.y + (view.w * aspect) / 2;
		let best = 0;
		let bestDist = Infinity;
		for (let i = 0; i < doc.pages; i++) {
			const cy = pageTop(i) + PAGE_H / 2;
			const d = Math.abs(centerY - cy);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	}, [view.y, view.w, aspect, doc.pages]);

	// short type label for the quick-jump table list
	function tableLabel(tb: DiagTable): string {
		if (tb.checkCol != null) return "QM comb.";
		if (tb.pi) return "PI chart";
		if (tb.kv) return `KV ${tb.kv}`;
		if (tb.inputCols != null) return "Truth";
		return "Table";
	}

	// pan the view to center a table and select it — one dwell to jump there,
	// keeping the current zoom level (no re-fit)
	function focusTable(tb: DiagTable) {
		const bw = tb.cols * tb.cw * GRID;
		const bh = tb.rows * GRID;
		setView((v) => ({
			x: tb.x * GRID + bw / 2 - v.w / 2,
			y: tb.y * GRID + bh / 2 - (v.w * aspect) / 2,
			w: v.w,
		}));
		setMode("select");
		setSelection({ kind: "table", id: tb.id });
		setCellSel(null);
		returnModeRef.current = null;
	}

	// Import a LaTeX tabular from the clipboard into an editable table.
	function importLatexTable() {
		const place = (txt: string) => {
			const parsed = parseLatexTable(txt);
			if (!parsed) {
				alert("No \\begin{tabular}…\\end{tabular} found to import.");
				return;
			}
			const id = crypto.randomUUID();
			dispatch({
				type: "ADD_TABLE",
				table: {
					...parsed,
					id,
					x: Math.round(view.x / GRID) + 2,
					y: Math.round(view.y / GRID) + 2,
					hlCols: [],
					hlRows: [],
				},
			});
			setMode("select");
			setSelection({ kind: "table", id });
			setCellSel({ id, row: 0, col: 0 });
			focusLabelRef.current = true;
		};
		navigator.clipboard
			.readText()
			.then(place)
			.catch(() => {
				const txt = window.prompt("Paste the LaTeX tabular here:");
				if (txt) place(txt);
			});
	}

	// Save the whole document to a .json file the user can reopen later to keep
	// editing (distinct from PNG/LaTeX export, which is final output).
	function saveFile() {
		const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "diagram.infedit.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	// Open a previously saved .json file and replace the document with it.
	function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = ""; // allow re-opening the same file later
		if (!file) return;
		file
			.text()
			.then((txt) => {
				dispatch({ type: "LOAD", doc: normalizeDoc(JSON.parse(txt)) });
				setSelection(null);
				endMultiSelect();
			})
			.catch(() => alert("Could not open that file — it is not a valid saved diagram."));
	}

	function handleBgClick(gx: number, gy: number) {
		// group mode: two empty-canvas dwells define a box; everything inside is
		// added to the selection (individual item toggles still work alongside).
		if (multiMode) {
			if (multi.length > 0 && pendingCorner === null) {
				const anchor = multiAnchor();
				if (anchor) moveMulti(gx - anchor.x, gy - anchor.y);
				return;
			}
			if (pendingCorner === null) {
				setPendingCorner({ x: gx, y: gy });
				setHoverCell({ x: gx, y: gy });
			} else {
				addItemsInRect(
					Math.min(pendingCorner.x, gx),
					Math.min(pendingCorner.y, gy),
					Math.max(pendingCorner.x, gx),
					Math.max(pendingCorner.y, gy),
				);
				setPendingCorner(null);
				setHoverCell(null);
			}
			return;
		}
		if (mode === "node") {
			// Junction dots drop with a single dwell; stay in the mode to place more.
			if (shape === "dot") {
				dispatch({ type: "ADD_DOT", id: crypto.randomUUID(), x: gx, y: gy });
				return;
			}
			// States and boxes are drawn from two opposite corners.
			if (pendingCorner === null) {
				setPendingCorner({ x: gx, y: gy }); // first corner
				setHoverCell({ x: gx, y: gy });
			} else {
				// opposite corner → create, then jump straight to labeling it
				setPendingCorner(null);
				setHoverCell(null);
				if (pendingCorner.x !== gx && pendingCorner.y !== gy) {
					const id = crypto.randomUUID();
					dispatch({
						type: "ADD_SHAPE",
						id,
						shape,
						ax: pendingCorner.x,
						ay: pendingCorner.y,
						bx: gx,
						by: gy,
					});
					returnModeRef.current = "node";
					setMode("select");
					setSelection({ kind: "node", id });
					focusLabelRef.current = true;
				}
			}
		} else if (mode === "line") {
			// wires are drawn from two grid points
			if (pendingCorner === null) {
				setPendingCorner({ x: gx, y: gy });
				setHoverCell({ x: gx, y: gy });
			} else {
				setPendingCorner(null);
				setHoverCell(null);
				if (pendingCorner.x !== gx || pendingCorner.y !== gy) {
					// create the wire and stay in Line mode to draw the next one right
					// away (edit it later via Select mode)
					dispatch({
						type: "ADD_LINE",
						id: crypto.randomUUID(),
						x1: pendingCorner.x,
						y1: pendingCorner.y,
						x2: gx,
						y2: gy,
					});
				}
			}
		} else if (mode === "text") {
			// drop a text label / block, then focus it for immediate typing
			const id = crypto.randomUUID();
			dispatch({ type: "ADD_TEXT", id, x: gx, y: gy, kind: textKind });
			returnModeRef.current = "text";
			setMode("select");
			setSelection({ kind: "text", id });
			focusLabelRef.current = true;
		} else if (mode === "image") {
			// place the pasted image at the clicked location
			if (pendingImage) {
				const id = crypto.randomUUID();
				// default image size: 4x4 grid cells (caller can resize in inspector)
				dispatch({
					type: "ADD_IMAGE",
					id,
					x: gx,
					y: gy,
					w: 4,
					h: 4,
					dataUrl: pendingImage,
				});
				setPendingImage(null); // clear the pending image
				returnModeRef.current = "image";
				setMode("select");
				setSelection({ kind: "image", id });
			}
		} else if (mode === "table") {
			if (tablePreset !== "blank") {
				// table presets place with one dwell; KV opens a setup modal first
				const id = crypto.randomUUID();
				if (tablePreset === "kv3" || tablePreset === "kv4") {
					const kv = tablePreset === "kv3" ? 3 : 4;
					setKvSetup({
						id,
						x: gx,
						y: gy,
						preset: tablePreset,
						vars: defaultKvVars(kv),
						form: "dnf",
					});
				} else {
					dispatch({ type: "ADD_TABLE", table: makeTable(id, gx, gy, tablePreset) });
					returnModeRef.current = "table";
					setMode("select");
					setSelection({ kind: "table", id });
					setCellSel(null);
				}
			} else if (pendingCorner === null) {
				// blank table: draw a region with two corners
				setPendingCorner({ x: gx, y: gy });
				setHoverCell({ x: gx, y: gy });
			} else {
				setPendingCorner(null);
				setHoverCell(null);
				const cols = Math.abs(gx - pendingCorner.x);
				const rows = Math.abs(gy - pendingCorner.y);
				if (cols > 0 && rows > 0) {
					const id = crypto.randomUUID();
					const x0 = Math.min(pendingCorner.x, gx);
					const y0 = Math.min(pendingCorner.y, gy);
					dispatch({
						type: "ADD_TABLE",
						table: {
							id,
							x: x0,
							y: y0,
							cols,
							rows,
							cw: 1, // each drawn cell is one grid square; widen later if needed
							header: true,
							cells: Array.from({ length: rows }, () => Array(cols).fill("")),
						},
					});
					returnModeRef.current = "table";
					setMode("select");
					setSelection({ kind: "table", id });
					setCellSel(null);
				}
			}
		} else if (mode === "deriv") {
			const id = crypto.randomUUID();
			dispatch({
				type: "ADD_DERIV",
				derivation: {
					id,
					x: gx,
					y: gy,
					// expression column fills the printable width (inside the margins)
					exprW: Math.round((PAGE_W - 2 * PAGE_MARGIN) / GRID) - 7,
					steps: [{ rel: "=", expr: "", reason: "" }],
				},
			});
			returnModeRef.current = "deriv";
			setMode("select");
			setSelection({ kind: "deriv", id });
			setDerivStep(0);
			setDerivField("expr");
			focusLabelRef.current = true;
		} else if (mode === "select" && selection?.kind === "node") {
			dispatch({ type: "MOVE_NODE", id: selection.id, x: gx, y: gy });
		} else if (mode === "select" && selection?.kind === "text") {
			dispatch({ type: "MOVE_TEXT", id: selection.id, x: gx, y: gy });
		} else if (mode === "select" && selection?.kind === "image") {
			dispatch({ type: "MOVE_IMAGE", id: selection.id, x: gx, y: gy });
		} else if (mode === "select" && selection?.kind === "table") {
			// clicking empty space moves the table by its top-left corner
			dispatch({ type: "MOVE_TABLE", id: selection.id, x: gx, y: gy });
			setCellSel(null);
		} else if (mode === "select" && selection?.kind === "deriv") {
			dispatch({ type: "MOVE_DERIV", id: selection.id, x: gx, y: gy });
		} else if (mode === "edge") {
			setPendingFrom(null);
		}
	}

	function handleBgMove(gx: number, gy: number) {
		// track the cursor while drawing a shape/line/table or the group-select box
		if ((mode === "node" || mode === "line" || mode === "table" || multiMode) && pendingCorner) {
			setHoverCell((h) => (h && h.x === gx && h.y === gy ? h : { x: gx, y: gy }));
		}
	}

	function handleLineClick(id: string) {
		if (multiMode) {
			toggleMulti("line", id);
			return;
		}
		if (mode === "select") {
			returnModeRef.current = null;
			setSelection({ kind: "line", id });
		} else if (mode === "delete") {
			dispatch({ type: "DELETE_LINE", id });
			setSelection(null);
		}
	}

	function handleTextClick(id: string) {
		if (multiMode) {
			toggleMulti("text", id);
			return;
		}
		if (mode === "select") {
			returnModeRef.current = null;
			setSelection({ kind: "text", id });
		} else if (mode === "delete") {
			dispatch({ type: "DELETE_TEXT", id });
			setSelection(null);
		}
	}

	function handleImageClick(id: string) {
		if (multiMode) {
			toggleMulti("image", id);
			return;
		}
		if (mode === "select") {
			returnModeRef.current = null;
			setSelection({ kind: "image", id });
		} else if (mode === "delete") {
			dispatch({ type: "DELETE_IMAGE", id });
			setSelection(null);
		}
	}

	function handleCellClick(id: string, row: number, col: number) {
		if (multiMode) {
			toggleMulti("table", id);
			return;
		}
		if (mode === "delete") {
			dispatch({ type: "DELETE_TABLE", id });
			setSelection(null);
			setCellSel(null);
			return;
		}
		if (mode !== "select") return;
		// First click on a not-yet-selected table only selects it — no in-cell
		// action fires until the table is the active selection.
		if (!loopMode && (selection?.kind !== "table" || selection.id !== id)) {
			returnModeRef.current = null;
			setSelection({ kind: "table", id });
			setCellSel(null);
			return;
		}
		// KV value cell (not a header): a click flips 0/1. The cell is still
		// selected so you can type something else (e.g. "-") in the field.
		const tbl = doc.tables.find((t) => t.id === id);
		if (!loopMode && tbl?.cellToggle && !tbl.cellToggleLocked && row > 0 && col > 0) {
			const cur = tbl.cells[row]?.[col] ?? "";
			dispatch({ type: "SET_TABLE_CELL", id, row, col, text: cur === "0" ? "1" : "0" });
			returnModeRef.current = null;
			setSelection({ kind: "table", id });
			setCellSel({ id, row, col });
			return;
		}
		// QM check column: a click toggles the cell between empty and a checkmark
		if (!loopMode && tbl?.checkCol === col && row > 0) {
			const cur = tbl.cells[row]?.[col] ?? "";
			dispatch({ type: "SET_TABLE_CELL", id, row, col, text: cur === "✓" ? "" : "✓" });
			returnModeRef.current = null;
			setSelection({ kind: "table", id });
			setCellSel({ id, row, col });
			return;
		}
		// QM bit columns (between Dez. and the ✓ column): cycle 0 → 1 → - → 0
		if (!loopMode && tbl?.checkCol != null && row > 0 && col >= 1 && col <= tbl.cols - 3) {
			const cur = tbl.cells[row]?.[col] ?? "";
			const next = cur === "0" ? "1" : cur === "1" ? "-" : "0";
			dispatch({ type: "SET_TABLE_CELL", id, row, col, text: next });
			returnModeRef.current = null;
			setSelection({ kind: "table", id });
			setCellSel({ id, row, col });
			return;
		}
		// PI chart: a coverage cell cycles empty → X → circled X (essential) → empty.
		// Circled X is stored as 'Ⓧ'; the circle is drawn around the X in Canvas.
		if (!loopMode && tbl?.pi && row > 0 && col > 0) {
			const cur = tbl.cells[row]?.[col] ?? "";
			const next = cur === "X" ? "Ⓧ" : cur === "Ⓧ" ? "" : "X";
			dispatch({ type: "SET_TABLE_CELL", id, row, col, text: next });
			returnModeRef.current = null;
			setSelection({ kind: "table", id });
			setCellSel({ id, row, col });
			return;
		}
		// KV loop marking: pick two opposite corner cells
		if (loopMode && selectedTable && selectedTable.id === id) {
			if (!loopFirst) {
				setLoopFirst({ id, row, col });
			} else {
				dispatch({
					type: "ADD_TABLE_LOOP",
					id,
					loop: {
						id: crypto.randomUUID(),
						r1: Math.min(loopFirst.row, row),
						c1: Math.min(loopFirst.col, col),
						r2: Math.max(loopFirst.row, row),
						c2: Math.max(loopFirst.col, col),
						color: LOOP_COLORS[(selectedTable.loops?.length ?? 0) % LOOP_COLORS.length],
						label: "",
					},
				});
				setLoopFirst(null);
				setLoopMode(false);
			}
			return;
		}
		returnModeRef.current = null;
		setSelection({ kind: "table", id });
		setCellSel({ id, row, col });
		focusLabelRef.current = true; // focus the cell input
	}

	function handleDerivRowClick(id: string, index: number) {
		if (multiMode) {
			toggleMulti("deriv", id);
			return;
		}
		if (mode === "delete") {
			dispatch({ type: "DELETE_DERIV", id });
			setSelection(null);
			setDerivStep(null);
			return;
		}
		if (mode === "select") {
			returnModeRef.current = null;
			setSelection({ kind: "deriv", id });
			setDerivStep(index);
			setDerivField("expr");
			focusLabelRef.current = true;
		}
	}

	// Click the rendered expression → focus the field and drop the caret near
	// the clicked spot (approximate; fine-tune with ←/→).
	function handleExprCaret(id: string, index: number, srcIndex: number) {
		if (mode !== "select") return;
		returnModeRef.current = null;
		setSelection({ kind: "deriv", id });
		setDerivStep(index);
		setDerivField("expr");
		pendingCaretRef.current = srcIndex;
		focusLabelRef.current = true;
	}

	// Click inside a multi-line text block → focus its textarea with the caret at
	// the clicked character offset (like clicking a derivation expression).
	function handleTextCaret(id: string, offset: number) {
		if (mode !== "select") return;
		if (multiMode) {
			toggleMulti("text", id);
			return;
		}
		returnModeRef.current = null;
		setSelection({ kind: "text", id });
		pendingCaretRef.current = offset;
		focusLabelRef.current = true;
	}

	function handleNodeClick(id: string) {
		if (multiMode) {
			toggleMulti("node", id);
			return;
		}
		if (mode === "edge") {
			if (pendingFrom === null) {
				setPendingFrom(id);
			} else {
				// create the arrow, then open its edit menu (label + curvature)
				const edgeId = crypto.randomUUID();
				dispatch({ type: "ADD_EDGE", id: edgeId, from: pendingFrom, to: id });
				setPendingFrom(null);
				returnModeRef.current = "edge";
				setMode("select");
				setSelection({ kind: "edge", id: edgeId });
				focusLabelRef.current = true;
			}
		} else if (mode === "select") {
			returnModeRef.current = null; // manual selection — Done goes back to neutral
			setSelection({ kind: "node", id });
		} else if (mode === "delete") {
			dispatch({ type: "DELETE_NODE", id });
			setSelection(null);
		}
	}

	function handleEdgeClick(id: string) {
		if (multiMode) return; // edges follow their nodes; nothing to add to the group
		if (mode === "select") {
			returnModeRef.current = null;
			setSelection({ kind: "edge", id });
		} else if (mode === "delete") {
			dispatch({ type: "DELETE_EDGE", id });
			setSelection(null);
		}
	}

	// Leave edit mode: blur the label field and deselect. Used by the Done
	// button so the on-screen keyboard is never required just to exit.
	function finishEditing() {
		(document.activeElement as HTMLElement | null)?.blur();
		setSelection(null);
		// If this item was just created, resume its creation mode so the user can
		// keep making more of the same; otherwise stay in the current (Select) mode.
		const resume = returnModeRef.current;
		returnModeRef.current = null;
		if (resume) setMode(resume);
	}

	function setEdgeCurve(id: string, curve: number) {
		dispatch({ type: "SET_EDGE_CURVE", id, curve });
	}

	function setEdgeRel(id: string, rel: RelType) {
		dispatch({ type: "SET_EDGE_REL", id, rel });
	}

	function moveLine(id: string, dx: number, dy: number) {
		dispatch({ type: "MOVE_LINE", id, dx, dy });
	}

	function resizeLine(id: string, delta: number) {
		dispatch({ type: "RESIZE_LINE", id, delta });
	}

	function setLineArrow(id: string, arrow: LineArrow) {
		dispatch({ type: "SET_LINE_ARROW", id, arrow });
	}

	function setLineLabelPos(id: string, pos: LabelPos) {
		dispatch({ type: "SET_LINE_LABEL_POS", id, pos });
	}

	// nudge the selected node (used for junction dots) by a fraction of a cell
	// move the selected table cell's row up (-1) or down (+1); header row stays
	function moveRow(dir: number) {
		if (!cellSel || !selectedTable) return;
		const firstMovable = selectedTable.header ? 1 : 0;
		const r2 = cellSel.row + dir;
		if (cellSel.row < firstMovable || r2 < firstMovable || r2 >= selectedTable.rows) return;
		dispatch({ type: "MOVE_ROW", id: selectedTable.id, row: cellSel.row, dir });
		setCellSel({ ...cellSel, row: r2 });
	}

	function nudgeNode(dx: number, dy: number) {
		if (selection?.kind !== "node") return;
		const n = doc.nodes.find((x) => x.id === selection.id);
		if (!n) return;
		dispatch({ type: "MOVE_NODE", id: n.id, x: n.x + dx, y: n.y + dy });
	}

	// group multi-select: set of `${kind}:${id}` keys for highlighting in Canvas
	const multiSet = useMemo(() => new Set(multi.map((r) => `${r.kind}:${r.id}`)), [multi]);

	// toggle a part in/out of the group selection (used while multiMode is on)
	function toggleMulti(kind: string, id: string) {
		setMulti((prev) =>
			prev.some((r) => r.kind === kind && r.id === id)
				? prev.filter((r) => !(r.kind === kind && r.id === id))
				: [...prev, { kind, id }],
		);
	}

	// add every item whose reference point falls inside the box to the group
	// (union — existing group members and toggled items are kept)
	function addItemsInRect(x1: number, y1: number, x2: number, y2: number) {
		const inside = (px: number, py: number) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
		const found: { kind: string; id: string }[] = [];
		for (const n of doc.nodes) if (inside(n.x, n.y)) found.push({ kind: "node", id: n.id });
		for (const l of doc.lines) if (inside((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2)) found.push({ kind: "line", id: l.id });
		for (const t of doc.texts) if (inside(t.x, t.y)) found.push({ kind: "text", id: t.id });
		for (const tb of doc.tables)
			if (inside(tb.x + (tb.cols * tb.cw) / 2, tb.y + tb.rows / 2)) found.push({ kind: "table", id: tb.id });
		for (const d of doc.derivations) if (inside(d.x, d.y)) found.push({ kind: "deriv", id: d.id });
		setMulti((prev) => {
			const have = new Set(prev.map((r) => `${r.kind}:${r.id}`));
			return [...prev, ...found.filter((r) => !have.has(`${r.kind}:${r.id}`))];
		});
	}

	function multiAnchor(): { x: number; y: number } | null {
		if (multi.length === 0) return null;
		let minX = Infinity;
		let minY = Infinity;
		for (const ref of multi) {
			if (ref.kind === "node") {
				const n = doc.nodes.find((x) => x.id === ref.id);
				if (!n) continue;
				const { hw, hh } = halfExtents(n);
				minX = Math.min(minX, n.x - hw / GRID);
				minY = Math.min(minY, n.y - hh / GRID);
			} else if (ref.kind === "line") {
				const l = doc.lines.find((x) => x.id === ref.id);
				if (!l) continue;
				minX = Math.min(minX, l.x1, l.x2);
				minY = Math.min(minY, l.y1, l.y2);
			} else if (ref.kind === "text") {
				const t = doc.texts.find((x) => x.id === ref.id);
				if (!t) continue;
				minX = Math.min(minX, t.x);
				minY = Math.min(minY, t.y);
			} else if (ref.kind === "table") {
				const tb = doc.tables.find((x) => x.id === ref.id);
				if (!tb) continue;
				minX = Math.min(minX, tb.x);
				minY = Math.min(minY, tb.y);
			} else if (ref.kind === "deriv") {
				const d = doc.derivations.find((x) => x.id === ref.id);
				if (!d) continue;
				minX = Math.min(minX, d.x);
				minY = Math.min(minY, d.y);
			}
		}
		return Number.isFinite(minX) && Number.isFinite(minY) ? { x: minX, y: minY } : null;
	}

	// nudge every part in the group selection together, as one undo step
	function moveMulti(dx: number, dy: number) {
		if (multi.length === 0) return;
		dispatch({ type: "MOVE_MANY", refs: multi, dx, dy });
	}

	function startMultiSelect() {
		setSelection(null);
		setMode("select");
		setMulti([]);
		setPendingCorner(null);
		setHoverCell(null);
		setMultiMode(true);
	}

	function endMultiSelect() {
		setMultiMode(false);
		setMulti([]);
		setPendingCorner(null);
		setHoverCell(null);
	}

	// group multi-select ends when leaving Select mode or when a single item
	// gets selected some other way (e.g. the jump-to-table list)
	useEffect(() => {
		if ((mode !== "select" || selection) && multiMode) endMultiSelect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, selection]);

	// nudge a text label by a fraction of a cell (same step as wires)
	function nudgeText(dx: number, dy: number) {
		const t = selection?.kind === "text" ? doc.texts.find((x) => x.id === selection.id) : null;
		if (!t) return;
		dispatch({ type: "MOVE_TEXT", id: t.id, x: t.x + dx, y: t.y + dy });
	}

	// Nudge an edge's curvature by a step, clamped to a sane range.
	function bendEdge(id: string, delta: number) {
		const edge = doc.edges.find((e) => e.id === id);
		if (!edge) return;
		const next = Math.max(-CURVE_MAX, Math.min(CURVE_MAX, (edge.curve ?? 0) + delta));
		setEdgeCurve(id, next);
	}

	// Self-loop size (reuses the edge's `curve` field), clamped so it can't invert.
	function resizeLoop(id: string, delta: number) {
		const edge = doc.edges.find((e) => e.id === id);
		if (!edge) return;
		const next = Math.max(LOOP_SIZE_MIN, Math.min(LOOP_SIZE_MAX, (edge.curve ?? 0) + delta));
		setEdgeCurve(id, next);
	}

	// Rotate a self-loop around its state.
	function rotateLoop(id: string, deltaDeg: number) {
		const edge = doc.edges.find((e) => e.id === id);
		if (!edge) return;
		dispatch({ type: "SET_EDGE_ANGLE", id, angle: (edge.angle ?? -90) + deltaDeg });
	}

	// Write to whichever label field is currently being edited.
	function setActiveLabel(text: string) {
		if (selection?.kind === "node") dispatch({ type: "SET_NODE_LABEL", id: selection.id, label: text });
		else if (selection?.kind === "edge") dispatch({ type: "SET_EDGE_LABEL", id: selection.id, label: text });
		else if (selection?.kind === "text") dispatch({ type: "SET_TEXT", id: selection.id, text });
		else if (selection?.kind === "line") dispatch({ type: "SET_LINE_LABEL", id: selection.id, label: text });
		else if (selection?.kind === "table" && cellSel)
			dispatch({ type: "SET_TABLE_CELL", id: cellSel.id, row: cellSel.row, col: cellSel.col, text });
		else if (selection?.kind === "deriv" && derivStep != null)
			dispatch({ type: "SET_DERIV", id: selection.id, index: derivStep, field: derivField, value: text });
	}

	// The label input currently focused (palette buttons keep focus via
	// onMouseDown preventDefault, so this stays the field being edited).
	function activeInput(): HTMLInputElement | HTMLTextAreaElement | null {
		const el = document.activeElement;
		return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : labelInputRef.current;
	}

	// Wrap the selection with pre/post, caret left just before `post`.
	function insertWrap(pre: string, post: string) {
		const el = activeInput();
		if (!el) return;
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? start;
		const inner = el.value.slice(start, end);
		const next = el.value.slice(0, start) + pre + inner + post + el.value.slice(end);
		setActiveLabel(next);
		const caret = start + pre.length + inner.length;
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	}

	// Insert literal text at the caret.
	function insertText(str: string) {
		const el = activeInput();
		if (!el) return;
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? start;
		const next = el.value.slice(0, start) + str + el.value.slice(end);
		setActiveLabel(next);
		const caret = start + str.length;
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	}

	// Convert a trailing operand (no space yet) when leaving/advancing the field.
	function finalizeDeriv() {
		if (!selectedDeriv || derivStep == null) return;
		const cur = selectedDeriv.steps[derivStep]?.expr ?? "";
		const fin = boolConvert(cur, true);
		if (fin !== cur) dispatch({ type: "SET_DERIV", id: selectedDeriv.id, index: derivStep, field: "expr", value: fin });
	}

	// Append a derivation step after the current one and focus its expression.
	function addStep() {
		if (!selectedDeriv || derivStep == null) return;
		finalizeDeriv();
		const idx = derivStep;
		dispatch({ type: "ADD_DERIV_STEP", id: selectedDeriv.id, after: idx });
		setDerivStep(idx + 1);
		setDerivField("expr");
		setSelection({ kind: "deriv", id: selectedDeriv.id }); // force the focus effect
		focusLabelRef.current = true;
	}

	// Move to another derivation line (same derivation), focusing its expression.
	function gotoStep(index: number) {
		if (!selectedDeriv) return;
		const i = Math.max(0, Math.min(selectedDeriv.steps.length - 1, index));
		if (i === derivStep) return;
		finalizeDeriv();
		setDerivStep(i);
		setDerivField("expr");
		setSelection({ kind: "deriv", id: selectedDeriv.id }); // force the focus effect
		focusLabelRef.current = true;
	}

	// Enter adds the next line; Up/Down move between lines; Escape leaves.
	function handleDerivKey(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
		if (e.key === "Escape") {
			e.currentTarget.blur();
			setSelection(null);
			setDerivStep(null);
		} else if (e.key === "Enter") {
			e.preventDefault();
			addStep();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			if (derivStep != null) gotoStep(derivStep + 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (derivStep != null) gotoStep(derivStep - 1);
		}
	}

	// Spreadsheet-style navigation while editing a table cell.
	// In a math table, convert a trailing operator word when leaving the cell.
	function finalizeCell() {
		if (!selectedTable || !cellSel || !selectedTable.math) return;
		const cur = selectedTable.cells[cellSel.row]?.[cellSel.col] ?? "";
		const fin = boolConvert(cur, true);
		if (fin !== cur)
			dispatch({ type: "SET_TABLE_CELL", id: cellSel.id, row: cellSel.row, col: cellSel.col, text: fin });
	}

	function handleCellKey(e: React.KeyboardEvent<HTMLInputElement>) {
		if (!cellSel || !selectedTable) return;
		// F2 / F3 toggle the highlight of the current column / row (single press —
		// modifiers like Alt are awkward to reach on a gaze keyboard)
		if (e.key === "F2" || e.key === "F3") {
			e.preventDefault();
			dispatch({
				type: "TOGGLE_HIGHLIGHT",
				id: cellSel.id,
				axis: e.key === "F2" ? "col" : "row",
				index: e.key === "F2" ? cellSel.col : cellSel.row,
			});
			return;
		}
		const { rows, cols } = selectedTable;
		// free-form tables (blank + QM) grow at the edge; fixed truth/KV templates
		// keep their wrap-around navigation.
		const growable = selectedTable.kv == null && selectedTable.inputCols == null;
		const el = e.currentTarget;
		let { row, col } = cellSel;
		switch (e.key) {
			case "Escape":
				el.blur();
				setSelection(null);
				setCellSel(null);
				return;
			case "Tab":
				e.preventDefault();
				if (e.shiftKey) {
					col--;
					if (col < 0) {
						col = cols - 1;
						row = (row - 1 + rows) % rows;
					}
				} else if (growable && col === cols - 1) {
					// at the last column: append a new column and step into it
					dispatch({ type: "TABLE_COLS", id: cellSel.id, delta: 1 });
					col = col + 1;
				} else {
					col++;
					if (col >= cols) {
						col = 0;
						row = (row + 1) % rows;
					}
				}
				break;
			case "Enter":
				e.preventDefault();
				// at the last row of a free-form table: append a row and step into it
				if (growable && row === rows - 1) {
					dispatch({ type: "TABLE_ROWS", id: cellSel.id, delta: 1 });
					row = row + 1;
				} else {
					row = Math.min(rows - 1, row + 1);
				}
				break;
			case "ArrowDown":
				e.preventDefault();
				row = Math.min(rows - 1, row + 1);
				break;
			case "ArrowUp":
				e.preventDefault();
				row = Math.max(0, row - 1);
				break;
			default:
				return; // let all other keys (incl. ←/→ for the caret) behave normally
		}
		finalizeCell(); // convert a trailing "not A" etc. before moving
		setCellSel({ id: cellSel.id, row, col });
		requestAnimationFrame(() => {
			el.focus();
			el.select();
		});
	}

	// Enter or Escape leaves the label field (Escape also deselects).
	function handleLabelKey(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" || e.key === "Escape") {
			e.currentTarget.blur();
			if (e.key === "Escape") setSelection(null);
		}
	}

	// paste event handler: extract PNG images from clipboard
	useEffect(() => {
		function onPaste(e: ClipboardEvent) {
			const target = e.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return; // allow normal paste in text inputs

			const items = e.clipboardData?.items;
			if (!items) return;

			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item.type.startsWith("image/png") || item.type.startsWith("image/")) {
					e.preventDefault();
					const blob = item.getAsFile();
					if (blob) {
						const reader = new FileReader();
						reader.onload = (ev) => {
							if (typeof ev.target?.result === "string") {
								setPendingImage(ev.target.result); // base64 data URL
								setMode("image"); // switch to image placement mode
							}
						};
						reader.readAsDataURL(blob);
					}
					break; // only process first image
				}
			}
		}

		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, []);

	// keyboard shortcuts (also usable via an on-screen keyboard)
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
			if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				dispatch({ type: "UNDO" });
				return;
			}
			switch (e.key) {
				case "s":
					changeMode("select");
					break;
				case "p":
					changeMode("node");
					break;
				case "c":
					changeMode("edge");
					break;
				case "l":
					changeMode("line");
					break;
				case "t":
					changeMode("text");
					break;
				case "i":
					if (pendingImage) changeMode("image");
					break;
				case "b":
					changeMode("table");
					break;
				case "r":
					changeMode("deriv");
					break;
				case "d":
					changeMode("delete");
					break;
				case "Escape":
					setPendingFrom(null);
					setPendingCorner(null);
					setHoverCell(null);
					setSelection(null);
					setLoopMode(false);
					setLoopFirst(null);
					break;
				case "Delete":
				case "Backspace":
					if (selection?.kind === "node") dispatch({ type: "DELETE_NODE", id: selection.id });
					else if (selection?.kind === "edge") dispatch({ type: "DELETE_EDGE", id: selection.id });
					else if (selection?.kind === "line") dispatch({ type: "DELETE_LINE", id: selection.id });
					else if (selection?.kind === "text") dispatch({ type: "DELETE_TEXT", id: selection.id });
					else if (selection?.kind === "image") dispatch({ type: "DELETE_IMAGE", id: selection.id });
					else if (selection?.kind === "table") dispatch({ type: "DELETE_TABLE", id: selection.id });
					else if (selection?.kind === "deriv") dispatch({ type: "DELETE_DERIV", id: selection.id });
					setSelection(null);
					setCellSel(null);
					setDerivStep(null);
					break;
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [changeMode, dispatch, selection]);

	return (
		<div className="app">
			<aside className="toolbar">
				<h1>INFEditor</h1>

				<div className="group">
					<span className="group-title">Mode</span>
					<div className="btn-grid">
						<button className={mode === "select" ? "active" : ""} onClick={() => changeMode("select")}>
							Select <kbd>s</kbd>
						</button>
						<button className={mode === "node" ? "active" : ""} onClick={() => changeMode("node")}>
							Node <kbd>p</kbd>
						</button>
						<button className={mode === "edge" ? "active" : ""} onClick={() => changeMode("edge")}>
							Connect <kbd>c</kbd>
						</button>
						<button className={mode === "line" ? "active" : ""} onClick={() => changeMode("line")}>
							Line <kbd>l</kbd>
						</button>
						<button className={mode === "text" ? "active" : ""} onClick={() => changeMode("text")}>
							Text <kbd>t</kbd>
						</button>
						<button
							className={mode === "image" ? "active" : ""}
							onClick={() => changeMode("image")}
							title={pendingImage ? "Click canvas to place image" : "Paste an image first (Ctrl+V)"}
							disabled={!pendingImage}
						>
							Image <kbd>i</kbd>
						</button>
						<button className={mode === "table" ? "active" : ""} onClick={() => changeMode("table")}>
							Table <kbd>b</kbd>
						</button>
						<button className={mode === "deriv" ? "active" : ""} onClick={() => changeMode("deriv")}>
							Deriv. <kbd>r</kbd>
						</button>
						<button className={mode === "delete" ? "active danger" : "danger"} onClick={() => changeMode("delete")}>
							Delete <kbd>d</kbd>
						</button>
					</div>
				</div>

				{mode === "node" && (
					<div className="group">
						<span className="group-title">Shape</span>
						<div className="btn-grid">
							<button
								className={shape === "circle" ? "active" : ""}
								onClick={() => {
									setShape("circle");
									setPendingCorner(null);
									setHoverCell(null);
								}}
							>
								◯ State
							</button>
							<button
								className={shape === "box" ? "active" : ""}
								onClick={() => {
									setShape("box");
									setPendingCorner(null);
									setHoverCell(null);
								}}
							>
								▭ Box
							</button>
							<button
								className={shape === "dot" ? "active" : ""}
								onClick={() => {
									setShape("dot");
									setPendingCorner(null);
									setHoverCell(null);
								}}
							>
								● Dot
							</button>
						</div>
					</div>
				)}

				{mode === "text" && (
					<div className="group">
						<span className="group-title">Text type</span>
						<div className="btn-grid">
							<button
								className={textKind === "label" ? "active" : ""}
								onClick={() => setTextKind("label")}
								title="Short label with math markup (x_1, \overline{}, …)"
							>
								Label
							</button>
							<button
								className={textKind === "text" ? "active" : ""}
								onClick={() => setTextKind("text")}
								title="Multi-line plain text block"
							>
								Text field
							</button>
						</div>
					</div>
				)}

				{mode === "table" && (
					<div className="group">
						<span className="group-title">Table type</span>
						<div className="btn-grid">
							{(
								[
									["blank", "Blank (draw)"],
									["kv3", "KV 3-var"],
									["kv4", "KV 4-var"],
									["qmc", "QM comb."],
									["qmp", "QM PI chart"],
								] as [TablePreset, string][]
							).map(([p, label]) => (
								<button
									key={p}
									className={tablePreset === p ? "active" : ""}
									onClick={() => {
										setTablePreset(p);
										setPendingCorner(null);
										setHoverCell(null);
									}}
								>
									{label}
								</button>
							))}
						</div>
						<button onClick={importLatexTable} title="Import a LaTeX tabular from the clipboard">
							⎘ Paste LaTeX table
						</button>
					</div>
				)}

				<div className="group">
					<span className="group-title">Edit</span>
					<div className="btn-grid">
						<button disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })}>
							Undo <kbd>⌃Z</kbd>
						</button>
						<button
							className="danger"
							onClick={() => {
								if (confirm("Clear the whole diagram?")) {
									dispatch({ type: "CLEAR" });
									setSelection(null);
								}
							}}
						>
							Clear
						</button>
					</div>
				</div>

				{doc.tables.length > 0 && (
					<div className="group">
						<button className="group-toggle" onClick={() => setTablesJumpOpen((v) => !v)}>
							<span>Tables — jump to ({doc.tables.length})</span>
							<span>{tablesJumpOpen ? "▾" : "▸"}</span>
						</button>
						{tablesJumpOpen &&
							doc.tables.map((tb, i) => (
								<button
									key={tb.id}
									className={selection?.kind === "table" && selection.id === tb.id ? "active" : ""}
									onClick={() => focusTable(tb)}
								>
									{i + 1} · {tableLabel(tb)}
								</button>
							))}
					</div>
				)}

				<div className="group">
					<span className="group-title">View (pan / zoom)</span>
					<div className="dpad">
						<span />
						<button onClick={() => panBy(0, -0.3)} title="Pan up">
							↑
						</button>
						<span />
						<button onClick={() => panBy(-0.3, 0)} title="Pan left">
							←
						</button>
						<button onClick={resetView} title="Reset view">
							⌂
						</button>
						<button onClick={() => panBy(0.3, 0)} title="Pan right">
							→
						</button>
						<span />
						<button onClick={() => panBy(0, 0.3)} title="Pan down">
							↓
						</button>
						<span />
					</div>
					<div className="curve-row">
						<button onClick={() => zoomBy(0.8)} title="Zoom in">
							＋
						</button>
						<button onClick={() => zoomBy(1.25)} title="Zoom out">
							－
						</button>
					</div>
				</div>

				<div className="group">
					<span className="group-title">Label size · A4 pages ({doc.pages})</span>
					<div className="btn-grid">
						<button onClick={() => setLabelScale((s) => Math.max(0.6, s - 0.2))} title="Smaller labels">
							A− label
						</button>
						<button onClick={() => setLabelScale((s) => Math.min(4, s + 0.2))} title="Larger labels">
							A＋ label
						</button>
						<button
							disabled={doc.pages <= 1}
							onClick={() => dispatch({ type: "SET_PAGES", count: doc.pages - 1 })}
							title="Remove a page"
						>
							− page
						</button>
						<button onClick={() => dispatch({ type: "SET_PAGES", count: doc.pages + 1 })} title="Add a page">
							＋ page
						</button>
					</div>
				</div>

				<div className="group">
					<span className="group-title">File · export</span>
					<div className="btn-grid">
						<button onClick={saveFile} title="Save the editable diagram to a .json file">
							Save
						</button>
						<button onClick={() => fileInputRef.current?.click()} title="Open a saved .json diagram">
							Open…
						</button>
						<button
							onClick={() => svgRef.current && printA4(svgRef.current, doc.pages)}
							title="Print all pages to A4 PDF"
						>
							Print PDF
						</button>
						<button
							onClick={() => svgRef.current && exportPng(svgRef.current)}
							title="Export all content as a PNG image"
						>
							PNG
						</button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="application/json,.json"
						onChange={handleLoadFile}
						style={{ display: "none" }}
					/>
				</div>

				<div className="hint">
					{loopMode &&
						(loopFirst
							? "Now dwell the opposite corner cell to draw the group loop."
							: "Dwell one corner cell of the group, then the opposite corner.")}
					{!loopMode &&
						mode === "node" &&
						shape === "dot" &&
						"Dwell a grid point to drop a junction dot (place as many as you like)."}
					{mode === "node" &&
						shape !== "dot" &&
						(pendingCorner
							? `Now dwell on the opposite corner to finish the ${shape === "circle" ? "state" : "box"}.`
							: `Dwell on the first corner of the ${shape === "circle" ? "state" : "box"}.`)}
					{mode === "edge" &&
						(pendingFrom ? "Now dwell on the target node (same node = self-loop)." : "Dwell on the source node.")}
					{mode === "line" &&
						(pendingCorner
							? "Now dwell on the end point of the wire."
							: "Dwell start then end; keep drawing. Select a wire (Select mode) to edit it.")}
					{mode === "text" &&
						`Dwell anywhere to drop a ${textKind === "text" ? "multi-line text block" : "label"}, then type it.`}
					{mode === "deriv" &&
						"Dwell to start a derivation, then type each line and reason. You do the algebra; it makes the LaTeX."}
					{mode === "table" &&
						tablePreset !== "blank" &&
						"Dwell to place the shell, then click a cell to edit. You fill every value."}
					{mode === "table" &&
						tablePreset === "blank" &&
						(pendingCorner
							? "Now dwell the opposite corner — the region becomes a grid of cells."
							: "Dwell one corner of the table, then the opposite corner.")}
					{mode === "select" &&
						"Dwell a node/text to select; dwell an empty cell to move it (boxes anchor by their top-left corner)."}
					{mode === "delete" && "Dwell a node, edge, wire, or text to delete it."}
				</div>
			</aside>

			<main className="stage">
				<Canvas
					ref={svgRef}
					doc={doc}
					mode={mode}
					selection={selection}
					multi={multiSet}
					areaSelect={multiMode}
					pendingFrom={pendingFrom}
					pendingCorner={pendingCorner}
					hoverCell={hoverCell}
					drawShape={shape}
					view={viewBox}
					labelScale={labelScale}
					onBgClick={handleBgClick}
					onBgMove={handleBgMove}
					onNodeClick={handleNodeClick}
					onEdgeClick={handleEdgeClick}
					onLineClick={handleLineClick}
					onTextClick={handleTextClick}
					onImageClick={handleImageClick}
					onTextCaret={handleTextCaret}
					cellSel={cellSel}
					loopFirst={loopFirst}
					onCellClick={handleCellClick}
					derivStep={derivStep}
					onDerivRowClick={handleDerivRowClick}
					onExprCaret={handleExprCaret}
				/>
				<div className="page-jump" aria-label="Page navigation">
					<button onClick={() => jumpToPage(activePage - 1)} disabled={activePage <= 0} title="Previous page">
						◀
					</button>
					<div className="page-jump-list">
						{Array.from({ length: doc.pages }, (_, i) => (
							<button
								key={i}
								className={i === activePage ? "active" : ""}
								onClick={() => jumpToPage(i)}
								title={`Jump to page ${i + 1}`}
							>
								{i + 1}
							</button>
						))}
					</div>
					<button onClick={() => jumpToPage(activePage + 1)} disabled={activePage >= doc.pages - 1} title="Next page">
						▶
					</button>
				</div>
				{expandedEditor && (
					<div className="editor-modal-backdrop" onClick={() => setExpandedEditor(null)}>
						<div className="editor-modal" onClick={(e) => e.stopPropagation()}>
							<div className="editor-modal-title">{expandedEditor.title}</div>
							<div className="editor-modal-preview-wrap">
								<div className="editor-modal-preview-title">Preview</div>
								{expandedEditor.value.trim() ? (
									<div className="editor-modal-preview">
										<svg className="editor-modal-preview-svg" style={{ height: `${modalPreviewHeight}px` }}>
											<text x={12} y={24} className="editor-modal-preview-text">
												{renderLines(modalPreviewSource, 12, 30)}
											</text>
										</svg>
									</div>
								) : (
									<div className="editor-modal-preview empty">(empty)</div>
								)}
							</div>
							{expandedEditor.multiline ? (
								<textarea
									autoFocus
									className="editor-modal-input"
									rows={10}
									value={expandedEditor.value}
									onChange={(e) => setExpandedValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape") setExpandedEditor(null);
									}}
								/>
							) : (
								<input
									autoFocus
									className="editor-modal-input"
									value={expandedEditor.value}
									onChange={(e) => setExpandedValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape") setExpandedEditor(null);
									}}
								/>
							)}
							<div className="editor-modal-actions">
								<button onClick={() => setExpandedEditor(null)}>Done</button>
							</div>
						</div>
					</div>
				)}
				{kvSetup && (
					<div className="editor-modal-backdrop" onClick={() => setKvSetup(null)}>
						<div className="editor-modal" onClick={(e) => e.stopPropagation()}>
							<div className="editor-modal-title">KV setup</div>
							<div className="kv-setup-head">Name variables and choose the starting normal form.</div>
							<div className="kv-form-switch">
								<button
									className={kvSetup.form === "dnf" ? "active" : ""}
									onClick={() => setKvSetup((p) => (p ? { ...p, form: "dnf" } : p))}
								>
									DNF
								</button>
								<button
									className={kvSetup.form === "knf" ? "active" : ""}
									onClick={() => setKvSetup((p) => (p ? { ...p, form: "knf" } : p))}
								>
									KNF
								</button>
							</div>
							<div className="kv-var-grid">
								{kvSetup.vars.map((name, i) => (
									<label key={i} className="kv-var-item">
										<span>Var {i + 1}</span>
										<input
											autoFocus={i === 0}
											value={name}
											onChange={(e) =>
												setKvSetup((prev) => {
													if (!prev) return prev;
													const vars = prev.vars.slice();
													vars[i] = e.target.value;
													return { ...prev, vars };
												})
											}
											onKeyDown={(e) => {
												if (e.key === "Escape") setKvSetup(null);
												if (e.key === "Enter") createKvFromSetup();
											}}
										/>
									</label>
								))}
							</div>
							<div className="editor-modal-actions">
								<button className="danger" onClick={() => setKvSetup(null)}>
									Cancel
								</button>
								<button onClick={createKvFromSetup}>Create KV table</button>
							</div>
						</div>
					</div>
				)}
			</main>

			<aside className="inspector">
				<span className="group-title">Properties</span>
				{selectedNode && (
					<>
						{selectedNode.shape !== "dot" && (
							<label>
								Label
								<input
									ref={attachLabel}
									value={selectedNode.label}
									onChange={(e) =>
										dispatch({
											type: "SET_NODE_LABEL",
											id: selectedNode.id,
											label: e.target.value,
										})
									}
									onKeyDown={handleLabelKey}
									autoFocus
								/>
								<button
									type="button"
									className="expand-field-btn"
									onClick={() =>
										openExpandedEditor("Node label", selectedNode.label, false, (value) =>
											dispatch({ type: "SET_NODE_LABEL", id: selectedNode.id, label: value }),
										)
									}
								>
									Expand
								</button>
							</label>
						)}
						{selectedNode.shape === "dot" && (
							<>
								<span className="group-title">Move (1/4 cell)</span>
								<div className="dpad">
									<span />
									<button onClick={() => nudgeNode(0, -LINE_STEP)}>↑</button>
									<span />
									<button onClick={() => nudgeNode(-LINE_STEP, 0)}>←</button>
									<span />
									<button onClick={() => nudgeNode(LINE_STEP, 0)}>→</button>
									<span />
									<button onClick={() => nudgeNode(0, LINE_STEP)}>↓</button>
									<span />
								</div>
								<p className="muted">Or dwell an empty cell to move it.</p>
								<span className="group-title">Style</span>
								<button
									className={selectedNode.hollow ? "active" : ""}
									onClick={() => dispatch({ type: "TOGGLE_DOT_HOLLOW", id: selectedNode.id })}
								>
									Outlined (off = filled)
								</button>
							</>
						)}
						{selectedNode.shape === "circle" && (
							<>
								<button
									className={selectedNode.accepting ? "active" : ""}
									onClick={() => dispatch({ type: "TOGGLE_ACCEPTING", id: selectedNode.id })}
								>
									Accepting (double circle)
								</button>
								<button
									className={selectedNode.start ? "active" : ""}
									onClick={() => dispatch({ type: "TOGGLE_START", id: selectedNode.id })}
								>
									Start state
								</button>
							</>
						)}
						{selectedNode.shape === "box" && (
							<>
								<span className="group-title">Logic gate (Schaltnetz)</span>
								<div className="gate-grid">
									<button
										className={!selectedNode.gate ? "active" : ""}
										onClick={() => dispatch({ type: "SET_NODE_GATE", id: selectedNode.id, gate: "none" })}
									>
										None
									</button>
									{GATE_ORDER.map((g) => (
										<button
											key={g}
											className={selectedNode.gate === g ? "active" : ""}
											onClick={() => dispatch({ type: "SET_NODE_GATE", id: selectedNode.id, gate: g })}
											title={GATES[g].name}
										>
											{GATES[g].name}
											<span className="gate-hint">{GATES[g].sym}</span>
										</button>
									))}
								</div>
							</>
						)}
					</>
				)}
				{selectedEdge && (
					<>
						<label>
							Transition label
							<input
								ref={attachLabel}
								value={selectedEdge.label}
								onChange={(e) =>
									dispatch({
										type: "SET_EDGE_LABEL",
										id: selectedEdge.id,
										label: e.target.value,
									})
								}
								onKeyDown={handleLabelKey}
								autoFocus
							/>
							<button
								type="button"
								className="expand-field-btn"
								onClick={() =>
									openExpandedEditor("Transition label", selectedEdge.label, false, (value) =>
										dispatch({ type: "SET_EDGE_LABEL", id: selectedEdge.id, label: value }),
									)
								}
							>
								Expand
							</button>
						</label>
						{selectedEdge.from !== selectedEdge.to && (
							<>
								<span className="group-title">Relationship</span>
								{REL_TYPES.map(({ rel, label }) => (
									<button
										key={rel}
										className={(selectedEdge.rel ?? "arrow") === rel ? "active" : ""}
										onClick={() => setEdgeRel(selectedEdge.id, rel)}
									>
										{label}
									</button>
								))}
								<span className="group-title">Curvature</span>
								<div className="curve-row">
									<button onClick={() => bendEdge(selectedEdge.id, -CURVE_STEP)} title="Bend one way">
										↶
									</button>
									<button onClick={() => setEdgeCurve(selectedEdge.id, 0)}>Straight</button>
									<button onClick={() => bendEdge(selectedEdge.id, CURVE_STEP)} title="Bend the other way">
										↷
									</button>
								</div>
							</>
						)}
						{selectedEdge.from === selectedEdge.to && (
							<>
								<span className="group-title">Loop size</span>
								<div className="curve-row">
									<button onClick={() => resizeLoop(selectedEdge.id, -CURVE_STEP)}>−</button>
									<button onClick={() => resizeLoop(selectedEdge.id, CURVE_STEP)}>+</button>
								</div>
								<span className="group-title">Loop position</span>
								<div className="curve-row">
									<button
										onClick={() => rotateLoop(selectedEdge.id, -LOOP_ANGLE_STEP)}
										title="Rotate loop around the state"
									>
										↺
									</button>
									<button
										onClick={() => rotateLoop(selectedEdge.id, LOOP_ANGLE_STEP)}
										title="Rotate loop around the state"
									>
										↻
									</button>
								</div>
							</>
						)}
					</>
				)}
				{selectedLineId && (
					<>
						<label>
							Label
							<input
								ref={attachLabel}
								autoFocus
								value={selectedLine?.label ?? ""}
								onChange={(e) =>
									dispatch({
										type: "SET_LINE_LABEL",
										id: selectedLineId,
										label: e.target.value,
									})
								}
								onKeyDown={(e) => {
									if (e.key === "Tab") {
										e.preventDefault();
										const order: LabelPos[] = ["start", "middle", "end"];
										const cur = selectedLine?.labelPos ?? "middle";
										const next = order[(order.indexOf(cur) + (e.shiftKey ? 2 : 1)) % 3];
										setLineLabelPos(selectedLineId, next);
									} else {
										handleLabelKey(e);
									}
								}}
							/>
							<button
								type="button"
								className="expand-field-btn"
								onClick={() =>
									openExpandedEditor("Line label", selectedLine?.label ?? "", false, (value) =>
										dispatch({ type: "SET_LINE_LABEL", id: selectedLineId, label: value }),
									)
								}
							>
								Expand
							</button>
						</label>
						<span className="group-title">Label position</span>
						<div className="curve-row">
							{(["start", "middle", "end"] as LabelPos[]).map((p) => (
								<button
									key={p}
									className={(selectedLine?.labelPos ?? "middle") === p ? "active" : ""}
									onClick={() => setLineLabelPos(selectedLineId, p)}
								>
									{p === "start" ? "Start" : p === "middle" ? "Middle" : "End"}
								</button>
							))}
						</div>
						<span className="group-title">Move (1/4 cell)</span>
						<div className="dpad">
							<span />
							<button onClick={() => moveLine(selectedLineId, 0, -LINE_STEP)}>↑</button>
							<span />
							<button onClick={() => moveLine(selectedLineId, -LINE_STEP, 0)}>←</button>
							<span />
							<button onClick={() => moveLine(selectedLineId, LINE_STEP, 0)}>→</button>
							<span />
							<button onClick={() => moveLine(selectedLineId, 0, LINE_STEP)}>↓</button>
							<span />
						</div>
						<span className="group-title">Length (1/4 cell)</span>
						<div className="curve-row">
							<button onClick={() => resizeLine(selectedLineId, -LINE_STEP)}>−</button>
							<button onClick={() => resizeLine(selectedLineId, LINE_STEP)}>+</button>
						</div>
						<span className="group-title">Arrowhead</span>
						<div className="gate-grid">
							{(
								[
									{ a: "none", label: "None" },
									{ a: "end", label: "End →" },
									{ a: "start", label: "Start ←" },
									{ a: "both", label: "Both ↔" },
								] as { a: LineArrow; label: string }[]
							).map(({ a, label }) => (
								<button
									key={a}
									className={(selectedLine?.arrow ?? "none") === a ? "active" : ""}
									onClick={() => setLineArrow(selectedLineId, a)}
								>
									{label}
								</button>
							))}
						</div>
					</>
				)}
				{selectedText && selectedText.kind === "text" && (
					<>
						<label>
							Text
							<textarea
								ref={attachLabel}
								className="expr-input"
								rows={6}
								value={selectedText.text}
								onChange={(e) => dispatch({ type: "SET_TEXT", id: selectedText.id, text: e.target.value })}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.currentTarget.blur();
										setSelection(null);
									}
								}}
								autoFocus
							/>
							<button
								type="button"
								className="expand-field-btn"
								onClick={() =>
									openExpandedEditor("Text", selectedText.text, true, (value) =>
										dispatch({ type: "SET_TEXT", id: selectedText.id, text: value }),
									)
								}
							>
								Expand
							</button>
						</label>
						<span className="group-title">Text options</span>
						<div className="btn-grid">
							<button onClick={() => dispatch({ type: "SET_TEXT_SIZE", id: selectedText.id, delta: -0.2 })}>A−</button>
							<button onClick={() => dispatch({ type: "SET_TEXT_SIZE", id: selectedText.id, delta: 0.2 })}>A＋</button>
							<button
								className={selectedText.bold ? "active" : ""}
								onClick={() => dispatch({ type: "TOGGLE_TEXT_BOLD", id: selectedText.id })}
							>
								Bold
							</button>
							<button
								className={selectedText.align === "center" ? "active" : ""}
								onClick={() =>
									dispatch({
										type: "SET_TEXT_ALIGN",
										id: selectedText.id,
										align: selectedText.align === "center" ? "left" : "center",
									})
								}
							>
								{selectedText.align === "center" ? "Centered" : "Left"}
							</button>
						</div>
						<span className="group-title">Move (1/4 cell)</span>
						<div className="dpad">
							<span />
							<button onClick={() => nudgeText(0, -LINE_STEP)}>↑</button>
							<span />
							<button onClick={() => nudgeText(-LINE_STEP, 0)}>←</button>
							<span />
							<button onClick={() => nudgeText(LINE_STEP, 0)}>→</button>
							<span />
							<button onClick={() => nudgeText(0, LINE_STEP)}>↓</button>
							<span />
						</div>
						<p className="muted">Or dwell an empty cell (Select mode) to move it.</p>
					</>
				)}
				{selectedText && selectedText.kind !== "text" && (
					<>
						<label>
							Text
							<input
								ref={attachLabel}
								value={selectedText.text}
								onChange={(e) =>
									dispatch({
										type: "SET_TEXT",
										id: selectedText.id,
										text: e.target.value,
									})
								}
								onKeyDown={handleLabelKey}
								autoFocus
							/>
							<button
								type="button"
								className="expand-field-btn"
								onClick={() =>
									openExpandedEditor("Label text", selectedText.text, false, (value) =>
										dispatch({ type: "SET_TEXT", id: selectedText.id, text: value }),
									)
								}
							>
								Expand
							</button>
						</label>
						<span className="group-title">Move (1/4 cell)</span>
						<div className="dpad">
							<span />
							<button onClick={() => nudgeText(0, -LINE_STEP)}>↑</button>
							<span />
							<button onClick={() => nudgeText(-LINE_STEP, 0)}>←</button>
							<span />
							<button onClick={() => nudgeText(LINE_STEP, 0)}>→</button>
							<span />
							<button onClick={() => nudgeText(0, LINE_STEP)}>↓</button>
							<span />
						</div>
						<p className="muted">Or dwell an empty cell (Select mode) to move it.</p>
					</>
				)}
				{selectedImage && (
					<>
						<span className="group-title">Image</span>
						<div className="dpad-row">
							<label>
								Position X (cells)
								<input
									type="number"
									step="0.5"
									value={selectedImage.x}
									onChange={(e) =>
										dispatch({
											type: "MOVE_IMAGE",
											id: selectedImage.id,
											x: Number(e.target.value),
											y: selectedImage.y,
										})
									}
								/>
							</label>
							<label>
								Position Y (cells)
								<input
									type="number"
									step="0.5"
									value={selectedImage.y}
									onChange={(e) =>
										dispatch({
											type: "MOVE_IMAGE",
											id: selectedImage.id,
											x: selectedImage.x,
											y: Number(e.target.value),
										})
									}
								/>
							</label>
						</div>
						<div className="dpad-row">
							<label>
								Width (cells)
								<input
									type="number"
									step="0.5"
									min="1"
									value={selectedImage.w}
									onChange={(e) =>
										dispatch({
											type: "RESIZE_IMAGE",
											id: selectedImage.id,
											w: Math.max(1, Number(e.target.value)),
											h: selectedImage.h,
										})
									}
								/>
							</label>
							<label>
								Height (cells)
								<input
									type="number"
									step="0.5"
									min="1"
									value={selectedImage.h}
									onChange={(e) =>
										dispatch({
											type: "RESIZE_IMAGE",
											id: selectedImage.id,
											w: selectedImage.w,
											h: Math.max(1, Number(e.target.value)),
										})
									}
								/>
							</label>
						</div>
						<span className="group-title">Move (1/4 cell)</span>
						<div className="dpad">
							<span />
							<button
								onClick={() =>
									dispatch({
										type: "MOVE_IMAGE",
										id: selectedImage.id,
										x: selectedImage.x,
										y: selectedImage.y - LINE_STEP,
									})
								}
							>
								↑
							</button>
							<span />
							<button
								onClick={() =>
									dispatch({
										type: "MOVE_IMAGE",
										id: selectedImage.id,
										x: selectedImage.x - LINE_STEP,
										y: selectedImage.y,
									})
								}
							>
								←
							</button>
							<span />
							<button
								onClick={() =>
									dispatch({
										type: "MOVE_IMAGE",
										id: selectedImage.id,
										x: selectedImage.x + LINE_STEP,
										y: selectedImage.y,
									})
								}
							>
								→
							</button>
							<span />
							<button
								onClick={() =>
									dispatch({
										type: "MOVE_IMAGE",
										id: selectedImage.id,
										x: selectedImage.x,
										y: selectedImage.y + LINE_STEP,
									})
								}
							>
								↓
							</button>
							<span />
						</div>
						<p className="muted">Or dwell an empty cell (Select mode) to move it.</p>
					</>
				)}
				{selectedTable && (
					<>
						{cellSel && cellSel.id === selectedTable.id && (
							<label>
								Cell (r{cellSel.row + 1}, c{cellSel.col + 1})
								<input
									ref={attachLabel}
									value={selectedTable.cells[cellSel.row]?.[cellSel.col] ?? ""}
									onChange={(e) =>
										dispatch({
											type: "SET_TABLE_CELL",
											id: selectedTable.id,
											row: cellSel.row,
											col: cellSel.col,
											text: selectedTable.math ? boolConvert(e.target.value, false) : e.target.value,
										})
									}
									onKeyDown={handleCellKey}
									onBlur={finalizeCell}
									autoFocus
								/>
								<button
									type="button"
									className="expand-field-btn"
									onClick={() =>
										openExpandedEditor(
											`Cell r${cellSel.row + 1} c${cellSel.col + 1}`,
											selectedTable.cells[cellSel.row]?.[cellSel.col] ?? "",
											false,
											(value) =>
												dispatch({
													type: "SET_TABLE_CELL",
													id: selectedTable.id,
													row: cellSel.row,
													col: cellSel.col,
													text: selectedTable.math ? boolConvert(value, false) : value,
												}),
										)
									}
								>
									Expand
								</button>
							</label>
						)}
						{cellSel && cellSel.id === selectedTable.id && (
							<button
								className={(selectedTable.struck ?? []).includes(`${cellSel.row}:${cellSel.col}`) ? "active" : ""}
								onClick={() =>
									dispatch({
										type: "TOGGLE_STRIKE",
										id: selectedTable.id,
										row: cellSel.row,
										col: cellSel.col,
									})
								}
							>
								Strikethrough cell
							</button>
						)}
						{cellSel && cellSel.id === selectedTable.id && (
							<>
								<span className="group-title">Bold separator</span>
								<div className="btn-grid">
									<button
										className={(selectedTable.boldCols ?? []).includes(cellSel.col) ? "active" : ""}
										onClick={() =>
											dispatch({
												type: "TOGGLE_BOLD_SEP",
												id: selectedTable.id,
												axis: "col",
												index: cellSel.col,
											})
										}
									>
										Right edge
									</button>
									<button
										className={(selectedTable.boldRows ?? []).includes(cellSel.row) ? "active" : ""}
										onClick={() =>
											dispatch({
												type: "TOGGLE_BOLD_SEP",
												id: selectedTable.id,
												axis: "row",
												index: cellSel.row,
											})
										}
									>
										Bottom edge
									</button>
								</div>
								<span className="group-title">Highlight</span>
								<div className="btn-grid">
									<button
										className={(selectedTable.hlCols ?? []).includes(cellSel.col) ? "active" : ""}
										title="Toggle column highlight (F2)"
										onClick={() =>
											dispatch({
												type: "TOGGLE_HIGHLIGHT",
												id: selectedTable.id,
												axis: "col",
												index: cellSel.col,
											})
										}
									>
										Column <kbd>F2</kbd>
									</button>
									<button
										className={(selectedTable.hlRows ?? []).includes(cellSel.row) ? "active" : ""}
										title="Toggle row highlight (F3)"
										onClick={() =>
											dispatch({
												type: "TOGGLE_HIGHLIGHT",
												id: selectedTable.id,
												axis: "row",
												index: cellSel.row,
											})
										}
									>
										Row <kbd>F3</kbd>
									</button>
								</div>
								<button onClick={() => dispatch({ type: "CLEAR_HIGHLIGHTS", id: selectedTable.id })}>
									Clear all highlights
								</button>
							</>
						)}
						{cellSel && cellSel.id === selectedTable.id && cellSel.row >= (selectedTable.header ? 1 : 0) && (
							<>
								<span className="group-title">Move row</span>
								<div className="curve-row">
									<button onClick={() => moveRow(-1)} disabled={cellSel.row <= (selectedTable.header ? 1 : 0)}>
										↑
									</button>
									<button onClick={() => moveRow(1)} disabled={cellSel.row >= selectedTable.rows - 1}>
										↓
									</button>
								</div>
							</>
						)}
						<span className="group-title">
							{selectedTable.checkCol != null ? "Rows / variables" : "Rows / Columns"}
						</span>
						<div className="btn-grid">
							<button onClick={() => dispatch({ type: "TABLE_ROWS", id: selectedTable.id, delta: 1 })}>Row +</button>
							<button onClick={() => dispatch({ type: "TABLE_ROWS", id: selectedTable.id, delta: -1 })}>Row −</button>
							{selectedTable.checkCol != null ? (
								<>
									<button onClick={() => dispatch({ type: "QM_VARS", id: selectedTable.id, delta: 1 })}>Var +</button>
									<button onClick={() => dispatch({ type: "QM_VARS", id: selectedTable.id, delta: -1 })}>Var −</button>
								</>
							) : (
								<>
									<button onClick={() => dispatch({ type: "TABLE_COLS", id: selectedTable.id, delta: 1 })}>
										Col +
									</button>
									<button onClick={() => dispatch({ type: "TABLE_COLS", id: selectedTable.id, delta: -1 })}>
										Col −
									</button>
								</>
							)}
						</div>
						<span className="group-title">Cell width</span>
						<div className="curve-row">
							<button onClick={() => dispatch({ type: "TABLE_WIDTH", id: selectedTable.id, delta: -1 })}>−</button>
							<button onClick={() => dispatch({ type: "TABLE_WIDTH", id: selectedTable.id, delta: 1 })}>+</button>
						</div>
						<div className="btn-grid">
							<button
								className={selectedTable.header ? "active" : ""}
								onClick={() => dispatch({ type: "TOGGLE_TABLE_HEADER", id: selectedTable.id })}
							>
								Header row
							</button>
							<button
								className={selectedTable.math ? "active" : ""}
								onClick={() => dispatch({ type: "TOGGLE_TABLE_MATH", id: selectedTable.id })}
								title="Wrap each cell in $…$ so \overline{} etc. compile"
							>
								Math $…$
							</button>
						</div>
						{selectedTable.form && (
							<>
								<span className="group-title">Normal form</span>
								<div className="curve-row">
									<button
										className={selectedTable.form === "dnf" ? "active" : ""}
										onClick={() =>
											selectedTable.form === "knf" && dispatch({ type: "TOGGLE_TABLE_FORM", id: selectedTable.id })
										}
										title="Minterms — mark the 1-cells; product terms"
									>
										DNF
									</button>
									<button
										className={selectedTable.form === "knf" ? "active" : ""}
										onClick={() =>
											selectedTable.form === "dnf" && dispatch({ type: "TOGGLE_TABLE_FORM", id: selectedTable.id })
										}
										title="Maxterms — mark the 0-cells; sum terms"
									>
										KNF
									</button>
								</div>
							</>
						)}
						{selectedTable.cellToggle && (
							<>
								<span className="group-title">KV click behavior</span>
								<button
									className={selectedTable.cellToggleLocked ? "active" : ""}
									onClick={() => dispatch({ type: "TOGGLE_CELL_TOGGLE_LOCK", id: selectedTable.id })}
									title="Lock to stop click-flipping 0/1 in KV value cells"
								>
									{selectedTable.cellToggleLocked ? "Click flip locked" : "Click flip unlocked"}
								</button>
							</>
						)}
						{selectedTable.inputCols && (
							<button
								onClick={() => dispatch({ type: "FILL_TABLE_INPUTS", id: selectedTable.id })}
								title="Fill the input columns with the 0/1 pattern (formatting only)"
							>
								Fill input pattern
							</button>
						)}
						<span className="group-title">KV groups (loops)</span>
						<button
							className={loopMode ? "active" : ""}
							onClick={() => {
								setLoopMode((m) => !m);
								setLoopFirst(null);
							}}
						>
							{loopMode ? "Marking… dwell 2 corners" : "+ Add group loop"}
						</button>
						{(selectedTable.loops ?? []).map((lp) => (
							<div key={lp.id}>
								<div className="loop-row">
									<button
										className="loop-swatch"
										style={{ background: lp.color }}
										title="Pick colour"
										onClick={() => setPickerLoop((p) => (p === lp.id ? null : lp.id))}
									/>
									<input
										value={lp.label}
										placeholder="term (e.g. x_1 x_3)"
										onChange={(e) =>
											dispatch({
												type: "SET_LOOP_LABEL",
												id: selectedTable.id,
												loopId: lp.id,
												label: selectedTable.math ? boolConvert(e.target.value, false) : e.target.value,
											})
										}
									/>
									<button
										type="button"
										onClick={() =>
											openExpandedEditor("Loop label", lp.label, false, (value) =>
												dispatch({
													type: "SET_LOOP_LABEL",
													id: selectedTable.id,
													loopId: lp.id,
													label: selectedTable.math ? boolConvert(value, false) : value,
												}),
											)
										}
									>
										Expand
									</button>
									<button
										className={lp.wrapH ? "active" : ""}
										title="Wrap across left/right edges"
										onClick={() =>
											dispatch({ type: "TOGGLE_LOOP_WRAP", id: selectedTable.id, loopId: lp.id, axis: "h" })
										}
									>
										⇄
									</button>
									<button
										className={lp.wrapV ? "active" : ""}
										title="Wrap across top/bottom edges"
										onClick={() =>
											dispatch({ type: "TOGGLE_LOOP_WRAP", id: selectedTable.id, loopId: lp.id, axis: "v" })
										}
									>
										⇅
									</button>
									<button
										className="danger"
										onClick={() => {
											dispatch({ type: "DEL_TABLE_LOOP", id: selectedTable.id, loopId: lp.id });
											setPickerLoop(null);
										}}
									>
										✕
									</button>
								</div>
								{pickerLoop === lp.id && (
									<div className="color-picker">
										{LOOP_COLORS.map((c) => (
											<button
												key={c}
												className={`color-swatch${lp.color === c ? " active" : ""}`}
												style={{ background: c }}
												onClick={() => {
													dispatch({ type: "SET_LOOP_COLOR", id: selectedTable.id, loopId: lp.id, color: c });
													setPickerLoop(null);
												}}
											/>
										))}
										<input
											type="color"
											className="color-custom"
											value={lp.color}
											title="Custom colour"
											onChange={(e) =>
												dispatch({ type: "SET_LOOP_COLOR", id: selectedTable.id, loopId: lp.id, color: e.target.value })
											}
										/>
									</div>
								)}
							</div>
						))}
						<span className="group-title">LaTeX (tabular)</span>
						<textarea className="latex-out" readOnly rows={5} value={tableToLatex(selectedTable)} />
						<button onClick={() => navigator.clipboard?.writeText(tableToLatex(selectedTable))}>Copy LaTeX</button>
						<p className="muted">Click a cell to edit; dwell empty space to move the table.</p>
					</>
				)}
				{selectedDeriv && derivStep != null && selectedDeriv.steps[derivStep] && (
					<>
						<span className="group-title">
							Line {derivStep + 1}
							{derivStep === 0 ? " (start)" : ""}
						</span>
						{derivStep > 0 && (
							<label>
								Relation
								<input
									value={selectedDeriv.steps[derivStep].rel}
									onFocus={() => setDerivField("rel")}
									onChange={(e) =>
										dispatch({
											type: "SET_DERIV",
											id: selectedDeriv.id,
											index: derivStep,
											field: "rel",
											value: e.target.value,
										})
									}
									onKeyDown={handleDerivKey}
								/>
								<button
									type="button"
									className="expand-field-btn"
									onClick={() =>
										openExpandedEditor("Derivation relation", selectedDeriv.steps[derivStep].rel, false, (value) =>
											dispatch({
												type: "SET_DERIV",
												id: selectedDeriv.id,
												index: derivStep,
												field: "rel",
												value,
											}),
										)
									}
								>
									Expand
								</button>
							</label>
						)}
						<label>
							Expression
							<textarea
								ref={attachLabel}
								className="expr-input"
								rows={6}
								value={selectedDeriv.steps[derivStep].expr}
								onFocus={() => setDerivField("expr")}
								onChange={(e) =>
									dispatch({
										type: "SET_DERIV",
										id: selectedDeriv.id,
										index: derivStep,
										field: "expr",
										value: boolConvert(e.target.value, false),
									})
								}
								onBlur={finalizeDeriv}
								onKeyDown={handleDerivKey}
								autoFocus
							/>
							<button
								type="button"
								className="expand-field-btn"
								onClick={() =>
									openExpandedEditor("Derivation expression", selectedDeriv.steps[derivStep].expr, true, (value) =>
										dispatch({
											type: "SET_DERIV",
											id: selectedDeriv.id,
											index: derivStep,
											field: "expr",
											value: boolConvert(value, false),
										}),
									)
								}
							>
								Expand
							</button>
						</label>
						{derivStep > 0 && (
							<label>
								Reason
								<input
									value={selectedDeriv.steps[derivStep].reason}
									onFocus={() => setDerivField("reason")}
									onChange={(e) =>
										dispatch({
											type: "SET_DERIV",
											id: selectedDeriv.id,
											index: derivStep,
											field: "reason",
											value: e.target.value,
										})
									}
									onKeyDown={handleDerivKey}
								/>
								<button
									type="button"
									className="expand-field-btn"
									onClick={() =>
										openExpandedEditor("Derivation reason", selectedDeriv.steps[derivStep].reason, false, (value) =>
											dispatch({
												type: "SET_DERIV",
												id: selectedDeriv.id,
												index: derivStep,
												field: "reason",
												value,
											}),
										)
									}
								>
									Expand
								</button>
							</label>
						)}
						<div className="btn-grid">
							<button onClick={addStep}>Add line ⏎</button>
							<button
								className="danger"
								onClick={() => {
									dispatch({ type: "DEL_DERIV_STEP", id: selectedDeriv.id, index: derivStep });
									setDerivStep(Math.max(0, derivStep - 1));
								}}
							>
								Del line
							</button>
						</div>
						<span className="group-title">LaTeX (align*)</span>
						<textarea className="latex-out" readOnly rows={6} value={derivToLatex(selectedDeriv)} />
						<button onClick={() => navigator.clipboard?.writeText(derivToLatex(selectedDeriv))}>Copy LaTeX</button>
					</>
				)}
				{((selectedNode && selectedNode.shape !== "dot") ||
					selectedEdge ||
					(selectedText && selectedText.kind !== "text") ||
					selectedLineId ||
					(selectedTable && cellSel) ||
					(selectedDeriv && derivStep != null)) && (
					<>
						<span className="group-title">Insert</span>
						<div className="btn-grid">
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertWrap("\\overline{", "}")}
								title="Negation bar  \overline{ }"
							>
								A̅ NOT
							</button>
							<button onMouseDown={(e) => e.preventDefault()} onClick={() => insertText("\\cdot ")} title="AND  \cdot">
								· AND
							</button>
							<button onMouseDown={(e) => e.preventDefault()} onClick={() => insertText("+")} title="OR  +">
								+ OR
							</button>
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertText("\\oplus ")}
								title="XOR  \oplus"
							>
								⊕ XOR
							</button>
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertText("\\Rightarrow ")}
								title="Implies  \Rightarrow"
							>
								⇒ Impl
							</button>
							<button onMouseDown={(e) => e.preventDefault()} onClick={() => insertText("(")} title="Open paren">
								(
							</button>
							<button onMouseDown={(e) => e.preventDefault()} onClick={() => insertText(")")} title="Close paren">
								)
							</button>
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertWrap("^{", "}")}
								title="Superscript  ^{ }"
							>
								x²
							</button>
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertWrap("_{", "}")}
								title="Subscript  _{ }"
							>
								x₂
							</button>
						</div>
					</>
				)}
				{selection && (
					<button className="done" onClick={finishEditing}>
						✓ Done
					</button>
				)}
				{!selection && multiMode && (
					<>
						<span className="group-title">Group move ({multi.length})</span>
						{multi.length > 0 ? (
							<>
								<span className="group-title">Move (1 cell)</span>
								<div className="dpad">
									<span />
									<button onClick={() => moveMulti(0, -1)}>↑</button>
									<span />
									<button onClick={() => moveMulti(-1, 0)}>←</button>
									<span />
									<button onClick={() => moveMulti(1, 0)}>→</button>
									<span />
									<button onClick={() => moveMulti(0, 1)}>↓</button>
									<span />
								</div>
								<button onClick={() => setMulti([])}>Clear selection</button>
							</>
						) : (
							<p className="muted">
								Dwell two empty-canvas corners to grab everything inside, or dwell parts one by one (dwell again to
								remove).
							</p>
						)}
						<button onClick={endMultiSelect}>Done</button>
					</>
				)}
				{!selection && !multiMode && (
					<>
						<p className="muted">Select something (Select mode) to edit its label and properties.</p>
						<button onClick={startMultiSelect}>Select multiple to move</button>
					</>
				)}
			</aside>
		</div>
	);
}
