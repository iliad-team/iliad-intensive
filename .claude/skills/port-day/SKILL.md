---
name: port-day
description: Port a teaching day into this repo as a worksheet module — a LaTeX day from a cloned source repo, or a reading day from the Iliad Mega Doc — transcribing the author's words, never writing new prose. Use whenever asked to port, convert, or bring in a day/module (e.g. "port A.3", "do the next reading day"), or to add a slides deck for a day.
---

# Porting a teaching day

Two paths, same mandate:

- **LaTeX day** — buildable source exists (a clone under `repos/`, gitignored).
  Target `tex/<slug>/main.tex` under the `iliad.sty` contract.
- **Reading day** — no worksheet source; the curated reading list *is* the
  material. Target `tex/<slug>/main.mdx`, served as-is — a web page only, never
  a PDF.

`schedule.yaml` says which a day is (`source: ready` vs `source: readings`);
`scratch/MATERIAL.md` is the running status of what's ported vs. missing.

## You port. You do not write.

**Never write prose yourself. Every sentence in a module must come from the
source, verbatim.** You are a transcriber, not an author or an editor. For a
LaTeX day this extends to math: copy equations byte-for-byte (shell slicing,
`cp`), and edit only scaffolding lines.

This is the rule the whole skill hangs on, and it is easy to break by accident.
Concretely, all of the following are forbidden:

- **Writing a `summary:`.** It is always `summary: TODO` — never composed, never
  paraphrased from the Doc, never lifted from `scratch/MATERIAL.md`. The Doc tabs
  have no summary field, so *any* summary is invented. David writes them.
- **Distilling bullets from prose.** If the tab's intent section is three
  paragraphs and the template wants a bullet list, port the three paragraphs.
  Do not "turn them into" outcomes.
- **Rewording anything** — not headings, not awkward phrasing, not grammatical
  errors, not a heading like "Monitoring (taught in a separate day the latest
  version)" that reads badly. Port it as written.
- **Repairing broken links with your own words.** The Doc export mangles some
  internal links into things like
  `http://Iliad%20Intensive%20April%202026,%20Post-training.md`. Drop the dead
  URL, keep the author's text exactly; do not substitute a description like
  "(see the section above)".
- **Filling gaps.** If a section the template wants doesn't exist upstream, or
  the tab promises a section its body lacks, leave it out and report it. Never
  write the missing material.
- **Restructuring exercises.** Inline `\textbf{(a)}` part markers stay as they
  are; do not convert them into an `enumerate`.

Formatting is the one thing you may change: heading levels, `*` vs `-` bullets,
wrapping the outcomes in `<LearningOutcomes>`, dropping the Doc's export
artifacts (auto-generated TOC, `{#anchor}` suffixes, `\.` escapes). Words are
the author's; structure is the template's.

When in doubt, port it verbatim and flag it in your report. An awkward sentence
faithfully carried over is correct; a smooth one you wrote is a defect.

## Hard rules

1. **Never edit or push `main`.** All work happens in a worktree on a branch
   named `port-<x.y>-claude`, and finishes as a PR for review.
2. **Never `rm` a subagent's output.** If work already exists from a prior run,
   copy `main.tex`/`biblo.bib`/`main.mdx` out *before* cleaning anything. This
   rule exists because that mistake was made once.
3. **Never `npm install` from inside a worktree** — it writes through the
   symlink into the main checkout.

## Set up the worktree with the script

    ./new-worktree.sh <name> [base-ref] [--src <clone>]

Never bare `git worktree add` — a fresh worktree materialises only committed
files, so it has no deps and the content build dies with
`Cannot find package 'bibtex-parse'`. The script symlinks **both** gitignored
installs (`node_modules` *and* `scripts/tex2mdx/node_modules`), smudges LFS, and
optionally copies a source clone in with `--src`. It is idempotent, so re-run it
to repair an existing worktree.

Pass an explicit `base-ref` — `origin/main`, not the default `main`, whenever the
local `main` might be behind. Check with `git log --oneline main..origin/main`.

Present in a worktree because they're committed: `tex/iliad.sty`,
`schedule.yaml`, `scripts/`, `src/`. Absent because they're gitignored:
`repos/`, `content/`, `public/`, `scratch/`.

### The symlinked-`node_modules` consequences

