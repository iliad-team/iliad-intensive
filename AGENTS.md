# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Repo

Static Next.js site that renders the Iliad Intensive worksheets. **LaTeX is the source; everything else is built and gitignored.** See [`README.md`](README.md) to set up and run.

## Layout

- `tex/<slug>/main.tex` — the worksheet sources; **the only committed content** (plus per-module `biblo.bib`/figures and shared `tex/iliad.sty`).
- [`schedule.yaml`](schedule.yaml) — **the curriculum, and the only hand-kept build input**: clusters → teaching days → each day's worksheets, every level in taught order. It owns each page's cluster, day and position; a worksheet's own frontmatter never states them (the build stamps them in). Validate + print with `node scripts/schedule.mjs`.
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

## Course-material tracking

- **[`/admin/status`](src/app/admin/status/page.tsx)** — the live per-day table the site
  itself publishes (worksheet · slides · Doc tab · source). Derived from the build, so it
  matches what is deployed; the hand-kept half is [`schedule.yaml`](schedule.yaml).
- [`scratch/MATERIAL.md`](scratch/MATERIAL.md) — every live June day: source status + doc tab, with a handoff section. **Start here** for what's ported vs. missing.
- [`PESTER_LIST.md`](PESTER_LIST.md) — who to chase for still-missing source.
