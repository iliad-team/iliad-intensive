# Notebooks — design

**Status: built** (branch `notebooks-claude`, 2026-09-23), with E.3 as the first
module moved in. Designed in discussion with David on 2026-09-23.

## Goal

Host the Colab notebooks that are generated purely from Python in this repo, so all of
a day's material — worksheet, slides, figures, notebooks — lives in `tex/<slug>/`.

- **In scope now:** D.2 (`iliad-team/iliad-intensive-D.2`, goal misgeneralisation) and
  E.3 (`iliad-team/iliad-intensive-E.3`, compact proofs). Both already use the ARENA
  master-file generator and publish to an orphan `build` branch in their own repos.
- **Later:** C.3, whose notebooks come from its own `build_notebooks.py`. It can join
  once the pipeline below exists, as a second generator step.
- **Out of scope:** C.1.1 and C.2. Their notebooks are hand-maintained `.ipynb` with
  their own tooling, and stay in their own repos.

## Principles

1. **Same repo.** One PR carries a change to a day's worksheet and its notebook. No
   second clone, no second review.
2. **The master `.py` is the only ground truth.** Notebooks never enter git. A local
   `.ipynb` is built for editing, but an edit only counts once it has been synced back
   into the `.py`.
3. **No command can silently destroy work.** There is no direction flag to get wrong.
   The tool works out what changed, and refuses when both sides did.
4. **Authors face as few rules as possible.** Any notebook converts, including a demo
   notebook someone brings from elsewhere. ARENA's conventions are optional markup.
5. **Outputs are never kept.** Rerunning a cell regenerates them, and dropping them is
   what keeps the diffs readable.
6. **Published notebooks contain only global URLs.** Relative paths and embedded base64
   exist only locally.

## Layout

```
tex/
  iliad.sty
  gen_notebooks.py           # the shared generator (standard library only)
  <slug>/
    main.tex | main.mdx      # worksheet, as today
    slides*.tex              # decks, as today
    compact_proofs.py        # a master; its filename is the notebook's name
    max_of_k.py              # another master: another notebook
    compact_proofs.ipynb     # local only, gitignored (one per master)
    fig/                     # ALL images: worksheet, slides and notebooks (Git LFS)
    support/                 # modules shipped next to the notebooks (tests.py, utils.py, …)
```

- **A master** is a `.py` directly in `tex/<slug>/` whose first line is
  `# ! CELL TYPE:`. There is no naming rule; the tool writes that header itself when it
  imports a plain notebook. Any other `.py` there is left alone.
- **Each master is its own notebook.** A slug can have any number.
- **Master names** become file and link names, so the tool rejects names with spaces, or
  ending in `_sol`/`_nosol`, with a suggested fix.
- **Helper modules** the notebooks import go in `support/`. A helper next to `main.tex`
  would not ship with the notebooks. `support/` is published as-is next to the
  notebooks, so a package inside it (`support/part6_goalmisgen/`) keeps its import name.
  Binaries in it (images a module loads) go through LFS, like `fig/`.
- **Support modules on Colab and locally.** When a module has `support/` or a solutions
  module, every published notebook gets a second cell, after the header, that on Colab
  sparse-clones the notebook's folder from the `notebooks` branch (its PR preview's folder,
  in a preview) and puts it on `sys.path`. The local editing notebook instead starts with
  a marked cell putting `build/notebooks/<slug>/` on `sys.path`. That's where the
  published copy of `support/` and the solutions module sit after every run of the
  tool, and the cell is skipped when syncing back.
- **Solutions module.** A master whose support code imports ARENA's solutions module
  (D.2's `tests.py` does, to test students' answers against the reference) names it on a
  `# ! SOLUTIONS: part6_goalmisgen/solutions.py` line at the top. The tool then also
  publishes that file: every solution and `py`-filtered code cell as plain Python,
  exactly as ARENA's generator wrote it (checked byte-for-byte against D.2's old build).
- **`fig/` is shared.** It is already LFS-tracked at any depth for every image format
  (`.gitattributes`), so notebook images need no new rule, and one image can serve the
  worksheet, a deck and a notebook.

### Keeping the two builds apart

A master edit must never recompile a PDF, and a `.tex` edit must never regenerate a
notebook.

