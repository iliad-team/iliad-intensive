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

```latex
\begin{summary}
One paragraph on what this sheet is about.
\end{summary}

\begin{learningoutcomes}
  \item First outcome.
  \item Second outcome.
\end{learningoutcomes}
```

- `summary` becomes the page's lede and its index blurb (italic block in
  the PDF); `learningoutcomes` renders as the "What you'll learn" box where
  you put it — both usually sit right after `\maketitle`.
- MDX: put `summary:` in the YAML frontmatter; `<LearningOutcomes>` with a
  markdown list inside.

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

\begin{remark}
An aside in the mathematical register.
\end{remark}
```

- Types: `note` (default), `tip`, `warning` — coloured boxes on web + PDF
  (`[boxes]`).
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

## Citations

Entries go in your folder's `biblo.bib`; `\cite{Shannon:48}` etc. as normal
(`\bibliography{biblo}` + a style at the end of the sheet). On the web,
citations render as author-year text linking to an anchored entry in a
References list at the bottom of the page; there, an entry with a `url`
(or arXiv `eprint`) field makes its title the outbound link. Citations
never link straight out of the page.

## Inline marks

- `\hint{…}` → *[Hint: …]* — `\note{…}` → *[Note: …]*
- `\important` after an exercise's label → ★ (the sheet's key exercises)
- Footnotes render inline in parentheses on the web.

## Writing in MDX instead

`main.mdx` replaces `main.tex` entirely: YAML frontmatter (`title`,
`cluster`, `summary`, `contributors` — `title` required, there's no
`\title{}` to fall back on), KaTeX math with `$…$`/`$$…$$`, and the JSX
components named above. The PDF is generated by pandoc; downloads offer
PDF + Markdown (no LaTeX). Everything else — downloads variants, the index,
the render gate — works identically.
