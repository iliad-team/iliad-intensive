# Per-PR website previews

Every pull request that passes the checks gets its own rendered copy of the site,
so a reviewer can click through the real pages before the PR is merged:

```
https://iliad-team.github.io/iliad-intensive/pr-preview/pr-<N>/
```

A bot comments that URL on the PR automatically, and updates it on every push.
When the PR is closed or merged, the preview is torn down.

## How it works

The site is a static export (`output: "export"` → `out/`). Everything is served
from a single **`gh-pages` branch**:

```
gh-pages/
  index.html, _next/, ...        ← production site (deployed from main)
  pr-preview/
    pr-12/  index.html, ...       ← preview for PR #12
    pr-14/  index.html, ...       ← preview for PR #14
```

`.github/workflows/site.yml` builds the site once per event, then stages the
result and publishes it with `.github/publish-gh-pages.sh`:

- **push to `main`** → wipes the root, keeps `pr-preview/`, copies `out/` in.
- **pull request opened/updated** → after the check ladder passes, replaces
  `pr-preview/pr-<N>/` with `out/` and upserts a comment with the URL.
- **pull request closed** → deletes `pr-preview/pr-<N>/`.

All three write to the same branch, so they share a `gh-pages-write` concurrency
group (`cancel-in-progress: false`): simultaneous deploys **queue** instead of
racing — which force-pushing needs even more than appending did. The URL comment
is `continue-on-error` — a GitHub API hiccup can't fail an otherwise-successful
deploy (the URL is deterministic regardless).

### The branch keeps no history

Every publish **force-pushes one orphan commit**. `gh-pages` is always exactly
one commit deep, because nothing on it is source — it is regenerable from `tex/`
plus the build.

This is not a tidiness preference. Appending grew the branch to **5.4 GB across
90 commits — 99.8% of the repository**, and every contributor's `git pull` paid
for it, since git's default refspec fetches all branches. A single worksheet page
is ~10 MB, so each rebuild added another copy.

The consequence for anyone editing the workflow: **each job stages the complete
tree** in `.deploy/` (check out `gh-pages`, edit only the subtree it owns) and
lets the script replace the branch with it. A force-push has no previous state to
merge against, so a path missing from `.deploy/` is a path unpublished. This is
why the production job carries `pr-preview/` forward instead of deleting it, and
why `clean-exclude`-style filtering cannot work here: the tree you push *is* the
site. The script refuses to push a tree with no root `index.html`.

### Base path

GitHub Pages serves the repo under `/iliad-intensive`. Assets and links are
absolute, so a preview one level deeper must be built with a matching prefix.
The workflow sets `NEXT_PUBLIC_BASE_PATH` accordingly:

| Event | `NEXT_PUBLIC_BASE_PATH` |
|---|---|
| push to `main` | `/iliad-intensive` |
| PR #N | `/iliad-intensive/pr-preview/pr-N` |

`npm run ci` honours an existing `NEXT_PUBLIC_BASE_PATH` and falls back to
`/iliad-intensive`, so local builds and the production deploy are unchanged.

## Required one-time setup (maintainer)

The previous setup deployed via the **GitHub Actions** Pages source, which serves
a *single* artifact as the whole site — previews can't coexist with it. This
model uses the **branch** source instead. In the repo:

> **Settings → Pages → Build and deployment → Source → "Deploy from a branch" →
> Branch: `gh-pages` / `(root)`**

Until that switch is made, the `gh-pages` branch is built but nothing is served
from it. (The first workflow run creates the branch.)

A branch source runs **Jekyll** by default, which would strip Next's `_next/`
assets (Jekyll ignores `_`-prefixed dirs). The build writes a `.nojekyll` marker
to the site root to disable that — no action needed, but don't remove it.

## Caveats / known limitations

- **Fork PRs.** On a `pull_request` from a fork, `GITHUB_TOKEN` is read-only, so
  the preview deploy silently no-ops. Previews work for branches pushed to this
  repo (the team's normal flow). Do **not** switch to `pull_request_target` to
  work around this — it would run untrusted PR code with a write token.
- **Concurrent deploys.** All `gh-pages` writes share the `gh-pages-write`
  concurrency group, so a `main` push and a PR deploy queue rather than race.
- **Third-party actions.** Publishing no longer uses one. Earlier revisions used
  `rossjrw/pr-preview-action` (dropped: a post-deploy REST call for the commit
  SHA failed the check on a GitHub API blip even though the deploy succeeded)
  and then `JamesIves/github-pages-deploy-action` (dropped for the force-push
  model: its `single-commit` option checks out an *orphan*, so the worktree
  starts empty and `clean-exclude: pr-preview/**` protects nothing — enabling it
  naively would have unpublished every open PR's preview).
- **Branch size.** One commit deep, but the *tip* is still large: a full site
  build is ~100 MB and each live preview is another copy. Closing stale PRs is
  what keeps it down.
- **Prototype.** This is a first cut (branch `pr-website-serve`). Validate on a
  throwaway PR before relying on it.
