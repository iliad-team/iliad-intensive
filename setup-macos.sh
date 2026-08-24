#!/usr/bin/env bash
#
# ./setup-macos.sh — macOS companion to setup.sh (which assumes apt/Ubuntu);
# ./setup.sh execs this on Darwin, so you never need to call it directly.
# Installs TeX Live (MacTeX) and poppler via Homebrew, then everything
# else identically to setup.sh. Idempotent: re-running only installs
# what's missing.
#
# MacTeX (even -no-gui) is a full TeX Live, so the packages setup.sh probes
# for one by one (biber, biblatex, lmodern, cm-super) are all included.

set -euo pipefail
cd "$(dirname "$0")"

echo "== Homebrew =="
if ! command -v brew >/dev/null; then
  echo "Homebrew not found — install it first:"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi

echo
echo "== system packages (TeX Live, poppler) =="
need=()
command -v pdftocairo >/dev/null || need+=(poppler)
command -v git-lfs    >/dev/null || need+=(git-lfs)
if [ ${#need[@]} -gt 0 ]; then
  echo "installing: ${need[*]}"
  brew install "${need[@]}"
else
  echo "already installed"
fi

if ! command -v pdflatex >/dev/null; then
  echo "installing MacTeX (no GUI) — this is a large download..."
  brew install --cask mactex-no-gui
  # Make TeX available in this shell without opening a new terminal
  eval "$(/usr/libexec/path_helper)"
fi
echo "pdflatex: $(command -v pdflatex || echo 'NOT FOUND — open a new terminal and re-run')"

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
# --skip-repo: only set the smudge/clean filters. The hook half would try to
# write into the pinned .githooks (npm's prepare script sets core.hooksPath
# before this runs) and abort on the custom pre-push there — which already
# calls `git lfs pre-push` itself.
git lfs install --local --skip-repo
git lfs pull || echo "  (git lfs pull skipped — no remote objects yet)"

echo
echo "== git hooks =="
git config core.hooksPath .githooks
echo "pre-push hook enabled (runs ./run.sh ci + git lfs pre-push; bypass once with --no-verify)"

echo
echo "Done. Next steps:"
echo "  ./run.sh --help          the commands"
echo "  ./run.sh watch <slug>    live-edit a worksheet with the site running"