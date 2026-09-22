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
# Optionally copies a source clone into the gitignored _src_repo/ for porting,
# and — with --init — scaffolds an empty worksheet module in tex/<slug>/.
#
# Usage:
#   scripts/new-worktree.sh <name> [base-ref] [--src <dir>] [--init[=<slug>]]
#
# Examples:
#   scripts/new-worktree.sh port-b.6-claude                       # branch off main
#   scripts/new-worktree.sh port-b.6-claude main --src ~/clones/foo
#   scripts/new-worktree.sh port-b.6-claude --init                # then answer the prompts
#   scripts/new-worktree.sh port-b.6-claude --init=power-seeking  # slug pre-filled
#
# --init asks a handful of questions (LaTeX or MDX, title, author, whether you
# want slides.tex / biblo.bib, which schedule.yaml day the sheet belongs to) and
# writes a skeleton tex/<slug>/ — the same shape as tex/example/, minus the
# figures: main.tex or main.mdx, an empty fig/, and whatever else you asked for.
# It needs a terminal; without --init the script behaves exactly as it always
# has, so agents and CI are unaffected.
#
# Idempotent: safe to re-run on an existing worktree to (re)create missing
# symlinks or refresh LFS files. --init refuses to touch an existing tex/<slug>/.
#
# NOTE: never `npm install` through the symlinks — that mutates the main
# checkout's node_modules. Install in the main checkout instead.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

# ---- args ------------------------------------------------------------------
name=""; base="main"; src=""; init=0; slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --src) shift; src="${1:-}"; [ -n "$src" ] || die "--src needs a path" ;;
    --init) init=1 ;;
    --init=*) init=1; slug="${1#--init=}" ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;;
    -*) die "unknown flag: $1" ;;
    *) if [ -z "$name" ]; then name="$1"; else base="$1"; fi ;;
  esac
  shift
done
[ -n "$name" ] || die "usage: $(basename "$0") <name> [base-ref] [--src <dir>] [--init[=<slug>]]"

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

#==============================================================================
# --init: scaffold an empty worksheet module in the worktree's tex/<slug>/
#==============================================================================

# sed-safe replacement text (the templates below are literal heredocs with
# @PLACEHOLDER@ tokens; titles and names are substituted in afterwards).
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

# slug-to-title: "singular-learning-theory" -> "Singular Learning Theory"
title_from_slug() {
  printf '%s' "$1" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2); print}'
}

ask() {  # ask <prompt> <default> -> answer on stdout
  local prompt="$1" default="${2:-}" reply=""
  if [ -n "$default" ]; then
    read -r -p "  $prompt [$default]: " reply || true
    printf '%s' "${reply:-$default}"
  else
    read -r -p "  $prompt: " reply || true
    printf '%s' "$reply"
  fi
}

