# Copilot instructions — INFEditor

Read `HANDOVER.md` in the repo root for full context. Summary of standing rules:

**What this is:** a gaze-driven diagram & notation editor for a CS student who
works entirely via eye-tracking (dwell-clicking), to draw diagrams and write
boolean-algebra / logic / automata / circuit content fast for exams and
homework. React 18 + TypeScript + Vite, single-file offline build, deployed to
GitHub Pages.

**Design rules (do not violate):**

- **Gaze-first UX:** large dwell-friendly targets, **no dragging**, two-dwell /
  two-corner interactions, snap-to-grid, toolbars on screen edges, big Undo.
- **Formatting only — never solve.** The editor must never compute or fill in
  content (no boolean simplification, no truth-table outputs, no minimization).
  This is an exam-integrity rule. Truth tables get empty structure; the only
  auto-fill is the deterministic 0/1 input pattern via an explicit button.
- Dark mode is default; **every export/print is light** (dark ink on white).

**Working conventions:**

- Verify with **`npm run build`** (`tsc -b && vite build`). Inline IDE
  diagnostics during edits are often **stale** — trust the build.
- Windows/PowerShell: **no double quotes in git commit messages** (here-strings
  break). Commit style: concise subject + bullets + `Co-Authored-By:` trailer.
- Push to `master` auto-deploys via GitHub Actions (Pages Source = "GitHub
  Actions"). `dist/`, `node_modules/` are gitignored.
- Match surrounding code style; drive colors through CSS theme variables; make
  anything drawn theme-aware **and** export-baked (see `applyLightStyles`).

**Where things live:** `types.ts` (model), `store.ts` (reducer + undo),
`Canvas.tsx` (SVG render + `renderRich` LaTeX-subset text), `App.tsx` (shell +
interactions), `exportPng.ts` / `printA4.ts` (export/print), `latex.ts`
(tabular + align\*), `geometry.ts` (grid + A4 page constants), `gates.ts`,
`styles.css`.
