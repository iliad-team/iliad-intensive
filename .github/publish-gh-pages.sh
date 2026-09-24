#!/usr/bin/env bash
# publish-gh-pages.sh — every write to gh-pages.
#
#   publish-gh-pages.sh production <dir> <msg>   <dir> becomes the site root; every
#                                                pr-preview/ subtree is carried over
#   publish-gh-pages.sh preview <N> <dir> <msg>  <dir> becomes pr-preview/pr-<N>/
#   publish-gh-pages.sh remove <msg> <N>...      delete pr-preview/pr-<N>/ for each N
#   publish-gh-pages.sh list                     print the PR number of every preview
#
# gh-pages holds nothing but build output — every byte of it is regenerable from
# tex/ plus the build — so it keeps no history: each publish force-pushes a
# single parentless commit that replaces the branch. Appending instead is what
# grew the branch to 5.4 GB across 90 commits (99.8% of the repo), which every
# `git pull` paid for, because git's default refspec fetches all branches.
#
# Each writer owns one part of the tree (production the root, a preview its own
# pr-preview/pr-<N>/) and changes only that part of the CURRENT branch:
#
#   1. fetch gh-pages's trees, not its files (--filter=blob:none — a few MB, not
#      the ~1 GB a checkout was, which took ~20 s of every preview deploy);
#   2. build the new root tree from it with git plumbing: its trees, plus ours;
#   3. push the orphan commit with --force-with-lease against the commit fetched
#      in 1, so a writer that raced in between is never overwritten: the push
#      is refused, and this writer starts again from 1 on top of the other's.
#
# That is what replaces the old `concurrency: gh-pages-write` lock. GitHub keeps
# one PENDING job per concurrency group and cancels any older pending one when a
# new one queues, whatever cancel-in-progress says — so with three writers at
# once, the middle one vanished. Five PR previews outlived their PRs that way
# (#170, #173 and #174 merged together, their cleanups "cancelled"), and a
# production deploy waiting behind a preview could have been dropped the same way.
#
# Works in a scratch repo, not the checkout: a clone with the repo's hooks
# enabled would run its pre-push hook (the whole CI ladder).
#
# Needs GITHUB_TOKEN and GITHUB_REPOSITORY. PAGES_REMOTE overrides the remote (a
# local bare repo, for testing this script).
set -euo pipefail

usage="usage: publish-gh-pages.sh production <dir> <msg> | preview <N> <dir> <msg> | remove <msg> <N>... | list"
cmd="${1:?$usage}"; shift
REPO_URL="${PAGES_REMOTE:-https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git}"
BRANCH=gh-pages

check_pr() { case "$1" in ''|*[!0-9]*) echo "::error::bad PR number '$1'"; exit 1 ;; esac; }

work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/publish-gh-pages.XXXXXX")"
trap 'rm -rf "$work"' EXIT
git init -q --bare "$work/repo.git"
export GIT_DIR="$work/repo.git"
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add origin "$REPO_URL"

# The current branch tip, trees only ("" when the branch does not exist yet).
fetch_base() {
  if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git fetch -q --depth=1 --filter=blob:none origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    git rev-parse "refs/remotes/origin/$BRANCH"
  fi
}

# A tree object for the files under directory $1, hashed straight from disk
# (these are ours, so their contents are written into the scratch repo).
tree_of_dir() {
  GIT_INDEX_FILE="$work/dir-index" GIT_WORK_TREE="$(realpath "$1")" git add -A .
  GIT_INDEX_FILE="$work/dir-index" git write-tree
  rm -f "$work/dir-index"
}

