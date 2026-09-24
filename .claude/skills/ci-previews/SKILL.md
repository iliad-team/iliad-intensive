---
name: ci-previews
description: How the site is built, checked and deployed — the site.yml workflow job by job (caches, concurrency keys, env vars), the single gh-pages branch that holds production plus every PR's live preview, the orphan force-push publish script, fork-PR previews via workflow_run and the trust gate, the weekly sweep, the git hooks, the preview banner and its "diff vs main" view. Read this when CI is red, a preview or production deploy didn't appear, before editing anything under .github/ or .githooks/, or when asked how the live preview works.
---

# CI, deploys and PR previews

`docs/PR-PREVIEWS.md` is the design doc and stays authoritative on the *why*;
this skill is the job-by-job mechanics as of 2026-09-22 plus a debugging map.
`docs/website.md` covers DNS/Cloudflare/the custom domain.

## The model

One static export, one branch:

```
gh-pages/                    ← ONE orphan commit, force-pushed on every publish
  index.html, _next/, …      ← production (built from main)
  .nojekyll, CNAME           ← Jekyll off; CNAME comes from public/CNAME
  pr-preview/pr-<N>/…        ← one complete site per open PR, base path /pr-preview/pr-N
```

GitHub Pages serves the branch from `(root)` at `iliad-intensive.org`. Every
writer stages the **whole tree** in `.deploy/` (checkout `gh-pages`, edit only
its own subtree) and hands it to `.github/publish-gh-pages.sh`, which refuses
a tree with no root `index.html`, makes an orphan commit and
`git push --force origin HEAD:gh-pages`. A path missing from `.deploy/` is a
path unpublished — that is why the production deploy deletes everything at the
root *except* `pr-preview/`, and why appending history was abandoned (5.4 GB
across 90 commits). Clones exclude the branch with a negative refspec (README).

The Colab notebooks live on their own orphan branches, one commit each: **`notebooks`**
(production, written only from main) and **`notebooks-pr-<N>`** (a same-repo PR's
preview, written only by that PR, deleted on close). So a PR never writes production,
and no branch has two writers. They're written only by `.github/workflows/notebooks.yml`,
through `.github/notebooks-branch.sh`. See the section below and `docs/NOTEBOOKS.md`.

## `.github/workflows/site.yml`

**Triggers**: `pull_request` (opened/synchronize/reopened), `pull_request_target`
(closed only), `push` to main, `schedule` Mondays 04:17 UTC, `workflow_dispatch`.

**Concurrency**: group `site-<PR number || ref>`, `cancel-in-progress` only for
`pull_request*` events. Keyed on the PR *number* because a merged PR's closed
event has no merge ref and used to fall into main's group and cancel the
production build (main lost 7 of 11 deploys, all checks green). Every job that
writes `gh-pages` additionally takes `concurrency: gh-pages-write` with
`cancel-in-progress: false`, so writers queue.

**`build`** (every event except close/schedule/dispatch; 20-minute cap):
1. `actions/checkout` with `lfs: true` (figures are LFS pointers otherwise and
   pdflatex dies on them).
2. `cfg` step: on `pull_request` → `base=/pr-preview/pr-N`, `pr=N`, the PR
   title via `env:` and a heredoc (never `${{ }}` into bash: a title is
   attacker-controlled), `sha` = the PR **head** sha (not the merge commit);
   otherwise empty base/pr, `sha=github.sha`. It also computes the
   **partial-preview scope** with `gh pr diff --name-only`: `tex/<slug>/…`
   marks that worksheet `changed`; any other path the site reads (`tex/*.sty`,
   `scripts/`, `src/`, `public/`, `schedule.yaml`, package/Next config, the
   workflows) sets `full=true`; `docs/`, `.claude/`, `scratch/`,
   `intensives/` and root Markdown mark nothing. A failed `gh pr diff` means
   full. Outputs `changed` (comma list) and `full`.
3. apt: `~/apt-debs` cached on `hashFiles('.github/apt-packages.txt')` (that
   file is the one package list; `setup.sh` mirrors it). Warm path = `dpkg -i`
   from the cached `.deb`s, no mirror contact, gated on a `manifest` file
   written only after a successful install. Cold path = real `apt-get` with
   `timeout 300`/`600` because a trickling Ubuntu mirror once ate the whole
   job budget six builds in a row.
4. Typst: `~/.local/bin/typst` cached on `hashFiles('scripts/install-typst.sh')`,
   installed by that script (pinned version, sha256-checked).
