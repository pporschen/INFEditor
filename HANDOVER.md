# INFEditor — Project Handover

Context dump for the next AI assistant (and future me). Read this first.

## What this is

A **gaze-driven diagram & notation editor** for **Patrick** (`pp` / GitHub
`pporschen`), a computer-science student with **ALS** who works **entirely via
eye-tracking** (Tobii + OS-level dwell-clicking — the OS turns gaze into a mouse
cursor and a dwell into a click). Goal: draw technical diagrams and write
boolean-algebra / logic / automata / circuit content **fast during exams and
homework**, replacing slow LaTeX/TikZ.

Live: **https://pporschen.github.io/INFEditor/**

## Non-negotiable design principles

1. **Gaze-first UX.** Large dwell-friendly targets; **no dragging ever**;
   interactions are two-dwell / two-corner; everything snaps to the grid;
   toolbars sit on the screen **edges** (out of the gaze travel path); big Undo;
   clear selection highlights. When adding UI, keep targets big and never
   require precision or drag.
2. **Formatting only — never solve.** This is an integrity rule for exams: the
   editor must **never compute or fill content** (no boolean simplification, no
   truth-table outputs, no Karnaugh minimization). Truth tables get an empty
   structure; the *only* auto-fill is the deterministic 0/1 **input** pattern,
   surfaced as an explicit "Fill input pattern" formatting button — outputs stay
   blank. Keep this line.
3. **Dark mode is the default; every export is light** (dark ink on white) so
   submissions look normal.

## Stack, build, deploy

- **React 18 + TypeScript + Vite**, built to a **single offline `dist/index.html`**
  via `vite-plugin-singlefile` (double-click to run, no server).
- Build / verify: **`npm run build`** (runs `tsc -b && vite build`). **Always
  build to verify.** The IDE's inline TypeScript diagnostics shown *during* edits
  are frequently **stale** — trust the build, not the red squiggles.
- Environment is **Windows / PowerShell**. Gotcha: `git commit -m @'…'@`
  here-strings **break if the message contains a double quote (`"`)** — keep
  commit messages quote-free.
- LF↔CRLF warnings on commit are harmless.
- **Deploy**: pushing to `master` triggers `.github/workflows/deploy.yml`, which
  builds and publishes `dist/` to GitHub Pages. Pages **Source must be
  "GitHub Actions"** in repo Settings (already set). `dist/` and `node_modules/`
  are gitignored.

## Architecture (`src/`)

| File | Responsibility |
|------|----------------|
| `types.ts` | All data types. `Doc = { nodes, edges, lines, texts, tables, derivations, pages }`. |
| `store.ts` | `useReducer` store with **undo history** (`{past[], present}`); every mutation is an action here. |
| `geometry.ts` | `GRID` (48px), node `halfExtents`/`anchor` (ellipse+box+dot), **A4 page constants** (1 cell = 1 cm; `PAGE_W/H`, `PAGE_MARGIN`, `pageTop`). |
| `Canvas.tsx` | SVG renderer. `renderRich` (LaTeX-subset text), all element rendering, hit handling, page frames, draw previews. `viewBox` = pan/zoom `view`. A `<g id="content">` wraps all diagram content (export/print measure it via `getBBox`). |
| `App.tsx` | App shell: toolbar, inspector, **all interaction handlers**, modes, keyboard shortcuts, `view` (pan/zoom) state, autosave to `localStorage`, auto-pan effects. |
| `exportPng.ts` | PNG export (content bounding box) + **`applyLightStyles`** (shared light baking). |
| `printA4.ts` | Vector multi-page **A4 print** (CSS-driven). |
| `latex.ts` | `tableToLatex` (`tabular`), `derivToLatex` (`align*`). |
| `gates.ts` | IEC/DIN logic-gate symbol table. |
| `styles.css` | Theme via CSS variables; dark default; `@media print` pins light + print pipeline CSS. |

## Data model highlights

- **DiagNode** `{id, x, y, label, shape:'circle'|'box'|'dot', accepting, start, w?, h?, gate?}`.
  `x,y` = **center** in grid units (may be half-cell). Circles render as ellipses
  sized by `w/h`; boxes as rects; dots are tiny filled circles. `gate` turns a
  box into an IEC logic gate (symbol + output negation bubble).
- **DiagEdge** `{id, from, to, label, curve?, angle?, rel?}`. `from===to` = self-loop
  (`angle` = position around node, `curve` = loop size). `rel` = UML relationship
  (association/dependency/inheritance/realization/aggregation/composition) driving
  markers + dashing. `curve` on normal edges bows a quadratic bézier.
