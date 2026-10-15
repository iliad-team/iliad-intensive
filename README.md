# Iliad Intensive worksheets

The worksheets for [ILIAD](https://iliad.ac)'s intensive course.

**Live site: [iliad-intensive.org](https://iliad-intensive.org/)**

Feedback welcome! I want friction for you as the writer to be as low as possible. If something is frustrating, [open an issue](https://github.com/iliad-team/iliad-intensive/issues) and let me know!

[Project Board](https://github.com/orgs/iliad-team/projects/7/views/1)

## Setup (one-time)

```
git clone --single-branch --branch main git@github.com:iliad-team/iliad-intensive.git
cd iliad-intensive
./setup.sh
```

Works on Linux (apt) and macOS on a Mac, `setup.sh` hands off to
`setup-macos.sh`, which installs the same toolchain via Homebrew and MacTeX
(install [Homebrew](https://brew.sh) first). 

Windows is not yet supported
([#60](https://github.com/iliad-team/iliad-intensive/issues/60)).

## Render the website

```
./run.sh watch name-of-your-material
```

`./run.sh slugs` shows you the name of all worksheets.

See `./run.sh --help` for details.
`./run.sh ci` runs the CI action as if you had pushed to the repo; with a slug
(`./run.sh ci my-slug`) only that worksheet's content is rebuilt first, which is
the quick way to check one sheet.

## Material status

**[iliad-intensive.org/admin/status](https://iliad-intensive.org/admin/status/)**

Shows existing status of material on main (so can easily spot what is missing),
pulls from [`schedule.yaml`](schedule.yaml).

## Folder structure

Each folder in `tex/` represents a page on the course site.
Structure folder as follows:
```
name-of-my-material/
├── fig
│   └── ... # figures
├── biblo.bib
├── slides.[tex|typ]   # optional slide deck in LaTeX or Typst.
├── slides-<label>.[tex|typ]   # further decks, for a day with more than one lecture
└── main.[tex|mdx]
```

You can write either in LaTeX or Markdown, as you prefer.
Import `tex/iliad-slides.sty` which defines the environments for theorem/definition/etc.

## Start a new worksheet

```
cp -r tex/example tex/name-of-your-material
```
`tex/example/main.tex` includes an example of every supported construct
that is defined in `iliad.sty`. See `docs/iliad-sty.md` for more details.
You can then edit the copy of the template directly.

## LaTeX Format

1. **Metadata**: `\title`, `\author`, the `%--- iliad ---` block (summary,
   slides URL) and learning outcomes. See [`docs/latex_format.md`](docs/latex_format.md).

2. **Commands**: See `docs/commands.md` for details.
* Exercises: `\begin{exercise}[Optional Title]\label{ex:your-label} ... \end{exercise}`
  - Labels are optional if no solutions are provided.
* Solutions: `\begin{solution}[ex:your-label] ... \end{solution}`
  - Label is mandatory to pair with the exercise.
* Other semantic blocks: `definition`, `theorem`, `lemma`,
  `proposition`, `corollary`, `fact`, `example`, `proof`, `remark`,
  `callout[note|tip|warning][Title]`. All of them can be `\label`ed and `\cref`ed. 
* Figures: export to PDF into your `fig/`, then a normal `figure` +
  `\includegraphics{fig/name.pdf}` + `\caption` + `\label`. 
* Citations: entries in `biblo.bib`, cite normally.

## How to contribute

* I just want to give content
   - Open a new thread in the [`intensive-writers`](https://discord.com/channels/1376305163777605774/1536756690454585364) in the Discord (someone from ILIAD should send you an invite.)
* I want to port it myself
   - Make a branch e.g. `d.3-aixi-port`, work in your branch, commit your changes, open a PR to `main`, and an ILIAD admin will merge it into the main branch.
* I don't like github/I have my own workflow.
   - If you prefer to work in Overleaf, you can fork the repo, and then 
[sync your fork](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization) to Overleaf. PR to upstream when ready.
* If you've got your own setup, work as your normally do, and then ask in the Discord the best way to port it.

---
*Maintainer & pipeline docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)*
