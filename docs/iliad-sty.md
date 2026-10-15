# `iliad.sty` — the worksheet contract

The one required package for worksheets. It defines the environments the
converter understands; any other LaTeX converts as written. Per-construct
syntax: [commands.md](commands.md).

## Loading it

```latex
\IfFileExists{iliad.sty}{\usepackage[boxes]{iliad}}{\usepackage[boxes]{../iliad}}
```

- Repo: `tex/iliad.sty` is the shared copy. Local copies are gitignored; the
  build fails if one drifts from it.
- Overleaf etc.: put an uncommitted copy next to `main.tex`.
- `[boxes]` adds `tcolorbox` PDF styling. The website ignores it.

Loads `amsmath`, `amssymb`, `amsthm`, `enumitem`, `graphicx`, `hyperref`,
and `cleveref` (last). Configure hyperref with `\hypersetup{...}`; **do not
re-load it.**

## Strictness

Don't define your own theorem/exercise/solution machinery or
`\renew…` anything this package defines. Clashes fail compilation and CI.
Port legacy material to the format.

## What it defines

| Name | Kind | Purpose |
|---|---|---|
| `exercise` | env | numbered ("Exercise 2.1"), own per-section counter |
| `solution` | env | answer bound to an exercise |
| `solutionsonly` | env | unboxed, unbound content for the with-solutions build only |
| `pdfonly` | env | both PDFs, not web; nest `solutionsonly` for with-solutions PDF only |
| `learningoutcomes` | env | "What you'll learn"; an `itemize`, or `\subsection*{}` groups of `itemize` |
| `definition` `theorem` `lemma` `proposition` `corollary` `fact` `example` | envs | amsthm, one shared per-section counter |
| `proof` | env | amsthm; collapsible on the web |
| `hint` | env | unnumbered; collapsible on the web |
| `teachingnote` | env | `[Title]` (default "Teaching note"); dashed box in PDF, collapsed on web; unnumbered, in both variants |
| `callout` | env | `[note\|tip\|warning][Title]`; title replaces the type word (PDF), heads the box (web) |
| `remark` | env | note-style callout on web; `[Title]` → "Remark (Title)" |
| `\important` | mark | ★ marks a key exercise |
| `\authorname{}` `\affiliation{}` | cmds | structured `\author{}` entries |
| `\hint{}` `\note{}` | cmds | inline `[Hint: …]` / `[Note: …]`; not at top level of a `hint` env |
| `\youtube[Title]{ID}` | cmd | 11-char video ID: player on web, "Video:" URL line in PDF |
| `\llbracket` `\rrbracket` | cmds | Iverson brackets; don't load `stmaryrd` for them (~79 MB CI download). `\providecommand`d. Slide decks don't load `iliad.sty`, so define their own |
| `\ifsolutions` | toggle | `\solutionsfalse` hides every solution from the PDF |
| `\skippable`, `\difficulty{}`, `summary` env | legacy | compile, not in the contract; use `summary:` metadata |

## Metadata extraction

From the LaTeX:

- **title** ← `\title{...}`, found anywhere (after `\begin{document}` works)
- **byline** ← `\author{...}`; `A \and B` works; `\authorname{X}\\ \affiliation{Y}` renders "X (Y)"

The rest lives in the `%--- iliad ---` block atop `main.tex`:

- `cluster:`
- `summary:` (not extracted from LaTeX)
- `title:` / `contributors:`: optional overrides of the extracted values; a duplicate draws a build warning
- `unlisted: true`: page built and reachable by URL, linked from nowhere
- `slides:`: URL of an externally hosted deck (outbound link); a compiled `slides.tex` in the folder supersedes it (see [commands.md](commands.md))

Values are one-line YAML scalars, except `summary:`, which may be a folded
block scalar (continuation lines indented two spaces after `% `):

```latex
%--- iliad ---
% cluster: B
% title: "Singular Learning Theory"
% summary: >-
%   A nice long paragraph describing the sheet, shown under the page title
%   and as the index blurb.
%--- end ---
```

A legacy `\begin{summary}` env in the body is hoisted into the frontmatter; a
`summary:` key overrides it.

Build **warnings** (never failures, with `file.tex:line`) for:

- missing title, cluster or contributors
- summary missing, empty or `TODO` (ports leave `TODO` when the source has
  none). It is the page lede and index blurb. MDX sheets get this warning from
  `build-content.mjs`.

## Labels and cross-references

- `\label` anything (exercises, theorems, callouts, remarks); `\cref` prints
  the same on paper and web, type word included. The build warns on plain
  `\ref` and on hand-written "Section~\cref{...}".
- All sectioning levels print "Section", all appendix levels "Appendix"
  (cleveref names renamed here; the converter reads them from this file).
- Place the `\label` at the env's top level; right after `\begin{...}` is clearest.
- Callouts and remarks have hidden per-section counters: no number in the
  box, but `\cref` prints "Callout 2.1" / "Remark 2.3" and links to it.

## Solutions and the two PDF variants

- `\begin{solution}[ex:label]` must name its exercise; it may then sit anywhere.
- Every download has two variants: with solutions, and `-nosol` (all stripped;
  safe to hand out or paste into an LLM). `\solutionsfalse` does the same for
  your own compiles.
- A back-of-sheet solutions section must wrap its `\appendix`/
  `\section{Solutions}` header in `pdfonly` + `solutionsonly`. Otherwise the web
  (which moves solutions under their exercises) and the `-nosol` PDF show an
  empty header. See "PDF-only content" in
  [commands.md](commands.md).
