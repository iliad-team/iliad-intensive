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
# Like gh-pages it keeps no history — every write force-pushes ONE orphan commit
# holding the whole tree — so each command fetches the current tree, edits only
# the part it owns, and publishes all of it: whatever is missing when this pushes
# is unpublished. Callers serialise on one concurrency group (notebooks-write).
#
# Needs GITHUB_TOKEN and GITHUB_REPOSITORY; `sweep` also needs `gh` (GH_TOKEN).
set -euo pipefail

cmd="${1:?usage: notebooks-branch.sh production <dir> | preview <N> <dir> | remove <N> | sweep}"
# NOTEBOOKS_REMOTE overrides the remote (a local bare repo, for testing this script).
REPO_URL="${NOTEBOOKS_REMOTE:-https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git}"
WORK="${RUNNER_TEMP:-/tmp}/notebooks-branch"
rm -rf "$WORK"

# The current tree, or an empty one the first time (the branch doesn't exist yet).
if git ls-remote --exit-code --heads "$REPO_URL" notebooks >/dev/null 2>&1; then
  git clone -q --depth 1 --branch notebooks "$REPO_URL" "$WORK"
else
  mkdir -p "$WORK" && git -C "$WORK" init -q && git -C "$WORK" remote add origin "$REPO_URL"
fi

pr_dir() {
  case "$1" in ''|*[!0-9]*) echo "::error::bad PR number '$1'"; exit 1 ;; esac
  echo "$WORK/pr-preview/pr-$1"
}

case "$cmd" in
  production)
    src="${2:?production needs the built tree}"
    # Fresh root, open previews kept.
    find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git ! -name pr-preview -exec rm -rf {} +
    cp -a "$src/." "$WORK/"
    msg="notebooks @ ${GITHUB_SHA:-local}"
    ;;
  preview)
    dir=$(pr_dir "${2:-}"); src="${3:?preview needs the built tree}"
    rm -rf "$dir" && mkdir -p "$dir" && cp -a "$src/." "$dir/"
    msg="Notebook preview for PR #$2"
    ;;
  remove)
    dir=$(pr_dir "${2:-}")
    [ -d "$dir" ] || { echo "no notebook preview for PR #$2 — nothing to remove"; exit 0; }
    rm -rf "$dir"
    msg="Remove notebook preview for PR #$2"
    ;;
  sweep)
    # Delete only on a definitive CLOSED/MERGED; an API failure keeps the preview
    # (the same rule as site.yml's preview-sweep).
    removed=()
    shopt -s nullglob
    for d in "$WORK"/pr-preview/pr-*/; do
      n=$(basename "$d"); n=${n#pr-}
      case "$n" in ''|*[!0-9]*) continue ;; esac
      state=$(gh pr view "$n" --repo "$GITHUB_REPOSITORY" --json state -q .state 2>/dev/null) || state=UNKNOWN
      case "$state" in
        CLOSED|MERGED) rm -rf "$d"; removed+=("#$n"); echo "sweep pr-$n ($state)" ;;
        *) echo "keep  pr-$n ($state)" ;;
      esac
    done
    [ ${#removed[@]} -gt 0 ] || { echo "nothing to sweep"; exit 0; }
    msg="Sweep notebook previews: ${removed[*]}"
    ;;
  *) echo "unknown command: $cmd"; exit 1 ;;
esac

# Empty directories vanish from git; drop an empty pr-preview/ so the tree stays tidy.
rmdir "$WORK/pr-preview" 2>/dev/null || true

cd "$WORK"
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q --orphan publish
git add -A
git commit -q --allow-empty -m "$msg"
git push -q --force origin HEAD:notebooks
echo "published $(git ls-files | wc -l) files to notebooks ($msg)"
