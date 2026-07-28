# Authoring reference — every supported construct

Construct-by-construct syntax for worksheets, LaTeX first, with the MDX
equivalent where you author `main.mdx` directly. `tex/example/main.tex` is
the living demo of everything here; [iliad-sty.md](iliad-sty.md) covers the
package mechanics.

## Exercises

```latex
\begin{exercise}[Optional Title]
\label{ex:warmup}
\important            % optional ★: one of the sheet's key exercises
Let $p$ be a distribution on a finite set $\mathcal{X}$.
\begin{enumerate}
  \item Show that $H(p) \geq 0$.  \label{ex:warmup-a}
  \item For which $p$ is $H(p) = 0$?
\end{enumerate}
\end{exercise}
```

- Numbered per section ("Exercise 2.1"); the optional argument is the title.
- Label the exercise if a solution or `\cref` points at it; unlabeled
  exercises are allowed but draw a CI advisory (no stable web anchor).
- Subparts are a plain `enumerate`; label an `\item` to reference it
  ("Exercise 1.2(a)").
- MDX: `<Exercise id="ex-warmup">**Exercise 1.1.** …</Exercise>`

## Solutions

```latex
\begin{solution}[ex:warmup]
For \cref{ex:warmup-a}: each term is non-negative. \hint{when is $-t\log t = 0$?}
\end{solution}
```

- `[ex:label]` is **mandatory** (compile error without it) — that binding is
  why placement is free: right after the exercise or collected at the end.
