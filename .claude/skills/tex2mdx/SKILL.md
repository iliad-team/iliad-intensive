---
name: tex2mdx
description: Internals of scripts/tex2mdx/, the LaTeX → MDX converter — the stages in order, which file owns what (shims.mjs for dialect, emit-ast.mjs for emission, autolabel/texinput for the .aux contract), what every construct becomes on the web, cross-refs, solution relocation, the KaTeX macro block, warnings vs advisories, and how to add or fix a construct. Read this when a conversion fails with an ERROR, a page renders a construct wrongly, a new LaTeX corpus needs a shim, or before editing anything under scripts/tex2mdx/.
---

# tex2mdx — the converter

Design in one line: **copy prose and math byte-for-byte, translate only known
markup, fail loud on anything unrecognised.** Cross-references and every
displayed number come from LaTeX's own `.aux`, never from a simulated counter.
The `content-build` skill covers how the build invokes it; this is what
happens inside. `scripts/tex2mdx/README.md` is the short version.

```
node scripts/tex2mdx/tex2mdx.mjs tex/<slug>/main.tex \
  -o content/modules/<slug>.mdx --tikz-dir public/uploads/<slug> --tikz-src /uploads/<slug>/
node scripts/tex2mdx/tex2mdx-check.mjs content/modules/<slug>.mdx
```

Exit 2 on any **ERROR** (`warn()`); **advisories** (`advise()`) print under
`NOTE (warning, does not fail CI)` and never fail. Both carry `file:line`,
found by searching each source file's comment-stripped text for a needle
snippet (`state.mjs`). It has its own `package.json`/`node_modules`
(unified-latex, bibtex-parse, its own KaTeX) — `npm ci --prefix scripts/tex2mdx`.

## Files

| File | Owns |
|---|---|
| `tex2mdx.mjs` | CLI; auto-label injection; `.aux` → refs; `\crefname`; frontmatter block; contract checks; `\gdef` macro block; `.bib` parsing; title/author/summary; YouTube title lookup; runs the emitter; TOC; writes the file; renders TikZ; prints the report |
| `emit-ast.mjs` | unified-latex typed AST → MDX. Two passes. All environment/macro/list/heading/math emission, solution relocation, footnotes, References |
| `shims.mjs` | **all dialect knowledge**, pure tables and string transforms: `MACRO_OVERRIDE`, `MACRO_SKIP`, `KATEX_SHIMS`, `MATH_TRANSFORMS`, `braceMathArgs`, `CREF_NAME_DEFAULTS`, `THM_FAMILY`, `CONTRACT_NAMES`, `KNOWN_FRONT_KEYS`, `TIKZ_PKG_OK` |
| `autolabel.mjs` | same-line `\label{iliad-auto-N}` injection, comment/verbatim-aware, `\input`-following (`injectAutoLabelsTree`) |
| `texinput.mjs` | `transformInputTree`: apply a transform to main + every `\input` in one deterministic order; returns per-file texts and the inlined `flat` document. `\include` is not followed (warns) |
| `tikz.mjs` | standalone TikZ snippets → `pdflatex` + `pdftocairo` → `tikz-<12 hex>.svg`, content-addressed; preamble filtered through `TIKZ_PKG_OK` plus tikz config and macro definitions |
| `tex2mdx-check.mjs` | the render gate: compile with remark-math + remark-gfm + rehype-katex, then KaTeX-render every span and fail on `katex-error`/`#cc0000` |
| `util.mjs` | `readGroup`/`readOpt`/`readArg`, `stripComments`, `slug`, `ghSlug` (matches rehype-slug), `tidy`, `NEST`/`CHILD` markers, `frontMatterOrderIssues` |
| `state.mjs` | `SRC_FILES`, `warn`, `advise`, `snippetOf`, `fmtIssue` |

## Pipeline, in order (`tex2mdx.mjs`)

1. `injectAutoLabelsTree(main.tex, {postProcess: stripComments})` → `tex`
   (the inlined, labelled, comment-stripped document) and `autoLabels`.
   Each file's stripped text is registered for `file:line`.
