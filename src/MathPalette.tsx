import { useEffect, useRef, useState } from "react";

const POS_KEY = "infeditor.mathPalette.pos.v1";

// Math-only symbols for the floating palette (Math profile). A string is
// inserted at the caret; a [pre, post] pair wraps the selection.
const MATH_SYMBOLS: { label: string; insert: string | [string, string]; title: string }[] = [
	{ label: "Σ", insert: "\\sum ", title: "Summation \\sum" },
	{ label: "Σ↕", insert: ["\\sum_{", "}^{}"], title: "Summation with limits \\sum_{ }^{ }" },
	{ label: "∫", insert: "\\int ", title: "Integral \\int" },
	{ label: "√", insert: ["\\sqrt{", "}"], title: "Square root \\sqrt{ }" },
	{ label: "x²", insert: ["^{", "}"], title: "Superscript ^{ }" },
	{ label: "x₂", insert: ["_{", "}"], title: "Subscript _{ }" },
	{ label: "×", insert: "\\times ", title: "Times \\times" },
	{ label: "÷", insert: "\\div ", title: "Divides \\div" },
	{ label: "·", insert: "\\cdot ", title: "Dot \\cdot" },
	{ label: "≠", insert: "\\neq ", title: "Not equal \\neq" },
	{ label: "≤", insert: "\\leq ", title: "Less or equal \\leq" },
	{ label: "≥", insert: "\\geq ", title: "Greater or equal \\geq" },
	{ label: "∞", insert: "\\infty ", title: "Infinity \\infty" },
	{ label: "∈", insert: "\\in ", title: "Element \\in" },
	{ label: "→", insert: "\\rightarrow ", title: "Right arrow \\rightarrow" },
	{ label: "⇒", insert: "\\Rightarrow ", title: "Implies \\Rightarrow" },
	{ label: "α", insert: "\\alpha ", title: "Alpha \\alpha" },
	{ label: "β", insert: "\\beta ", title: "Beta \\beta" },
	{ label: "π", insert: "\\pi ", title: "Pi \\pi" },
	{ label: "( )", insert: ["(", ")"], title: "Parentheses ( )" },
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
				<span>⠿ Math symbols</span>
				<button onClick={onClose} title="Close (m)">
					✕
				</button>
			</div>
			<div className="math-palette-grid">
				{MATH_SYMBOLS.map((sym) => (
					<button
						key={sym.label}
						title={sym.title}
						onClick={() => (Array.isArray(sym.insert) ? onWrap(sym.insert[0], sym.insert[1]) : onInsert(sym.insert))}
					>
						{sym.label}
					</button>
				))}
			</div>
		</div>
	);
}
