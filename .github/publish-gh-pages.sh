#!/usr/bin/env bash
# Publish the staged tree in .deploy/ to gh-pages as ONE orphan commit.
#
# gh-pages holds nothing but build output — every byte of it is regenerable from
# tex/ plus the build — so it keeps no history: each publish force-pushes a
# single parentless commit that replaces the branch. Appending instead is what
# grew the branch to 5.4 GB across 90 commits (99.8% of the repo), which every
# `git pull` paid for, because git's default refspec fetches all branches.
#
# The contract that falls out of this, and that every caller must honour:
# .deploy/ IS the published site. Not a patch against it — the whole tree, root
# and every live pr-preview/ subtree. A path missing from .deploy/ when this
# runs is a path unpublished. Callers stage by checking out gh-pages into
# .deploy/ and editing the part they own.
set -euo pipefail

MSG="${1:?commit message required}"
DIR="${GITHUB_WORKSPACE:-$PWD}/.deploy"

# A tree with no root index.html is a broken site, and force-pushing it would
# take production down with no previous commit on the branch to revert to. The
# callers guard their own inputs; this is the last check before the push.
test -f "$DIR/index.html" || {
  echo "::error::$DIR has no index.html — refusing to force-push (would break the live site)"
  exit 1
}

cd "$DIR"
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# --orphan: the new commit has no parent, so pushing it drops the old history
# rather than adding to it. Everything staged here is the whole branch.
git checkout -q --orphan publish
git add -A
git commit -q -m "$MSG"
git push -q --force origin HEAD:gh-pages

echo "published $(git ls-files | wc -l) files to gh-pages ($MSG)"