- **DiagLine** `{id, x1,y1,x2,y2, arrow?, label?, labelPos?}` — free wires; coords are
  fractional (¼-cell nudge/resize buttons). Arrowheads start/end/both.
- **DiagText** `{id, x, y, text, kind?, size?, align?, bold?}` — free text. `kind`
  `'label'` = short math-markup label (renderRich, `\\` breaks); `'text'` = a
  multi-line plain-text block (real newlines, size/align/bold options).
- **DiagTable** `{id, x, y, cols, rows, cw, header, cells[][], inputCols?, math?, loops?}` —
  tables + truth-table shells. `math` wraps cells in `$…$` on export. `loops` are
  **KV/Karnaugh group markings** (`TableLoop {r1,c1,r2,c2,color,label}`): rounded
  colored outlines around a cell block, drawn by dwelling two corner cells
  (`loopMode`/`loopFirst` in App). Wrap-around = two same-color loops. They keep
  their colour in export/print (not light-baked). `kv` (3|4) makes it a **Veitch
  diagram**: a pure value grid with `x_i` variable **bars** along the axes
  (`KV_SPEC` in Canvas.tsx), no binary codes — the German KV-Diagramm style.
  Table presets: `blank` (2-corner draw), `t2/t3/t4` (truth shells), `kv3/kv4`,
  and **Quine-McCluskey worksheets** `qmc` (combination table, German
  row-per-term layout: `Dez. | x_n…x_1 | ✓ | Gruppe`, starts at 4 vars; the
  inspector shows Var +/- (`QM_VARS`) to add/remove bit columns and relabel;
  `checkCol` makes the ✓ column click-toggle empty/✓; Enter at the last row
  appends a row) and `qmp` (prime-implicant coverage chart, `pi:true`: starts
  2×2, Enter adds a row and Tab adds a column; decimals across the top, PI terms
  down the left; coverage cells cycle empty→`X`→`Ⓧ` (circled = essential, drawn
  via `.pi-circle`); each row's marks are joined by a `.pi-cover-line` spanning
  first→last covered minterm). Every column auto-grows to fit its widest cell
  (per-column widths in Canvas; KV maps stay uniform for their loops). Row order
  can be changed with Move row ↑/↓ (`MOVE_ROW`; header fixed). Any cell can be
  struck through (`struck: ["r:c"]` + `.cell-strike`) via the inspector toggle.
  A **Tables — jump to** toolbar list pans/selects any table (`focusTable`).
  QM worksheets are **empty scaffolds only** — per the never-solve rule the tool
  draws structure and the student does all grouping/combining/selection by hand.
- **DiagDerivation** `{id, x, y, exprW, steps: {rel, expr, reason}[]}` — boolean-algebra
  derivation → `align*`. Step 0 is the initial expression.
- **pages: number** — count of stacked A4 pages.

## Text markup — `renderRich` (the LaTeX subset understood)

The on-canvas text renderer parses a small LaTeX subset so what you type renders
nicely **and** exports verbatim-correct:

- `_{}` / `^{}` sub/superscript.
- `\overline{}` / `\bar{}` negation — rendered with **combining overline U+0305**
  (reliable everywhere incl. export; `text-decoration` on `<tspan>` was flaky).
  Braces are **invisible grouping** (like LaTeX). Nesting supported.
- operators: `\cdot`·  `\oplus`⊕  `\lnot`/`\neg`¬  `\lor`/`\vee`∨  `\land`/`\wedge`∧.
- `\left` / `\right` are stripped (keep the bracket; drop the invisible `\left.`/`\right.` dot).

