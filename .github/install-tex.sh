#!/usr/bin/env bash
# TeX Live + poppler for the site build (.github/workflows/site.yml).
#
# The package set (and every per-package why) lives in
# .github/apt-packages.txt — one definition, shared with ./setup.sh
# and hashed into site.yml's apt cache key. Add packages THERE, not here.
#
# Two paths, because the Ubuntu mirrors cannot be trusted with the
# critical path. On 2026-08-19 azure.archive.ubuntu.com (the runners'
# preferred mirror) went down, every runner fell back to
# archive.ubuntu.com, and `apt-get update` trickled its index fetch
# for 19m41s — under the Acquire timeouts, which catch a dead socket,
# not a slow one — until the 20-minute job cap killed it. Six builds
# died that way, two of them production deploys, and the warm .deb
# cache could not help because apt insists on fetching fresh indexes
# before it will even look at /var/cache/apt/archives.
#
# WARM (the norm): install straight from the cached .debs with
#   `dpkg -i`, which reads only local files — no `apt-get update`, no
#   index fetch, no mirror anywhere. Gated by the cache's manifest so
#   a partial or foreign cache can never skip the real install.
# COLD (first run, 7-day eviction, list change, or any warm-path
#   surprise): real apt, with wall-clock `timeout`s so a trickling
#   mirror fails in minutes with a clear message instead of eating
#   the whole job budget. A successful cold run reseeds the cache
#   and writes the manifest, making the next run warm.
#
# site.yml runs this only when scripts/build-plan.mjs says some worksheet will
# compile, and in the background, so it overlaps the Node setup; the build step
# waits for it.

set -euo pipefail

# ── Only the pdflatex format ─────────────────────────────────────────────────
# tex-common's dpkg trigger rebuilds every format TeX Live ships (`fmtutil --sys
# --all`): 16 of them, the LuaTeX ones the slowest — 34 s of a 70 s warm install.
# Every build here is pdflatex (worksheets and decks alike), so divert
# texlive-base's /usr/bin/fmtutil — dpkg installs the real one as
# fmtutil.distrib — and put a wrapper in its place that turns --all into
# --byfmt pdflatex. Every other call passes through untouched. A deck that ever
# needs another engine will fail on its missing format: add it to the wrapper.
if [ -z "$(dpkg-divert --list /usr/bin/fmtutil)" ]; then
  sudo dpkg-divert --local --rename --divert /usr/bin/fmtutil.distrib --add /usr/bin/fmtutil
fi
sudo tee /usr/bin/fmtutil > /dev/null <<'WRAPPER'
#!/bin/bash
# CI only: .github/install-tex.sh put this here. Builds the pdflatex format
# where TeX Live's triggers ask for all of them.
args=()
for a in "$@"; do
  if [ "$a" = --all ]; then args+=(--byfmt=pdflatex); else args+=("$a"); fi
done
exec /usr/bin/fmtutil.distrib "${args[@]}"
WRAPPER
sudo chmod 755 /usr/bin/fmtutil

# The wanted set, from the one definition (strip comments/blanks).
PKGS=$(grep -vE '^\s*(#|$)' .github/apt-packages.txt | xargs)

# Every wanted package installed AND configured?
satisfied() {
  local p
  for p in $PKGS; do
    [ "$(dpkg-query -W -f '${db:Status-Status}' "$p" 2>/dev/null)" = installed ] || return 1
  done
}