ask_yn() {  # ask_yn <prompt> <y|n default> -> 0 = yes
  local prompt="$1" default="$2" reply=""
  local hint="[y/N]"; [ "$default" = y ] && hint="[Y/n]"
  read -r -p "  $prompt $hint: " reply || true
  reply="${reply:-$default}"
  case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# Add <slug> to the `worksheets:` list of day <code> in schedule.yaml, creating
# the key if the day has none. Exit: 0 written · 2 the day is `port: never` ·
# 3 no such day code.
schedule_add() {  # schedule_add <schedule.yaml> <day-code> <slug>
  local file="$1" code="$2" add="$3" tmp status=0
  tmp="$(mktemp)"
  awk -v code="$code" -v slug="$add" '
    function flush(   i, last) {
      if (wsline > 0) {
        for (i = 1; i <= n; i++) {
          print buf[i]
          if (i == lastitem) print fieldindent "  - " slug
        }
      } else {
        last = n
        while (last > 0 && buf[last] ~ /^[ \t]*$/) last--
        for (i = 1; i <= last; i++) print buf[i]
        print fieldindent "worksheets:"
        print fieldindent "  - " slug
        for (i = last + 1; i <= n; i++) print buf[i]
      }
      n = 0; wsline = 0; lastitem = 0
    }
    /^[ ]*- code:/ {
      if (inday) { flush(); inday = 0 }
      val = $0
      sub(/^[ ]*- code:[ ]*/, "", val)
      gsub(/^[ "]+|[ "]+$/, "", val)
      if (val == code && !found) {
        found = 1; inday = 1; n = 0; wsline = 0; lastitem = 0
        match($0, /^[ ]*/); dayindent = substr($0, 1, RLENGTH)
        fieldindent = dayindent "  "
        buf[++n] = $0
        next
      }
    }
    {
      if (inday) {
        if ($0 !~ /^[ \t]*$/) {
          match($0, /^[ ]*/)
          if (RLENGTH <= length(dayindent)) { flush(); inday = 0; print; next }
        }
        if ($0 ~ "^" fieldindent "port:[ ]*never") { err = 2; exit 2 }
        buf[++n] = $0
        if ($0 ~ "^" fieldindent "worksheets:") { wsline = n; lastitem = n }
        else if (wsline > 0 && $0 ~ "^" fieldindent "  - ") lastitem = n
        next
      }
      print
    }
    END {
      if (err) exit err
      if (inday) flush()
      if (!found) exit 3
    }
  ' "$file" > "$tmp" || status=$?
  if [ "$status" -ne 0 ]; then rm -f "$tmp"; return "$status"; fi
  mv "$tmp" "$file"
}

init_module() {
  [ -t 0 ] || die "--init asks questions — run it from a terminal"

  echo
  echo "• new worksheet module"

  # ---- slug ----------------------------------------------------------------
  while :; do
    [ -n "$slug" ] || slug="$(ask 'slug (folder under tex/, e.g. singular-learning-theory)' '')"
    if [ -z "$slug" ]; then
      echo "    a slug is required" >&2
    elif ! printf '%s' "$slug" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
      echo "    lowercase letters, digits and single hyphens only" >&2; slug=""
    elif [ -e "$WT/tex/$slug" ]; then
      echo "    tex/$slug already exists — pick another slug" >&2; slug=""
    else
      break
    fi
  done

  # ---- format --------------------------------------------------------------
  echo
  echo "  format:"
  echo "    [1] tex — LaTeX worksheet: PDF downloads + web page (main.tex)"
  echo "    [2] mdx — web page only, e.g. a reading day (main.mdx)"
  local fmt=""
  while :; do
    fmt="$(ask 'choice' '1')"
    case "$fmt" in
      1|tex) fmt=tex; break ;;
      2|mdx) fmt=mdx; break ;;
      *) echo "    answer 1 or 2" >&2 ;;
    esac
  done

  # ---- metadata ------------------------------------------------------------
  echo
  local title author
  title="$(ask 'title' "$(title_from_slug "$slug")")"
  author="$(ask 'author' "$(git -C "$MAIN" config user.name || true)")"
  [ -n "$author" ] || author="TODO Author"

  # ---- extras --------------------------------------------------------------
  local want_slides=0 want_bib=0
  if ask_yn 'slides.tex (a beamer deck the build compiles to slides.pdf)?' \
            "$([ "$fmt" = tex ] && echo y || echo n)"; then want_slides=1; fi
  if [ "$fmt" = tex ]; then
    if ask_yn 'biblo.bib (bibtex bibliography)?' y; then want_bib=1; fi
  fi

  # ---- schedule ------------------------------------------------------------
  echo
  local day
  day="$(ask 'schedule.yaml day code to list it under, e.g. B.4 (blank to skip)' '')"

  # ---- write ---------------------------------------------------------------
  local dir="$WT/tex/$slug"
  mkdir -p "$dir/fig"
  # git cannot track an empty directory; the placeholder keeps fig/ around
  # until the first real figure lands (delete it then).
  : > "$dir/fig/.gitkeep"

  local subs=(-e "s|@TITLE@|$(esc "$title")|g" -e "s|@AUTHOR@|$(esc "$author")|g" -e "s|@SLUG@|$(esc "$slug")|g")

  if [ "$fmt" = tex ]; then
    {
      cat <<'EOF'
% YAML frontmatter for the website sits in the block below. LaTeX ignores it;
% the converter lifts it into the module frontmatter and CI validates it.
% Keys: title, summary, contributors — all optional (title/contributors are
% read from \title{}/\author{} when absent). `summary:` is the sheet's
% OVERVIEW: the page header shows it under the title and the index reuses it,
% so keep it one tight paragraph — and never write an "Overview" section in
% the body. The sheet's cluster and day are NOT keys here: list this slug
% under its day in schedule.yaml and the build stamps both in.
%--- iliad -------------------------------------------------------------------
% title: "@TITLE@"
% summary: >-
%   TODO — one tight paragraph saying what this sheet covers. (An unwritten
%   summary draws a build warning, which is the point.)
%--- end ----------------------------------------------------------------------
\documentclass[11pt]{article}

% The ONE required package: exercise, solution, proof, callout, remark,
% definition/theorem/lemma/…, the \ifsolutions toggle, hyperref + cleveref.
% Local copy first (Overleaf), else the shared ../iliad.sty.
\IfFileExists{iliad.sty}{\usepackage[boxes]{iliad}}{\usepackage[boxes]{../iliad}}

% \solutionsfalse   % uncomment to hide all solutions from the PDF

% ---- Free zone: your own packages and macros -------------------------------
% Macros become KaTeX \gdef's automatically (avoid \mathchoice and
% optional-arg macros — the converter warns if it cannot translate one).
\newcommand{\R}{\mathbb{R}}