# Trees are edited one directory level at a time with ls-tree | mktree, never
# through an index: the fetched base has trees but no file contents, and index
# operations (read-tree --prefix, write-tree) download every file they touch to
# check it — measured: a preview publish pulled a 300 MB production file. The
# push needs none of them either; they are all already on the remote.
#
# Entries of tree $1 (NUL-separated ls-tree lines), minus the names in $2...
entries_without() {
  local tree=$1; shift
  git ls-tree -z "$tree" | while IFS= read -r -d '' e; do
    local name=${e#*$'\t'} skip= x
    for x in "$@"; do [ "$name" = "$x" ] && skip=1; done
    [ -n "$skip" ] || printf '%s\0' "$e"
  done
}
subtree() { git ls-tree "$1" "$2" | awk '$2 == "tree" { print $3 }'; }
mk() { git mktree -z --missing; }

# Build the new root from base $1 (and our tree $2), print its tree id.
new_root() {
  local base=$1 ours=${2:-} previews n names=()
  case "$cmd" in
    production)
      if [ -n "$(git ls-tree "$ours" pr-preview)" ]; then
        echo "::error::the site itself has a pr-preview/ directory — refusing to publish over the previews" >&2; exit 1
      fi
      previews=$([ -n "$base" ] && subtree "$base" pr-preview || true)
      { entries_without "$ours"
        [ -z "$previews" ] || printf '040000 tree %s\tpr-preview\0' "$previews"; } | mk ;;
    preview|remove)
      [ -n "$base" ] || { echo "::error::no $BRANCH branch to change" >&2; exit 1; }
      previews=$(subtree "$base" pr-preview)
      if [ "$cmd" = preview ]; then names=("pr-$PR"); else for n in "${PRS[@]}"; do names+=("pr-$n"); done; fi
      previews=$({ [ -z "$previews" ] || entries_without "$previews" "${names[@]}"
                   [ "$cmd" = remove ] || printf '040000 tree %s\tpr-%s\0' "$ours" "$PR"; } | mk)
      { entries_without "$base" pr-preview
        # an empty pr-preview/ is dropped, as git would
        [ "$previews" = "$(printf '' | mk)" ] || printf '040000 tree %s\tpr-preview\0' "$previews"; } | mk ;;
  esac
}

case "$cmd" in
  list)
    base="$(fetch_base)"
    [ -n "$base" ] || exit 0
    git ls-tree --name-only "$base:pr-preview" 2>/dev/null | sed -n 's/^pr-\([0-9][0-9]*\)$/\1/p'
    exit 0 ;;
  production)
    DIR="${1:?$usage}"; MSG="${2:?$usage}" ;;
  preview)
    PR="${1:?$usage}"; DIR="${2:?$usage}"; MSG="${3:?$usage}"; check_pr "$PR" ;;
  remove)
    MSG="${1:?$usage}"; shift; PRS=("$@")
    [ ${#PRS[@]} -gt 0 ] || { echo "nothing to remove"; exit 0; }
    for n in "${PRS[@]}"; do check_pr "$n"; done ;;
  *) echo "$usage"; exit 1 ;;
esac

ours=""
if [ -n "${DIR:-}" ]; then
  test -f "$DIR/index.html" || { echo "::error::$DIR has no index.html — refusing to publish it"; exit 1; }
  ours="$(tree_of_dir "$DIR")"
fi

for attempt in 1 2 3 4 5 6 7 8; do
  base="$(fetch_base)"
  if [ "$cmd" = remove ] && [ -z "$base" ]; then echo "no $BRANCH branch — nothing to remove"; exit 0; fi
  root="$(new_root "$base" "$ours")"
  # A tree with no root index.html is a broken site, and force-pushing it would
  # take production down with no previous commit on the branch to revert to.
  # (ls-tree, not cat-file -e: that would download the file to check it.)
  [ -n "$(git ls-tree "$root" index.html)" ] || {
    echo "::error::the new $BRANCH tree has no root index.html — refusing to push (would break the live site)"; exit 1; }
  if [ -n "$base" ] && [ "$root" = "$(git rev-parse "$base^{tree}")" ]; then
    echo "$BRANCH already has exactly this tree — nothing to publish ($MSG)"; exit 0
  fi
  commit="$(git commit-tree "$root" -m "$MSG")"
  # Lease: replace the branch only if it is still the commit we built on.
  if git push -q --force-with-lease="refs/heads/$BRANCH:$base" origin "$commit:refs/heads/$BRANCH" 2>"$work/push.err"; then
    echo "published $(git ls-tree -r --name-only "$root" | wc -l) files to $BRANCH ($MSG)"
    exit 0
  fi
  if ! grep -q -E "stale info|rejected|fetch first|non-fast-forward" "$work/push.err"; then
    cat "$work/push.err" >&2; exit 1
  fi
  echo "another writer published first — retrying on top of it (attempt $attempt)"
  sleep $(( (RANDOM % 8) + 2 ))
done
echo "::error::gave up after 8 attempts — $BRANCH kept changing underneath this publish"
exit 1
