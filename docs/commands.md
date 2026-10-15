# Authoring reference — every supported construct

Worksheet syntax, LaTeX first, with the MDX equivalent for hand-authored
`main.mdx`. `tex/example/main.tex` demos everything here;
[iliad-sty.md](iliad-sty.md) covers the package mechanics.

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

- Numbered per section ("Exercise 2.1"); optional argument is the title.
- Unlabelled exercises draw a CI warning (no stable web anchor).
- Subparts: plain `enumerate`. Label an `\item` and `\cref` prints
  "Exercise 1.2(a)", linking to the part. Don't hand-write
  `\cref{ex:warmup}(a)`; the build flags it.
- MDX: `<Exercise id="ex-warmup">**Exercise 1.1.** …</Exercise>`

## Solutions

```latex
\begin{solution}[ex:warmup]
For \cref{ex:warmup-a}: each term is non-negative. \hint{when is $-t\log t = 0$?}
\end{solution}
```

- `[ex:label]` is mandatory (compile error without it). Place it anywhere.
- The PDF keeps your placement; the web moves each solution under its
  exercise. A solutions section left empty is dropped from the page, so don't
  `\cref` it from prose.
- Collapsed on the web, hidden in the PDF by `\solutionsfalse`, stripped from
  `-nosol` downloads.
- MDX: `<Solution>…</Solution>`

## Solutions-only content

```latex
\begin{solutionsonly}
\textbf{Instructor note.} Discuss \cref{ex:gibbs-hard} on the board first.
\end{solutionsonly}
```

- Only in the with-solutions build. No box, heading or binding; renders where
  written.
- Removed from every `-nosol` download (PDF, `.tex`, `.mdx`); hidden by
  `\solutionsfalse` or `[nosolutions]`.
- Use instead of `\ifsolutions…\fi`, which the web ignores.

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

- In both PDFs; absent from the web page, sidebar, anchors and `.mdx`
  downloads.
- Main use: the header of a collected solutions section, which would point at
  nothing on the web once its solutions relocate. Nested as above, it appears
  only in the with-solutions PDF.
- `\cref`s inside `pdfonly` are fine. A `\cref` from outside into it is a
  dead web link; the build warns.
- Numbering stays faithful: the web reads numbers from the `.aux`, so hiding
  Theorem 2.4 leaves a gap (2.3, 2.5).

## Hints

```latex
\begin{hint}
Consider $f(t) = t - 1 - \log t$.
\end{hint}
```

- Unnumbered, unlabelled, renders where written.
- PDF: bold "Hint:". Web: collapsible.
- Survives `\solutionsfalse` and `-nosol`.
- MDX: `<Hint>…</Hint>`

## Learning outcomes and summary

The summary goes in the `%--- iliad ---` block at the top of `main.tex`, as a
YAML folded scalar (continuation lines indented two spaces after `% `):

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

Longer sheets can group them under `\subsection*{...}`, each with an `itemize`:

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

- Summary → page lede and index blurb. `learningoutcomes` → "What you'll
  learn" box, placed after Prerequisites (see "Front matter opens the sheet").
- A legacy body `\begin{summary}` still converts; frontmatter `summary:` wins.
- MDX: `summary:` in frontmatter; `<LearningOutcomes>` around a markdown
  list. Group headings become bold lines (no anchor, not in the ToC).
- Missing, empty or `TODO` summary: non-fatal warning.

## Table of contents

```latex
\tableofcontents   % usually right after \maketitle
```

- Optional. Web: a **Contents** list linking every section level, numbered as
  the headings (`1`, `1.1`, `4.2.1`).
- Omits sections emptied by relocation (e.g. a `Solutions` appendix) and the
  References list.
- MDX sheets: no ToC; rely on the sidebar.

## Front matter opens the sheet

Every sheet opens:

1. **Overview**: the metadata `summary:`, shown under the title. Keep it one
   paragraph. A body `## Overview` is allowed and counts as content.
2. **Video embeds** (optional): see "Videos".
3. **Prerequisites**: an ordinary section.
4. **Learning outcomes**: the `learningoutcomes` box.

Then the content. The build warns (non-fatal) if items 2–4 are out of order.
Videos later in the content are exempt.

## Further reading goes last

"Further reading" / "Learn more" is the last section: after all content,
before the references or `\appendix`.

## Theorem family

```latex
\begin{definition}[entropy]
\label{def:entropy}
The \emph{entropy} of $p$ is …
\end{definition}
```

