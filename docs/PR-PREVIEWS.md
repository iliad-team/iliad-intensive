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

`.github/workflows/site.yml` builds the site once per event and then:

- **push to `main`** → publishes `out/` to the **root** of `gh-pages`
  (`JamesIves/github-pages-deploy-action`, with `clean-exclude: pr-preview/**`
  so it never wipes an active preview).
- **pull request opened/updated** → after the check ladder passes, publishes
  `out/` to `pr-preview/pr-<N>/` and comments the URL
  (`rossjrw/pr-preview-action`).
- **pull request closed** → removes `pr-preview/pr-<N>/`.

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

## Caveats / known limitations

- **Fork PRs.** On a `pull_request` from a fork, `GITHUB_TOKEN` is read-only, so
  the preview deploy silently no-ops. Previews work for branches pushed to this
  repo (the team's normal flow). Do **not** switch to `pull_request_target` to
  work around this — it would run untrusted PR code with a write token.
- **Concurrent deploys.** A `main` push and a PR event can both push to
  `gh-pages` at once and race; the actions retry, but a rare failure just needs a
  re-run. A shared deploy concurrency group would serialise them if this becomes
  a problem.
- **Third-party actions.** `rossjrw/pr-preview-action` and
  `JamesIves/github-pages-deploy-action` are pinned by major version; pin to a
  commit SHA if you want stricter supply-chain guarantees.
- **Prototype.** This is a first cut (branch `pr-website-serve`). Validate on a
  throwaway PR before relying on it.