2. Split at `\begin{document}` / `\end{document}` into `preamble` and `body`.
3. `\crefname` / thmtools `refname=`/`name=` declarations: first from
   `tex/iliad.sty` (local-first, like `main.tex`'s load), then the preamble,
   so the web calls a `\cref` what the PDF calls it (`subsection` → "Section").
4. `.aux`: `--aux`, else sibling `main.aux`, else one temp-dir pdflatex pass.
   `parseAux` reads `\newlabel{KEY@cref}{{[type]…NUMBER}…}` into
   `{name, num}` and plain `\newlabel{key}{{NUM}…}` into `{name:"", num}`.
   If the last auto-label is missing from the refs the `.aux` is stale and is
   regenerated; failing that, one ERROR and simulated counters.
5. `initTikz` with the preamble. Dialect flags: `usesExerciseEnv`,
   `remarkNumbered` (`\newtheorem{remark}`), `declaredThms` (author
   `\newtheorem`/`\declaretheorem` → numbered callouts), `commentCmds`
   (`\declareauthor{x}` → `\x{…}` dropped whole).
6. The `%--- iliad ---` … `%--- end ---` comment block, read from the *raw*
   `main.tex`, becomes frontmatter verbatim. Unknown key = ERROR
   (`KNOWN_FRONT_KEYS`: `title summary contributors slug unlisted slides`;
   `cluster`/`day` are deliberately not keys). Missing block = advisory only
   when the sheet uses `exercise`.
7. Contract checks: duplicate `\label` (ERROR); `\renewcommand` of a
   `CONTRACT_NAMES` entry (ERROR); plain `\ref`, `\cref{x}(a)`, hand-written
   `\hyperref` text, front-matter order (advisories).
8. `buildGdef`: every `\newcommand`/`\renewcommand`/`\providecommand` and
   `\DeclareMathOperator` in preamble + body becomes a KaTeX `\gdef`, after
   `KATEX_SHIMS`. `MACRO_SKIP` names are omitted; `MACRO_OVERRIDE` bodies
   replace ones KaTeX can't run; a body containing `$` is ERROR + skipped (it
   would close the macro span); an optional-arg macro is ERROR unless
   overridden. `\def` is harvested for expansion but not exported.
9. `.bib`: `\bibliography{name}` else `biblo.bib`, via `bibtex-parse`. Each
   key gets `disp` ("Doe 2020", "Doe & Roe 2020", "Doe et al. 2020"), URL (or
   arXiv from `eprint`), and the fields the References list is typeset from.
10. Frontmatter values: `title` from the first `\title{}` anywhere (text before
    `\hfill`); `contributors` from `\author{}` split on `\and`, with
    `\authorname{}`/`\affiliation{}` → "Name (Affil)"; a legacy
    `\begin{summary}` env hoisted to `summary`. Block keys win. Missing
    title/contributors/summary and `summary: TODO` are advisories.
11. `\youtube{ID}` with no `[Title]`: oEmbed lookup, cached in
    `content/modules/.video-titles.json`; failure is an advisory.
12. `emitDocument(body, ctx)` → `tidy()` → fill the `<!--ILIAD_TOC-->`
    placeholder (after tidy, which would flatten the nested list) → write
    `frontmatter + "$<gdefs>$" + body`. The macro span is omitted when
    empty (`$$` alone would open display math).
13. `renderTikzSnippets()`: only hashes with no existing SVG compile.

## Emission (`emit-ast.mjs`)

`emitDocument` first `braceMathArgs` the source (`\frac12` → `\frac{1}{2}`,
because unified-latex leaves digit runs as one token inside `aligned`, `cases`,
matrices), then:

- **Phase A**: parse preamble+body with default signatures, harvest author
  `\newcommand`s (`listNewcommands`) into `authorMacros`; optional-arg macros
  are ERROR unless in `MACRO_OVERRIDE`. Parameterless `\def`s too.
- **Phase B**: re-parse the body with `ENV_SIGNATURES` + declared theorem envs
  + `CONTRACT_MACROS` + author macro signatures, so arguments attach.
- **Pass 1** walks to fill `anchorMap` (label → anchor), output discarded,
  warnings rolled back. **Pass 2** emits, then `relocateSolutions`, then
  appends `## References` for every cited key and the GFM footnote
  definitions.

