#!/usr/bin/env bash
#
# scripts/new-worktree.sh — spin up (or re-wire) a dev worktree for this repo.
#
# `git worktree add` only materialises the COMMITTED files; everything
# gitignored is absent in a fresh worktree. This script creates (or reuses) a
# branch + a worktree under ./worktrees/<name>, then wires up the gitignored
# bits a worktree needs to actually build:
#   • the top-level node_modules symlink
#   • the tex2mdx converter's nested node_modules symlink (holds bibtex-parse,
#     @unified-latex/* — the content build fails without it)
#   • LFS file contents (smudge any pointers)
# Optionally copies a source clone into the gitignored _src_repo/ for porting.
#
# Usage:
#   scripts/new-worktree.sh <name> [base-ref] [--src <source-clone-dir>]
#
# Examples:
#   scripts/new-worktree.sh port-b.6-claude                       # branch off main
#   scripts/new-worktree.sh port-b.6-claude main --src ~/clones/foo
#
# Idempotent: safe to re-run on an existing worktree to (re)create missing
# symlinks or refresh LFS files.
#
# NOTE: never `npm install` through the symlinks — that mutates the main
# checkout's node_modules. Install in the main checkout instead.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

# ---- args ------------------------------------------------------------------
name=""; base="main"; src=""
while [ $# -gt 0 ]; do
  case "$1" in
    --src) shift; src="${1:-}"; [ -n "$src" ] || die "--src needs a path" ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;;
    -*) die "unknown flag: $1" ;;
    *) if [ -z "$name" ]; then name="$1"; else base="$1"; fi ;;
  esac
  shift
done
[ -n "$name" ] || die "usage: $(basename "$0") <name> [base-ref] [--src <source-clone-dir>]"

# ---- locate the main checkout ----------------------------------------------
MAIN=$(cd "$(git rev-parse --git-common-dir)/.." && pwd) || die "not inside a git repo"
WT="$MAIN/worktrees/$name"

[ -d "$MAIN/node_modules" ] \
  || die "main checkout has no node_modules — run 'npm ci' in $MAIN first"
[ -d "$MAIN/scripts/tex2mdx/node_modules" ] \
  || die "missing $MAIN/scripts/tex2mdx/node_modules — run 'npm ci --prefix scripts/tex2mdx' in $MAIN first"

# ---- create or reuse the worktree ------------------------------------------
mkdir -p "$MAIN/worktrees"
if git -C "$MAIN" worktree list --porcelain | grep -qxF "worktree $WT"; then
  echo "• worktree already exists: $WT (reusing)"
elif [ -e "$WT" ]; then
  die "$WT exists but is not a registered worktree — remove it or pick another name"
elif git -C "$MAIN" show-ref --verify --quiet "refs/heads/$name"; then
  echo "• branch '$name' exists — checking it out into a new worktree"
  git -C "$MAIN" worktree add "$WT" "$name"
else
  echo "• creating branch '$name' off '$base' + worktree"
  git -C "$MAIN" worktree add -b "$name" "$WT" "$base"
fi

# ---- symlink the two gitignored node_modules -------------------------------
link() {  # link <target> <linkname>
  local target="$1" linkname="$2"
  if [ -L "$linkname" ]; then
    echo "  ✓ $linkname (symlink present)"
  elif [ -e "$linkname" ]; then
    echo "  ! $linkname exists and is not a symlink — leaving as-is"
  else
    mkdir -p "$(dirname "$linkname")"
    ln -s "$target" "$linkname"
    echo "  + $linkname -> $target"
  fi
}
echo "• node_modules symlinks:"
link "$MAIN/node_modules"                 "$WT/node_modules"
link "$MAIN/scripts/tex2mdx/node_modules" "$WT/scripts/tex2mdx/node_modules"

# ---- LFS file contents ------------------------------------------------------
if command -v git-lfs >/dev/null 2>&1; then
  echo "• git lfs checkout"
  git -C "$WT" lfs checkout >/dev/null 2>&1 || echo "  (nothing to smudge)"
else
  echo "• git-lfs not installed — skipping LFS checkout"
fi

# ---- optional source material into _src_repo/ ------------------------------
if [ -n "$src" ]; then
  [ -d "$src" ] || die "--src path not found: $src"
  echo "• copying source clone into _src_repo/"
  mkdir -p "$WT/_src_repo"
  cp -r "$src"/. "$WT/_src_repo/"
fi

echo
echo "✓ worktree ready: $WT"
echo "    cd $WT"
echo "    ./run.sh watch <slug>     # content build + live preview (works via the symlinks)"
echo "    # full 'next build' / pre-push CI: run from the main checkout on the branch,"
echo "    # or replace the symlinks with real installs."
