import { useEffect, useRef, useState } from "react";

const POS_KEY = "infeditor.mathPalette.pos.v1";

// Symbols for the floating palette (Math profile). A string is inserted at
// the caret; a [pre, post] pair wraps the selection.
type Sym = { label: string; insert: string | [string, string]; title: string };

const MATH_SYMBOLS: Sym[] = [
	{ label: "Σ", insert: "\\sum ", title: "Summation \\sum" },
	{ label: "Σ↕", insert: ["\\sum_{", "}^{}"], title: "Summation with limits \\sum_{ }^{ }" },
	{ label: "∫", insert: "\\int ", title: "Integral \\int" },
	{ label: "√", insert: ["\\sqrt{", "}"], title: "Square root \\sqrt{ }" },
	{ label: "a⁄b", insert: ["\\frac{", "}{}"], title: "Fraction \\frac{ }{ }" },
	{ label: "x²", insert: ["^{", "}"], title: "Superscript ^{ }" },
	{ label: "x₂", insert: ["_{", "}"], title: "Subscript _{ }" },
	{ label: "×", insert: "\\times ", title: "Times \\times" },
	{ label: "÷", insert: "\\div ", title: "Divides \\div" },
	{ label: "·", insert: "\\cdot ", title: "Dot \\cdot" },
	{ label: "≠", insert: "\\neq ", title: "Not equal \\neq" },
	{ label: "<", insert: " < ", title: "Less than <" },
	{ label: ">", insert: " > ", title: "Greater than >" },
	{ label: "≤", insert: "\\leq ", title: "Less or equal \\leq" },
	{ label: "≥", insert: "\\geq ", title: "Greater or equal \\geq" },
	{ label: "∞", insert: "\\infty ", title: "Infinity \\infty" },
	{ label: "→", insert: "\\rightarrow ", title: "Right arrow \\rightarrow" },
	{ label: "α", insert: "\\alpha ", title: "Alpha \\alpha" },
	{ label: "β", insert: "\\beta ", title: "Beta \\beta" },
	{ label: "π", insert: "\\pi ", title: "Pi \\pi" },
	{ label: "( )", insert: ["(", ")"], title: "Parentheses ( )" },
];

const LOGIC_SYMBOLS: Sym[] = [
	{ label: "¬", insert: "\\lnot ", title: "Not \\lnot" },
	{ label: "A̅", insert: ["\\overline{", "}"], title: "Negation bar \\overline{ }" },
	{ label: "∧", insert: "\\land ", title: "And \\land" },
	{ label: "∨", insert: "\\lor ", title: "Or \\lor" },
	{ label: "⊕", insert: "\\oplus ", title: "Xor \\oplus" },
	{ label: "⇒", insert: "\\Rightarrow ", title: "Implies \\Rightarrow" },
	{ label: "⇔", insert: "\\Leftrightarrow ", title: "If and only if \\Leftrightarrow" },
	{ label: "≡", insert: "\\equiv ", title: "Equivalent \\equiv" },
	{ label: "∀", insert: "\\forall ", title: "For all \\forall" },
	{ label: "∃", insert: "\\exists ", title: "Exists \\exists" },
	{ label: "⊤", insert: "\\top ", title: "True \\top" },
	{ label: "⊥", insert: "\\bot ", title: "False \\bot" },
];

const SET_SYMBOLS: Sym[] = [
	{ label: "ℕ", insert: "\\mathbb{N}", title: "Natural numbers \\mathbb{N}" },
	{ label: "ℤ", insert: "\\mathbb{Z}", title: "Integers \\mathbb{Z}" },
	{ label: "ℚ", insert: "\\mathbb{Q}", title: "Rationals \\mathbb{Q}" },
	{ label: "ℝ", insert: "\\mathbb{R}", title: "Reals \\mathbb{R}" },
	{ label: "ℂ", insert: "\\mathbb{C}", title: "Complex numbers \\mathbb{C}" },
	{ label: "∈", insert: "\\in ", title: "Element \\in" },
	{ label: "∉", insert: "\\notin ", title: "Not element \\notin" },
	{ label: "⊂", insert: "\\subset ", title: "Subset \\subset" },
	{ label: "⊆", insert: "\\subseteq ", title: "Subset or equal \\subseteq" },
	{ label: "∪", insert: "\\cup ", title: "Union \\cup" },
	{ label: "∩", insert: "\\cap ", title: "Intersection \\cap" },
	{ label: "∖", insert: "\\setminus ", title: "Set difference \\setminus" },
	{ label: "∅", insert: "\\emptyset ", title: "Empty set \\emptyset" },
	{ label: "{ }", insert: ["\\{", "\\}"], title: "Set braces \\{ \\}" },
	{ label: "|", insert: " | ", title: "Such that |" },
];

const SECTIONS: { title: string; symbols: Sym[] }[] = [
	{ title: "Math", symbols: MATH_SYMBOLS },
	{ title: "Sets", symbols: SET_SYMBOLS },
	{ title: "Logic", symbols: LOGIC_SYMBOLS },
];

type Pos = { x: number; y: number };

// keep the title bar on screen so the palette can always be grabbed again
function clampPos(p: Pos, el: HTMLElement | null): Pos {
	const w = el?.offsetWidth ?? 280;
	return {
		x: Math.max(0, Math.min(window.innerWidth - w, p.x)),
		y: Math.max(0, Math.min(window.innerHeight - 48, p.y)),
	};
}

function loadPos(): Pos {
	try {
		const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
		if (p && typeof p.x === "number" && typeof p.y === "number") return p;
	} catch {
		/* ignore corrupt value */
	}
	return { x: Math.max(0, window.innerWidth - 620), y: 80 };
}

// Floating, draggable symbol palette. Buttons keep focus in the label field
// being edited (mousedown preventDefault), like the inspector palettes.
export function MathPalette({
	onInsert,
	onWrap,
	onClose,
}: {
	onInsert: (text: string) => void;
	onWrap: (pre: string, post: string) => void;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<Pos>(loadPos);
	const drag = useRef<{ dx: number; dy: number } | null>(null);

	useEffect(() => {
		localStorage.setItem(POS_KEY, JSON.stringify(pos));
	}, [pos]);

	useEffect(() => {
		const onResize = () => setPos((p) => clampPos(p, ref.current));
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
		if ((e.target as HTMLElement).closest("button")) return;
		drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
		const d = drag.current;
		if (!d) return;
		setPos(clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, ref.current));
	}

	function onPointerUp() {
		drag.current = null;
	}

	return (
		<div
			ref={ref}
			className="math-palette"
			style={{ left: pos.x, top: pos.y }}
			onMouseDown={(e) => e.preventDefault()}
		>
			<div
				className="math-palette-head"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
			>
				<span>⠿ Symbols</span>
				<button onClick={onClose} title="Close (m)">
					✕
				</button>
			</div>
			{SECTIONS.map((sec) => (
				<div key={sec.title}>
					<div className="math-palette-section">{sec.title}</div>
					<div className="math-palette-grid">
						{sec.symbols.map((sym) => (
							<button
								key={sym.label}
								title={sym.title}
								onClick={() =>
									Array.isArray(sym.insert) ? onWrap(sym.insert[0], sym.insert[1]) : onInsert(sym.insert)
								}
							>
								{sym.label}
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
