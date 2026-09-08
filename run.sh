#!/usr/bin/env bash
#
# ./run.sh — run the site's npm scripts with the right Node version.
#
# Works from any shell (fish included): the bash shebang means nvm — which is a
# bash-only sourced function and cannot run under fish — is loaded here in bash.
# Next.js 16 needs Node >= 20.9.0; system Node is 18.x, so we select nvm's Node.

set -euo pipefail

usage() {
  cat <<'EOF'
./run.sh — Iliad Intensive site, with the right Node version selected via nvm

Usage:
  ./run.sh                 start the dev server -> http://localhost:3000
  ./run.sh watch [slug]    LIVE authoring: dev server + rebuild on every save
                        (slug = only that worksheet; without = any worksheet)
  ./run.sh preview [slug]  PRODUCTION-SPEED preview: serves a static build and
                        rebuilds on save (auto-reloads the browser). With a slug,
                        a save re-renders only that section. -> http://localhost:4321
  ./run.sh content [slug]  build worksheets: tex/mdx -> pages, PDFs, downloads
                        (no slug = all; add --check for the fast gate only)
  ./run.sh ci [slug ...]   exactly what the GitHub CI action runs: full content
                        build + static site build; exit 0 = CI will be green
                        (slugs = build only those worksheets' content, then the
                        whole site from whatever content/ already holds)
  ./run.sh build           static-export the site -> out/
  ./run.sh slugs           list every worksheet slug, one per line
  ./run.sh <script>        any other script from package.json

Don't know the slug? `./run.sh slugs` lists them, and -i (--pick) in place of a
slug picks one with fzf, if fzf is installed:
  ./run.sh ci -i           pick the worksheets to build, then run CI on them

First time here? ./setup.sh installs everything (TeX Live, poppler,
Node via nvm, npm deps).

The edit loop for a worksheet:
  ./run.sh watch your-slug                 # edit main.tex, save, refresh browser

More: README.md (writing worksheets) · docs/DEVELOPMENT.md (pipeline internals)
EOF
}

# The worksheet slugs: every tex/<slug>/ holding a main.tex or main.mdx — the
# same rule build-content.mjs applies. Read straight off the filesystem, so
# `slugs` costs no Node and stays pipe-clean (`./run.sh slugs | xargs …`).
here="$(cd -- "$(dirname -- "$0")" && pwd)"
list_slugs() {
  local d
  for d in "$here"/tex/*/; do
    [ -f "${d}main.tex" ] || [ -f "${d}main.mdx" ] || continue
    basename "$d"
  done
}

# -i / --pick: choose the worksheet(s) instead of typing a slug. fzf is NOT a
# dependency of this repo — deliberately, since `slugs` already answers "what
# can I build?" — so when it is missing the whole cost is this message.
# $1 non-empty = several may be picked (content, ci); empty = exactly one
# (watch and preview both read a single argv[2]).
pick_slugs() {
  local multi=$1
  if ! command -v fzf >/dev/null 2>&1; then
    echo "error: -i needs fzf (sudo apt install fzf). Without it, list the" >&2
    echo "       worksheets with ./run.sh slugs and pass one by name." >&2
    exit 1
  fi
  list_slugs | fzf ${multi:+--multi} --height=40% --reverse --prompt='worksheet> ' \
    --header="${multi:+tab to pick several · }enter to run · esc to cancel" \
    || { echo "nothing picked — cancelled." >&2; exit 1; }
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  slugs) list_slugs; exit 0 ;;
esac

# Load nvm.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "error: nvm not found at $NVM_DIR — install it or edit this script." >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# Use the project's Node version (.nvmrc) if present, else nvm's default.
if [ -f .nvmrc ]; then
  nvm use >/dev/null
else
  nvm use default >/dev/null
fi

echo "Using $(node --version) via nvm"

# Run the requested npm script (defaults to dev); extra args pass through.
script="${1:-dev}"
shift 2>/dev/null || true

# -i / --pick anywhere in the arguments is replaced by the fzf choice. Done here
# rather than in each script so every slug-taking subcommand gets it at once.
# pick_slugs exits on a cancel or a missing fzf; `|| exit 1` propagates that out
# of the command substitution instead of quietly building everything.
argv=()
for a in "$@"; do
  case "$a" in
    -i|--pick)
      case "$script" in
        content|ci)    chosen="$(pick_slugs 1)"  || exit 1 ;;
        watch|preview) chosen="$(pick_slugs "")" || exit 1 ;;
        *) echo "error: -i applies to watch, preview, content and ci — not '$script'." >&2; exit 1 ;;
      esac
      while IFS= read -r pick; do [ -n "$pick" ] && argv+=("$pick"); done <<< "$chosen"
      ;;
    *) argv+=("$a") ;;
  esac
done
set -- ${argv[@]+"${argv[@]}"}

# `ci` is a compound npm script (content build && next build && post-checks), so
# `npm run ci -- slug` would tack the slug onto the LAST command, not the content
# build. Slugs go in via CI_SLUGS, which the script expands unquoted at the front.
if [ "$script" = "ci" ]; then
  if [ $# -gt 0 ]; then
    export CI_SLUGS="$*"
    echo "ci: content build limited to $CI_SLUGS (the site build is always the full one)"
  fi
  npm run ci
  exit
fi

if [ $# -gt 0 ]; then
  npm run "$script" -- "$@"
else
  npm run "$script"
fi