Turbopack cannot resolve a symlinked `node_modules` ("points out of the
filesystem root"), so inside a worktree:

- `./run.sh content <slug>` and `build-content.mjs` work.
- `./run.sh ci`, `./run.sh watch`, and any full `next build` **fail**. Run those
  from the main checkout on the branch (`git switch <branch> && ./run.sh ci`),
  or replace the symlinks with real installs
  (`unlink node_modules; unlink scripts/tex2mdx/node_modules; npm ci; npm ci --prefix scripts/tex2mdx`).
- The **pre-push hook** runs that same `next build`, so it rejects the push.
  `git push --no-verify` is the hook's documented override and is correct here:
  the content gate passes and CI runs a real `npm install`.

## Every module: the `schedule.yaml` edit

A module does not declare its own place in the course. Writing `cluster:` or
`day:` in frontmatter (or in a `.tex` `%--- iliad ---` block) is a **build
error**. Instead list the slug under its day's `worksheets:` in `schedule.yaml`,
in reading order if the day has more than one. A worksheet no day lists fails the
build. Validate with `node scripts/schedule.mjs`. `/admin/status` then shows
"in repo" for that day on its own — no other bookkeeping.

## Reading day → `main.mdx`

`docs/commands.md` §"Writing in MDX instead" is the authoring contract for the
file itself: heading levels (`##` is the top, never `#`), `{/* … */}` comments,
frontmatter rules, and the check commands. Read it before writing the file.

```mdx
---
title: <module title>
summary: TODO
contributors:
  - Name (Affiliation)
slides: <canonical Drive folder URL, if the deck is a raw PDF>
---

<LearningOutcomes>

* first outcome
* second outcome

</LearningOutcomes>

## Prerequisites
## Roadmap for today
## Reading guide
## Further reading
```

**Learning outcomes must use the `<LearningOutcomes>` component**, never an
`## Learning outcomes` heading — a heading renders as an ordinary section instead
of the "What you'll learn" box. No "The students:" lead-in inside the box; just
the bullets. See `docs/commands.md` §"Learning outcomes and summary".

### Doc tab → module, section by section

| Doc tab section | Module |
| :--- | :--- |
| Module Intent / Learning outcomes | `<LearningOutcomes>` |
| Prerequisites | keep as `## Prerequisites` |
| Teaching guide → sessions, schedule | `## Roadmap for today` (student-facing parts only) |
| Main content | `## Reading guide` |
| Learn more | `## Further reading`, subsections and annotations preserved — always the LAST section, just before any references |
| Daily Checkpoint (quiz link) | **drop** |
| Session Intent, Teaching notes | **drop** |
| Notes for future iterations | **drop** |

Keep it student-facing: teacher instructions ("steer toward…", "write it on a
sticky note") and retrospectives are planning artifacts, not participant
material. `docs/LINKS.md` has the Doc tab URL for each day.

## LaTeX day → `main.tex`

Assemble one self-contained `tex/<slug>/main.tex` (+ `biblo.bib`, + `fig/`),
inlining any `\input`-ed section files. The canonical template is
`tex/example/main.tex`; `docs/iliad-sty.md` and `docs/commands.md` are the full
contract. In outline:

- First lines are the YAML comment block: `%--- iliad ---` / `% title: …` /
  `% summary: …` / `%--- end ---`. No `cluster:`/`day:` (see above).
- `\documentclass[11pt]{article}`, then exactly
  `\IfFileExists{iliad.sty}{\usepackage[boxes]{iliad}}{\usepackage[boxes]{../iliad}}`.
  Do **not** reload hyperref/cleveref — `iliad.sty` loads them.
- `\title{}` / `\author{\authorname{Name}\\ \affiliation{Org}}`; after
  `\maketitle`, `\begin{summary}…\end{summary}` and
  `\begin{learningoutcomes}\item…\end{learningoutcomes}`.
- Exercises: `\begin{exercise}[Title]` then `\label{ex:…}`. Solutions:
  `\begin{solution}[ex:…]` — the label is mandatory and must match; the build
  strips these for the `-nosol` variant.
- Figures: inline `tikzpicture` (converter → SVG) or
  `figure`+`\includegraphics{fig/*.pdf}`. Citations: per-module `biblo.bib`,
  `\cite{}`, `\bibliographystyle{plain}`, `\bibliography{biblo}`.
- A `Further reading` / `Learn more` section goes LAST — after all taught
  content, just before `\bibliography` (or before `\appendix` if there is
  one). If the source has it elsewhere, move it; the entries themselves stay
  verbatim.
- Never `\renewcommand`/`\renewenvironment` a contract name; never commit a
  local `iliad.sty`.

The converter **fails loud** (WARN → build failure) on unknown environments,
`$` inside a `\newcommand` body, optional-argument macros, `\mathchoice`,
duplicate `\label`s, and missing `\cite` keys. Fix these in
scaffolding/preamble only — **never** by altering math.

### Delegating the assembly

For a large LaTeX day the mechanical assembly suits a `general-purpose`
subagent scoped to `<worktree>/tex/<slug>/`. Set up the worktree and branch
**first**, so the subagent can never touch `main`. Give it the verbatim mandate,
the framework contract above (or point it at `docs/commands.md`,
`docs/iliad-sty.md`, `tex/example/main.tex`), the build-until-clean loop, and the
location of the source clone (`_src_repo/` at the worktree root, put there by
`new-worktree.sh --src`). It is gitignored, so it needs no cleanup — but it must
never be staged.

## Slides that exist only as a raw PDF

They live in the Drive folder **"[External] slides"**
(`1zlgIqGeCZg67zHT1fh6cM-IH2OmkkOzb`), in a subfolder named after the **repo
slug**, with the file named **`<slug>-slides.pdf`** — matching the name the build
stages downloads under, so it is unambiguous once downloaded:

    [External] slides/<slug>/<slug>-slides.pdf

An editable source (e.g. a `.pptx`) may sit alongside the PDF in the same folder.

**`slides:` points at the FOLDER, never at the file.** Use the folder URL:

    slides: https://drive.google.com/drive/folders/<folderId>

A file ID dies whenever an author replaces a deck by deleting and re-uploading
(only Drive's "Manage versions" preserves it), and the build cannot tell a dead
Drive link from a live one — it just passes the URL through. A folder ID survives
renames, re-uploads, extra files, and a second deck for a split session. This is
safe because the site renders an external deck as a bare `Slides [open ↗]` link
(`src/components/DownloadsRow.tsx`) — nothing assumes a file, an extension, or a
downloadable PDF.

Copy the contributor's deck in (you can't move files you don't own) rather than
linking their original — decks have been owned by personal Gmail accounts. The
folder grants `anyone: reader`, so copies are publicly linkable. Check you aren't
widening access: compare the original's permissions before copying.

The tradeoff to know: a folder link never 404s, so it stays green on
`/admin/status` even if the folder is empty or holds the wrong deck. Nothing
verifies a deck is actually present — CI has no Drive credentials. If a day's
slides matter, open the folder and look.

## Build and preview

    node scripts/build-content.mjs --check <slug>    # converter + KaTeX gate, no PDFs
    node scripts/build-content.mjs <slug>            # full: PDFs + downloads

Must exit 0, with no WARN and a green KaTeX render gate. Iterate on failures by
adjusting scaffolding/preamble only.

`./run.sh watch` = dev server + rebuild on save, **no browser live-reload** — it
prints "refresh the browser" and means it. `./run.sh preview` serves a real
static build and *does* auto-reload via an injected SSE snippet. Edit sources in
`tex/`; `content/modules/*.mdx` is generated and gets overwritten.

## Commit + PR

Stage only sources: `main.tex` + `biblo.bib` + `fig/*`, or `main.mdx` (+ `fig/`),
plus the `schedule.yaml` line. Everything else — `main-nosol.*`, `.aux`, `.pdf`,
`rendergate.log`, `content/`, `public/`, the `_src_repo/` source clone, the
`node_modules` symlink — is gitignored or must not be staged.

    git push -u origin port-<x.y>-claude --no-verify   # see the symlink note above
    gh pr create --base main --title "[X.Y] <Title>"

Every PR body points at **both** (see `docs/PR-PREVIEWS.md`):

- the **issue** it addresses — `Closes #<n>`; find it with `gh issue list`, day
  issues are titled `[X.Y] <Title>`;
- the **live preview** — CI deploys the rendered site to
  `https://iliad-team.github.io/iliad-intensive/pr-preview/pr-<PR#>/` and a bot
  comments the URL once checks pass. That link is what a reviewing author opens.

Watch CI with `gh pr checks <n> --watch`. Leave the worktree in place until the
PR merges, then `git worktree remove`.

## After the PR

- Move the board card `[X.Y]` (project 7) to "In review".
- Record deferred pieces (missing figures, a deck kept as a separate artifact) in
  `scratch/MATERIAL.md`, and anyone to chase in `PESTER_LIST.md`.

## Report honestly

Say what the source didn't have. Doc tabs are frequently internally inconsistent
— stale tables of contents promising sections the body lacks, scheduled blocks
with no material. Those are gaps to flag for chasing the author, not gaps to fill
in yourself.