- **Worksheet hash** (`worksheetHash` in `scripts/build-content.mjs`) skips: masters
  (matched by their first line), `*.ipynb`, the tool's stamp files, and `support/`.
  Masters are matched by content rather than skipping all `*.py`, so a `.py` that a
  worksheet pulls in with `\inputminted` (none does today) would still count.
  `fig/` stays in the hash, so an image change rebuilds that day's PDF — correct, since
  the worksheet may use it.
- **`scripts/watch.mjs`** ignores the same files.
- **Notebook workflow** triggers only on
  `tex/*/*.py`, `tex/*/fig/**`, `tex/*/support/**`, `tex/gen_notebooks.py` and the
  workflow file. A figure change regenerates notebooks too; publishing takes seconds.
- **`.gitignore`** gains `tex/*/*.ipynb` and the stamp files.
- **`.githooks/pre-commit`** rejects any `.ipynb` under `tex/`.

## The master file format

The ARENA master format:

```python
# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## Some heading

![Trade-off between proof length and bound](fig/trade-off.png)
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

import torch as t
```

- **It is valid Python.** Headers are comments, markdown cells are raw string literals,
  and magics are commented out. `ast.parse` accepts the current E.3 master. The
  extension stays `.py`, so editors, linters and formatters work.
- **Splitting a master into cells is purely textual**, on the `# ! CELL TYPE` lines, so
  a code cell with a syntax error still round-trips.

**Optional markup**, meaningful only when present:

| Markup | Effect |
|---|---|
| `# EXERCISE` … `# END EXERCISE` / `# SOLUTION` … `# END SOLUTION` in a code cell | The `_nosol` and `_sol` notebooks differ |
| `# ! FILTERS: [colab]`, `[~colab]`, … | Cell appears only in some outputs |
| `# ! TAGS: [master-comment]` | Cell is commented out in the master, live in the notebook (used for `%pip` setup cells) |

**Both notebooks are always published.** A master with no exercise markers publishes
two identical files, so both link commands are always valid and authors never need to
know whether their notebook has a split.

**ARENA requirements that are dropped:**
- the section-list first markdown cell, which the generator `eval()`s for the Streamlit
  contents page;
- the whole Streamlit page generator;
- the `### Exercise` + `Difficulty: 🔴` + `Importance: 🔵` cell format;
- the `[X.Y]` title regex;
- `config.yaml`: names come from the slug and the master's filename.

## Workflow

One command, whichever way you work:

```bash
./run.sh notebooks <slug>    # wraps python3 tex/gen_notebooks.py <slug>
```