\title{@TITLE@}
\author{@AUTHOR@}
\date{\today}

\begin{document}
\maketitle

% Front matter opens every sheet in this fixed order: video embeds (optional),
% Prerequisites, then the learning-outcomes box — then the content.
% \youtube{VIDEO_ID}   % 11-character id, never the full URL

%===============================================================================
\section{Prerequisites}
\label{sec:prereqs}

\begin{itemize}
  \item TODO — what a participant needs before this sheet.
\end{itemize}

% The "What you'll learn" box. A single itemize is fine; group the outcomes
% under \subsection*{...} headings once the list gets long.
\begin{learningoutcomes}
  \begin{itemize}
    \item TODO — what they will be able to do afterwards.
  \end{itemize}
\end{learningoutcomes}

%===============================================================================
\section{TODO first section}
\label{sec:first}

TODO — ordinary \LaTeX{} prose. Inline math is copied byte-for-byte:
$e^{i\pi} + 1 = 0$. Cross-reference anything you label with \cref{sec:prereqs}.

\begin{exercise}[TODO title]
\label{ex:first}
TODO — the optional argument is the exercise's title; subparts are a plain
\texttt{enumerate}. Add \verb|\important| after the label to star it.
\end{exercise}

% Every solution names its exercise — [ex:label] is mandatory — so solutions
% may sit inline or be collected at the end. The web always moves them under
% their exercise.
\begin{solution}[ex:first]
TODO
\end{solution}

EOF
      if [ "$want_bib" = 1 ]; then
        cat <<'EOF'
% A citation keeps bibtex fed: `\bibliography` with nothing cited is a LaTeX
% error, so replace this with a real one rather than deleting it alone.
TODO — cite your sources: \cite{example:2024}.

\bibliographystyle{plain}
\bibliography{biblo}

EOF
      fi
      cat <<'EOF'
\end{document}
EOF
    } | sed "${subs[@]}" > "$dir/main.tex"
    echo "  + tex/$slug/main.tex"
  else
    cat <<'EOF' | sed "${subs[@]}" > "$dir/main.mdx"
---
title: @TITLE@
summary: >-
  TODO — one tight paragraph saying what this page covers. It is the page's
  lede and its index blurb. (An unwritten summary draws a build warning.)
contributors:
  - @AUTHOR@
# slides: https://drive.google.com/…   # a deck hosted elsewhere, if there is one
---

{/* main.mdx replaces main.tex entirely: this file is copied verbatim into
    content/modules/@SLUG@.mdx and served as the page — no converter, no PDF.
    Math is KaTeX ($…$ / $$…$$); the components below are the supported set
    (docs/commands.md). Cluster and day live in schedule.yaml, not here. */}

## Prerequisites

* TODO — what a participant needs before this page.

<LearningOutcomes>

* TODO — what they will be able to do afterwards.

</LearningOutcomes>

## TODO first section

TODO — ordinary markdown. Inline math is KaTeX: $e^{i\pi} + 1 = 0$.

<Exercise>

TODO — a discussion question or exercise.

</Exercise>

<Solution>

TODO — collapsed on the page, stripped from the -nosol download.

</Solution>

