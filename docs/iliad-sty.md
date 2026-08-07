# `iliad.sty` — the worksheet contract

`iliad.sty` is the one required package for LaTeX worksheets. It defines the
small set of semantic environments the tex → MDX converter understands (the
"contract zone"). Everything else — prose, math, `\newcommand` macros, extra
packages, citations — is the "free zone": write whatever LaTeX you like and
it converts faithfully. Per-construct syntax lives in
[commands.md](commands.md); this page covers the package itself.

## Loading it

Every worksheet loads the style local-first, with the shared repo copy as
fallback:

```latex
\IfFileExists{iliad.sty}{\usepackage[boxes]{iliad}}{\usepackage[boxes]{../iliad}}
```

- **In the repo**, `tex/iliad.sty` is the single shared copy everyone builds
  against. Per-folder copies are gitignored, and the build fails if a stray
  local copy drifts from the shared one.
- **Outside the repo** (your machine, Overleaf), put a copy of `iliad.sty`
  next to your `main.tex` and the same line finds it. Don't commit it.

The `[boxes]` option turns on ready-made `tcolorbox` styling for the PDF.
Without it, PDF rendering is deliberately plain — style your PDF however you
like; the website's look is decided downstream and doesn't depend on it.

It loads for you: `amsmath`, `amssymb`, `amsthm`, `enumitem`, `graphicx`,
`hyperref`, and `cleveref` (last, as it must be). Configure hyperref with
`\hypersetup{...}` — do **not** re-load it.

## Strictness

The contract is strict about its own names: worksheets must not define their
own theorem/exercise/solution machinery, and must not `\renewcommand` /
`\renewenvironment` anything this package defines. A clash is a loud compile
error on purpose — port legacy material to the format rather than working
around it (CI also rejects redefinitions of contract names).

## What it defines

| Name | Kind | Purpose |
|---|---|---|
| `exercise` | env | numbered problem box ("Exercise 2.1"), own per-section counter |
| `solution` | env | worked answer bound to an exercise; hidden by `\solutionsfalse` |
| `solutionsonly` | env | plain content shown only in the with-solutions build (answer key / instructor aside); no box or binding; stripped from `-nosol` |
| `pdfonly` | env | kept in both PDF variants, dropped entirely from the web build; nest `solutionsonly` inside it for with-solutions-PDF-only content |
| `learningoutcomes` | env | "What you'll learn" box; body is an `itemize`, or `\subsection*{}` groups each with their own `itemize` |
| `definition` `theorem` `lemma` `proposition` `corollary` `fact` `example` | envs | amsthm family sharing one per-section counter |
| `proof` | env | amsthm; collapsible on the web |
| `hint` | env | unnumbered block hint, rendered in place; collapsible on the web |
| `callout` | env | `[note\|tip\|warning]` coloured aside |
| `remark` | env | aside in the theorem register; note-style callout on the web. Optional title: `\begin{remark}[Title]` → "Remark (Title)" |
| `\important` | mark | ★ after an exercise's label: one of the sheet's key exercises |
| `\authorname{}` `\affiliation{}` | cmds | structured `\author{}` entries (byline extraction) |
| `\hint{}` `\note{}` | cmds | inline `[Hint: …]` / `[Note: …]` (don't use inline `\hint{}` at the top level of a `hint` environment) |
| `\ifsolutions` | toggle | `\solutionsfalse` hides every solution from the PDF |
| `\skippable`, `\difficulty{}`, `summary` env | legacy | still compile but are not part of the contract; the page summary belongs in the `%--- iliad ---` metadata block |

## Metadata extraction

The website builds each page's metadata from the LaTeX itself:

- **title** ← `\title{...}` (found anywhere in the document, so setting it
  after `\begin{document}` works)
- **byline** ← `\author{...}`; plain `A \and B` works, and
  `\authorname{X}\\ \affiliation{Y}` entries render as "X (Y)"

The **summary** is not extracted from the LaTeX — it lives in the
`%--- iliad ---` comment block at the top of `main.tex`, alongside the other
metadata keys (`cluster:`, and optional `title:`/`contributors:` overrides of
the extracted values — a duplicate draws a build advisory). Values are
one-line YAML scalars, except `summary:`, which may be a paragraph written as
a YAML folded block scalar (continuation lines indented two spaces after the
leading `% `; line breaks fold into spaces):

```latex
%--- iliad ---
% cluster: B
% title: "Singular Learning Theory"
% summary: >-
%   A nice long paragraph describing the sheet, shown under the page title
%   and as the index blurb.
%--- end ---
```

(Legacy sheets with a `\begin{summary}` env in the body still convert — it is
hoisted into the frontmatter — but a `summary:` key overrides it.)

`unlisted: true` is a maintainer flag:
the page is built and reachable by URL but linked from nowhere. `slides:` holds
the URL of an externally hosted deck (rendered as an outbound link; a compiled
`slides.tex` in the folder supersedes it — see [commands.md](commands.md)).

Missing title/cluster/contributors draw build **advisories** (never
failures) with `file.tex:line` locations.

So does a summary that isn't one: **missing, empty, or still `TODO`**. The
summary is the page's lede *and* its blurb in the homepage and sidebar index, so
a sheet without one looks unfinished in two places — and `TODO` is exactly what
a port leaves behind when the source had no summary to transcribe (an author's
words are ported, never invented), which makes it the easiest thing in the file
to forget. An MDX-authored sheet gets the same advisory from
`build-content.mjs`, since it never passes through the converter.

## Labels and cross-references

`\label` anything you want to reference — exercises, theorems, callouts,
remarks all take labels, and `\cref` resolves to the exact text LaTeX
prints, on paper and on the web alike. Any placement LaTeX binds correctly
is valid (top level of the environment); right after `\begin{...}` is
clearest. Callouts and remarks carry discreet per-section counters: no
number shows in the box, but `\cref` prints "Callout 2.1" / "Remark 2.3"
and links to it.

## Solutions and the two PDF variants

`\begin{solution}[ex:label]` must name its exercise — that binding is what
lets solutions live anywhere (adjacent, or collected at the end) and still
pair up. The build produces every download in two variants: with solutions,
and with every solution stripped (`-nosol`) — the stripped `.tex`/`.mdx`/
`.pdf` are safe to hand out or paste into an LLM. `\solutionsfalse` is the
authoring-time equivalent for your own PDF compiles.

A sheet that collects its solutions in a back-of-sheet section should wrap
that section's `\appendix`/`\section{Solutions}` header in `pdfonly` +
`solutionsonly`: the web relocates the solutions under their exercises and
would otherwise show the emptied header, and the `-nosol` PDF must not show
it either. See "PDF-only content" in [commands.md](commands.md).
