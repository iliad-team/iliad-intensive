# Iliad Intensive worksheets

You write LaTeX; the machinery does the rest. Each folder in `tex/` becomes
a page on the course site plus per-page downloads — PDF, LaTeX, and
Markdown, each in a with-solutions and a solutions-stripped variant (the
stripped ones are safe to hand out or paste into an LLM). Only your `.tex`,
`biblo.bib`, and `fig/` go in git — never build outputs.

## Start a worksheet

    cp -r tex/example tex/your-slug       # folder name = the page's URL slug

Your folder sits next to the one shared style file:

    tex/
      iliad.sty          shared style — never edit or copy it
      your-slug/
        main.tex         your worksheet   (\usepackage[boxes]{../iliad})
        biblo.bib        your bibliography
        fig/             your figures, exported to PDF

`tex/example/main.tex` is the living example — every supported construct,
with comments. Read it side by side with its rendered page.

Working **outside the repo** (your own machine, Overleaf)? Put a copy of
`iliad.sty` next to your `main.tex` — it looks there first, then one level
up. Don't commit that copy (the repo gitignores it): inside the repo,
everyone builds against the shared `tex/iliad.sty`.

## Prefer Markdown to LaTeX?

Author `tex/your-slug/main.mdx` instead of `main.tex` — it is served as the
page directly, no conversion. Rules:

- Start with a `---` YAML frontmatter block (`title`, `cluster`, `summary`,
  `contributors` — same keys as the LaTeX block, and here `title` is
  required since there's no `\title{}` to fall back on).
- Math is KaTeX: `$inline$` and `$$display$$`.
- The site components are available as JSX:
  `<Exercise id="…">`, `<Solution>`, `<Callout type="note|tip|warning">`,
  `<Definition term="…">`, `<Theorem kind="…">`, `<LearningOutcomes>`,
  `<Figure src="/uploads/your-slug/name.svg" caption="…" />`.
- Figures still live in `fig/` (PDFs are converted to SVG; svg/png copy
  through) and are referenced as `/uploads/your-slug/<name>.svg`.
- Downloads offered: **PDF** (generated from your markdown via pandoc) and
  **Markdown**, each with the with/without-solutions toggle — no LaTeX
  download for MDX-authored sheets.

## The contract

Everything not listed here is a free zone: arbitrary notation, extra
packages, custom macros (they become web math macros automatically).

1. **Your LaTeX is the source of the page metadata**: the title comes from
   `\title{}`, the byline from `\author{}` (affiliations supported:
   `\authorname{Ada}\\ \affiliation{Somewhere}` renders "Ada (Somewhere)"),
   and the lede from `\begin{summary}…\end{summary}`. The
   **`%--- iliad ---` block** (YAML, in comments) is for simple one-line
   values only — usually just `cluster:` — and an explicit key there
   overrides the extracted value. Nothing is mandatory; missing
   title/cluster/contributors draw a build advisory, not a failure.
   Everything else — prerequisites, reading lists, difficulty notes —
   is normal LaTeX in the body.
2. **`\usepackage[boxes]{../iliad}` is the one required package.** It
   provides the environments below plus `\ifsolutions`, hyperref,
   cleveref. Don't re-load hyperref; configure it with `\hypersetup{}`.
3. **Exercises**: `\begin{exercise}[Optional Title]`, optionally marked
   `\important` (a ★ flagging the sheet's key exercises). Give every
   exercise a `\label` — unlabelled exercises get no stable link and no
   solution can reference them.
4. **Solutions**: `\begin{solution}[ex:your-label]` — naming the exercise
   is mandatory. Solutions render collapsed on the site and are dropped
   from the no-solutions PDF.
5. **Learning outcomes**: `\begin{learningoutcomes} \item … \end{learningoutcomes}`,
   usually right after `\maketitle` — a "What you'll learn" box in both
   the PDF and the site.
6. **Other semantic blocks**: `definition`, `theorem`, `lemma`,
   `proposition`, `corollary`, `fact`, `example`, `proof`, `remark`,
   `callout[note|tip|warning]`. All of them — callouts and remarks
   included — can be `\label`ed and `\cref`ed. Put the `\label` anywhere at
   the top level of the environment (right after `\begin{…}` is clearest).
   Never `\renewcommand` these names.
7. **Figures**: export to PDF into your `fig/`, then a normal `figure` +
   `\includegraphics{fig/name.pdf}` + `\caption` + `\label`. Inline
   `tikzpicture`/`tikzcd` is also converted automatically.
8. **Citations**: entries in your `biblo.bib`, cite normally.

## Check your work

    cd tex/your-slug
    pdflatex main.tex && bibtex main && pdflatex main.tex && pdflatex main.tex

The PDF is ground truth for your content. If you have Node ≥ 20, you can
also run the exact web-conversion gate CI runs:

    ./run content --check your-slug

It prints `file:line` for anything it can't translate. No Node? Just open
the PR — CI runs the same gate.

## Preview the website locally (optional)

One-time install — from the repo root:

    ./setup        # TeX Live + poppler + pandoc (apt), Node 22 (nvm), npm deps

Then live authoring is one command:

    ./run watch your-slug     # dev server + rebuild on every save

Edit `main.tex`/`main.mdx`, save, refresh http://localhost:3000 — what you
see is exactly what deploys (same converter, same renderer). Other commands:

    ./run content your-slug   # one full worksheet build: page + PDFs + downloads
    ./run content             # build everything
    ./run ci                  # exactly what GitHub CI runs; exit 0 = CI green
    ./run --help              # the rest

Errors and warnings carry `file.tex:line` locations wherever the converter
can know them; PDF compile failures quote the first `!` line of the LaTeX
log plus the log path.

## Publish

Branch, commit your folder, open a PR. Green CI + merge to `main` = live on
the site minutes later.

---
*Maintainer & pipeline docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)*