# ── Warm path ──────────────────────────────────────────────────────
warm_install() {
  [ -f "$HOME/apt-debs/manifest" ] \
    || { echo "cache: no manifest — cold path"; return 1; }
  [ "$(cat "$HOME/apt-debs/manifest")" = "$PKGS" ] \
    || { echo "cache: manifest is for a different package list — cold path"; return 1; }
  compgen -G "$HOME/apt-debs/*.deb" > /dev/null \
    || { echo "cache: manifest but no .debs — cold path"; return 1; }

  # Pick the newest cached .deb per package (the cache accretes
  # superseded versions), then skip anything the runner image
  # already has at >= that version — handed an older .deb, dpkg
  # would happily DOWNGRADE a library the image has since upgraded.
  declare -A ver deb
  local d p v
  for d in "$HOME"/apt-debs/*.deb; do
    p=$(dpkg-deb -f "$d" Package); v=$(dpkg-deb -f "$d" Version)
    if [ -z "${ver[$p]:-}" ] || dpkg --compare-versions "$v" gt "${ver[$p]}"; then
      ver[$p]=$v; deb[$p]=$d
    fi
  done
  local todo=()
  for p in "${!deb[@]}"; do
    v=$(dpkg-query -W -f '${Version}' "$p" 2>/dev/null || true)
    if [ -z "$v" ] || dpkg --compare-versions "$v" lt "${ver[$p]}"; then
      todo+=("${deb[$p]}")
    fi
  done
  echo "warm: installing ${#todo[@]} cached .debs with dpkg (no apt, no mirror)"
  if [ "${#todo[@]}" -gt 0 ]; then
    # All in one call: dpkg unpacks everything, then configures in
    # dependency order itself, so the set needs no ordering from us.
    sudo dpkg -i "${todo[@]}" > /dev/null || return 1
  fi
  satisfied
}

if ! warm_install; then
  # ── Cold path ────────────────────────────────────────────────────
  # A failed warm path may leave packages unpacked-but-unconfigured,
  # which apt refuses to work around; repair before it runs.
  sudo dpkg --configure -a || true

  APT_OPTS="-o Acquire::Retries=3
            -o Acquire::http::Timeout=20
            -o Acquire::https::Timeout=20"

  # Seed apt's archive from whatever the cache had (possibly a
  # previous package list, via restore-keys). apt matches a .deb by
  # name, size and hash and silently skips re-downloading it, so
  # this is a pure download cache and staleness only means
  # "download the few that changed". --update=none so a cached file
  # never clobbers a newer one apt just fetched.
  if compgen -G "$HOME/apt-debs/*.deb" > /dev/null; then
    echo "cache: $(ls "$HOME"/apt-debs/*.deb | wc -l) .deb files restored"
    sudo cp --update=none "$HOME"/apt-debs/*.deb /var/cache/apt/archives/ || true
  else
    echo "cache: empty — everything will be downloaded"
  fi

  # Two layers of timeout, for two failure modes. The Acquire
  # options catch a DEAD connection (idle socket). `timeout` is a
  # wall-clock cap for the mirror that keeps trickling — apt has no
  # minimum-throughput setting, so a slow-but-alive transfer
  # otherwise runs forever (that is the 19m41s incident above).
  # Budgets: a healthy update is <40s, a healthy cold install ~330s;
  # both caps clear the 20-minute job budget with the ~4-minute
  # build behind them.
  sudo timeout 300 apt-get update -q $APT_OPTS \
    || { echo "::error::apt-get update failed or stalled — likely an Ubuntu mirror incident; re-run this job"; exit 1; }
  # --fix-broken: also finish/repair anything a failed warm path
  # left behind, in the same resolver run.
  sudo timeout 600 apt-get install -y --fix-broken --no-install-recommends $APT_OPTS $PKGS \
    || { echo "::error::apt-get install failed or stalled — likely an Ubuntu mirror incident; re-run this job"; exit 1; }

  # Hand what apt fetched back to the cache for the next warm run.
  mkdir -p "$HOME/apt-debs"
  cp --update=none /var/cache/apt/archives/*.deb "$HOME/apt-debs/" 2>/dev/null || true
  echo "cache: $(ls "$HOME"/apt-debs/*.deb 2>/dev/null | wc -l) .deb files kept ($(du -sh "$HOME/apt-debs" | cut -f1))"
fi

# The wrapper above is only safe while pdflatex's format really got built.
[ -n "$(kpsewhich -engine=pdftex pdflatex.fmt)" ] \
  || { echo "::error::pdflatex.fmt was not built — see the fmtutil wrapper in .github/install-tex.sh"; exit 1; }

# The warm-path gate. Written LAST, and only on success (set -e), so
# it can only ever describe a set this very run proved installable.
mkdir -p "$HOME/apt-debs"
printf '%s\n' "$PKGS" > "$HOME/apt-debs/manifest"
# The slides ladder picks bibtex or biber from the deck's own source
# (scripts/build-content.mjs).
# contributor LaTeX is untrusted: never enable shell-escape