5. Node 22 with npm cache over both lockfiles; `npm ci` twice (root and
   `scripts/tex2mdx`).
6. `public/uploads` cached on `tikz-${hashFiles('tex/**')}` (content-addressed
   SVGs); worksheet artifacts (`tex/*/.build-hash`, PDFs, `.aux`, `.bbl`,
   `content/modules`, `public/downloads`) cached under `worksheets-<sha>` with
   `restore-keys: worksheets-` — the key never hits, so the newest entry is
   always restored and rewritten. Only cache entries saved on main are visible
   to other branches; entries expire after 7 idle days.
7. `npm run ci` with `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_PREVIEW_PR`,
   `NEXT_PUBLIC_PREVIEW_PR_TITLE`, `NEXT_PUBLIC_COMMIT_SHA`, plus
   `PREVIEW_CHANGED_SLUGS` and `PREVIEW_FULL` — the same script `./run.sh ci`
   runs. `package.json`'s `ci` must keep an **empty** default for the base
   path: `${VAR:-x}` fires on empty too and would re-prefix production.
   The ladder ends with `scripts/prune-preview.mjs`: on a partial preview it
   deletes the unchanged worksheets' `downloads/` and `uploads/` from `out/`
   (their pages were never rendered — `listSlugs` filtered them) and writes
   `out/preview-manifest.json`; a production build or a full preview passes
   through. `check-overflow` skips pages absent from `out/`.
8. Guard `out/index.html`, `touch out/.nojekyll`, upload artifact `site`
   (hidden files included, 1-day retention).

**`deploy`** (push to main): download `site`, guard, checkout `gh-pages` into
`.deploy`, `find .deploy -mindepth 1 -maxdepth 1 ! -name .git ! -name pr-preview -exec rm -rf`,
`cp -a out/. .deploy/`, publish `"Deploy <sha>"`.

**`preview-deploy`** (`pull_request` from a branch in *this* repo only): stage
`.deploy/pr-preview/pr-N/`, publish, then upsert one PR comment carrying the
marker `<!-- pr-preview-url -->` with the URL and head sha
(`continue-on-error`; the URL is deterministic anyway). The comment reads
`out/preview-manifest.json` to name the changed pages, or say the preview is
full, or that no worksheet page changed.

**Partial previews** (`docs/PR-PREVIEWS.md` §"Partial previews"): a preview
holds only the worksheets the PR touched plus the shell (homepage, status,
intensives, licence). Every link to an unpublished worksheet goes to the live
site at the root path, which on the same origin *is* the unchanged page
(`ModuleLink`, `siteHref` in `src/lib/preview.ts`). Changed worksheets are
tinted green on the homepage and sidebar. Only a build with
`NEXT_PUBLIC_PREVIEW_PR` set can be partial, so production never is. Measured:
one changed worksheet publishes ~11 MB instead of ~165. Fork previews get it
for free (same artifact). Local recipe: add `PREVIEW_CHANGED_SLUGS=<slug>` and
`NEXT_PUBLIC_DIFF_BASE=https://iliad-intensive.org` to a preview-flavoured
build, then `node scripts/prune-preview.mjs`.

**`preview-cleanup`** (`pull_request_target: closed`): checkout **main** (the
merge ref is gone once merged), remove `pr-preview/pr-N/`, publish, flip the
comment to "Preview removed". Safe on `pull_request_target` only because it
runs nothing from the PR.

**`preview-sweep`** (schedule/dispatch): for every `pr-preview/pr-*/`, `gh pr
view --json state`; delete only on a definitive `CLOSED`/`MERGED`, keep on any
API failure, publish once. The backstop for a cleanup that never fired.

## `.github/workflows/notebooks.yml` — the `notebooks` branch

Builds the Colab notebooks from the `tex/<slug>/<name>.py` masters with
`python3 tex/gen_notebooks.py --publish` (standard library only, seconds). Separate
from `site.yml` so neither build triggers the other.

- **Push to main** (path-filtered: masters, `fig/`, `support/`, the generator, the header
  template, `schedule.yaml`) → `notebooks-branch.sh production build/notebooks` → `notebooks`.
- **Every same-repo PR**, with no path filter because the PR's site preview links these
  notebooks → `--preview <N>`, `notebooks-branch.sh preview <N>` → `notebooks-pr-<N>`, and a
  `<!-- notebook-preview -->` comment with the Colab links. Fork PRs build but can't
  publish; their site preview links production's notebooks.
