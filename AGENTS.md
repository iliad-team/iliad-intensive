# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Repo

Static Next.js site that renders the Iliad Intensive worksheets. **LaTeX is the source; everything else is built and gitignored.** See [`README.md`](README.md) to set up and run.

## Layout

- `tex/<slug>/main.tex` — the worksheet sources; **the only committed content** (plus per-module `biblo.bib`/figures and shared `tex/iliad.sty`).
- [`schedule.yaml`](schedule.yaml) — **the curriculum, and the hand-kept input the build reads**: clusters → teaching days → each day's worksheets, every level in taught order. It owns each page's cluster, day and position; a worksheet's own frontmatter never states them (the build stamps them in). Validate + print with `node scripts/schedule.mjs`.
- `intensives/<slug>.yaml` — one file per programme ILIAD runs: a place, and a date for each day it teaches, referencing `schedule.yaml`'s day codes. Read only by the `/intensives` pages, never by the content build. The filename is the URL segment.
- `scripts/` — build pipeline: `build-content.mjs` runs `tex2mdx/` (LaTeX→MDX converter) then `build-status.mjs` (the `/admin/status` data); `schedule.mjs` reads/validates `schedule.yaml` for both; `watch.mjs` rebuilds on change.
- `content/` — generated `modules/<slug>.mdx`, `index.json` and `status.json` (gitignored, built from `tex/` + `schedule.yaml`).
- `src/` — the site (`app/`, `components/`, `lib/`).
- `public/`, `out/`, `.next/`, `node_modules/`, `repos/` — assets, build output, deps, cloned source repos — all gitignored.

## docs/ — read the one you need

- [`DEVELOPMENT.md`](docs/DEVELOPMENT.md) — dev workflow + the full content pipeline.
- [`INTERNALS.md`](docs/INTERNALS.md) — file-level site internals (what reads what).
- [`PR-PREVIEWS.md`](docs/PR-PREVIEWS.md) — per-PR live website previews (gh-pages model, one-time setup, caveats).
- [`commands.md`](docs/commands.md) — authoring reference: every supported worksheet construct.
- [`iliad-sty.md`](docs/iliad-sty.md) — the `iliad.sty` worksheet contract (macros/environments).
- [`LINKS.md`](docs/LINKS.md) — Google-Doc tab link for each day.

## Agent skills — `.claude/skills/`

Committed, and the only place the harness looks for project skills
(`.claude/skills/<name>/SKILL.md`; the directory name is the `/command`). They
hold **procedures**, loaded on demand; durable reference belongs in `docs/`, and
always-loaded facts belong here in `AGENTS.md`.

- [`port-day`](.claude/skills/port-day/SKILL.md) — port a teaching day into
  `tex/<slug>/`: LaTeX days from a cloned source repo, reading days from the
  Iliad Mega Doc. Covers the verbatim mandate (transcribe, never write),
  worktree setup, the `iliad.sty` contract, the Drive convention for raw-PDF
  decks, and the commit/PR ritual. Invoked for "port A.3", "do the next reading
  day", or adding a deck to a day.

`CLAUDE.md` is a one-line `@AGENTS.md` import, not a duplicate: Claude Code
reads `CLAUDE.md` and not `AGENTS.md`, so deleting it unloads every instruction
in this file. Other agents read `AGENTS.md` directly.

## Course-material tracking

- **[`/admin/status`](src/app/admin/status/page.tsx)** — the live per-day table the site
  itself publishes (worksheet · slides · Doc tab · source). Derived from the build, so it
  matches what is deployed; the hand-kept half is [`schedule.yaml`](schedule.yaml).
- [`scratch/MATERIAL.md`](scratch/MATERIAL.md) — every live June day: source status + doc tab, with a handoff section. **Start here** for what's ported vs. missing.
- [`PESTER_LIST.md`](PESTER_LIST.md) — who to chase for still-missing source.