It handles each master in the slug independently, each with its own stamp, and does
three things:
1. Syncs each `<name>.py` with its local `<name>.ipynb`, in whichever direction the
   [sync table](#sync-safety) says.
2. Imports any `.ipynb` in the folder that has no `.py` yet.
3. Writes the published `_nosol`/`_sol` notebooks into gitignored `build/notebooks/<slug>/`,
   so they can be opened and run locally.

A conflict in one pair stops only that pair. The others still sync, and the command
exits non-zero listing what conflicted.

### Editing the master

Edit `compact_proofs.py`, run the command, open `build/notebooks/<slug>/compact_proofs_sol.ipynb`
to run the solutions. Commit the `.py`.

### Editing the notebook locally (Jupyter, VS Code)

Run the command once to get `compact_proofs.ipynb`. Edit it and run cells as normal.
Run the command again: the edits are written into the `.py`. Commit the `.py`. The
author never reads or writes the master format.

### Editing in Colab

Upload the local `compact_proofs.ipynb` to Colab and edit it there. Download it back over
`tex/<slug>/compact_proofs.ipynb` and run the command. The base hash in the notebook's
metadata records which `.py` it came from, so this is a clean sync, not a conflict.
(Depends on Colab keeping notebook metadata on download — see
[Open questions](#open-questions).)

### Bringing an existing notebook

Drop `demo.ipynb` and its folders (images, data) into `tex/<slug>/`, run the command.
`demo.py` is created. Then:

| In the brought notebook | What happens |
|---|---|
| Markdown/HTML image link to a local file (`![…](images/foo.png)`) | File copied into `fig/`, link rewritten. Already named, so alt text is not needed |
| Embedded image (`data:` URI, cell attachment) | Extracted to `fig/`, named from its alt text; **error if it has none** |
| Code that opens a local file (`Image(filename="img/x.png")`, `pd.read_csv("data.csv")`) | Not rewritten. **Warning:** "cell 19 reads img/x.png, which won't exist on Colab". Fix: a markdown image, or move the file into `support/` |
| Outputs | Dropped |

The brought folders can be deleted once the import succeeds.

### Adding an image

Save the file into `fig/` and write, in a markdown cell,
`![what it shows](fig/trade-off.png)` or
`<img src="fig/trade-off.png" width="500" alt="what it shows">`.
LFS stores it on commit.

### Removing a notebook

Delete its `.py` (and its local `.ipynb`). A leftover `.ipynb` whose `.py` has gone is
reported as an orphan and **not** re-imported, so a deleted notebook doesn't come back.
An `.ipynb` is imported only when it has no stamp, i.e. it was never generated here.

### Rules for authors, in full

- Images live in `fig/` and have alt text.
- Commit the `.py`, never the `.ipynb` (the pre-commit hook enforces this).

## Linking from worksheets and slides

| | LaTeX (worksheets and decks) | MDX |
|---|---|---|
| Without solutions | `\notebooknosol{compact_proofs}` | `<NotebookNoSol name="compact_proofs" />` |
| With solutions | `\notebooksol{compact_proofs}` | `<NotebookSol name="compact_proofs" />` |
| Custom link text | `\notebooksol[the worked solutions]{compact_proofs}` | `<NotebookSol name="compact_proofs">the worked solutions</NotebookSol>` |
| Another day's notebook | `\notebooknosol{worst-case-interp/compact_proofs}` | `<NotebookNoSol name="worst-case-interp/compact_proofs" />` |

(Underscores cannot appear in LaTeX command names, hence `\notebooknosol`, not
`\notebook_nosol`. `nosol` matches the build's existing `main-nosol.pdf`.)

- **LaTeX:** `iliad.sty` and `iliad-slides.sty` (a copy, since a deck may not load
  `iliad.sty`) define both commands. `build-content.mjs` runs pdflatex as
  `\def\iliadslug{<slug>}\input{…}`, so the PDF links work. Default link text is
  "Open in Colab" / "Open in Colab (solutions)".
- **Conversion:** `tex2mdx` turns both commands into the MDX tags, so hand-written `.mdx`
  and converted `.tex` end up in the same place.
- **Resolution:** `build-content.mjs` replaces the tags with plain markdown links right
  after stamping the schedule, before the render gate and the downloads. The site needs
  no component, and worksheet pages still ship no React.
- **Checking:** the build fails if a name doesn't match a master. The list of master
  names is part of the worksheet hash, so adding or removing a notebook re-checks its
  own module's sheet; editing one doesn't.
- **Keep in step:** the Colab URL is built in four places that must agree —
  `COLAB_URL` in `tex/gen_notebooks.py` and `scripts/build-content.mjs`, and
  `\iliad@notebook` in the two `.sty` files. (Today's hard-coded links mix `blob/main`
  and `blob/build` across the day repos.)

**On the page:** every notebook also gets a **Notebook** row in the page's downloads
block, next to Slides, with a `colab ↗` link. It follows the "with solutions" checkbox
like the worksheet downloads do. Several notebooks are labelled by their first heading.
The build writes the list to `content/notebooks.json` on every run.

Resolved link:
`https://colab.research.google.com/github/iliad-team/iliad-intensive/blob/notebooks/<slug>/<name>_{nosol,sol}.ipynb`

## Sync safety

### State

- **A stamp per master:** `tex/<slug>/.<name>.sync` (gitignored): the hash of the `.py`,
  the hash of what the notebook converts to, and the notebook's base hash, as they were
  after the last successful sync.
- **A base hash inside the notebook:** `metadata.iliad.base` is the hash of the `.py`
  the notebook was generated from. Jupyter and VS Code keep notebook metadata on save.

"The notebook changed" means *what it converts to* changed. Running cells (outputs,
execution counts) or re-saving in another editor is not a change.

### Decision table

| Situation | Action |
|---|---|
| No `.py`, notebook never synced here | **import**: create the `.py` from the notebook |
| No `.py`, notebook has a stamp | **orphan**: warn, do nothing (a deleted master stays deleted) |
| `.py`, no notebook | build the notebook |
| Notebook converts to exactly the `.py` | nothing (restamp) |
| Neither changed since the stamp | nothing |
| Only the `.py` changed | rebuild the notebook from the `.py` |
| The notebook changed, and it **descends from the current `.py`** | carry the edit into the `.py` |
| Anything else | **conflict** |

A notebook descends from the current `.py` when its base hash is the current `.py`'s
hash (it was built from it: the local and Colab round trips), or when it is the
notebook the last sync accepted and the `.py` hasn't changed since.

That rule covers the trap a stamp alone misses. A notebook is open in Jupyter, the
`.py` is edited and synced (rebuilding the notebook), then Jupyter autosaves its stale
copy back. The notebook now looks like the only side that changed, and carrying it
across would silently undo the `.py` edit. Its base hash is the old `.py`'s, so the tool
refuses.

After carrying a notebook edit into the `.py`, the notebook is left as it is, outputs
and all, so an open editor isn't disturbed.

**On conflict:** write nothing to the `.py` or the `.ipynb`. Save the notebook's version
as `<name>.from-notebook.py` (gitignored) for diffing and merging by hand, and exit
non-zero. Other masters in the same run still sync.

**Before overwriting a notebook,** move the old one to `tex/<slug>/.trash/` (gitignored,
last 5 kept). The `.py` needs no backup: it is in git.

**Layout normalisation:** the `.py` is rewritten into the canonical layout (blank lines
between cells and so on) whenever it is the source, as ARENA's py → ipynb → py did.
Content never changes.

## Round-trip rules

Converting `.py` → `.ipynb` → `.py` gives back the `.py` exactly, once it is in the
canonical layout. Converting `.ipynb` → `.py` → `.ipynb` gives back the notebook exactly,
ignoring outputs, execution counts and image embedding.

| Notebook contents | In the `.py` |
|---|---|
| Markdown and raw cells | `r'''…'''`, with any `'''` in the text escaped as `\'\'\'` (ARENA's rule) |
| A cell's filters/tags | ARENA's `# ! FILTERS: […]` / `# ! TAGS: […]` header; in the notebook, the cell's first lines (`# FILTERS: …`), as ARENA's master notebook had them |
| `%pip`, `!cmd`, `%%bash`, `%%writefile` | Prefixed with `#%! ` (every line, for a cell magic), removed again on the way back and in the published notebooks. A comment the author wrote is never uncommented |
| Code with syntax errors | Unchanged |
| Empty cells | Kept (dropped from the published notebooks) |
| `raw` cells | Kept, as `# ! CELL TYPE: raw` |
| A line starting `# ! CELL TYPE:` inside a cell | Error: it would split the master there |
| Notebook metadata Colab relies on (`accelerator`, `colab.gpuType`) | A `# ! NOTEBOOK: {…}` first line |
| The solutions-module setting (`metadata.iliad.solutions` in the local notebook) | A `# ! SOLUTIONS: <path>` line at the top |
| The local notebook's `sys.path` cell | Skipped (marked as generated) |
| Outputs, execution counts | Dropped |
| Images | See [Images](#images) |

## Images

### Findings (Colab test, 2026-09-23)

| Embedding in a markdown cell | Colab |
|---|---|
| markdown `![alt](attachment:…)` | not displayed |
| HTML `<img src="attachment:…">` | not displayed |
| markdown `![alt](data:image/png;base64,…)` | displayed |
| HTML `<img src="data:…" width="300">` | displayed, width honoured |
| markdown `![alt](https://…)` | displayed |

Neither Colab nor VS Code inserted anything when an image was pasted or dragged into a
markdown cell. Authors add an image by saving the file into `fig/` and writing the link.

### The four forms of one image

| Where | Form |
|---|---|
| `.py` (committed) | `![Alt text](fig/name.png)` or `<img src="fig/name.png" width="…" alt="Alt text">` — paths relative to the slug folder |
| `fig/name.png` (committed) | the image, in Git LFS |
| Local `.ipynb` | same tag, `src` replaced by a `data:` URI; other attributes kept |
| Published notebook | same tag, `src` replaced by `https://iliad-intensive.org/uploads/<slug>/nb/name.png` |

The local notebook embeds images so it also displays correctly when uploaded to Colab.

### Notebook → `.py`

- A `data:` image whose bytes match a file in `fig/` goes back to that file's link.
  Matching by bytes, not by name, makes the round trip exact.
- A `fig/…` link written into the notebook by hand passes through unchanged. Conversion
  fails if the file doesn't exist.
- A link to a local file outside `fig/` (a brought notebook's `images/foo.png`) is copied
  into `fig/` under its own filename and rewritten.
- A `data:` image or `attachment:` with bytes not in `fig/` is extracted to
  `fig/<slug of alt text>.<ext>`. **Conversion fails if the image has no name**: missing
  or empty alt text, or an editor default (`image.png`, `image`). The error names the cell
  and shows the fix, e.g. `cell 14: image has no name — write ![what it shows](…)`.
- **A new image is never written over an existing file.** `fig/` is shared with the
  worksheet, so a name collision with different bytes is an error: "fig/trade-off.png
  already exists with different content — rename the image's alt text, or replace the
  file directly". Replacing a figure is always done by hand.
- Two different new images with the same name in one sync: error.
- A notebook referencing a PDF in `fig/`: error (notebooks can't display PDFs).

### Other files in `fig/` (HTML demos)

A self-contained web page can live in `fig/` too: D.2's pottery-shop game is
`fig/play.html`. The site build copies `.html` from `fig/` like an image, to
`/uploads/<slug>/play.html`, which the slides link. A notebook links it as
`[play the pottery shop](fig/play.html)`, and publishing rewrites a plain link into `fig/`
the same way it rewrites an image (to `/uploads/<slug>/nb/…`, or the PR preview's copy).
The file must not load anything relative to itself; `play.html` loads nothing at all.

Images may be deleted. A deleted image breaks any notebook still pointing at it,
including copies students saved, and that is accepted.

## Publishing

### The notebook branches

Build output only, each kept at a single orphan commit (every publish replaces it):

```
notebooks          <slug>/<name>_{nosol,sol}.ipynb, <slug>/<support modules>
                   production: written only by a push to main
notebooks-pr-<N>   the same layout, PR <N>'s preview: written only by that PR's
                   runs, deleted when the PR closes
```

**A PR never writes production.** PR workflows run the PR's own code, including its
own copy of the publish script, so under a shared branch a buggy PR could damage the
live notebooks before review. Here a PR can only ever touch its own branch. The script
also refuses `production` unless the run is on `main`. That guards against mistakes, not
malice: anyone who can push a branch here can already edit workflows.

**No branch has two writers,** so there is no locking and no retrying: a run just
force-pushes its branch. Concurrency groups are per PR (a newer push supersedes an older
one) and one for `main`. Deliberately not one group shared by all: GitHub cancels an
older *pending* run in a group, which could silently drop a production publish.

Every write goes through `.github/notebooks-branch.sh` (`production`, `preview <N>`,
`remove <N>`, `sweep`). Deleting a branch doesn't free space at once: GitHub
garbage-collects unreferenced objects in its own time. The branches are small anyway
(about 500 KB of notebooks), and clones skip them (README: `^refs/heads/notebooks` and
`^refs/heads/notebooks-pr-*`, exact so that source branches like `notebooks-fix` still
fetch).

### Notebooks — `.github/workflows/notebooks.yml`

- **Push to `main`** (path-filtered to masters, `fig/`, `support/`, the generator):
  `gen_notebooks.py --publish`, checks, then `notebooks-branch.sh production` → `notebooks`.
- **Every same-repo PR** (no path filter): `gen_notebooks.py --publish --preview <N>`,
  checks, `notebooks-branch.sh preview <N>` → `notebooks-pr-<N>`, and one upserted PR comment listing each
  notebook's Colab links. It runs for every PR, not only notebook ones, because the
  PR's site preview links these notebooks either way. It takes seconds.
- **Fork PRs** build and check but cannot publish (read-only token). Their site preview
  links production's notebooks instead.
- **PR closed** (`pull_request_target`, checks out `main` only, never the PR): `remove <N>`
  deletes `notebooks-pr-<N>`.
- **Weekly** (Mondays): `sweep` deletes the `notebooks-pr-*` branches of PRs that are no longer open, the
  backstop for a missed close event.
- `--publish` only reads `.py` files and writes `build/notebooks/`; it never touches a
  local `.ipynb`, so CI cannot destroy anything. Checks: every notebook parses as JSON,
  and no `data:`, `attachment:` or `fig/` image source remains.
- Support modules reach Colab through the fetch cell the generator adds (see
  [Layout](#layout)); a master needs no clone code of its own.
- Checks out with LFS, so binaries in `support/` are published as real files.

### The header cell

Every published notebook, both versions, starts with one markdown cell built from
[`tex/notebook-header.md`](../tex/notebook-header.md), a shared template: edit it to
change every notebook. It links the worksheet page the notebook belongs to (the URL and
day label come from `schedule.yaml`), the ILIAD Intensive site, and both versions of the
notebook, and says which version this is. It is added at publish time only, so it never
enters a master or the local editing notebook.

`gen_notebooks.py` reads `schedule.yaml` with a small reader of its own, to stay
standard-library only. It was checked against `scripts/schedule.mjs` for every scheduled
worksheet (2026-09-23), and `scripts/schedule.mjs --check`, the first step of `./run.sh ci`, fails
the build if they ever disagree. Then fix the Python one.

### Images — the existing site build

- `scripts/build-content.mjs` copies the `fig/` images the slug's masters reference into
  `public/uploads/<slug>/nb/`. The CI checkout already fetches LFS, so these are real
  files, served by GitHub Pages at `https://iliad-intensive.org/uploads/<slug>/nb/…`
  (Cloudflare is DNS-only for the site, so there is no CDN cache in front).
- This copy is not part of `worksheetHash`.
- Image fetches hit GitHub Pages, not LFS, so they cost no LFS bandwidth.
- The two workflows run independently, so for a few minutes after a merge a new
  notebook may point at an image the site has not deployed yet. It fixes itself when
  the site deploy finishes.

### PR previews

A same-repo PR previews its notebooks end to end:

| | Production | PR `<N>` preview |
|---|---|---|
| Notebooks (Colab) | `…/blob/notebooks/<slug>/…` | `…/blob/notebooks-pr-<N>/<slug>/…` |
| Images | `iliad-intensive.org/uploads/<slug>/nb/…` | `iliad-intensive.org/pr-preview/pr-<N>/uploads/<slug>/nb/…` |
| Worksheet links (`\notebooksol`, web and PDF) | production notebooks | the PR's notebooks |

- `gen_notebooks.py --preview <N>` builds the PR's notebooks with the preview's Colab
  URLs (branch `notebooks-pr-<N>`, which its fetch cell also clones) and image URLs.
- `site.yml` sets `NOTEBOOK_PREVIEW_PR` for a same-repo PR's build, so
  `build-content.mjs` points the site preview's notebook links at the PR's notebooks, and
  pdflatex gets `\iliadnbbranch` (`notebooks-pr-<N>`) for the PDFs.
- A sheet that links notebooks has the notebooks branch in its worksheet hash, so a
  preview never reuses production's cached page, or the reverse. Sheets without notebook
  links are unaffected and stay cached.
- `scripts/prune-preview.mjs` keeps `uploads/<slug>/nb/` for every module, including
  ones the PR didn't touch. The preview's notebooks link every module's images under the
  preview, and it's only a few PNGs per module.

## Migration

**E.3 — done** on this branch:

1. `tex/worst-case-interp/compact_proofs.py`: E.3's master at `origin/master` 6e225d4,
   transformed by script (two changes): the first cell dropped (ARENA's Streamlit
   section list), and the four diagram URLs pointed at `fig/`.
2. The four PNGs copied into `tex/worst-case-interp/fig/` (LFS).
3. `main.mdx`'s two hard-coded Colab links became `<NotebookNoSol name="compact_proofs">`.
4. E.3 has no support modules and no setup-cell clone, so nothing else changed.

After merging, the old repo's `build` branch should stay, and the repo be archived
rather than deleted, so Colab links already shared keep working.

**D.2 — done** (stacked on the previews PR):

1. `tex/policy-gradients-misgeneralization/goal_misgeneralisation.py`: D.2's master at
   `main` 83147cc, transformed by script (three changes): the first cell dropped (the
   Streamlit section list), a `# ! SOLUTIONS: part6_goalmisgen/solutions.py` line added,
   and the setup cell's clone of the old repo's `build` branch removed (the generator's
   fetch cell replaces it; its `%pip install` and widget-manager lines stay).
2. `support/part6_goalmisgen/`: the nine support files from `gen/support/part6_goalmisgen/`,
   unchanged (the two PNGs in LFS).
3. `main.mdx`'s hard-coded Colab link became `<NotebookNoSol name="goal_misgeneralisation">`.
4. Checked: the published notebooks match the old `build` branch cell for cell, apart
   from the header cell, the fetch cell and the trimmed setup cell. `solutions.py` is
   byte-identical, and the support modules and solutions module import from the
   published folder.

Still pointing at the old repo: `slides-goalmisgen.tex` and the notebook link the
pottery-shop game at `iliad-team.github.io/iliad-intensive-D.2/play.html`, served by
that repo's Pages. Archiving the repo keeps it served. Its `goalmisgen-2.6-*` branches are
fully merged into its `main` (checked 2026-09-23); its orphan `notebooks` branch is stale
output.

## Generator

`tex/gen_notebooks.py`: one file, standard library only, about 900 lines. The cell
format and the exercise machinery are ARENA's (`gen/core/` in E.3 and D.2, 9 files,
about 1,970 lines, ported function by function), trimmed to the two Colab outputs.

**Kept from ARENA,** because E.3 and D.2 use them: cell filters (`colab`, `ex`, `soln`,
`~…`, inline `FILTERS: … END FILTERS`), `EXERCISE`/`SOLUTION`/`HIDE` blocks, the
solution dropdown placed in the next markdown cell, the `master-comment`, `main`,
`keep-main` and `html` tags, `if MAIN:` and `FLAG_` stripping, `# COLAB-SPLIT`, the
`(exercises)`/`(solutions)` title suffix on the first `# `
heading (only when the master has a split; the header cell now carries the Colab links), and learning objectives copied from a
"Content & Learning Objectives" cell under each section heading.

**Dropped:** Streamlit pages, ruff formatting, `config.yaml`, and
every *required* structure (section-list first cell, `[X.Y]` title, `# Introduction`
cell, exercise-cell format). Also the hard-coded "Part of the ILIAD Intensive course
material…" line both old generators put under the title; a master that wants it
writes it.

**Checked against the old output:** E.3's master (and D.2's, in a scratch copy) give the
same notebooks as their repos' `build` branches, cell for cell, except that one line.

## Tests

`tex/test_gen_notebooks.py` (`./run.sh test-notebooks`) tests the generator itself.
It's standard library only and takes about 2 seconds. Nothing runs it automatically:
run it after changing `gen_notebooks.py`. It works in a throwaway copy, so it never
touches `tex/` or your local notebooks. Two groups:

- **scenarios:** a scratch module taken through every row of the sync table
  (including the stale-autosave conflict, the Colab round trip and a deleted master);
  importing an arbitrary notebook (magics, cell magics, empty/raw/broken cells, embedded
  and local images, a CSV read, GPU metadata); image naming and collisions; the exercise
  split; the solutions module, `support/` and the fetch/path cells; `--preview`.
- **real masters:** every master in the repo is committed in canonical layout,
  round-trips `.py` → local notebook → `.py` exactly, and publishes both versions (and a
  PR preview) with only global URLs.

Separately, `./run.sh ci` (so every CI build) starts with `node scripts/schedule.mjs
--check`. It validates `schedule.yaml` with the real parser, and checks that the
generator's own small reader agrees on every page URL. Either failure stops the build
before anything compiles.

## Open questions

- **Does Colab keep notebook metadata on download?** The Colab editing workflow relies on
  `metadata.iliad.base` surviving. If it doesn't, a notebook edited in Colab reports a
  conflict (safe, but not smooth).
- **Where C.3's generator fits:** a second step in `notebooks.yml`, or ported onto the
  master format.