{/* Also available: <Hint>, <Callout type="warning">, <TeachingNote title="…">
    (notes for whoever teaches the day), <Figure src="/uploads/@SLUG@/x.svg"
    caption="…" /> for anything you drop in fig/, and <YouTube id="…" />. */}
EOF
    echo "  + tex/$slug/main.mdx"
  fi

  if [ "$want_slides" = 1 ]; then
    cat <<'EOF' | sed "${subs[@]}" > "$dir/slides.tex"
% slides.tex — the optional deck for this worksheet. The build compiles it to
% slides.pdf and hosts it next to the sheet's downloads; it is NEVER converted
% to MDX (a deck is a download, not a web page).
%
% HANDOUT: mentioning \HANDOUT anywhere in this file — as the line below does —
% makes the build produce a second, collapsed slides-handout.pdf with every
% \pause flattened. Drop the line if the deck has no reveals.
%
% tex/iliad-slides.sty is an OPTIONAL shared style; replace it with your own
% preamble if you like. Nothing on the website reads a deck. If all you have is
% a prebuilt PDF with no source, don't commit the binary — host it and add a
% `slides: <url>` line to the frontmatter block instead.
\ifdefined\HANDOUT\PassOptionsToClass{handout}{beamer}\fi
\documentclass{beamer}
\IfFileExists{iliad-slides.sty}{\usepackage{iliad-slides}}{\usepackage{../iliad-slides}}

\title{@TITLE@}
\subtitle{Slides}
\author{@AUTHOR@}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{TODO}
  \begin{itemize}
    \item TODO
    \pause
    \item TODO — this bullet arrives on a \texttt{\textbackslash pause}.
  \end{itemize}
\end{frame}

\end{document}
EOF
    echo "  + tex/$slug/slides.tex"
  fi

  if [ "$want_bib" = 1 ]; then
    cat <<'EOF' > "$dir/biblo.bib"
% Bibliography for this worksheet — cite with \cite{key} from main.tex.
% Replace the placeholder; an entry nothing cites is harmless, but a
% \bibliography with no citations at all fails the LaTeX build.
@article{example:2024,
  author  = {A. N. Author},
  title   = {TODO — replace this placeholder entry},
  journal = {Journal of TODO},
  year    = {2024},
}
EOF
    echo "  + tex/$slug/biblo.bib"
  fi
  echo "  + tex/$slug/fig/ (empty — figures go here, .gitkeep holds the folder)"

  # ---- schedule.yaml -------------------------------------------------------
  if [ -n "$day" ]; then
    local sched="$WT/schedule.yaml" rc=0
    if grep -qE "^[[:space:]]+- $slug\$" "$sched"; then
      echo "  ✓ schedule.yaml already lists $slug"
    else
      schedule_add "$sched" "$day" "$slug" || rc=$?
      case "$rc" in
        0) echo "  + schedule.yaml: $slug listed under day $day" ;;
        2) echo "  ! day $day is marked 'port: never' — it may not list worksheets." >&2
           echo "    Drop that flag first, then add '$slug' by hand." >&2 ;;
        3) echo "  ! no day '$day' in schedule.yaml — list '$slug' by hand." >&2 ;;
        *) echo "  ! could not edit schedule.yaml — list '$slug' by hand." >&2 ;;
      esac
    fi
    if [ "$rc" = 0 ] && command -v node >/dev/null 2>&1; then
      if (cd "$WT" && node scripts/schedule.mjs >/dev/null 2>&1); then
        echo "  ✓ schedule.yaml validates"
      else
        echo "  ! schedule.yaml no longer validates — check it:" >&2
        echo "      (cd $WT && node scripts/schedule.mjs)" >&2
      fi
    fi
  else
    echo "  · not listed in schedule.yaml — add '$slug' under its day, or the build will"
    echo "    reject it (mark 'unlisted: true' in the frontmatter for a demo sheet)."
  fi
}

[ "$init" = 1 ] && init_module

echo
echo "✓ worktree ready: $WT"
echo "    cd $WT"
if [ "$init" = 1 ]; then
  echo "    ./run.sh watch $slug        # content build + live preview of the new sheet"
else
  echo "    ./run.sh watch <slug>     # content build + live preview (works via the symlinks)"
fi
echo "    # full 'next build' / pre-push CI: run from the main checkout on the branch,"
echo "    # or replace the symlinks with real installs."
