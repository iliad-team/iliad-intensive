# Iliad Intensive worksheets

You write LaTeX; the machinery does the rest. Each folder in `tex/` becomes
a page on the course site, a PDF (with and without solutions), and per-page
downloads. Only your `.tex`, `biblo.bib`, and `fig/` go in git — never build
outputs.

## Start a worksheet

    cp -r tex/template tex/your-slug      # folder name = the page's URL slug

Your folder sits next to the one shared style file:

    tex/
      iliad.sty          shared style — never edit or copy it
      your-slug/
        main.tex         your worksheet   (\usepackage[boxes]{../iliad})
        biblo.bib        your bibliography
        fig/             your figures, exported to PDF

`tex/template/main.tex` is the living example — every supported construct,
with comments. Read it side by side with its rendered page.

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
  **Markdown** — no LaTeX download for MDX-authored sheets.

## The contract

Everything not listed here is a free zone: arbitrary notation, extra
packages, custom macros (they become web math macros automatically).

1. **The `%--- iliad ---` block** at the top of `main.tex` (YAML, in
   comments) carries `title`, `cluster`, `summary`, `contributors`.
   Nothing is mandatory — `title` and `contributors` fall back to
   `\title{}`/`\author{}` (an explicit key wins), and a missing title,
   cluster, or contributors draws a build advisory, not a failure.
   Everything else — prerequisites, reading lists, difficulty notes —
   is normal LaTeX in the body.
2. **`\usepackage[boxes]{../iliad}` is the one required package.** It
   provides the environments below plus `\ifsolutions`, hyperref,
   cleveref. Don't re-load hyperref; configure it with `\hypersetup{}`.
3. **Exercises**: `\begin{exercise}[Optional Title]`, optionally marked
   `\skippable`. Give every exercise a `\label` — unlabelled exercises get
   no stable link and no solution can reference them.
4. **Solutions**: `\begin{solution}[ex:your-label]` — naming the exercise
   is mandatory. Solutions render collapsed on the site and are dropped
   from the no-solutions PDF.
5. **Learning outcomes**: `\begin{learningoutcomes} \item … \end{learningoutcomes}`,
   usually right after `\maketitle` — a "What you'll learn" box in both
   the PDF and the site.
6. **Other semantic blocks**: `definition`, `theorem`, `lemma`,
   `proposition`, `corollary`, `fact`, `example`, `proof`, `remark`,
   `callout[note|tip|warning]`. `\label` goes on its own line right after
   `\begin{…}`. Never `\renewcommand` these names.
7. **Figures**: export to PDF into your `fig/`, then a normal `figure` +
   `\includegraphics{fig/name.pdf}` + `\caption` + `\label`. Inline
   `tikzpicture`/`tikzcd` is also converted automatically.
8. **Citations**: entries in your `biblo.bib`, cite normally.

## Check your work

    cd tex/your-slug
    pdflatex main.tex && bibtex main && pdflatex main.tex && pdflatex main.tex

The PDF is ground truth for your content. If you have Node ≥ 20, you can
also run the exact web-conversion gate CI runs:

    node scripts/build-content.mjs --check --only your-slug

It prints `file:line` for anything it can't translate. No Node? Just open
the PR — CI runs the same gate.

## Preview the website locally (optional)

One-time install:

1. **TeX Live** (you have it if `pdflatex` runs) and **poppler-utils**
   (`pdftocairo`, for figure/diagram SVGs):
   `sudo apt install texlive-latex-extra texlive-pictures texlive-science poppler-utils`
2. **pandoc** — only needed for MDX-authored sheets' PDFs: `sudo apt install pandoc`
3. **Node ≥ 20.9** — easiest via [nvm](https://github.com/nvm-sh/nvm):
   `nvm install 22`. (The repo's `./run` wrapper auto-selects it afterwards,
   from any shell including fish.)
4. In the repo root: `npm install`

Then the edit loop is:

    node scripts/build-content.mjs --only your-slug   # source → page (+ your PDF)
    ./run                                             # dev server → http://localhost:3000

Edit your `main.tex`/`main.mdx`, re-run the first line, refresh the browser.
What you see is exactly what deploys — same converter, same renderer.
(`./run content` rebuilds every worksheet at once.)

## Publish

Branch, commit your folder, open a PR. Green CI + merge to `main` = live on
the site minutes later.

---
*Maintainer & pipeline docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)*
