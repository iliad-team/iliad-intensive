# Notebooks — design

Built 2026-09-23 (branch `notebooks-claude`). E.3 and D.2 are moved in.

## Goal

Generate Colab notebooks from Python masters in `tex/<slug>/`, next to the day's
worksheet, slides and figures.

- **In scope:** D.2 (`iliad-team/iliad-intensive-D.2`) and E.3
  (`iliad-team/iliad-intensive-E.3`), which used ARENA's master-file generator and an
  orphan `build` branch in their own repos.
- **Later:** C.3 (own `build_notebooks.py`), as a second generator step.
- **Out of scope:** C.1.1 and C.2 (hand-maintained `.ipynb`; stay in their own repos).

## Principles

1. One PR carries a worksheet change and its notebook.
2. **The master `.py` is the only ground truth.** Notebooks never enter git; a local
   `.ipynb` edit counts only once synced into the `.py`.
3. No command silently destroys work. No direction flag: the tool detects which side
   changed and refuses if both did.
4. Any notebook converts. ARENA conventions are optional markup.
5. Outputs are never kept.
6. Published notebooks contain only global URLs; relative paths and base64 are local only.

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

- **Master:** a `.py` directly in `tex/<slug>/` whose first line is `# ! CELL TYPE:`.
  Other `.py` files are ignored. Any number per slug; one notebook each.