- The PDF keeps your placement; **the web always moves each solution directly
  beneath its exercise** (a solutions section left empty by the move is
  dropped from the page — don't `\cref` it from prose).
- Collapsed (`<details>`) on the web; hidden from the PDF by
  `\solutionsfalse`; stripped entirely from the `-nosol` downloads.
- MDX: `<Solution>…</Solution>`

## Solutions-only content

```latex
\begin{solutionsonly}
\textbf{Instructor note.} Discuss \cref{ex:gibbs-hard} on the board first.
\end{solutionsonly}
```

- Content that appears **only** in the with-solutions build — an answer key, an
  instructor aside, a spoiler. Unlike `solution` it has no box, heading, or
  exercise binding, and it is never relocated: it renders as plain content
  exactly where you write it.
- Removed entirely from every `-nosol` download (PDF, `.tex`, `.mdx`), the same
  way solutions are, so those stay spoiler-free. Also hidden from your own PDF
  by `\solutionsfalse` / loading iliad with `[nosolutions]`.
- Prefer this to a bare `\ifsolutions…\fi`: the conditional works in the PDF but
  is **not** honoured on the web (the converter can't evaluate TeX conditionals),
  whereas `solutionsonly` works in both.

## PDF-only content

```latex
\begin{pdfonly}
\begin{solutionsonly}
\clearpage
\appendix
\section{Solutions}
\label{apx:solutions}
\end{solutionsonly}
\end{pdfonly}
```

- Content kept in **both** PDF variants but dropped from the web page and the
  `.mdx` downloads without a trace — nothing inside lands in the page, the
  sidebar, or the anchors.
- The motivating case is a collected back-of-sheet solutions section: on the
  web its solutions relocate under their exercises, so its `\appendix` /
  `\section{Solutions}` header would be left pointing at nothing. Nest
  `solutionsonly` inside `pdfonly` (as above) and the header appears **only**
  in the with-solutions PDF.
- The "don't `\cref` the solutions section" rule is lifted *inside* `pdfonly`:
  a sentence like "\Cref{apx:solutions} provides worked solutions." is fine
  when wrapped this way, since the web never renders it. A `\cref` *outside*
  pointing *in* would be a dead link on the web — the build flags it with an
  advisory.
- Numbered material (a `\section`, theorem, exercise) inside `pdfonly` is
  safe for the numbering: the web reads every displayed number out of the
  PDF's own `.aux`, so hiding, say, Theorem 2.4 leaves a faithful gap on the
  web (…2.3, then 2.5), exactly mirroring the PDF. Just remember the hidden
  thing isn't on the page — web-visible `\cref`s to it are dead links (the
  build flags them, see above).

## Hints

```latex
\begin{hint}
Consider $f(t) = t - 1 - \log t$.
\end{hint}
```

- Unnumbered, never labeled, renders exactly where it is written (no
  relocation, unlike solutions).
- PDF: a bold "Hint:" lead-in. Web: a collapsible drop-down, like solutions —
  and unlike solutions, hints survive `\solutionsfalse` and the `-nosol`
  downloads.
- MDX: `<Hint>…</Hint>`

## Learning outcomes and summary

The summary is **metadata, not body text**: it goes in the `%--- iliad ---`
comment block at the top of `main.tex`, as a YAML folded block scalar
(continuation lines indented two spaces after the leading `% `):

```latex
%--- iliad ---
% summary: >-
%   One paragraph on what this sheet is about. It can run over several
%   lines; the line breaks fold into spaces.
%--- end ---
```

Learning outcomes stay in the body:

```latex
\begin{learningoutcomes}
  \begin{itemize}
    \item First outcome.
    \item Second outcome.
  \end{itemize}
\end{learningoutcomes}
```

The body is ordinary LaTeX. For a longer sheet, group the outcomes under
`\subsection*{...}` headings, each with its own `itemize`:

```latex
\begin{learningoutcomes}
  \subsection*{Motivation}
  \begin{itemize}
    \item ...
  \end{itemize}

  \subsection*{Core results}
  \begin{itemize}
    \item ...
  \end{itemize}
\end{learningoutcomes}
```

- The summary becomes the page's lede and its index blurb;
  `learningoutcomes` renders as the "What you'll learn" box where you put
  it — usually right after `\maketitle`.
- Legacy sheets with a `\begin{summary}` env in the body still convert (it
  is hoisted into the frontmatter), but the metadata block is the home for
  new sheets; a frontmatter `summary:` overrides the env if both are present.
- MDX: put `summary:` in the YAML frontmatter; `<LearningOutcomes>` with a
  markdown list inside. Group headings become bold subheadings in the box
  (not real headings — no anchor, not in the table of contents).

## Theorem family

```latex
\begin{definition}[entropy]
\label{def:entropy}
The \emph{entropy} of $p$ is …
\end{definition}
```

`definition`, `theorem`, `lemma`, `proposition`, `corollary`, `fact`,
`example` share one per-section counter; `proof` is collapsible on the web.
The optional argument is a name/attribution; on the web every box renders
axiom-style — a bold lead ("**Lemma 2.2 (Gibbs' inequality).**") inside the
coloured box, so names can contain math.
MDX: `<Definition id="def-entropy">**Definition 2.1 (entropy).** …</Definition>`,
`<Theorem id="thm-gibbs">**Lemma 2.2 (Gibbs).** …</Theorem>`.

## Callouts and remarks

```latex
\begin{callout}[warning]
\label{co:pitfall}
Don't confuse $\log$ bases here.
\end{callout}

\begin{remark}[optional title]
An aside in the mathematical register.
\end{remark}
```

- Types: `note` (default), `tip`, `warning` — coloured boxes on web + PDF
  (`[boxes]`).
- `remark` takes an optional title, appended in parentheses:
  `\begin{remark}[Encodings]` renders as "Remark (Encodings)".
- Both may be labelled: no number shows in the box, but
  `\cref{co:pitfall}` prints "Callout 2.1" and links to it.
- MDX: `<Callout type="warning" id="co-pitfall">…</Callout>`

## Math, macros, cross-references

- Inline `$…$`, display `\[…\]`, `equation`, `align` — all KaTeX on the web.
- Your preamble `\newcommand`s / `\DeclareMathOperator`s translate to web
  math macros automatically (avoid `\mathchoice` and optional-argument
  macros — the converter warns at `file.tex:line` when it can't translate).
- `\cref`/`\Cref` resolve to the exact text LaTeX prints, everywhere:
  equations, sections, exercises, subparts, callouts.

## Figures

```latex
\begin{figure}[ht]
  \centering
  \includegraphics[width=0.45\linewidth]{fig/value-curve.pdf}
  \caption{An example figure.}
  \label{fig:value}
\end{figure}
```

- Export figures to **PDF** into your `fig/` folder — the build converts
  them to SVG for the web. Web-native assets (`.svg`, `.png`, …) in `fig/`
  are served as-is.
- Inline `tikzpicture`/`tikzcd` also works: each diagram is compiled and
  rendered for the web automatically.
- MDX: `<Figure src="/uploads/your-slug/value-curve.svg" caption="…" />`

## Slides

A worksheet folder may carry an optional slide deck:

```
tex/<slug>/slides.tex        # any self-contained LaTeX (usually beamer)
```

- If `slides.tex` is present, the build compiles it to `slides.pdf` and hosts
  it beside the other downloads — the page gains a **Slides** row (view PDF,
  download PDF, download the `.tex`). Same 3× `pdflatex` + `bibtex` ladder as
  the worksheet; a compile error fails the build with `file.tex:line`.
- **Handout variant.** A deck that mentions `\HANDOUT` opts into a second,
  collapsed build. Guard the reveals with it in the preamble:
  ```latex
  \ifdefined\HANDOUT\PassOptionsToClass{handout}{beamer}\fi
  \documentclass[10pt,aspectratio=169]{beamer}
  ```
  The build then also produces `slides-handout.pdf` by `\def`-ing the macro on
  the command line, and the **Slides** row reads *present · handout · LaTeX*
  instead of *view · download · LaTeX*. A deck with no `\pause` reveals simply
  never mentions `\HANDOUT` and builds once. To reproduce either build by hand:
  ```
  pdflatex slides.tex                                  # presentation
  pdflatex -jobname=slides-handout "\def\HANDOUT{}\input{slides}"   # handout
  ```
- `iliad.sty` is a *worksheet* contract and is **not** loaded for slides —
  style the deck however you like.
- Slides are **never** converted to MDX and have **no** `-nosol` variant (a
  deck is a download, not a web page).
- No source, only a PDF deck? Don't commit the binary. Host it (e.g. Drive)
  and point at it from the `%--- iliad ---` block:
  ```
  %--- iliad ---
  % slides: https://drive.google.com/…
  %--- end ---
  ```
  It renders as an outbound **Slides ↗** link. A compiled `slides.tex` takes
  precedence over the URL.
- The build emits a non-fatal **advisory** for any worksheet with no
  `slides.tex` (whether or not a `slides:` URL is set), in the full build and
  `./run.sh ci` — not in the `--check` watch/pre-push loop.
- For a day with **no worksheet yet**, there is no frontmatter to hold a
  `slides:` URL — put it on the day itself in [`schedule.yaml`](../schedule.yaml)
  instead. Deck precedence, highest first: a compiled `slides.tex` → a
  worksheet's `slides:` URL → the day's `slides:` URL → no deck.

## Which teaching day is this? (not your file's business)

Your frontmatter describes the *worksheet*. Where it sits in the *course* —
its cluster, its teaching day, the order it's listed in — lives in one central
file, [`schedule.yaml`](../schedule.yaml), which lists each day's worksheets in
reading order:

```yaml
      - code: D.3
        title: AIXI
        worksheets:
          - solomonoff-induction    # order here is the order on the site
          - aixi
```

- Add your slug under its day and you're done: the homepage, the sidebar and
  [`/admin/status`](https://iliad-team.github.io/iliad-intensive/admin/status/)
  all follow, and the build stamps `cluster:`/`day:` into your page for you.
- Several worksheets per day is normal — D.3 is Solomonoff Induction then AIXI,
  and that order is a fact about teaching, which no sort of the titles could
  have recovered.
- Writing `cluster:` or `day:` in your own frontmatter **fails the build**: two
  places to state one fact is one too many.
- A worksheet no day lists also **fails the build**, so nothing can quietly
  land unplaced. (`unlisted: true` opts a sheet out of the course entirely —
  that's the format demo, and almost certainly not you.)

## Citations

Entries go in your folder's `biblo.bib`; `\cite{Shannon:48}` etc. as normal
(`\bibliography{biblo}` + a style at the end of the sheet). On the web,
citations render as author-year text linking to an anchored entry in a
References list at the bottom of the page; there, an entry with a `url`
(or arXiv `eprint`) field makes its title the outbound link. Citations
never link straight out of the page.

**Pick whatever style you like.** `\bibliographystyle` governs the PDF only —
the converter never reads it. It parses `biblo.bib` itself and normalizes
every citation to the same author-year form on the web, so an alpha-label
sheet (`alphaurl` → `[Knu73]`) and a natbib author-year one (`plainnat` →
`(Fishburn, 1971)`) read identically online and differ only in their PDFs.
natbib's commands are all understood: `\citet` keeps its grammatical form
("Watanabe 2009 defines…"), while `\cite`, `\citep`, `\citealp` and
`\citetext` render parenthesized.

If you reach for a style outside base TeX Live — `alphaurl` comes from
**urlbst**, packaged as `texlive-bibtex-extra` — add it to both `setup.sh`
and the workflow's apt list. A style bibtex cannot open produces no `.bbl`,
and pdflatex then degrades every `\cite` to `[?]` without erroring; the build
treats any bibtex failure other than "this document has no bibliography" as
fatal, so it cannot ship unnoticed again.

## Inline marks

- `\hint{…}` → *[Hint: …]* — `\note{…}` → *[Note: …]*
- `\important` after an exercise's label → ★ (the sheet's key exercises)
- Footnotes render inline in parentheses on the web.

## Writing in MDX instead

`main.mdx` replaces `main.tex` entirely: YAML frontmatter (`title`,
`summary`, `contributors` — `title` required, there's no
`\title{}` to fall back on), KaTeX math with `$…$`/`$$…$$`, and the JSX
components named above. The PDF is generated by pandoc; downloads offer
PDF + Markdown (no LaTeX). Everything else — downloads variants, the index,
the render gate — works identically.

A hand-authored `main.mdx` is **copied verbatim** into
`content/modules/<slug>.mdx` — no converter, no preprocessing — and the same
file is then handed to pandoc (`--from markdown+tex_math_dollars`) to make the
PDF. Two tools that disagree about what MDX is both read your file, and the
rules below all follow from that.

### Heading levels: `##` is the top

Match what the converter emits for a LaTeX day, so a hand-written page and a
generated one have the same shape:

| LaTeX | MDX |
| :--- | :--- |
| `\section` | `##` |
| `\subsection` | `###` |
| `\subsubsection` | `####` |

**Never `#`.** The site renders the frontmatter `title` as the page's h1, so a
`#` in the body is a second h1 sitting a level above every generated page's
sections. Numbered sections in generated pages carry an `N.` prefix read from
the `.aux` (`## 1. Preliminaries`); hand-authored days aren't numbered, so
don't add numbers by hand. Don't mix a bold line (`**Session 2: …**`) with a
real `### Session 1: …` for the same level — pick the heading.

### Comments: `{/* … */}`, and they leak into the PDF

```mdx
{/* # Roadmap for today */}
{/* parked until the author confirms the timetable */}
```

That is the only form MDX accepts. One per line is fine, so is a blank line
inside a single `{/* … */}` block. `<!-- … -->` is a **compile error**, not a
comment:

    MDX compile: FAIL :: Unexpected character `!` (U+0021) before name …
      (note: to create a comment in MDX, use `{/* text */}`)

Pandoc doesn't know MDX, so a comment is not a comment to it — it escapes the
whole thing into the PDF as literal `\{/* \# Roadmap for today */\}`. A comment
therefore hides from the site but **not** from the download. Use `{/* … */}`
while drafting; delete parked content before you ship rather than leaving it
commented. (Component *tags* differ: pandoc treats `<LearningOutcomes>` as raw
HTML and drops the tag while keeping its contents. An expression has no tag to
drop.)

### Frontmatter

Never write `cluster:` or `day:` — those belong to `schedule.yaml` and the
build stamps them in. Writing either is a hard build failure:

    main.mdx frontmatter sets `day` — that lives in schedule.yaml (list the
    slug under its day) and is stamped in at build time

So a new MDX module is two edits: the file, plus its slug under the right day's
`worksheets:` in `schedule.yaml`.

### Check it

    node scripts/tex2mdx/tex2mdx-check.mjs tex/<slug>/main.mdx   # the render gate alone, ~1s
    node scripts/build-content.mjs --check <slug>                # + the frontmatter/schedule rules
    node scripts/build-content.mjs <slug>                        # + the pandoc PDF

The gate wants `MDX compile: OK` and `0 errored` KaTeX spans. Only `--check`
catches a `cluster:`/`day:` in frontmatter or a slug missing from
`schedule.yaml`. Run the full build at least once before opening a PR — the PDF
is a download the site advertises, and pandoc fails on things MDX accepts.