- `definition`, `theorem`, `lemma`, `proposition`, `corollary`, `fact`,
  `example` share one per-section counter. `proof` collapses on the web.
- Optional argument: name/attribution, may contain math. Web lead:
  "**Lemma 2.2 (Gibbs' inequality).**"
- MDX: `<Definition id="def-entropy">**Definition 2.1 (entropy).** …</Definition>`,
  `<Theorem id="thm-gibbs">**Lemma 2.2 (Gibbs).** …</Theorem>`.

## Callouts and remarks

```latex
\begin{callout}[warning]
\label{co:pitfall}
Don't confuse $\log$ bases here.
\end{callout}

\begin{callout}[tip][Observation return]
$$ G_{\mathrm{obs}}(\vec s) = \mathbb{E}_{\vec s' \sim \mathcal{B}(\cdot \mid \vec O(\vec s))}[G(\vec s')] $$
\end{callout}

\begin{remark}[optional title]
An aside in the mathematical register.
\end{remark}
```

- Types: `note` (default), `tip`, `warning` (`[boxes]`).
- Second optional argument: title. Replaces the type word on the PDF frame;
  heads the box on the web. Plain text only: put a maths heading as a bold
  first line instead.
- `\begin{remark}[Encodings]` renders "Remark (Encodings)".
- Both can be labelled: no number shown, but `\cref{co:pitfall}` prints
  "Callout 2.1".
- MDX: `<Callout type="warning" id="co-pitfall">…</Callout>`,
  `<Callout type="tip" title="Observation return">…</Callout>`

## Math, macros, cross-references

- `$…$`, `\[…\]`, `equation`, `align`: KaTeX on the web.
- Preamble `\newcommand`s / `\DeclareMathOperator`s become KaTeX macros.
  Avoid `\mathchoice` and optional-argument macros; untranslatable ones warn
  at `file.tex:line`.
- `\cref`/`\Cref` print what LaTeX prints, for every labelled thing.
- Use `\cref` or `\eqref`. Plain `\ref`, or `\hyperref` text hand-writing
  "Appendix A", draws an advisory. `\ref*` inside `\hyperref` text is fine.
- Literal dollar: `\$` in `.tex` and `.mdx` (`\$1,000`); two bare `$` in a
  paragraph become a math span. Inside math use `\char36`.

## Figures

```latex
\begin{figure}[ht]
  \centering
  \includegraphics[width=0.45\linewidth]{fig/value-curve.pdf}
  \caption{An example figure.}
  \label{fig:value}
\end{figure}
```

- PDF figures in `fig/` become SVG on the web. `.svg`, `.png` etc. are served
  as-is.
- Inline `tikzpicture`/`tikzcd` works.
- MDX: `<Figure src="/uploads/your-slug/value-curve.svg" caption="…" />`

## Videos

```latex
\youtube{dQw4w9WgXcQ}                          % title auto-queried from YouTube
\youtube[What is a neural network?]{aircAruvnKk}   % title set by hand
```

- Argument: the 11-character video ID. A full URL warns and breaks the embed.
- Web: player plus "Watch on YouTube ↗" link. Without `[Title]`, the title
  comes from oEmbed (cached in `content/modules/.video-titles.json`); on
  failure the embed is untitled and CI warns.
- PDF: a **Video:** line with the watch URL.
- Block-level: put it between paragraphs.
- MDX: `<YouTube id="aircAruvnKk" title="…" />`
- Lecture recordings go before Prerequisites; illustrative videos anywhere.

## Notebooks

Built from master `.py` files beside `main.tex` (`tex/<slug>/<name>.py`); see
[`NOTEBOOKS.md`](NOTEBOOKS.md).

```latex
\notebooknosol{compact_proofs}                        % without solutions: "Open in Colab"
\notebooksol[the worked solutions]{compact_proofs}    % with solutions, own link text
\notebooknosol{worst-case-interp/compact_proofs}      % another module's notebook
```

- Inline links; also work in decks loading `iliad-slides.sty`.
- Build fails if `<name>.py` doesn't exist.
- Both versions always publish (identical if no exercise markers).
- Each notebook also gets a **Notebook** download row automatically, following
  the "with solutions" checkbox.
- MDX: `<NotebookNoSol name="compact_proofs" />`,
  `<NotebookSol name="compact_proofs">the worked solutions</NotebookSol>`.

