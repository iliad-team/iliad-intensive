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
  ./run.sh ci              exactly what the GitHub CI action runs: full content
                        build + static site build; exit 0 = CI will be green
  ./run.sh build           static-export the site -> out/
  ./run.sh <script>        any other script from package.json

First time here? ./setup.sh installs everything (TeX Live, poppler,
Node via nvm, npm deps).

The edit loop for a worksheet:
  ./run.sh watch your-slug                 # edit main.tex, save, refresh browser

More: README.md (writing worksheets) · docs/DEVELOPMENT.md (pipeline internals)
EOF
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
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
if [ $# -gt 0 ]; then
  npm run "$script" -- "$@"
else
  npm run "$script"
fi
