# Iliad Intensive worksheets

## Folder structure

Each folder in `tex/` represents a page on the course site.
Structure folder as follows:
```
name-of-my-material/
├── fig
│   └── ... # figures
├── biblo.bib
├── slides.[tex|mdx|pdf]
└── main.[tex|mdx]
```

You can write either in LaTeX or Markdown, as you prefer.
The main file for the material is `main.[tex|mdx]` (`.tex` files are converted
to `mdx` by the repo's own converter, `scripts/tex2mdx/`; pandoc is only used
to build the PDF of Markdown-authored sheets).
The slides for the material are `slides.[tex|mdx|pdf]`. Avoid using PDF slides,
ideally write LaTeX slides using beamer (Google Slides are annoying with math
and not machine-readable). *(Slides are not built by the pipeline yet.)*

## Start a worksheet

```
cp -r tex/example tex/name-of-your-material
```
`tex/example/main.tex` includes an example of every supported construct
that is defined in `iliad.sty`. See `docs/iliad-sty.md` for more details.

## LaTeX Format

1. **Required metadata** (the build warns if missing, but never fails):
   * `\title{}`
   * `\author{}` 
    - * affiliations supported:
    ```
    \author{
      \authorname{John Doe}\\
      \affiliation{Nowhere University}
      \and
      \authorname{Jane Doe}\\
      \affiliation{Institute of Science}
      \and
      ... % more authors
    }
    ```

2. **Optional metadata**:
    * `\begin{summary} ... \end{summary}` summarizes the material, and is extracted
    and displayed in the page index and under the page title.
    * ```
       \begin{learningoutcomes} 
       \item ...
       \item ... 
       \end{learningoutcomes}
      ``` 
      lists the learning outcomes of the material; renders as a
      "What you'll learn" box wherever you put it (usually right after
      `\maketitle`).
    * The `%--- iliad ---` comment block at the very top of `main.tex` holds
      simple one-line YAML values — usually just the cluster the page is
      grouped under:
      ```
      %--- iliad ---
      % cluster: D
      %--- end ---
      ```
      `title:`, `summary:`, and `contributors:` keys are also accepted there
      and override whatever is extracted from the LaTeX.

3. **Commands**: See `docs/commands.md` for details.
* Exercises: `\begin{exercise}[Optional Title]\label{ex:your-label} ... \end{exercise}`
  - Labels are optional if no solutions are provided.
* Solutions: `\begin{solution}[ex:your-label] ... \end{solution}`
  - Label is mandatory to pair with the exercise.
* Other semantic blocks: `definition`, `theorem`, `lemma`,
  `proposition`, `corollary`, `fact`, `example`, `proof`, `remark`,
  `callout[note|tip|warning]`. All of them can be `\label`ed and `\cref`ed. 
* Figures: export to PDF into your `fig/`, then a normal `figure` +
  `\includegraphics{fig/name.pdf}` + `\caption` + `\label`. 
* Citations: entries in `biblo.bib`, cite normally.

## Preview the website locally

One-time install — from the repo root:
```
    ./setup        # TeX Live + poppler + pandoc (apt), Node 22 (nvm), npm deps
```
Then live authoring is one command:
```
    ./run watch your-slug     # dev server + rebuild on every save
```
Edit `main.tex`/`main.mdx`, save, refresh http://localhost:3000

Before opening a PR, `./run ci` runs exactly what GitHub CI will (all PDFs,
conversion, render gate, site build); `./run --help` lists the rest.
Errors and warnings carry `file.tex:line` locations wherever the converter
can know them.

## How to contribute

Make a branch, work in your branch, commit your changes, open a PR to `main`,
and David will merge it into the main branch.

If you prefer to work in Overleaf, you can fork the repo, and then 
[sync your fork](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization) to Overleaf. PR to upstream when ready. 

---
*Maintainer & pipeline docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)*