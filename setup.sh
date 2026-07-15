#!/usr/bin/env bash
#
# ./setup.sh — install everything needed to develop this repo locally:
# TeX Live (+poppler, pandoc) via apt, Node 22 via nvm, npm dependencies.
# Idempotent: re-running only installs what's missing.

set -euo pipefail
cd "$(dirname "$0")"

echo "== system packages (TeX Live, poppler, pandoc) =="
# Keep this list in sync with .github/workflows/site.yml — installing the
# same packages keeps "passes locally, fails on CI" surprises to a minimum.
need=()
command -v pdflatex   >/dev/null || need+=(texlive-latex-extra texlive-pictures texlive-science texlive-fonts-recommended cm-super lmodern)
command -v pdftocairo >/dev/null || need+=(poppler-utils)
command -v pandoc     >/dev/null || need+=(pandoc)
command -v git-lfs    >/dev/null || need+=(git-lfs)
if [ ${#need[@]} -gt 0 ]; then
  echo "installing: ${need[*]}"
  sudo apt-get update -q
  sudo apt-get install -y --no-install-recommends "${need[@]}"
else
  echo "already installed"
fi

echo
echo "== Node >= 20.9 via nvm =="
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22 >/dev/null 2>&1 || nvm install 22
nvm use 22 >/dev/null
echo "node $(node --version)"

echo
echo "== npm dependencies =="
npm install --no-audit --no-fund
npm install --no-audit --no-fund --prefix scripts/tex2mdx

echo
echo "== git LFS (figures under tex/**/fig/*.png) =="
git lfs install --local
git lfs pull || echo "  (git lfs pull skipped — no remote objects yet)"

echo
echo "== git hooks =="
git config core.hooksPath .githooks
echo "pre-commit hook enabled (rejects binary assets committed outside Git LFS)"
echo "pre-push hook enabled (runs ./run.sh ci + git lfs pre-push; bypass once with --no-verify)"

echo
echo "Done. Next steps:"
echo "  ./run.sh --help          the commands"
echo "  ./run.sh watch <slug>    live-edit a worksheet with the site running"
