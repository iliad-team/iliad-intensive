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
remember to update after you port a day — you list your slug under its day in
[`schedule.yaml`](schedule.yaml), and the row fills itself in.

That one committed file is the whole hand-kept half, and it is the course: the
clusters, the teaching days (code, title, lead, Doc tab), which worksheets are
each day's material, and — for days nobody has ported yet — where the source
is, plus a `slides:` URL for a deck that only exists as a PDF someone handed
you.

```yaml
      - code: D.3
        title: AIXI
        worksheets:
          - solomonoff-induction    # order here is the order on the site
          - aixi
```

Its order *is* the site's order — clusters, then days, then a day's own
worksheets — on the homepage, in the sidebar, and on the status page. Several
worksheets per day is normal, and the site numbers them from this order: the two
above are shown as **D.3.1** Solomonoff Induction and **D.3.2** AIXI, listed
together under the day, while a day with a single worksheet stays plain **D.3**.
The numbers are display only — the day code you write here, and the one issues
and `/admin/status` use, is always the undotted one.

Run `node scripts/schedule.mjs` to validate the file and print the course as the
site will present it, numbering included; its own comments document every field.
It feeds a public page, so keep chase-ups and anything unflattering out of it.

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
to `mdx` by the repo's own converter, `scripts/tex2mdx/`). A LaTeX sheet also
builds a PDF you can download; a Markdown-authored sheet is a web page only —
no PDF is produced for it.
Slides are optional. Drop a `slides.tex` (any self-contained LaTeX — beamer is
the usual choice; `iliad.sty` is *not* loaded for slides) in the folder and the
build compiles it to a PDF hosted next to the worksheet — the page grows a
**Slides** row (view / download the PDF, download the `.tex`). Slides are never
converted to Markdown (a deck is a download, not a web page). If you'd rather
not write a beamer preamble, `tex/iliad-slides.sty` is a ready-made one you can
load — optional, nothing checks for it (see `docs/commands.md`). If your deck only
exists as a PDF with no source, don't commit the binary — host it (Drive, etc.)
and add a `slides:` line to the `%--- iliad ---` block (see below); it renders
as an outbound link instead. The build prints a (non-fatal) warning for any
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
      "What you'll learn" box wherever you put it (after Prerequisites —
      see `docs/commands.md` §"Front matter opens the sheet" for the fixed
      opening order). For a longer sheet, group the outcomes under
      `\subsection*{...}` headings, each followed by its own `itemize`.
    * The `%--- iliad ---` comment block at the very top of `main.tex` holds
      simple one-line YAML values — usually just the cluster the page is
      grouped under:
      ```
      %--- iliad ---
      % summary: >-
      %   One paragraph on what this sheet is about.
      %--- end ---
      ```
      `title:`, `summary:`, and `contributors:` keys are accepted there
      and override whatever is extracted from the LaTeX. A `slides:` key holds
      the URL of an externally hosted deck (for a PDF-only deck with no source);
      it renders as an outbound link and is superseded by a compiled `slides.tex`.
      Its cluster and teaching day are **not** keys here — list the slug under
      its day in [`schedule.yaml`](schedule.yaml) and the build stamps both in
      (see [status page](#material-status)).

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