What constructs become (the component *names* are the contract with
`src/lib/mdx.tsx`):

| LaTeX | MDX |
|---|---|
| `\section{T}` (+following `\label`s) | `## N. T` — number from the `.aux` via the auto-label; `###`/`####` for sub/subsub; starred = unnumbered; inside `learningoutcomes` just bold text |
| `\begin{exercise}[Title]\label{ex:x}` | `<Exercise id="ex-x">**Exercise N (★) (Title) [dd].** …</Exercise>`; `\important` → ★, legacy `\skippable` → (∗), `\difficulty{d}` → `[d]`; a missing label is an advisory |
| `\begin{solution}[ex:x]` | `<Solution for="ex-x">` during emission, then **moved directly under its exercise** (after earlier solutions and any `<Hint>`), attribute stripped. Missing `[label]` = ERROR; unknown label = ERROR; label that is not an exercise = ERROR, stays in place |
| `proof` | `<Solution title="Proof">` (or the optional arg) |
| `hint` env / `\hint{}` / `\note{}` | `<Hint>` / `[*Hint:* …]` / `[*Note:* …]` — `<Hint>` is its own component so the `-nosol` stripper keeps it |
| `teachingnote`[label] | `<TeachingNote title>` |
| `learningoutcomes` | `<LearningOutcomes>` wrapping the walked body |
| `definition` | `<Definition id>**Definition N (Title).** …</Definition>` |
| `theorem lemma proposition corollary` | `<Theorem id>**Kind N (Title).** …</Theorem>` |
| `fact`, `remark` | `<Callout type="note">**Fact/Remark N.** …` (remark numbered only when `\newtheorem{remark}`) |
| `example` | `<Callout type="tip">` |
| `callout[note\|tip\|warning][Title]` | `<Callout type title>` |
| author `\newtheorem{foo}{Foo}` | `<Callout type="note">**Foo N.** …` |
| `solutionsonly` | body wrapped in `{/* iliad:solutionsonly:start */}` … `end` markers for the `-nosol` stripper |
| `pdfonly` | dropped unwalked; a `\cref` from visible prose to a label inside it draws an advisory |
| `summary` env | nothing (hoisted to frontmatter) |
| `abstract` | `**Abstract.** …` |
| `quote`/`quotation` | `> ` blockquote |
| `verbatim`/`lstlisting`/`alltt`/`\verb` | fenced code / code span |
| `tabular` | pipe table (rules stripped, `&` split brace-aware) |
| `figure`/`table` with `\includegraphics{fig/x.pdf}` | `<Figure src="/uploads/<slug>/x.svg" alt>caption</Figure>` — caption as children so its math renders; labelled → wrapped in `<div id>` |
| `tikzpicture`/`tikzcd` (anywhere) | `<Figure src="/uploads/<slug>/tikz-<sha>.svg" alt="diagram" />` |
| `itemize`/`enumerate`/`description` | Markdown lists; first-level `enumerate` inside exercise/solution → `**(a)**` parts; `\item[x]` → bold label, no marker; a `\label` on an `\item` → `<span id>` so `\cref` lands on the part; nesting via `NEST`/`CHILD` markers resolved by `indentBody` |
| `equation`, `align`, `gather`, `multline`, `\[…\]`, `$$` | `$$ … $$`; `align*`→`aligned`, `gather`→`gathered`; `\intertext` splits into several displays; `\tag{x}` → `\quad\text{(x)}`; `\label` → `<div id>` wrapper |
| `$…$` | `$…$` after `mathClean` |
| `\cref{a,b}` | `[Exercise 2](#a)` — one pluralised type name for a same-type list ("Sections 4 and 7"), cleveref-style prose list; `\ref` number only; `\eqref` `(N)`; `\nameref`; `\crefrange`; `\hyperref[l]{t}` |
| `\cite{k}` / `\citep` / `\citet` | `(Doe 2020)` linking `#bib-<key>`; unknown key = ERROR |
| `\footnote{}` / `\footnotemark`+`\footnotetext` | GFM `[^n]` + one-line definition at the foot |
| `\href`, `\url` | `[t](u)`, `<u>` |
| `\textbf` `\emph` `\texttt` | `**` `*` code span (with `\_`, `{[}`, `\textbar` unescaped) |
| `\youtube[T]{ID}` | `<YouTube id title />`; ID must be 11 chars |
| `\paragraph{T}` | `**T.** ` run-in |
| `\tableofcontents` | in-page ToC built from the emitted headings |
| `` ` ` `` `''` `--` `---` `~` | `"` `"` `–` `—` space |
| author macro | expanded (args substituted) and re-walked, depth ≤ 12 |
| anything else | `{/* TODO(tex2mdx): … */}` + ERROR |

