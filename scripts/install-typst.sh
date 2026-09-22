#!/usr/bin/env bash
#
# scripts/install-typst.sh — install the pinned Typst release into a bin dir.
#
# Slide decks may be written in Typst (tex/<slug>/slides*.typ); the content
# build compiles them with `typst compile` (scripts/build-content.mjs). Typst
# is one static binary with no TeX dependency, so it is installed from the
# upstream GitHub release rather than apt — Ubuntu 24.04 (the CI runner image)
# ships no typst package at all. The version is pinned and the tarball is
# checksum-verified, so CI and every laptop compile a deck with the same
# binary. This file is the ONE definition: CI's "Typst" step runs it and keys
# its cache on this file's hash (bump the version here and the cache re-keys
# itself); ./setup.sh runs it too.
#
# Usage: scripts/install-typst.sh [bin-dir]      (default: ~/.local/bin)
# Idempotent: exits 0 without downloading when the pinned version is already
# there. To bump: change TYPST_VERSION, then refresh both SHA256s from
#   curl -sL https://github.com/typst/typst/releases/download/v<ver>/typst-<triple>.tar.xz | sha256sum

set -euo pipefail

TYPST_VERSION=0.15.1

BIN="${1:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64|Linux-amd64)
    TRIPLE=x86_64-unknown-linux-musl
    SHA256=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c ;;
  Linux-aarch64|Linux-arm64)
    TRIPLE=aarch64-unknown-linux-musl
    SHA256=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee ;;
  Darwin-*)
    echo "error: on macOS install Typst with Homebrew instead: brew install typst  (see setup-macos.sh)" >&2
    exit 1 ;;
  *)
    echo "error: no pinned Typst build for $(uname -s)/$(uname -m) — add its triple + sha256 above" >&2
    exit 1 ;;
esac

if [ -x "$BIN/typst" ] && "$BIN/typst" --version 2>/dev/null | grep -q "^typst $TYPST_VERSION\b"; then
  echo "typst $TYPST_VERSION already installed at $BIN/typst"
  exit 0
fi

URL="https://github.com/typst/typst/releases/download/v$TYPST_VERSION/typst-$TRIPLE.tar.xz"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "downloading $URL"
curl -fsSL --retry 3 --retry-delay 5 -o "$tmp/typst.tar.xz" "$URL"
echo "$SHA256  $tmp/typst.tar.xz" | sha256sum -c - >/dev/null \
  || { echo "error: checksum mismatch for $URL — refusing to install" >&2; exit 1; }
tar -xJf "$tmp/typst.tar.xz" -C "$tmp"
mkdir -p "$BIN"
install -m 0755 "$tmp/typst-$TRIPLE/typst" "$BIN/typst"
echo "installed $("$BIN/typst" --version) to $BIN/typst"
