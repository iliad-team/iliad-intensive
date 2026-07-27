---
name: port-day
description: >-
  Port a June-intensive teaching "day" (e.g. B.4 Training Dynamics) from its cloned
  source repo under repos/ into this repo's tex/<slug>/ worksheet framework. Use whenever
  the user asks to port/convert a day, a module, or an X.Y card from the board. ALWAYS work
  in a dedicated git worktree + branch and open a PR — never in the main working tree.
---

# Porting a day into the worksheet framework

Convert a day's source LaTeX (in a local clone under `repos/`) into a framework-compliant
`tex/<slug>/main.tex` and open it as a PR. The mechanical assembly is delegated to a
subagent, but the **worktree/branch/PR scaffolding is set up by the orchestrator first** so
the subagent never touches `main`.

## Hard rules (do not violate)

1. **Never work in the main working tree.** All port edits happen in a git worktree on a
   branch named `port-<x.y>-claude` (lowercase, e.g. `port-b.4-claude`).
2. **Never push to `main`.** Finish by opening a PR against `main` for the user to review.
3. **Never `rm` a subagent's output.** If work already exists in the main tree from a prior
   run, copy `main.tex`/`biblo.bib` out *before* cleaning anything. (This skill exists
   because that mistake was made once.)
4. **Verbatim content.** The subagent copies math/prose byte-for-byte from source and only
   re-wraps scaffolding. It must never retype or rephrase equations or prose.

## Step 1 — set up the worktree (orchestrator, in the main checkout)

```sh
SLUG=training-dynamics          # target module slug (matches iliad-curriculum-public naming)
XY=b.4                          # day code, lowercase
SRC=repos/iliad_intensive_training_dynamics   # the cloned source under repos/ (gitignored)
WT="../iliad-intensive-worktrees/port-$XY-claude"

git worktree add -b "port-$XY-claude" "$WT" main
# Fresh worktree lacks the gitignored deps + sources. Wire them up:
ln -s "$(pwd)/node_modules" "$WT/node_modules"                                  # top-level deps
ln -s "$(pwd)/scripts/tex2mdx/node_modules" "$WT/scripts/tex2mdx/node_modules"  # REQUIRED: the converter has its OWN nested deps (bibtex-parse, unified-latex); the content build fails without this
mkdir -p "$WT/tex/$SLUG"
cp -r "$SRC"/. "$WT/_src_repo/"                  # original source repo at the WORKTREE ROOT (gitignored; see below)
```

**The original source repo lives at `$WT/_src_repo` (i.e. `worktrees/<name-of-worktree>/_src_repo`).**
If a port worktree already has the source, it is at `./_src_repo` — reuse it, don't re-clone.
`_src_repo/` is in `.gitignore`, so it never gets committed; the subagent reads its content
from there.

