#!/usr/bin/env bash
#
# ./setup.sh — install everything needed to develop this repo locally:
# TeX Live (+poppler) via apt, Node 22 via nvm, npm dependencies.
# Idempotent: re-running only installs what's missing.

set -euo pipefail
cd "$(dirname "$0")"

echo "== system packages (TeX Live, poppler) =="
# Keep this list in sync with .github/workflows/site.yml — installing the
# same packages keeps "passes locally, fails on CI" surprises to a minimum.
#
# The list is kept deliberately lean — it is the biggest single cost in a CI
# run, and a slow Ubuntu mirror can stall it for 15+ minutes. texlive-science is
# NOT here on purpose (see the note in the workflow): stmaryrd's two glyphs are
# built from kernel pieces. texlive-bibtex-extra was in the same category until
# a biblatex deck arrived — alphaurl.bst is still vendored at tex/alphaurl.bst,
# but biblatex.sty ships nowhere else on Ubuntu, so the package is needed now.
need=()
command -v pdflatex   >/dev/null || need+=(texlive-latex-extra texlive-pictures texlive-fonts-recommended cm-super)
command -v pdftocairo >/dev/null || need+=(poppler-utils)
# biblatex decks (C.2's) need both halves: biber, the backend that reads the
# .bib and writes the .bbl, and biblatex.sty itself, which on Ubuntu ships only
# in texlive-bibtex-extra. Neither comes with the metapackages above.
command -v biber       >/dev/null || need+=(biber)
kpsewhich biblatex.sty >/dev/null 2>&1 || need+=(texlive-bibtex-extra)
# lmodern.sty: decks load it, but it is only a Recommends of the texlive
# packages above, so --no-install-recommends leaves it out. Probed with
# kpsewhich rather than a command name — it is a style file, not a binary.
kpsewhich lmodern.sty >/dev/null 2>&1 || need+=(lmodern)
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
echo "pre-push hook enabled (runs ./run.sh ci + git lfs pre-push; bypass once with --no-verify)"

echo
echo "Done. Next steps:"
echo "  ./run.sh --help          the commands"
echo "  ./run.sh watch <slug>    live-edit a worksheet with the site running"