`NOOP_MACROS` are dropped silently; `DROP_WITH_ARGS` drop with their arguments
(`\label`, `\vspace`, `\title`, `\input` …). Labels: the first top-level
`\label` in an env is its identity (`slug(label)` = lowercase, non-alnum → `-`);
heading anchors are `ghSlug(heading text)` so they match what rehype-slug
generates on the site.

- **Notebook links.** `\notebooksol[text]{name}` / `\notebooknosol[…]{…}` (signature
  `o m`) emit `<NotebookSol name="…">text</NotebookSol>` / `<NotebookNoSol …/>`, the same
  tags an MDX sheet writes. There is no site component for them: `build-content.mjs`
  (`resolveNotebookLinks`) replaces them with plain Colab links before the render gate,
  because only the build knows which notebook masters exist. See `docs/NOTEBOOKS.md`.

### Math

`mathClean` = `applyMathShims` (`KATEX_SHIMS` synonyms, `\$` → `\char36 `,
`\qedhere`/`\footnotemark` removed, diffcoeff `\diff` → `\frac`, `@{}` array
columns stripped) then resolves `\cref`/`\ref`/`\cite` inside math to plain
text and unwraps `\resizebox`. Math is never re-parsed; bodies go through
`printRaw`. A `\$` in *prose* stays `\$` (CommonMark escape). A `$` in a macro
body is ERROR because the macro block is itself a `$…$` span.

## Where to make a change

| You want to | Edit |
|---|---|
| a package command KaTeX lacks but has a synonym for | `KATEX_SHIMS` in `shims.mjs` |
| a pure rewrite of math bodies | `MATH_TRANSFORMS` |
| an author macro whose body KaTeX cannot execute | `MACRO_OVERRIDE`; layout-only macros into `MACRO_SKIP` |
| a new frontmatter key | `KNOWN_FRONT_KEYS` + `src/lib/content.ts` `Frontmatter` + whatever reads it |
| a new environment or macro on the web | `ENV_SIGNATURES`/`CONTRACT_MACROS` (so the parser attaches args) + a `case` in `emitEnv`/`emitMacro`; if it is numbered, `BUILTIN_NUMBERED` in `autolabel.mjs` and `THM_COUNTED`; a new component name also needs `src/lib/mdx.tsx`, and `docs/commands.md`/`docs/iliad-sty.md` + `tex/iliad.sty` for the PDF side |
| a package a TikZ snippet needs | `TIKZ_PKG_OK` |
| the printed name of a cref type | `\crefname` in `tex/iliad.sty` (both sides read it) |

Test one sheet: `node scripts/build-content.mjs --check <slug>` (fast) and
read `tex/<slug>/convert.log`; `tex/example/main.tex` exercises every
construct and is the regression sheet. Then a full build for the PDF side.

## Gotchas already paid for

- A theorem body opening with `$$` must go on its own line (`thmBody`), or
  micromark reads the fence as inline math and the whole file desyncs.
- Replacement strings containing `$$` must be passed as functions to
  `String.replace` or `$$`/`$&` get interpreted.
- `\item` args: unified-latex gives three slots; use `bracketArg`, not
  `args[0]`.
- `\href` is `o m m`; index from the end.
- `\item[label]` lists drop bullets (the label replaces the marker).
- Headings are never pruned, even if relocation empties a "Solutions"
  section — put an authored solutions appendix in `pdfonly`.
- `\include` is not followed; multi-file sheets use `\input`.
- The `.tex` download is inlined and still needs `iliad.sty` beside it.
- `texToPlain` is used for titles/attributes: math is dropped there (advisory)
  because JSX attributes cannot render it; captions are emitted as children
  for that reason.