Boolean **word auto-convert** (`boolConvert`): `and→\land`, `or→\lor`,
`xor→\oplus`, `not X→\overline{X}` (waits for a space / finalizes on blur so it
grabs the whole operand — product notation `not AB` works), `nand/nor/xnor→\overline{…}`.
Idempotent, whole-word only. Applied in the derivation *Expression* field and in
**Math-mode table cells** (gated on the table's `math` toggle, so ordinary prose
tables aren't mangled).

An **Insert** palette (shown when a label field is focused) inserts these:
`A̅ NOT`, `· AND`, `+ OR`, `⊕ XOR`, `( )`, `x²`, `x₂`. It targets whichever input
is focused via `document.activeElement` (`onMouseDown preventDefault` keeps focus).

## Modes & interaction

Modes (keyboard): Select `s`, Node `p`, Connect `c`, Line `l`, Text `t`, Table
`b`, Deriv `r`, Delete `d`.

- **Node** shapes: State (2 corners → ellipse), Box (2 corners), Junction dot
  (single dwell). **Table**: Blank (2-corner draw) or Truth 2/3/4 (single dwell,
  fixed size). **Line/Text/Deriv**: place then edit.
- After creating an item it **auto-selects and focuses its label**; the green
  **Done** button (and Enter/Escape) exits, and Done **resumes the creation
  mode** (`returnModeRef`) so you can make more of the same.
- Two-corner drawing shows a live dashed preview (`pendingCorner`/`hoverCell`).
- **Placement modes make geometry click-through** (`pointer-events:none`) so you
  can drop, e.g., a junction dot on a line intersection.
- **Multi-select group move**: in Select mode, "Select multiple to move"
  (`multiMode`) turns each dwell into an add/remove toggle on a `multi` ref set
  (`{kind,id}`). Also **two empty-canvas dwells define a box** (`areaSelect`
  preview) and `addItemsInRect` unions every item whose reference point (node
  center, line midpoint, text/deriv anchor, table center) is inside. A Move
  (1 cell) d-pad shifts them all via one `MOVE_MANY` action (one undo step).
  Edges ride with their nodes. Leaving Select mode ends it. Canvas highlights
  via a `multi` Set of `${kind}:${id}` keys.
- **Cell/line keyboard nav**: table cells = Tab/Shift+Tab/Enter/↑/↓ (selects text
  for overwrite); derivation lines = ↑/↓/Enter.
- **Auto-pan**: the active table cell / derivation line is panned into the top
  ~30% of the view (the gaze keyboard covers the lower half).

## Canvas / view

- Infinite pannable/zoomable canvas via `viewBox`. Toolbar has pan pad, zoom ±,
  reset (`⌂`), which frames page 1. **Full-bleed grid**: a `ResizeObserver`
  measures the canvas so `viewBox` aspect tracks the element (no letterbox).
- **Label size** control sets `--label-scale` (affects all text + export).

## Export / print

- **PNG (all content)** — bounding box of `#content`, light-baked via
  `applyLightStyles`, grid removed.
- **Print A4 → PDF** — `printA4.ts` builds **one vector A4 `<svg>` per page**
  (each showing its slice of the canvas), wrapped in `.print-page` divs. Print is
  **CSS-driven**: `@media print` hides the app, shows `.print-root`, pins the
  light palette (the live stylesheet still cascades onto the print SVGs, so baked
  attributes would be overridden — hence CSS, not baked styles), and
  `@page { size: A4 }`. Label scale is forwarded onto `.print-root`.
- **Copy LaTeX**: tables → `tabular` (with `$…$` if Math toggle on); derivations
  → `align*`.
- **Save/Open** (File group): "Save to file" downloads the whole `Doc` as
  `diagram.infedit.json`; "Open file…" reads one back and dispatches `LOAD`.
  Both go through `normalizeDoc` (shared with the localStorage autosave restore)
  so older/partial saves still load. This is project persistence — distinct from
  the light-baked PNG/PDF/LaTeX **export** (final output).

## Open threads / candidate next steps

- **Print A4 needs real-world testing** on Patrick's machine (margins, scale).
  In the browser print dialog: "Save as PDF"; enable **Background graphics** for
  table-header shading.
- No **content snapping to the printable area** and no **auto-add-page on
  overflow** yet — natural follow-ups for "write the whole exam".
- Boolean word-convert is derivation-expr only (could extend).
- Not built (scoped out earlier): standalone **expression object** + Copy LaTeX;
  UML **class boxes**; curved **parallel edges** (A→B and B→A overlap unless you
  bow them); Karnaugh maps; law-name snippets for derivation reasons.
- Toolbar is `overflow:hidden` and now has 8 mode buttons — can clip on very
  short windows; regroup if it does.

## Conventions

- Commit: concise subject + bullet body, end with the `Co-Authored-By:` trailer.
  **No double quotes** in messages (PowerShell here-string breaks).
- Commit/push when Patrick asks (he often says "c&p" / "p&c").
- Keep new code matching the surrounding style; drive colors through the CSS
  theme variables; theme-aware + export-baked for anything drawn.

## About the user

Patrick — CS student, a developer himself (prefers **React**, not familiar with
Svelte). Eye-tracking only; values **speed** and **exam integrity** above all.
Terse, action-oriented ("just build it", "c&p"). He is moving workplaces and
will delete the Claude account this history lived in — hence this handover.