- **PR closed** (`pull_request_target`, checks out `main` only) → `remove <N>` deletes
  `notebooks-pr-<N>`. **Weekly** → `sweep` deletes those of closed PRs.
- Checkout uses LFS: `support/` binaries (D.2's `sprites.png`) are published as files.
- `site.yml` passes `NOTEBOOK_PREVIEW_PR` to a same-repo PR's build, so its notebook
  links (web and PDF) open that PR's notebooks. The notebook images come from the
  site preview (`/pr-preview/pr-<N>/uploads/<slug>/nb/`), which `prune-preview.mjs`
  keeps for every module, touched or not.

## Fork PRs — `.github/workflows/fork-preview.yml`

A `pull_request` run from a fork gets a read-only `GITHUB_TOKEN` (it executes
the fork's code), so its push would 403 (PR #119). This workflow fires on
`workflow_run` after `site` completes, in the base repo's context, and:

- never checks out or runs anything from the PR; inputs are the inert `site`
  artifact of the triggering run and the publish script from main;
- resolves the PR number by listing open PRs and matching **head sha** (the
  `workflow_run` payload's `pull_requests[]` is empty for forks), and skips if
  the PR's current head has moved on;
- publishes only when `author_association` is OWNER/MEMBER/COLLABORATOR/
  CONTRIBUTOR — i.e. anyone with one merged PR here. No manual allowlist (David,
  2026-08-28). Untrusted authors get a 🔒 comment instead.
- `workflow_run` and `pull_request_target` always use the workflow file on
  **main**, so edits to these two paths take effect only after merge and
  cannot be tested from their own PR.

## Hooks (`.githooks/`, enabled by `git config core.hooksPath .githooks`, which `setup.sh` and npm `prepare` do)

- `pre-commit`: any staged file with a binary extension (`png jpg jpeg bmp gif
  tif tiff webp pdf ico psd heic avif`) must be an LFS pointer, or the commit
  is rejected with the fix printed. `.gitattributes` tracks `tex/**/fig/**`
  images and PDFs; a sibling `figures/` dir silently bypasses LFS.
- `pre-push`: runs `./run.sh content <tracked slugs>` then `./run.sh build`,
  then `git lfs pre-push` (the LFS hook is bypassed by the custom hooks path,
  so it is called by hand). `git push --no-verify` skips **all of it,
  including the LFS upload** — run `git lfs push origin <branch>` first or
  GitHub rejects the PR's new figures.

## The banner and the diff view

`components/PreviewBanner.tsx` renders only when `NEXT_PUBLIC_PREVIEW_PR` is
set: two rows — the PR number + title, links to the live site and the PR, and
on a partial preview how many pages changed; then the inert `#diff-controls`
row (`#diff-toggle` with `data-diff-base` and `data-base-path`, `#diff-sync`,
`#diff-hide` (default on), `#diff-stretch` (default off), the `#diff-next`
button, `#diff-status`). On previews `layout.tsx` wraps banner + navbar in
`#top-stack`, sticky at the top; `site.js` measures it into `--top-h`, which
anchor scroll offset, the sidebar's sticky offset and the diff column
headings use. `layout.tsx` adds `public/diff.js` only on preview builds.

`diff.js` (vanilla, ~400 lines): on tick it fetches the **same path from the
base origin** — empty base = this origin's root, which is production, so it is
a same-origin fetch; a local build can set `NEXT_PUBLIC_DIFF_BASE=https://iliad-intensive.org`,
which sends `access-control-allow-origin: *`. 404 → "page is new on this PR",
checkbox disables itself. Both `main article .prose` trees are split into leaf
blocks (paragraphs, headings, list items, display equations keyed by their TeX
`aria-label`, tables, atomic figures), sequence-diffed (common prefix/suffix
then LCS, bailing to all-removed/all-added above 6e6 cells), removed/added
pairs with the same tag and ≥0.3 word Jaccard become "modified" and get a
word-level diff (inline maths is one token), then spacers are inserted above
whichever side of each matched pair sits higher so the two columns share rows.
`<details>` containing a change are opened. "Hide unchanged" works on the
article's **top-level** blocks (paragraphs, headings, whole exercise/theorem
boxes, lists): a PR top is paired with the base top holding the other half of
a matched leaf inside it, tops with no change inside fold away with one block
of context beside each change, one clickable strip per section named by its
heading; a strip toggles its run and rebuilds the spacers.
"Allow stretched margins" off (the default) sizes each column to `--prose-w`
(680px), so overflow on the real page overflows here too; on, the columns
share the viewport. "Next change" sorts the stops by column position, scrolls
each into view with an amber `.diff-current` ring, and enables the diff first
if needed. State in `localStorage` `iliad.diff` / `iliad.diffSync` /
`iliad.diffHide` / `iliad.diffStretch`; "sync scroll" off adds `diff-unsync`
and each column scrolls alone. It compares against what is **deployed**, not
main HEAD.

Local recipe for a preview-flavoured build (from `docs/PR-PREVIEWS.md`):

```sh
node scripts/build-content.mjs <slug>
NEXT_PUBLIC_PREVIEW_PR=local NEXT_PUBLIC_DIFF_BASE=https://iliad-intensive.org \
  PREVIEW_ONLY=<slug> npx next build && node scripts/strip-hydration.mjs
python3 -m http.server 4499 --directory out
```

## Debugging map

| Symptom | Check |
|---|---|
| PR check red | `gh pr checks <n>` / `gh run view <id> --log-failed`. The build step prints the same `✗ <slug>: …` lines as `./run.sh ci`; reproduce locally with `./run.sh ci <slug>` |
| build green but no preview comment | same-repo PR: did `preview-deploy` run (`gh run view`)? Fork PR: is there a `fork-preview` run after it, and did the trust gate print `trusted=true`? Comment step is `continue-on-error`, so the URL may still work |
| preview shows stale content | the run for the newest push may have been cancelled by a newer push (same `site-<N>` group); look at the head sha in the comment |
| production not updated after merge | `gh run list --workflow site --branch main`; check the `deploy` job, and whether a `gh-pages-write` writer ahead of it failed. `/admin/status` also shows "N commits behind main" from the browser |
| preview 404s on assets/links | base path not applied somewhere render-time — see the `site-rendering` skill; or `.nojekyll` missing (Jekyll drops `_next/`) |
| preview of a closed PR still live | wait for Monday's sweep or `gh workflow run site.yml` |
| apt step stalls or fails | Ubuntu mirror incident; re-run. If `apt-packages.txt` changed, the first run is cold by design |
| a day nobody touched recompiles | cache miss: `worksheets-` entry expired (7 days idle) or the hash inputs changed (converter, `iliad.sty`, `build-content.mjs`) |
| `git push` rejected locally | the pre-push hook ran the ladder; fix the printed error, or `--no-verify` after `git lfs push` |
| a notebook link 404s in Colab | `notebooks` run for that push/PR (`gh run list --workflow notebooks`); `gh api repos/iliad-team/iliad-intensive/git/trees/<notebooks or notebooks-pr-N>?recursive=1` shows what is published |
| notebook images broken | they load from the *site* (`/uploads/<slug>/nb/`), so check the site deploy, not the notebooks run |
| a notebook's `support/` import fails on Colab | its fetch cell sparse-clones `<slug>/` from `notebooks` (or `notebooks-pr-<N>`) into `/content/<branch>`; a PNG there as a ~130-byte LFS pointer means the checkout lost `lfs: true` |
| custom domain gone | `public/CNAME` was deleted or not staged; the UI-written CNAME is wiped by every orphan publish |

## Rules when editing the workflows

1. Never route an event that **builds** through `pull_request_target`, and
   never `npm ci`/checkout PR code in `fork-preview.yml` — both hand a write
   token to the PR author.
2. Every `gh-pages` writer takes `concurrency: gh-pages-write`, never cancels
   in progress, stages the complete tree, and calls the publish script.
3. Keep PR-controlled strings (title, branch) out of `${{ }}` inside `run:`;
   pass them via `env:`.
4. Keep the `pr-preview-url` comment marker and the URL format; the PR
   template and `day-handoff` skill rely on them.
5. Keep `public/CNAME` and the `.nojekyll` touch.
6. Changing `apt-packages.txt` or `install-typst.sh` re-keys their caches by
   hash — no version suffix to bump. Mirror any package change in `setup.sh`.
7. `workflow_run`/`pull_request_target` changes are only exercised after
   merge; say so in the PR.
8. Notebook branches are written only through `.github/notebooks-branch.sh`: PRs write
   `notebooks-pr-<N>`, main writes `notebooks`, never crossed. Keep one writer per
   branch, and don't put the writers in one shared concurrency group: GitHub cancels
   an older *pending* run in a group, so a production publish could be silently dropped.