Gotchas that WILL bite in a fresh worktree:
- **Two** `node_modules` are gitignored and must BOTH be symlinked (above): the top-level one
  AND the converter's nested `scripts/tex2mdx/node_modules` (holds `bibtex-parse` +
  `@unified-latex/*`). If the nested one is missing, `build-content.mjs` fails on every module
  with a bibliography — do **not** misread this as a missing `package.json` dep, and do **NOT**
  `npm install` into the symlinked `node_modules` (that mutates the *main* checkout and can
  trip npm's optional-dep prune bug). Just add the nested symlink.
- `repos/` is gitignored → the source clone does not exist in the worktree. Copy it into
  `$WT/_src_repo` (above) or read it from the main checkout's absolute path.
- `tex/iliad.sty`, `content/clusters.json`, `scripts/`, `src/` **are** committed, so they're
  present in the worktree.
- The **pre-push hook** runs a full `next build`, which cannot resolve a *symlinked*
  `node_modules` ("points out of the filesystem root") and will reject the push. This is a
  property of the worktree symlink, not the content. `build-content.mjs --check` (the content
  gate) passes and GitHub CI runs a real `npm install`, so pushing with `--no-verify` (the
  hook's documented override) is acceptable here.

## Step 2 — launch the port subagent (scoped to the worktree)

Spawn a `general-purpose` subagent whose working area is `$WT/tex/$SLUG/`. Give it:

- The **verbatim mandate** (copy content with shell slicing/`cp`, edit only scaffolding lines).
- The **framework contract** (below), or point it to `docs/commands.md`, `docs/iliad-sty.md`,
  and the canonical template `tex/example/main.tex`.
- The location of the original source repo: `$WT/_src_repo` (i.e. `./_src_repo` from the
  worktree root — gitignored, present if the port was scaffolded above).
- The source structure and the target: assemble one self-contained `tex/<slug>/main.tex`
  (+ `tex/<slug>/biblo.bib`, + `fig/` if needed). Inline any `\input`-ed section files.
- The build-until-clean loop and the commit/push/PR steps (Steps 3–4).
- Note that `_src_repo/` is gitignored, so it must **never** be staged/committed (no manual
  cleanup needed, but never `git add` it).

### Framework contract the subagent must obey
- One authored `main.tex`. First lines = YAML comment block:
  `%--- iliad ---` / `% cluster: <A–E>` / `% title: ...` / `% summary: ...` / `%--- end ---`.
- `\documentclass[11pt]{article}`, then exactly
  `\IfFileExists{iliad.sty}{\usepackage[boxes]{iliad}}{\usepackage[boxes]{../iliad}}`.
  Do **not** reload hyperref/cleveref (iliad.sty loads them).
- `\title{}` / `\author{\authorname{Name}\\ \affiliation{Org}}`; after `\maketitle` add
  `\begin{summary}...\end{summary}` and `\begin{learningoutcomes}\item...\end{learningoutcomes}`.
- Exercises: `\begin{exercise}[Title]` newline `\label{ex:...}` ... `\end{exercise}`. Inline
  `\textbf{(a)}` part markers are fine as-is — do NOT restructure into `enumerate` (keeps it verbatim).
- Solutions: `\begin{solution}[ex:...]` (label MANDATORY, must match) ... `\end{solution}`.
  The build strips these to produce the `-nosol` variant.
- Figures: inline `tikzpicture` (converter → SVG) or `figure`+`\includegraphics{fig/*.pdf}`.
- Citations: per-module `biblo.bib` + `\cite{}` + `\bibliographystyle{plain}` + `\bibliography{biblo}`.
- The converter **fails loud** (WARN → build fail) on: unknown environments, `$` inside a
  `\newcommand` body, optional-argument macros, `\mathchoice`, duplicate `\label`s, missing
  `\cite` keys. Fix these in **scaffolding/preamble only**, never by altering math.
- Do not `\renewcommand`/`\renewenvironment` any contract name; do not commit a local `iliad.sty`.

## Reading-day modules (MDX, not LaTeX)

A "reading day" (a lecture + curated reading list, no exercises) ports as an **MDX module**:
author `tex/<slug>/main.mdx` — there is NO `main.tex` and none of the exercise/solution
machinery. Rules:
- `main.mdx` **MUST** begin with a `---` YAML frontmatter block (`title` required; add
  `cluster`, `summary`, `contributors`). Without it `build-content.mjs` errors immediately.
- No LaTeX conversion — `main.mdx` IS the page. The PDF is produced via **pandoc**
  (`markdown+tex_math_dollars`), and per-page downloads are **PDF + Markdown only** (no `.tex`).
  Math is `$...$` / `$$...$$`.
- **Same verbatim mandate:** the reading content — prose, links, learning outcomes, reading
  guide — must NOT be reworded, reordered, or trimmed of substance. Only add the frontmatter
  and strip pure export cruft (e.g. a Google-Docs auto-generated table-of-contents made of
  in-page `#anchor` links, which the site renders itself). When in doubt, keep it.
- Commit only `tex/<slug>/main.mdx` (+ `fig/` if any). Build/verify exactly as below with the
  module's slug.

## Step 3 — build until clean (in the worktree)

```sh
cd "$WT" && node scripts/build-content.mjs "$SLUG"
```
Must exit 0 with no WARN and a green KaTeX render gate; it runs `pdflatex → bibtex → pdflatex ×2`
with `-shell-escape` OFF and produces `main.pdf` + `main-nosol.pdf`. Iterate on failures by
adjusting scaffolding/preamble only.

## Step 4 — commit + PR (never to main)

```sh
cd "$WT"
git add "tex/$SLUG/main.tex" "tex/$SLUG/biblo.bib"   # + tex/$SLUG/fig/ if present
git commit -m "Port $XY <Title> worksheet into tex/$SLUG/"
git push -u origin "port-$XY-claude" --no-verify   # hook's next build can't resolve the symlinked node_modules; CI re-validates (see gotcha)
gh pr create --base main --title "Port $XY: <Title>" \
  --body "Closes #<issue>. Ports the <Title> worksheet (source: <origin repo>). Verbatim content; wrapped in the iliad.sty contract. Builds clean via scripts/build-content.mjs $SLUG."
```
Every PR must point at **both** (see `docs/PR-PREVIEWS.md`):
- the **issue** it addresses — `Closes #<issue>` in the body (find it with
  `gh issue list`; day issues are titled `[X.Y] <Title>`);
- the **live preview** — CI builds and deploys the rendered site to
  `https://iliad-team.github.io/iliad-intensive/pr-preview/pr-<PR#>/` once the
  checks pass and a bot comments the URL. Send that link to a reviewer.

Only `main.tex`, `biblo.bib`, and `fig/*` are committed; everything else
(`main-nosol.*`, `.aux/.pdf`, `content/`, `public/`, the `_src_repo/` source copy, the
`node_modules` symlink) is gitignored or must not be staged.

## Running CI / live-preview locally

`./run.sh ci` (= content build + `next build`) and `./run.sh watch` both run Next.js/Turbopack,
which **cannot** resolve a *symlinked* `node_modules` — so they fail inside a symlinked worktree
(only `./run.sh content <slug>` works there). To exercise the full CI ladder or preview the site:
- **Simplest:** run it from the **main checkout on the branch** (real `node_modules`):
  `git switch port-<x.y>-claude && ./run.sh ci` (or `./run.sh watch <slug>`), then `git switch main`.
- **Standalone worktree:** replace the symlinks with real installs —
  `unlink node_modules; unlink scripts/tex2mdx/node_modules; npm ci; npm ci --prefix scripts/tex2mdx`
  (uses run.sh's nvm Node ≥20.9). Never `npm install` *through* a symlink into the main tree.
- **Watch the real CI** on the PR: `gh pr checks <n> --watch` or `gh run watch`.

## Step 5 — after the PR

- Move the board card `[X.Y]` (project 7) to "In review".
- Record any deferred pieces (e.g. missing figures, a beamer slide deck kept as a separate
  artifact) as follow-ups / pester items in `scratch/MATERIAL.md` and `PESTER_LIST.md`.
- Leave the worktree until the PR merges; `git worktree remove "$WT"` when done.

## Reference
- Framework details: `docs/commands.md`, `docs/iliad-sty.md`, `docs/DEVELOPMENT.md`, `tex/iliad.sty`.
- Canonical template: `tex/example/main.tex`. Real modules: `tex/singular-learning-theory/`, `tex/decision-theory/`.
- Port tracking + source/local links: `scratch/MATERIAL.md`.