## Slides

```
tex/<slug>/slides.tex          # any self-contained LaTeX (usually beamer)
tex/<slug>/slides-<label>.tex  # further decks — a day with more than one lecture
tex/<slug>/slides.typ          # …or a deck written in Typst (same stems, .typ)
```

- `slides.tex` → `slides.pdf` (same `pdflatex`/`bibtex` ladder as the
  worksheet), shown as a **Slides** row (view, download PDF, `.tex`). A
  compile error fails the build.
- **Several decks**: add `slides-<label>.tex` (lowercase, digits, hyphens; not
  ending `-handout`). Each stages as `<slug>-slides-<label>.pdf/.tex` with its
  own row: `slides.tex` first, then filename order. With several rows, each
  is labelled by its `\title{}`. `slides.tex` itself is optional.
- **Naming a deck's row**: decks sharing a `\title{}` can set `title:` (the
  only deck key) in a metadata block:
  ```latex
  %--- iliad ---
  % title: 2. Predicting the future
  %--- end ---
  \documentclass[aspectratio=169]{beamer}
  ```
- **Handout variant**: a deck mentioning `\HANDOUT` also builds
  `slides-handout.pdf` (`slides-<label>-handout.pdf`); its row reads
  *present · handout · LaTeX*.
  ```latex
  \ifdefined\HANDOUT\PassOptionsToClass{handout}{beamer}\fi
  \documentclass[10pt,aspectratio=169]{beamer}
  ```
  By hand:
  ```
  pdflatex slides.tex                                  # presentation
  pdflatex -jobname=slides-handout "\def\HANDOUT{}\input{slides}"   # handout
  ```
- `iliad.sty` is not loaded for slides.
- **Optional shared style** `tex/iliad-slides.sty`: Madrid theme, maths and
  graphics packages, readable link colours, `\citev`. Load after
  `\documentclass`, local copy first:
  ```latex
  \ifdefined\HANDOUT\PassOptionsToClass{handout}{beamer}\fi
  \documentclass[10pt,aspectratio=169]{beamer}
  \IfFileExists{iliad-slides.sty}{\usepackage{iliad-slides}}{\usepackage{../iliad-slides}}
  ```
  The `\HANDOUT` line must precede `\documentclass`. Not enforced
  (`tex/training-dynamics/slides.tex` uses moloch).
