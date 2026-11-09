// Tab inside formulas: jump into the next `{…}` group after the caret, or —
// when no group follows — just past the `}` that closes the current one.
// Escaped set braces (`\{` `\}`) are skipped. Returns null when there is no
// brace after the caret, so Tab keeps its normal meaning.
export function braceTabTarget(s: string, caret: number): number | null {
	for (let i = caret; i < s.length; i++) {
		const ch = s[i];
		if (ch !== "{" && ch !== "}") continue;
		// odd number of backslashes before it → escaped literal brace
		let bs = 0;
		while (i - 1 - bs >= 0 && s[i - 1 - bs] === "\\") bs++;
		if (bs % 2 === 1) continue;
		// a closing brace directly followed by the next argument (\frac{a}{b},
		// \sum_{i}^{n}) goes straight into that argument
		if (ch === "}") {
			const next = /^[_^]?\{/.exec(s.slice(i + 1));
			if (next) return i + 1 + next[0].length;
		}
		return i + 1;
	}
	return null;
}

// Capture-phase keydown handler: runs before field-specific Tab handlers
// (table cells, line label position) and pre-empts them only when it moves
// the caret.
export function onBraceTab(e: KeyboardEvent) {
	if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
	const el = e.target;
	if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement && el.type === "text")) return;
	const caret = el.selectionEnd;
	if (caret == null) return;
	const to = braceTabTarget(el.value, caret);
	if (to == null) return;
	e.preventDefault();
	e.stopPropagation();
	el.setSelectionRange(to, to);
}
