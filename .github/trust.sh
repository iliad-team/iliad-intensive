#!/usr/bin/env bash
# trust.sh <login> <author_association> — prints "true" if a pull request by
# <login> may get our automation (auto-run CI, a live preview, /dev/diff
# snapshots), else "false". Always exits 0 unless misused; fails closed.
#
# Trusted:
#   - author_association OWNER, MEMBER or COLLABORATOR — people with standing
#     in the repo or the org, who can push branches here anyway; or
#   - <login> listed in .github/trusted-contributors ON main.
# Having had a PR merged (association CONTRIBUTOR) no longer counts on its own.
#
# The list is always read from main through the GitHub API, never from the
# working tree, so a PR editing the list cannot trust itself, whichever ref a
# caller happens to have checked out. If the list can't be read, only the
# association counts. Callers: approve-trusted.yml, fork-preview.yml,
# snapshots-dispatch.yml, and iliad-intensive-snapshots' update.yml.
#
# Env: GITHUB_REPOSITORY (default iliad-team/iliad-intensive); GH_TOKEN if set
# (the file is public, so it works without one too).
set -uo pipefail

login="${1:?usage: trust.sh <login> <author_association>}"
assoc="${2:-NONE}"
repo="${GITHUB_REPOSITORY:-iliad-team/iliad-intensive}"

case "$assoc" in
  OWNER|MEMBER|COLLABORATOR) echo true; exit 0 ;;
esac

list=$(curl -fsSL --retry 3 --max-time 20 \
  ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} \
  -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/$repo/contents/.github/trusted-contributors?ref=main") || {
  echo "::warning::could not read .github/trusted-contributors from main — treating $login as untrusted" >&2
  echo false; exit 0
}

# GitHub logins are case-insensitive; compare lowercased, ignoring comments.
if sed 's/#.*//' <<<"$list" | tr -s ' \t' '\n' | grep -qixF -- "$login"; then
  echo true
else
  echo false
fi