- **Typst decks** ([Typst](https://typst.app)): `slides.typ`,
  `slides-<label>.typ`.
  - One `typst compile`; row offers PDF and `.typ`; label from
    `#set document(title: "…")`; no handout.
  - `slides.tex` and `slides.typ` together fail the build.
  - Images in `fig/`, relative paths (`#image("fig/diagram.svg")`).
  - `--ignore-system-fonts`: only bundled fonts (Libertinus, New Computer
    Modern, DejaVu Sans Mono). Extra fonts go in `tex/<slug>/fonts/`
    (`--font-path`).
  - `./setup.sh` installs the pinned binary (`scripts/install-typst.sh`).
- No MDX conversion, no `-nosol` variant.
- **PDF-only deck**: don't commit it. Host it (e.g. Drive) and link it:
  ```
  %--- iliad ---
  % slides: https://drive.google.com/…
  %--- end ---
  ```
  Renders as a **Slides ↗** row listed first, alongside compiled decks. With
  several rows, give it a title:
  ```
  %--- iliad ---
  % slides:
  %   url: https://drive.google.com/…
  %   title: Intro to Reward Learning Theory
  %--- end ---
  ```
- No `slides*.tex`/`slides*.typ` → non-fatal warning (even with a `slides:`
  URL) in the full build and `./run.sh ci`, not in `--check`.
- Day with no worksheet yet: put `slides:` on the day in
  [`schedule.yaml`](../schedule.yaml). Hidden once a worksheet offers a deck.

## Which teaching day is this? (not your file's business)

Cluster, day and order live in [`schedule.yaml`](../schedule.yaml):

```yaml
      - code: D.3
        title: AIXI
        worksheets:
          - solomonoff-induction    # order here is the order on the site
          - aixi
```

- Add your slug under its day. The homepage, sidebar and
  [`/admin/status`](https://iliad-intensive.org/admin/status/) follow; the
  build stamps `cluster:`/`day:` in.
- `cluster:` or `day:` in your frontmatter **fails the build**.
- An unlisted worksheet **fails the build**. `unlisted: true` opts out (format
  demo only).

## Citations

Entries in your folder's `biblo.bib`; `\cite{Shannon:48}` etc., with
`\bibliography{biblo}` and a style at the end.

- Web: author-year text linking to a References list at the page bottom.
  Entries with `url` or arXiv `eprint` get an outbound title link.
- `\bibliographystyle` affects the PDF only; the web is always author-year.
- `\citet` stays textual; `\cite`, `\citep`, `\citealp`, `\citetext` are
  parenthesized.
- Any bibtex failure (except "no bibliography") is fatal, since otherwise
  every `\cite` silently becomes `[?]`.
- `alphaurl` is vendored at `tex/alphaurl.bst` (via `BSTINPUTS`). For other
  styles outside base TeX Live, vendor the `.bst` rather than add an apt
  package. Per-worksheet `.bst` works (`tex/singular-learning-theory/far.bst`).

## Inline marks

- `\hint{…}` → *[Hint: …]* — `\note{…}` → *[Note: …]*
- `\important` after an exercise's label → ★ (the sheet's key exercises)

## Footnotes

- `\footnote{…}` → web footnote with links both ways, numbered per page.
- `\footnotemark` … `\footnotetext{…}` works (e.g. in a theorem title:
  `\begin{definition}[Covering\protect\footnotemark]`). Mark first; an orphan
  `\footnotetext` stays inline and warns.
- Multi-paragraph footnotes are joined into one paragraph on the web.
- Footnotes in a `solution` are stripped from `-nosol`.

## Writing in MDX instead

`main.mdx` replaces `main.tex`:

- Frontmatter: `title` (required), `summary`, `contributors`.
- `$…$`/`$$…$$` math and the components above.
- **No PDF.** Downloads are Markdown only (± solutions).
- Copied verbatim to `content/modules/<slug>.mdx` and served as the page.

### Teaching notes: `<TeachingNote>` (MDX only)

For material aimed at whoever teaches the day:

```mdx
<TeachingNote title="Session intent">

The participants understand that there are different things we may want our
AIs to be aligned *to*, and can reason through …

</TeachingNote>

<TeachingNote title="Teaching notes">   {/* the default title is "Teaching note" */}

I was thinking about including Gwern's article on Tool AI's, but it's very
verbose, so I opted for Rohin's article instead.

</TeachingNote>
```

- Collapsed; `title` labels it. Blank lines around the body.
- Port `**Session intent:** The participants …` as
  `<TeachingNote title="Session intent">The participants …`.
- Don't use a `Callout`; this carries `data-component="teaching-note"`.
  Survives `-nosol`.
- LaTeX: `\begin{teachingnote}[Session intent] … \end{teachingnote}`. PDF:
  dashed box headed by the title.

### Heading levels: `##` is the top

| LaTeX | MDX |
| :--- | :--- |
| `\section` | `##` |
| `\subsection` | `###` |
| `\subsubsection` | `####` |

- **Never `#`**: the frontmatter `title` is the h1.
- Don't number headings by hand.
- Don't use a bold line in place of a heading.

### Comments: `{/* … */}`

```mdx
{/* # Roadmap for today */}
{/* parked until the author confirms the timetable */}
```

`<!-- … -->` is a compile error:

    MDX compile: FAIL :: Unexpected character `!` (U+0021) before name …
      (note: to create a comment in MDX, use `{/* text */}`)

Comments ship in the `.mdx` download; delete parked content before shipping.

### GFM: footnotes and tables

`remark-gfm` is loaded:

```mdx
The claim holds for finite horizons.[^horizon]

[^horizon]: It fails for $m = \infty$; see the appendix.
```

Any label works. A reference with no definition renders as literal
`[^horizon]` without failing the build.

### Frontmatter

`cluster:` or `day:` is a hard build failure:

    main.mdx frontmatter sets `day` — that lives in schedule.yaml (list the
    slug under its day) and is stamped in at build time

A new MDX module is the file plus its slug in `schedule.yaml`.

### Check it

    node scripts/tex2mdx/tex2mdx-check.mjs tex/<slug>/main.mdx   # the render gate alone, ~1s
    node scripts/build-content.mjs --check <slug>                # + the frontmatter/schedule rules
    node scripts/build-content.mjs <slug>                        # + staged downloads

Expect `MDX compile: OK` and `0 errored` KaTeX spans. Only `--check` catches
frontmatter/schedule errors.
