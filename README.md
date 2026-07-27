# Iliad Intensive worksheets

**Live site: [iliad-team.github.io/iliad-intensive](https://iliad-team.github.io/iliad-intensive/)**

Feedback welcome! I want friction for you as the writer to be as low as possible. If something is frustrating, [open an issue](https://github.com/iliad-team/iliad-intensive/issues) and let me know!

[Project Board](https://github.com/orgs/iliad-team/projects/7/views/1)

## Setup (one-time)

```
git clone git@github.com:iliad-team/iliad-intensive.git
cd iliad-intensive
chmod +x setup.sh
./setup.sh
```

## Render the website

```
./run.sh watch name-of-your-material
```

Edit `main.tex`/`main.mdx`, save, refresh, see http://localhost:3000

See `./run.sh --help` for details.
`./run.sh ci` runs the CI action as if you had pushed to the repo.

## Material status

**[iliad-team.github.io/iliad-intensive/admin/status](https://iliad-team.github.io/iliad-intensive/admin/status/)**
— one row per teaching day: is the worksheet live, is there a deck, the day's
Google-Doc tab, and where its source is. Every push rebuilds it, so it always
describes the site as deployed.

Most of that table is *observed*, not maintained: a day's material and slides
columns come from what the build actually produced. So there is no status to
remember to update after you port a day — you add one line to your own
worksheet's `%--- iliad ---` block naming its day, and the row fills itself in:

```
%--- iliad ---
% day: B.4
%--- end ---
```

Two worksheets may name the same day; both show up in its row. A `day:` code
that no day owns fails the build, so a typo can't quietly orphan your page.

The hand-kept half is [`content/days.yml`](content/days.yml): the day roster
itself (code, title, lead, Doc tab) and, for days nobody has ported yet, where
the source is — plus a `slides:` URL for a deck that only exists as a PDF
someone handed you. Edit that file to add a day or update a source; the file's
own comments document every field. It feeds a public page, so keep chase-ups
and anything unflattering out of it.

## Folder structure

Each folder in `tex/` represents a page on the course site.
Structure folder as follows:
```
name-of-my-material/
├── fig
│   └── ... # figures
├── biblo.bib
├── slides.tex   # optional slide deck — compiled to a hosted PDF
└── main.[tex|mdx]
```

You can write either in LaTeX or Markdown, as you prefer.
The main file for the material is `main.[tex|mdx]` (`.tex` files are converted
to `mdx` by the repo's own converter, `scripts/tex2mdx/`; pandoc is only used
to build the PDF of Markdown-authored sheets).
Slides are optional. Drop a `slides.tex` (any self-contained LaTeX — beamer is
the usual choice; `iliad.sty` is *not* loaded for slides) in the folder and the
build compiles it to a PDF hosted next to the worksheet — the page grows a
**Slides** row (view / download the PDF, download the `.tex`). Slides are never
converted to Markdown (a deck is a download, not a web page). If your deck only
exists as a PDF with no source, don't commit the binary — host it (Drive, etc.)
and add a `slides:` line to the `%--- iliad ---` block (see below); it renders
as an outbound link instead. The build prints a (non-fatal) advisory for any
worksheet with no `slides.tex`.

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
    * A `summary: >-` key in the `%--- iliad ---` metadata block summarizes the
    material, and is displayed in the page index and under the page title:
      ```
      %--- iliad ---
      % cluster: B
      % summary: >-
      %   One paragraph on what this sheet is about, indented two spaces
      %   after the `% `; line breaks fold into spaces.
      %--- end ---
      ```
    * ```
       \begin{learningoutcomes}
       \begin{itemize}
       \item ...
       \item ...
       \end{itemize}
       \end{learningoutcomes}
      ```
      lists the learning outcomes of the material; renders as a
      "What you'll learn" box wherever you put it (usually right after
      `\maketitle`). For a longer sheet, group the outcomes under
      `\subsection*{...}` headings, each followed by its own `itemize`.
    * The `%--- iliad ---` comment block at the very top of `main.tex` holds
      simple one-line YAML values — usually just the cluster the page is
      grouped under:
      ```
      %--- iliad ---
      % cluster: D
      %--- end ---
      ```
      `title:`, `summary:`, and `contributors:` keys are also accepted there
      and override whatever is extracted from the LaTeX. A `slides:` key holds
      the URL of an externally hosted deck (for a PDF-only deck with no source);
      it renders as an outbound link and is superseded by a compiled `slides.tex`.
      A `day:` key names the teaching day this sheet is the material for
      (`% day: B.4`, a code from `content/days.yml`) — that one line is what
      files it on the [status page](#material-status).

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

## How to contribute

* I just want to give content for David to port
   - Open an issue, label it with your day of content e.g "[D.3] port over AIXI material" and point to whereever the content lives and I'll handle it
* I want to port it myself
   - Make a branch e.g. `d.3-aixi-port`, work in your branch, commit your changes, open a PR to `main`, and David will merge it into the main branch.
* I don't like github/I have my own workflow.
   - If you prefer to work in Overleaf, you can fork the repo, and then 
[sync your fork](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization) to Overleaf. PR to upstream when ready.
   - If you've got your own setup, work as your normally do, and then open an issue, or just email me `davidq@iliad.ac` with the subject `ILIAD intensive [X.Y]` that contains a `.zip` of the tex/markdown/whatever source and I'll handle it.

---
*Maintainer & pipeline docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)*
