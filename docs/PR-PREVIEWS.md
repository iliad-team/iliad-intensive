# Per-PR website previews

Every PR that passes the checks gets a rendered copy of the site at:

```
https://iliad-intensive.org/pr-preview/pr-<N>/
```

A bot comments the URL on the PR and updates it on every push. Closing or merging the PR tears the preview down.

Same-repo PRs also preview Colab notebooks: `notebooks.yml` publishes them to a `notebooks-pr-<N>` branch (deleted on close) and comments their Colab links. Production's `notebooks` branch is written only from main. See [`NOTEBOOKS.md`](NOTEBOOKS.md#pr-previews).

## How it works

The site is a static export (`output: "export"` → `out/`), served from a single `gh-pages` branch:

```
gh-pages/
  index.html, _next/, ...        ← production site (deployed from main)
  pr-preview/
    pr-12/  index.html, ...       ← preview for PR #12
    pr-14/  index.html, ...       ← preview for PR #14
```

`.github/workflows/site.yml` builds once per event, stages the result and publishes it with `.github/publish-gh-pages.sh`:

| Event | Action |
|---|---|
| push to `main` | wipe the root, keep `pr-preview/`, copy `out/` in |
| PR opened/updated | after the check ladder passes, replace `pr-preview/pr-<N>/` with `out/` and upsert the URL comment. Fork PRs: done by `fork-preview.yml` (see [Fork PRs](#fork-prs)) |
| PR closed | delete `pr-preview/pr-<N>/`. Runs on `pull_request_target`, so it has a write token for forks too. Safe only because it builds and executes nothing from the PR |

- All three share the `gh-pages-write` concurrency group (`cancel-in-progress: false`), so deploys queue instead of racing.
- The URL comment is `continue-on-error`; an API failure can't fail a successful deploy.

### The branch keeps no history

Every publish force-pushes one orphan commit, so `gh-pages` is always one commit deep (appending grew it to 5.4 GB).

When editing the workflow:

- Each job stages the **complete** tree in `.deploy/`: check out `gh-pages`, edit only the subtree it owns. A path missing from `.deploy/` is unpublished.
- So the production job must carry `pr-preview/` forward, and `clean-exclude`-style filtering cannot work.
- The script refuses to push a tree with no root `index.html`.

### Base path

Production is at the root of `iliad-intensive.org` (see `public/CNAME`). Assets and links are absolute, so previews need a prefix:

| Event | `NEXT_PUBLIC_BASE_PATH` |
|---|---|
| push to `main` | *(empty)* |
| PR #N | `/pr-preview/pr-N` |

`npm run ci` honours an existing `NEXT_PUBLIC_BASE_PATH`, else defaults to empty. **The default must stay empty**: `${VAR:-default}` also fires on an empty value, so a non-empty default would re-prefix the production build.

## Partial previews: only what the PR changed

A preview contains only the worksheets the PR touched, plus the shell (homepage, `/admin/status`, `/intensives`, `/license`). Other worksheet links go to the live site.

The `cfg` step in `site.yml` decides:

- `gh pr diff --name-only` lists the PR's files against its merge base (works for forks).
- `tex/<slug>/…` marks that worksheet changed: it is rendered, published, and tinted green on the preview's homepage and sidebar.
- Anything else the site reads (`tex/iliad.sty`, `scripts/`, `src/`, `public/`, `schedule.yaml`, package and Next config files, workflows) makes a **full** preview. Changed worksheets are still tinted.
- Paths the site never reads (`docs/`, `.claude/`, `scratch/`, root Markdown, `intensives/`) mark nothing, so the PR publishes the shell alone.
- If the file list can't be fetched, the preview is full.

Mechanics:

- The result reaches the build as `PREVIEW_CHANGED_SLUGS` and `PREVIEW_FULL` (`src/lib/preview.ts`). `listSlugs` renders only the changed worksheets.
- `scripts/prune-preview.mjs` (last in `npm run ci`) removes unchanged worksheets' `downloads/` and `uploads/` and writes `out/preview-manifest.json`, from which the comment names changed pages.
- `ModuleLink` and `siteHref` point at the preview's copy if it exists, else the live site.
- Only a build with `NEXT_PUBLIC_PREVIEW_PR` set can be partial, so a stray env value can't drop pages from production.
- `check-overflow` skips pages a partial preview didn't render.
- Fork PRs get the same behaviour: `fork-preview.yml` publishes the build's artifact.

To reproduce locally (see [Trying it locally](#trying-it-locally)): add `PREVIEW_CHANGED_SLUGS=<slug>` to `next build` and run `node scripts/prune-preview.mjs` after `strip-hydration`. With `NEXT_PUBLIC_DIFF_BASE=https://iliad-intensive.org`, unchanged links go to production.

## Required one-time setup (maintainer)

Previews need the branch Pages source (the GitHub Actions source serves one artifact):

> **Settings → Pages → Build and deployment → Source → "Deploy from a branch" →
> Branch: `gh-pages` / `(root)`**

Until then, `gh-pages` is built but not served. The first workflow run creates the branch.

A branch source runs Jekyll, which ignores `_`-prefixed dirs like `_next/`. The build writes a `.nojekyll` marker to the site root. Don't remove it.

### Custom domain

- `iliad-intensive.org`: apex A records → GitHub Pages' four addresses, `www` → `iliad-team.github.io`. Both **DNS-only (grey cloud)** in Cloudflare, so GitHub's Let's Encrypt challenge isn't intercepted.
- `iliad-intensive.com`: separate Cloudflare zone, proxied, path-preserving redirect to the `.org`. Pages allows one custom domain per repo.
- The domain is claimed by `public/CNAME` (copied into `out/`). Setting it in Settings → Pages writes a `CNAME` to `gh-pages` that the next force-push deletes. **Don't delete `public/CNAME`.**

## The diff view

The preview banner's **diff vs main** checkbox splits the article into two columns: live site left, PR right. Removed blocks red, added green, edited blocks tinted with changed words marked (an inline formula is one word). Matched blocks share rows; a removed paragraph faces a hatched blank. Solutions containing a change open.

The two-row banner sticks to the top with the navbar (`#top-stack` in `layout.tsx`; `site.js` measures it into `--top-h`, used by the anchor scroll and sidebar sticky offsets). Controls:

- **diff vs main**: the two-column view.
- **sync scroll**: columns share the page scroll (on) or scroll separately (off).
- **hide unchanged** (default on): matching top-level blocks (paragraphs, headings, exercise/theorem boxes, lists) fold into a strip naming the heading and block count, keeping one block of context per change. Click to toggle.
- **allow stretched margins** (default off): off, each column is the real reading width, so page overflow shows here too (scrolls sideways on narrow screens). On, columns share the viewport but hide overflow.
- **show column edge** (default off): red line at each column's right edge; dashed red outline (and a count) on display equations wider than the column, i.e. what `scripts/check-overflow.mjs` reports. Works without the diff and on `/dev/diff`.
- **next change ▸**: scrolls to each changed block in turn (amber ring); turns the diff on if needed.

Implementation:

- `public/diff.js` (vanilla JS, like `site.js`) plus `DiffControls.tsx`. Loaded only by preview builds and `/dev/diff`.
- The base is fetched from the same path at the site root (same origin); no build step. A 404 (page not on main) disables the checkbox with a note.
- The base is what's deployed, which lags main's HEAD between a merge and its deploy.
- Blocks match by content (equations by TeX source), so a renumbered exercise shows as a heading edit.

### Page history: `/dev/diff`

Compares any two historical versions of a page: `/dev/diff/?page=<slug>&from=<tree>&to=<tree>`. Trees may be abbreviated; with none given, it shows the newest version against the previous one.

- Every version on every branch is pre-rendered by the [iliad-intensive-snapshots](https://github.com/iliad-team/iliad-intensive-snapshots) repo's backfill with today's pipeline, one HTML file per distinct `tex/<slug>/` tree.
- `public/dev-diff.js` reads that repo's `index.json` and two pages from raw.githubusercontent.com (`access-control-allow-origin: *`), shows the newer article and points `diff.js` at the older one via `#diff-toggle`'s `data-diff-url`.
- The site build stores none of it. Figures come from this site's `/uploads/`, so old versions show today's figures.

### Trying it locally

A local build can diff against production (which sends `access-control-allow-origin: *`):

```sh
node scripts/build-content.mjs <slug>
NEXT_PUBLIC_PREVIEW_PR=local NEXT_PUBLIC_DIFF_BASE=https://iliad-intensive.org \
  PREVIEW_ONLY=<slug> npx next build && node scripts/strip-hydration.mjs
python3 -m http.server 4499 --directory out     # then open /<cluster>/<slug>/
```

- `NEXT_PUBLIC_PREVIEW_PR=local` (any non-numeric value) labels the banner "Local preview build" with no PR link.
- `NEXT_PUBLIC_DIFF_BASE` is where base pages are fetched from. Empty (default, used by CI) means this origin's root.

## Fork PRs

A fork's `pull_request` run always gets a read-only `GITHUB_TOKEN`, whatever `permissions:` says. So `site.yml`'s preview deploy is same-repo only; `.github/workflows/fork-preview.yml` publishes fork previews:

- Triggers on `workflow_run` after a `site` build, with a write token. Never checks out or executes PR code: its only PR input is the built site artifact, copied into `pr-preview/pr-<N>/`. The publish script comes from `main`.
- Gated on [Who is trusted](#who-is-trusted), since it serves author-controlled HTML on the production origin. Untrusted authors get a comment instead.
- The PR number is looked up via the API from the run's head SHA (`pull_requests[]` is empty for forks). If that SHA is no longer the PR's head, it skips.
- **Never move the deploy (or any build) to `pull_request_target`.** That runs fork code with a write token (pwn-request). The `closed` cleanup is the one safe exception.

`workflow_run` and `pull_request_target` use the default branch's workflow file, so changes here only take effect on merge.

### Who is trusted

A fork PR's author is trusted if their `author_association` is OWNER/MEMBER/COLLABORATOR, or their login is in [`.github/trusted-contributors`](../.github/trusted-contributors) on main.

- `.github/trust.sh` is the one implementation. Every caller reads the list from main via the API, so a PR adding its own author does nothing until merged.
- A merged PR grants no trust by itself.
- To trust someone, add their login to `.github/trusted-contributors` and merge; remove it to revoke.

| What | Where | Untrusted author |
|---|---|---|
| CI runs without a click | the repo setting "Require approval for **all external contributors**", plus `approve-trusted.yml`, which approves a trusted author's waiting runs through the API | runs wait for a maintainer's **Approve and run** |
| A live preview | `fork-preview.yml` | a 🔒 comment instead |
| `/dev/diff` history | `snapshots-dispatch.yml` only dispatches for trusted authors, and iliad-intensive-snapshots' `update.yml` only renders trusted PR heads | not rendered |

No fork PR can write to this repo. Its runs get a read-only token and no secrets. The write-token jobs (`fork-preview`, `approve-trusted`, `snapshots-dispatch`) run main's code and never check out or execute the PR.

## Caveats / known limitations

- **No third-party publish action.** `JamesIves/github-pages-deploy-action` with `single-commit: true` would also work (its `git checkout --orphan <branch> origin/<branch>` keeps the existing tree). The script is a preference.
- **Branch size.** A full build is ~100 MB, plus each live preview. Close stale PRs.
- **Prototype.** First cut (branch `pr-website-serve`). Validate on a throwaway PR before relying on it.