- **Names** become file and link names; spaces and a `_sol`/`_nosol` suffix are rejected.
- **Helper modules** go in `support/` (a helper beside `main.tex` won't ship). It is
  published as-is, so a package (`support/part6_goalmisgen/`) keeps its import name.
  Binaries in it use LFS.
- **Fetch cell:** if a module has `support/` or a solutions module, each published
  notebook gets a second cell that sparse-clones its folder from the `notebooks` branch
  (or the PR preview's) onto `sys.path`. The local notebook instead starts with a marked
  cell adding `build/notebooks/<slug>/` to `sys.path`; sync-back skips it.
- **Solutions module:** if support code imports ARENA's solutions module (D.2's
  `tests.py` does), add `# ! SOLUTIONS: part6_goalmisgen/solutions.py` at the top. The
  tool publishes it: every solution and `py`-filtered cell as plain Python,
  byte-identical to ARENA's output.
- **`fig/` is shared** and already LFS-tracked for every image format at any depth.

### Keeping the two builds apart

A master edit must never recompile a PDF; a `.tex` edit must never regenerate a notebook.

- `worksheetHash` (`scripts/build-content.mjs`) skips masters (matched by first line,
  so an `\inputminted` `.py` still counts), `*.ipynb`, stamp files and `support/`.
  `fig/` stays in.
- `scripts/watch.mjs` ignores the same files.
- The notebook workflow triggers only on `tex/*/*.py`, `tex/*/fig/**`,
  `tex/*/support/**`, `tex/gen_notebooks.py` and the workflow file.
- `.gitignore` has `tex/*/*.ipynb` and the stamp files.
- `.githooks/pre-commit` rejects any `.ipynb` under `tex/`.

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

Valid Python (headers are comments, markdown is raw strings, magics are commented out).
Cells split textually on `# ! CELL TYPE`, so syntax errors still round-trip.

**Optional markup:**

| Markup | Effect |
|---|---|
| `# EXERCISE` … `# END EXERCISE` / `# SOLUTION` … `# END SOLUTION` in a code cell | `_nosol` and `_sol` differ |
| `# ! FILTERS: [colab]`, `[~colab]`, … | Cell appears only in some outputs |
| `# ! TAGS: [master-comment]` | Commented out in the master, live in the notebook (`%pip` setup cells) |

`_nosol` and `_sol` are always both published (identical without exercise markers).

**ARENA requirements dropped:** the section-list first cell, the Streamlit generator,
the `### Exercise` + `Difficulty: 🔴` + `Importance: 🔵` format, the `[X.Y]` title
regex, and `config.yaml` (names come from slug and filename).

## Workflow

```bash
./run.sh notebooks <slug>    # wraps python3 tex/gen_notebooks.py <slug>
```

Per master, independently:
1. Syncs `<name>.py` with `<name>.ipynb` per the [sync table](#sync-safety).
2. Imports any `.ipynb` with no `.py`.
3. Writes `_nosol`/`_sol` notebooks to gitignored `build/notebooks/<slug>/`.

A conflict stops only that pair; exit is non-zero.

### Editing the master

Edit `compact_proofs.py`, run the command, run
`build/notebooks/<slug>/compact_proofs_sol.ipynb`. Commit the `.py`.

### Editing the notebook locally (Jupyter, VS Code)

Run the command, edit `compact_proofs.ipynb`, run the command again. Commit the `.py`.

### Editing in Colab

Upload `compact_proofs.ipynb`, edit, download it back over
`tex/<slug>/compact_proofs.ipynb`, run the command. The metadata base hash makes this a
clean sync, if Colab keeps metadata (see [Open questions](#open-questions)).

### Bringing an existing notebook

Drop `demo.ipynb` and its folders into `tex/<slug>/` and run the command; `demo.py` is
created. Delete the brought folders afterwards.

| In the brought notebook | What happens |
|---|---|
| Image link to a local file (`![…](images/foo.png)`) | Copied into `fig/`, link rewritten |
| Embedded image (`data:` URI, attachment) | Extracted to `fig/`, named from alt text; **error if none** |
| Code opening a local file (`Image(filename="img/x.png")`, `pd.read_csv("data.csv")`) | Not rewritten; warns "cell 19 reads img/x.png, which won't exist on Colab". Use a markdown image or move the file to `support/` |
| Outputs | Dropped |

### Adding an image

Save it in `fig/`, then in markdown: `![what it shows](fig/trade-off.png)` or
`<img src="fig/trade-off.png" width="500" alt="what it shows">`.

### Removing a notebook

Delete the `.py` and `.ipynb`. A leftover stamped `.ipynb` is reported as an orphan,
not re-imported.

### Rules for authors, in full

- Images live in `fig/` and have alt text.
- Commit the `.py`, never the `.ipynb` (pre-commit hook enforces this).

## Linking from worksheets and slides

| | LaTeX (worksheets and decks) | MDX |
|---|---|---|
| Without solutions | `\notebooknosol{compact_proofs}` | `<NotebookNoSol name="compact_proofs" />` |
| With solutions | `\notebooksol{compact_proofs}` | `<NotebookSol name="compact_proofs" />` |
| Custom link text | `\notebooksol[the worked solutions]{compact_proofs}` | `<NotebookSol name="compact_proofs">the worked solutions</NotebookSol>` |
| Another day's notebook | `\notebooknosol{worst-case-interp/compact_proofs}` | `<NotebookNoSol name="worst-case-interp/compact_proofs" />` |

- **LaTeX:** defined in `iliad.sty` and `iliad-slides.sty` (decks may not load
  `iliad.sty`). pdflatex runs as `\def\iliadslug{<slug>}\input{…}`. Default text: "Open
  in Colab" / "Open in Colab (solutions)".
- `tex2mdx` converts the commands to the MDX tags; `build-content.mjs` resolves the tags
  to plain markdown links after stamping the schedule, before the render gate. No site
  component.
- The build fails on a name with no master. Master names are in the worksheet hash.
- **Keep in step:** the Colab URL is built in four places: `COLAB_URL` in
  `tex/gen_notebooks.py` and `scripts/build-content.mjs`, and `\iliad@notebook` in both
  `.sty` files.

Each notebook gets a **Notebook** row in the page's downloads block with a `colab ↗`
link following the "with solutions" checkbox; several are labelled by first heading.
List written to `content/notebooks.json`.

Resolved link:
`https://colab.research.google.com/github/iliad-team/iliad-intensive/blob/notebooks/<slug>/<name>_{nosol,sol}.ipynb`

## Sync safety

### State

- **Stamp:** `tex/<slug>/.<name>.sync` (gitignored): `.py` hash, hash of what the
  notebook converts to, and the notebook's base hash, as of the last sync.
- **Base hash:** `metadata.iliad.base` in the notebook, the hash of the `.py` it came
  from. Jupyter and VS Code preserve it.

A notebook "changed" only if what it converts to changed; running cells doesn't count.

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

"Descends" means its base hash is the current `.py`'s, or it is the notebook the last
sync accepted and the `.py` is unchanged. This blocks a stale Jupyter autosave from
undoing a `.py` edit.

- After carrying an edit into the `.py`, the notebook is left untouched.
- **On conflict:** nothing written; the notebook's version goes to
  `<name>.from-notebook.py` (gitignored) for manual merging.
- Overwritten notebooks move to `tex/<slug>/.trash/` (gitignored, last 5 kept).
- A `.py` used as source is rewritten into canonical layout; content never changes.

## Round-trip rules

`.py` → `.ipynb` → `.py` is exact once canonical. `.ipynb` → `.py` → `.ipynb` is exact
ignoring outputs, execution counts and image embedding.

| Notebook contents | In the `.py` |
|---|---|
| Markdown and raw cells | `r'''…'''`, `'''` escaped as `\'\'\'` |
| Filters/tags | `# ! FILTERS: […]` / `# ! TAGS: […]` header; in the notebook, the cell's first lines (`# FILTERS: …`) |
| `%pip`, `!cmd`, `%%bash`, `%%writefile` | Every line prefixed `#%! `; stripped on the way back and when publishing. Author comments are never uncommented |
| Code with syntax errors | Unchanged |
| Empty cells | Kept (dropped when publishing) |
| `raw` cells | `# ! CELL TYPE: raw` |
| A line starting `# ! CELL TYPE:` inside a cell | Error |
| Colab metadata (`accelerator`, `colab.gpuType`) | `# ! NOTEBOOK: {…}` first line |
| `metadata.iliad.solutions` | `# ! SOLUTIONS: <path>` at the top |
| The local `sys.path` cell | Skipped |
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

Pasting or dragging an image into a markdown cell does nothing in Colab or VS Code.

### The four forms of one image

| Where | Form |
|---|---|
| `.py` (committed) | `![Alt text](fig/name.png)` or `<img src="fig/name.png" width="…" alt="Alt text">`, relative to the slug folder |
| `fig/name.png` (committed) | the image, in Git LFS |
| Local `.ipynb` | `src` replaced by a `data:` URI (so it works uploaded to Colab) |
| Published notebook | `src` replaced by `https://iliad-intensive.org/uploads/<slug>/nb/name.png` |

### Notebook → `.py`

- `data:` image matching a `fig/` file's bytes → that file's link.
- Hand-written `fig/…` link → unchanged; error if the file is missing.
- Local file outside `fig/` → copied into `fig/` under its own name, link rewritten.
- `data:`/`attachment:` image with new bytes → `fig/<slug of alt text>.<ext>`. **Error
  if unnamed** (missing/empty alt, or `image.png`/`image`):
  `cell 14: image has no name — write ![what it shows](…)`.
- **Never overwrites an existing file.** Same name, different bytes: error ("fig/trade-off.png
  already exists with different content — rename the image's alt text, or replace the
  file directly"). Replace figures by hand.
- Two different new images with one name: error.
- A PDF in `fig/` referenced from a notebook: error.

### Other files in `fig/` (HTML demos)

Self-contained pages can live in `fig/` (D.2's `fig/play.html`). The site build copies
them to `/uploads/<slug>/play.html`. A notebook links `[play the pottery shop](fig/play.html)`;
publishing rewrites it like an image (`/uploads/<slug>/nb/…` or the preview copy). The
page must not load anything relative to itself.

Deleting an image breaks notebooks still using it, including students' copies. Accepted.

## Publishing

### The notebook branches

Each a single orphan commit, replaced on every publish:

```
notebooks          <slug>/<name>_{nosol,sol}.ipynb, <slug>/<support modules>
                   production: written only by a push to main
notebooks-pr-<N>   the same layout, PR <N>'s preview: written only by that PR's
                   runs, deleted when the PR closes
```

- **A PR never writes production.** The script refuses `production` off `main`.
- One writer per branch, so runs just force-push. Concurrency groups: one per PR, one
  for `main`. **Never one shared group**: GitHub cancels older pending runs and could
  drop a production publish.
- All writes go through `.github/notebooks-branch.sh` (`production`, `preview <N>`,
  `remove <N>`, `sweep`).
- Clones skip these branches via `setup.sh` refspecs `^refs/heads/notebooks` and
  `^refs/heads/notebooks-pr-*` (exact, so `notebooks-fix` still fetches).

### Notebooks — `.github/workflows/notebooks.yml`

| Trigger | Does |
|---|---|
| Push to `main` (path-filtered: masters, `fig/`, `support/`, generator) | `gen_notebooks.py --publish`, checks, `notebooks-branch.sh production` → `notebooks` |
| Every same-repo PR (no path filter; the site preview links these) | `--publish --preview <N>`, checks, `preview <N>` → `notebooks-pr-<N>`, one upserted PR comment with Colab links |
| Fork PR | Build and check only (read-only token); site preview links production notebooks |
| PR closed (`pull_request_target`, checks out `main` only) | `remove <N>` |
| Weekly (Mondays) | `sweep` deletes `notebooks-pr-*` of closed PRs |

- `--publish` reads only `.py` and writes `build/notebooks/`; never touches a local
  `.ipynb`.
- Checks: every notebook is valid JSON; no `data:`, `attachment:` or `fig/` image source
  remains.
- Support modules reach Colab via the fetch cell (see [Layout](#layout)).
- Checkout uses LFS, so `support/` binaries publish as real files.

### The header cell

Every published notebook starts with a cell built from
[`tex/notebook-header.md`](../tex/notebook-header.md) (edit it to change all). It links
the worksheet page (URL and day label from `schedule.yaml`), the site and both versions,
and names this version. Added at publish time only.

`gen_notebooks.py` has its own stdlib `schedule.yaml` reader. `scripts/schedule.mjs
--check` (first step of `./run.sh ci`) fails if it disagrees with the real parser; fix
the Python one.

### Images — the existing site build

- `scripts/build-content.mjs` copies `fig/` images referenced by masters to
  `public/uploads/<slug>/nb/`, served by GitHub Pages at
  `https://iliad-intensive.org/uploads/<slug>/nb/…` (Cloudflare DNS-only; no LFS
  bandwidth). Not part of `worksheetHash`.
- The workflows run independently, so a new notebook may briefly point at an image not
  yet deployed.

### PR previews

| | Production | PR `<N>` preview |
|---|---|---|
| Notebooks (Colab) | `…/blob/notebooks/<slug>/…` | `…/blob/notebooks-pr-<N>/<slug>/…` |
| Images | `iliad-intensive.org/uploads/<slug>/nb/…` | `iliad-intensive.org/pr-preview/pr-<N>/uploads/<slug>/nb/…` |
| Worksheet links (`\notebooksol`, web and PDF) | production notebooks | the PR's notebooks |

- `gen_notebooks.py --preview <N>` uses preview Colab URLs (branch `notebooks-pr-<N>`,
  also cloned by the fetch cell) and preview image URLs.
- `site.yml` sets `NOTEBOOK_PREVIEW_PR` for same-repo PRs; `build-content.mjs` then
  points links at the PR's notebooks and passes pdflatex `\iliadnbbranch`
  (`notebooks-pr-<N>`).
- Sheets that link notebooks include the notebooks branch in their worksheet hash, so
  preview and production never share a cached page.
- `scripts/prune-preview.mjs` keeps `uploads/<slug>/nb/` for every module.

## Migration

**E.3 — done.** `tex/worst-case-interp/compact_proofs.py` is E.3's master at
`origin/master` 6e225d4, scripted: first cell (Streamlit section list) dropped, four
diagram URLs pointed at `fig/` (PNGs copied, LFS). `main.mdx`'s two Colab links became
`<NotebookNoSol name="compact_proofs">`. Keep the old repo's `build` branch and archive
(don't delete) the repo, so shared Colab links keep working.

**D.2 — done.**
- `tex/policy-gradients-misgeneralization/goal_misgeneralisation.py` is D.2's master at
  `main` 83147cc, scripted: first cell dropped,
  `# ! SOLUTIONS: part6_goalmisgen/solutions.py` added, setup cell's clone of the old
  `build` branch removed (`%pip install` and widget-manager lines kept).
- `support/part6_goalmisgen/`: the nine files from `gen/support/part6_goalmisgen/`,
  unchanged (two PNGs in LFS).
- `main.mdx`'s Colab link became `<NotebookNoSol name="goal_misgeneralisation">`.
- Verified: matches the old `build` branch cell for cell except header, fetch and setup
  cells; `solutions.py` byte-identical.

Still on the old repo: `slides-goalmisgen.tex` and the notebook link the pottery-shop
game at `iliad-team.github.io/iliad-intensive-D.2/play.html` (archiving keeps Pages
serving it). Its `goalmisgen-2.6-*` branches are merged into its `main`; its orphan
`notebooks` branch is stale.

## Generator

`tex/gen_notebooks.py`: one stdlib-only file, ~900 lines, ported from ARENA's
`gen/core/` and trimmed to the two Colab outputs. Reproduces E.3's and D.2's old `build`
branches cell for cell, minus the title line noted below.

**Kept from ARENA:** cell filters (`colab`, `ex`, `soln`, `~…`, inline
`FILTERS: … END FILTERS`); `EXERCISE`/`SOLUTION`/`HIDE` blocks; solution dropdown in the
next markdown cell; tags `master-comment`, `main`, `keep-main`, `html`; `if MAIN:` and
`FLAG_` stripping; `# COLAB-SPLIT`; `(exercises)`/`(solutions)` suffix on the first `# `
heading (only when split); learning objectives copied from a "Content & Learning
Objectives" cell under each section heading.

**Dropped:** Streamlit pages, ruff formatting, `config.yaml`, all *required* structure
(section-list cell, `[X.Y]` title, `# Introduction` cell, exercise-cell format), and the
"Part of the ILIAD Intensive course material…" title line (write it in the master if
wanted).

## Tests

`tex/test_gen_notebooks.py` (`./run.sh test-notebooks`): stdlib only, ~2 s, runs in a
throwaway copy. **Not run automatically**; run it after changing `gen_notebooks.py`.

- **scenarios:** every sync-table row (incl. stale autosave, Colab round trip, deleted
  master); importing arbitrary notebooks (magics, empty/raw/broken cells, embedded and
  local images, CSV reads, GPU metadata); image naming and collisions; exercise split;
  solutions module, `support/`, fetch/path cells; `--preview`.
- **real masters:** each is committed canonical, round-trips exactly, and publishes both
  versions (and a preview) with only global URLs.

## Open questions

- **Does Colab keep notebook metadata on download?** If not, Colab-edited notebooks
  report a conflict (safe, not smooth).
- **Where C.3's generator fits:** a second step in `notebooks.yml`, or ported onto the
  master format.
