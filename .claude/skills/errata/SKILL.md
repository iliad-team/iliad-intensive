---
name: errata
description: Fix reported errata in the worksheet material — typos, broken links, wrong references, math errors — with the smallest possible edit to tex/<slug>/. Simple fixes are just made; meaning-changing fixes get an adjacent ERRATA comment; nothing is ever staged or committed — the unstaged diff is what David audits. Use for "fix these errata", "someone reported a bug in B.3", "typo in the SLT sheet".
---

# Fixing errata

You are correcting reported errors in already-ported worksheets. Source of
truth is `tex/<slug>/main.tex` (plus `biblo.bib`, `fig/`, and `slides.tex` if
present), or `tex/<slug>/main.mdx` for reading days. **Never edit
`content/`** — it is generated and overwritten by every build. Never edit
`src/` under this skill: a rendering bug is a site bug, not an erratum.

The modules were ported under a verbatim mandate (see `port-day`): every
sentence is the author's. Errata fixing is the sanctioned exception — but only
just. Fix the error; change nothing else. Preserve voice, tone, and structure.
An awkward-but-correct sentence stays awkward.

## Hard rules

1. **Never `git add`, `git commit`, or `git push` — not even if a fix looks
   trivial.** Every edit stays unstaged in the working tree; the unstaged diff
   (plus the ERRATA comments, below) is the audit artifact David reads before
   deciding what to commit. This deliberately runs in the main checkout, not a
   worktree — no branch, no PR.
2. **Snapshot `git status --short` before your first edit.** The main checkout
   is shared (Dropbox) and often already dirty; you must be able to tell your
   edits apart from pre-existing ones when you report. Never revert or clean a
   change you didn't make.
3. **The fix must match the report.** No drive-by cleanup, no style
   improvements, no "while I'm here". One bug → one minimal edit.

## Simple vs. larger fixes

**Simple — just fix it, no comment:**

- Typos, spelling, missing/doubled words, punctuation.
- A broken link whose correct target is obvious (moved arXiv page, `http`→
  `https`, trailing-garbage URL). If the right target isn't obvious, skip
  (`SKIPPED:cannot-locate`) rather than guess.
- A `\cref`/`\label` pointing at the wrong-but-obvious target; a citation key
  that's misspelled against `biblo.bib`.
- Prose contradicting the code/math right next to it, where the report says
  which side is wrong.

**Larger — fix it, and leave an adjacent comment:**

Anything that changes meaning or spans more than a line or two: a corrected
formula or derivation step, changed numbers in an exercise or solution, a
sentence that had to be rewritten to be true, a replaced (not just repaired)
link. Put the comment on its own line immediately above the change:

```latex
% ERRATA 2026-08-24: sign error — gradient was written +∇L, source and
%   surrounding text require −∇L. Reported by <name/channel if known>.
```

```mdx
{/* ERRATA 2026-08-24: replaced dead Distill link with the arXiv version. */}
```

Rules for the comment: date it, one or two lines, say what was wrong and what
it now says — it's orientation for the audit, not a changelog. In `.tex`, `%`
comments never reach the web build (the converter strips them) but do travel
in the downloadable `.tex`; in MDX, `{/* … */}` is invisible on the page but
ships in the `.mdx` download. Either way David strips or keeps them when he
commits — that's his call, not yours. `<!-- … -->` in MDX is a **compile
error**, never a comment.

If a fix would need more than a few lines, restructure a section, or requires
inventing prose the author never wrote — that's not errata. Skip it
(`SKIPPED:too-complex`) and say what a human would need to do.

## Out of scope — skip and report

- Writing or editing `summary:` — summaries are David's (`SKIPPED:too-complex`).
- Rewriting explanations, adding examples/exercises/dropdowns, "explain this
  better" requests — content tasks, not errata.
- Pedagogy or mathematical-content changes ("this should use KL, not TV").
  Flag for the day's author.
- `schedule.yaml` ordering, `iliad.sty` itself, anything in `src/`.
- Weakening anything to make a build pass (deleting a failing equation,
  dropping a citation). If your fix breaks the build, repair or revert it.

## Never touch (build-structural)

- The `%--- iliad ---` … `%--- end ---` metadata block's structure, and never
  add `cluster:`/`day:` anywhere (hard build failure — `schedule.yaml` owns
  placement).
- The `\IfFileExists{iliad.sty}…` loading line.
- Contract names: never `\renewcommand`/`\renewenvironment` anything
  `iliad.sty` defines; never commit a local `iliad.sty`.
- Solution bindings: `\begin{solution}[ex:label]` must keep naming its
  exercise's label; don't rename a `\label` without fixing every `\cref` and
  every solution binding to it (grep the file first).
- MDX heading levels: `##` is the top, never `#`.

## Locating the cell

Reports usually quote the rendered site. The URL maps straight to the source:
`/<cluster-word>/<slug>/` → `tex/<slug>/`. Otherwise grep `tex/` for the most
distinctive quoted phrase (remember the converter may have reflowed line
breaks — grep a short unique token, not a whole sentence). If a report quotes
a solution, the source is inside `\begin{solution}` in the same `main.tex`.
Can't find it in one or two greps → `SKIPPED:cannot-locate`; don't fish.

## Validate — once per touched module, at the end of the batch

    node scripts/build-content.mjs --check <slug>

Must exit 0 with no WARN and a green KaTeX gate (`0 errored`). If you touched
a `slides.tex`, run the full build for that module instead
(`node scripts/build-content.mjs <slug>`) — a broken slides build is fatal by
design. Anything the check writes lands in gitignored `content/`, so it can't
pollute the diff. A fix that breaks the check is yours to repair or revert
before reporting.

## Report back

No report file — the unstaged diff and the ERRATA comments are the record.
Your final message lists every bug you were given, one line each:

- `FIXED` — simple fix applied.
- `FIXED+COMMENT` — larger fix applied with an ERRATA comment.
- `SKIPPED:too-complex` / `SKIPPED:cannot-locate` / `SKIPPED:already-fixed` /
  `SKIPPED:not-a-bug` — with a one-line reason (what you searched, what a
  human would need).

Then: which modules passed `--check`, and a reminder that nothing is staged.
