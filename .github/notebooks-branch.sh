#!/usr/bin/env bash
# notebooks-branch.sh — every write to the `notebooks` branch (docs/NOTEBOOKS.md).
#
#   notebooks-branch.sh production <dir>   <dir>/ becomes the branch root
#   notebooks-branch.sh preview <N> <dir>  <dir>/ becomes pr-preview/pr-<N>/
#   notebooks-branch.sh remove <N>         drop pr-preview/pr-<N>/
#   notebooks-branch.sh sweep              drop every pr-preview/pr-<N>/ whose PR is closed
#
# The branch is laid out like gh-pages: production notebooks at the root
# (<slug>/<name>_{nosol,sol}.ipynb), each open PR's under pr-preview/pr-<N>/.
# Like gh-pages it keeps no history: every write force-pushes ONE orphan commit
# holding the whole tree. So each command fetches the current tree, edits only
# the part it owns, and publishes all of it.
#
# Two writers at once must not drop each other's work. That is NOT left to a
# workflow concurrency group: GitHub keeps one pending run per group and cancels
# the older pending one, which would silently lose e.g. a production publish
# queued behind a PR. Instead the push is conditional — --force-with-lease on the
# commit this run fetched — and a push that lost the race starts over from the
# new tree. Writers can run in any order and all of their changes land.
#
# Needs GITHUB_TOKEN and GITHUB_REPOSITORY; `sweep` also needs `gh` (GH_TOKEN).
set -euo pipefail

cmd="${1:?usage: notebooks-branch.sh production <dir> | preview <N> <dir> | remove <N> | sweep}"
# NOTEBOOKS_REMOTE overrides the remote (a local bare repo, for testing this script).
REPO_URL="${NOTEBOOKS_REMOTE:-https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git}"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/notebooks-branch.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
ATTEMPTS=8

check_pr() { case "$1" in ''|*[!0-9]*) echo "::error::bad PR number '$1'"; exit 1 ;; esac; }
case "$cmd" in
  production) SRC="$(realpath "${2:?production needs the built tree}")" ;;
  preview) check_pr "${2:-}"; SRC="$(realpath "${3:?preview needs the built tree}")" ;;
  remove) check_pr "${2:-}" ;;
  sweep) ;;
  *) echo "unknown command: $cmd"; exit 1 ;;
esac

# Edit $TREE for the command; set MSG. Return 1 when there is nothing to change.
apply() {
  case "$cmd" in
    production)
      # Fresh root, open previews kept.
      find "$TREE" -mindepth 1 -maxdepth 1 ! -name .git ! -name pr-preview -exec rm -rf {} +
      cp -a "$SRC/." "$TREE/"
      MSG="notebooks @ ${GITHUB_SHA:-local}"
      ;;
    preview)
      local dir="$TREE/pr-preview/pr-$2"
      rm -rf "$dir" && mkdir -p "$dir" && cp -a "$SRC/." "$dir/"
      MSG="Notebook preview for PR #$2"
      ;;
    remove)
      [ -d "$TREE/pr-preview/pr-$2" ] || { echo "no notebook preview for PR #$2 — nothing to remove"; return 1; }
      rm -rf "$TREE/pr-preview/pr-$2"
      MSG="Remove notebook preview for PR #$2"
      ;;
    sweep)
      # Delete only on a definitive CLOSED/MERGED; an API failure keeps the
      # preview (the same rule as site.yml's preview-sweep).
      local removed=() d n state
      shopt -s nullglob
      for d in "$TREE"/pr-preview/pr-*/; do
        n=$(basename "$d"); n=${n#pr-}
        case "$n" in ''|*[!0-9]*) continue ;; esac
        state=$(gh pr view "$n" --repo "$GITHUB_REPOSITORY" --json state -q .state 2>/dev/null) || state=UNKNOWN
        case "$state" in
          CLOSED|MERGED) rm -rf "$d"; removed+=("#$n"); echo "sweep pr-$n ($state)" ;;
          *) echo "keep  pr-$n ($state)" ;;
        esac
      done
      [ ${#removed[@]} -gt 0 ] || { echo "nothing to sweep"; return 1; }
      MSG="Sweep notebook previews: ${removed[*]}"
      ;;
  esac
  # Empty directories vanish from git; drop an empty pr-preview/ so the tree stays tidy.
  rmdir "$TREE/pr-preview" 2>/dev/null || true
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  rm -rf "$TREE"
  # The current tree and its commit, or an empty tree the first time (no branch yet;
  # the lease then requires that it still doesn't exist).
  lease=$(git ls-remote --heads "$REPO_URL" notebooks | cut -f1)
  if [ -n "$lease" ]; then
    git clone -q --depth 1 --branch notebooks "$REPO_URL" "$TREE"
    # the clone must be the commit the lease names; if it moved in between, retry
    [ "$(git -C "$TREE" rev-parse HEAD)" = "$lease" ] || { echo "notebooks moved while fetching — retrying"; continue; }
  else
    mkdir -p "$TREE" && git -C "$TREE" init -q && git -C "$TREE" remote add origin "$REPO_URL"
  fi

  apply "$@" || exit 0

  git -C "$TREE" config user.name  "github-actions[bot]"
  git -C "$TREE" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git -C "$TREE" checkout -q --orphan "publish-$attempt"
  git -C "$TREE" add -A
  git -C "$TREE" commit -q --allow-empty -m "$MSG"
  if git -C "$TREE" push -q --force-with-lease="refs/heads/notebooks:$lease" origin HEAD:refs/heads/notebooks 2>"$WORK/push.err"; then
    echo "published $(git -C "$TREE" ls-files | wc -l) files to notebooks ($MSG)"
    exit 0
  fi
  echo "notebooks changed under us (attempt $attempt/$ATTEMPTS): $(tail -1 "$WORK/push.err") — retrying"
  sleep $(( (RANDOM % 5) + attempt ))
done
echo "::error::could not publish to notebooks after $ATTEMPTS attempts"
exit 1
