#!/usr/bin/env bash
# notebooks-branch.sh — every write to the notebook branches (docs/NOTEBOOKS.md).
#
#   notebooks-branch.sh production <dir>   <dir>/ becomes the `notebooks` branch
#   notebooks-branch.sh preview <N> <dir>  <dir>/ becomes the `notebooks-pr-<N>` branch
#   notebooks-branch.sh remove <N>         delete `notebooks-pr-<N>`
#   notebooks-branch.sh sweep              delete every `notebooks-pr-<N>` whose PR is closed
#
# Production notebooks live on `notebooks`, written only by a push to main. Each
# same-repo PR's preview lives on its own `notebooks-pr-<N>` branch, written only
# by that PR's runs and deleted when it closes. So a PR — including a buggy
# version of this very script in a PR — never writes production's branch, and no
# branch ever has two writers: no locking, no merging, no retries.
#
# Every branch holds build output only, so each write force-pushes ONE orphan
# commit with the whole tree: no history accumulates. Deleted branches' objects
# are garbage-collected by GitHub in its own time.
#
# Needs GITHUB_TOKEN and GITHUB_REPOSITORY; `sweep` also needs `gh` (GH_TOKEN).
set -euo pipefail

cmd="${1:?usage: notebooks-branch.sh production <dir> | preview <N> <dir> | remove <N> | sweep}"
# NOTEBOOKS_REMOTE overrides the remote (a local bare repo, for testing this script).
REPO_URL="${NOTEBOOKS_REMOTE:-https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git}"

check_pr() { case "$1" in ''|*[!0-9]*) echo "::error::bad PR number '$1'"; exit 1 ;; esac; }

# Force-push the tree in $1 as the only commit of branch $2.
publish() {
  local src work
  src="$(realpath "$1")"
  work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/notebooks-branch.XXXXXX")"
  cp -a "$src/." "$work/"
  git -C "$work" init -q -b "$2"
  git -C "$work" config user.name  "github-actions[bot]"
  git -C "$work" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git -C "$work" add -A
  git -C "$work" commit -q --allow-empty -m "$3"
  git -C "$work" push -q --force "$REPO_URL" "HEAD:refs/heads/$2"
  echo "published $(git -C "$work" ls-files | wc -l) files to $2 ($3)"
  rm -rf "$work"
}

delete_branch() {
  if git ls-remote --exit-code --heads "$REPO_URL" "$1" >/dev/null 2>&1; then
    # From a scratch repo, not the checkout: pushing from a clone with the repo's
    # hooks enabled would run its pre-push hook (the whole CI ladder) for a delete.
    local tmp; tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/notebooks-branch.XXXXXX")"
    git -C "$tmp" init -q
    git -C "$tmp" push -q "$REPO_URL" --delete "$1"
    rm -rf "$tmp"
    echo "deleted $1"
  else
    echo "no branch $1 — nothing to delete"
  fi
}

case "$cmd" in
  production)
    # Belt and braces: only a build of main may publish production. (The workflow
    # already gates this step; this catches a PR that calls it by mistake.)
    if [ -z "${NOTEBOOKS_REMOTE:-}" ] && [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
      echo "::error::refusing to publish production notebooks from ${GITHUB_REF:-?} — only main does that"
      exit 1
    fi
    publish "${2:?production needs the built tree}" notebooks "notebooks @ ${GITHUB_SHA:-local}"
    ;;
  preview)
    check_pr "${2:-}"
    publish "${3:?preview needs the built tree}" "notebooks-pr-$2" "Notebook preview for PR #$2 @ ${GITHUB_SHA:-local}"
    ;;
  remove)
    check_pr "${2:-}"
    delete_branch "notebooks-pr-$2"
    ;;
  sweep)
    # Delete only on a definitive CLOSED/MERGED; an API failure keeps the branch
    # (the same rule as site.yml's preview-sweep).
    for ref in $(git ls-remote --heads "$REPO_URL" 'notebooks-pr-*' | cut -f2); do
      n=${ref#refs/heads/notebooks-pr-}
      case "$n" in ''|*[!0-9]*) continue ;; esac
      state=$(gh pr view "$n" --repo "$GITHUB_REPOSITORY" --json state -q .state 2>/dev/null) || state=UNKNOWN
      case "$state" in
        CLOSED|MERGED) echo "sweep notebooks-pr-$n ($state)"; delete_branch "notebooks-pr-$n" ;;
        *) echo "keep  notebooks-pr-$n ($state)" ;;
      esac
    done
    ;;
  *) echo "unknown command: $cmd"; exit 1 ;;
esac
