# Site internals

How the website actually works: what runs, what reads what, and where the
code came from. Companion to [DEVELOPMENT.md](DEVELOPMENT.md) (workflows and
commands), [iliad-sty.md](iliad-sty.md) (the authoring contract), and
[commands.md](commands.md) (per-construct syntax). This page is the
file-level map.

## The one-sentence version

A fully static Next.js site: LaTeX worksheets in `tex/` are converted at
build time into MDX + SVGs + PDFs by `scripts/`, and `next build`
(`output: "export"`) prerenders every page into `out/`, which GitHub Pages
serves as plain files. There is no server, no database, no API route — the
git repo is the source of truth and every derived file is a gitignored
build artifact.

## Data flow

```
tex/<slug>/main.tex  (or main.mdx)          SOURCES (the only content in git)
tex/iliad.sty                               the authoring contract, PDF side
        │
        │  scripts/build-content.mjs        orchestrator (worker pool, 4 jobs)
        │    └─ scripts/tex2mdx/            LaTeX AST → MDX converter
        ▼
content/modules/<slug>.mdx                  page bodies           (gitignored)
content/index.json                          homepage/sidebar list (gitignored)
content/status.json                         /admin/status table   (gitignored)
public/uploads/<slug>/*.svg                 figures + TikZ        (gitignored)
public/downloads/<slug>/*                   pdf/tex/mdx ±nosol,   (gitignored)
                                            +slides pdf/tex if slides.tex
        │
        │  next build  (output: "export", basePath from NEXT_PUBLIC_BASE_PATH)
        ▼
out/                                        static HTML/CSS/JS → GitHub Pages
```

One file is hand-edited and committed rather than generated: `schedule.yaml`,
the curriculum. It maps cluster ids (`A`, `B`, …) to labels and URL slugs,
lists the teaching days, and says which worksheets are each day's material —
so it fixes both the site's ordering and the `/admin/status` roster
(everything else on that page is derived from the build).

## What the site reads at build time

Every page is prerendered during `next build`; these are the complete
runtime inputs. If it's not in this table, the site doesn't depend on it.

| Input | Read by | Used for |
|---|---|---|
| `content/modules/*.mdx` | `src/lib/content.ts` | page bodies + frontmatter; **every** file here becomes a page, listed or not |
| `content/index.json` | `src/lib/content.ts` | homepage/sidebar listing + ordering + heading TOCs (absence ⇒ page is unlisted, still built) |
| `content/status.json` | `src/lib/status.ts` | the `/admin/status` table (absence ⇒ the page renders a "run the content build" hint) |
| `schedule.yaml` | `src/lib/cluster-store.ts` | cluster labels and the first URL segment (`/learning/<slug>/`), in the order the file lists them; falls back to `DEFAULT_CLUSTERS` in `src/lib/clusters.ts` |
| `public/downloads/<slug>/` | `src/lib/content.ts` (`listDownloads`) | which download buttons a page offers (dir listing at build time) |
| `public/uploads/<slug>/*.svg` | the browser, not the build | figure `<img>` targets referenced from the MDX |
| `NEXT_PUBLIC_BASE_PATH` env | `next.config.ts`, `src/lib/mdx.tsx`, module page | sub-path hosting (GitHub Pages project site); applied at render time, never baked into generated MDX |
| `NEXT_PUBLIC_COMMIT_SHA` env | `src/components/BuildStamp.tsx` | commit shown + linked in the page footer; set by CI, falls back to `git rev-parse HEAD` locally |
| `NEXT_PUBLIC_PREVIEW_PR` env | `src/components/PreviewBanner.tsx` | PR number on preview builds only; renders the "not the live site" banner |

## src/ — the whole site, ~800 lines

Routes (`src/app/`):

| File | Role |
|---|---|
| `layout.tsx` | HTML shell: fonts, `globals.css`, `Navbar` |
| `page.tsx` | homepage: hero paragraph + modules grouped by cluster from `index.json` |
| `[cluster]/[slug]/page.tsx` | the module page. `generateStaticParams` enumerates every MDX module; renders header (title/cluster/summary/contributors), `DownloadsRow`, the MDX body, and a "Built <date> from <source>" footer. `dynamicParams = false` — anything not prerendered 404s |
| `globals.css` | Tailwind 4 + `prose` typography tweaks |
| `icon.svg` | favicon |

Libraries (`src/lib/`):

| File | Role |
|---|---|
| `content.ts` | fs readers: module MDX + frontmatter, `index.json`, downloads dir |
| `mdx.tsx` | **the renderer.** `next-mdx-remote` + remark-math/rehype-katex/rehype-slug, plus the component catalogue the converter emits: `Callout`, `Exercise`, `Solution` (a `<details>`), `LearningOutcomes`, `Definition`, `Theorem`, `Figure`. Component *names* are the contract with `scripts/tex2mdx/`; the styling is this site's own. Content-hash cache so `next dev` doesn't re-render unchanged pages |
| `clusters.ts` | pure cluster helpers (client-safe, no fs) |
| `cluster-store.ts` | server-only loader for `schedule.yaml`'s cluster table (`server-only` import enforces the split) |

Components (`src/components/`): `ModulePageShell` (sidebar + content grid),
`SidebarNav` (cluster-grouped module list with per-page heading TOC),
`Navbar`, `NavContext`/`NavToggle` (mobile drawer state), `DownloadsRow`
(pdf/tex/mdx ± solutions buttons), `IliadMark` (logo).

## scripts/ — the content pipeline

| File | Role |
|---|---|
| `build-content.mjs` | per-worksheet ladder, parallel across worksheets (default 4 workers, buffered logs): shared-`iliad.sty` shadow guard → PDF first (3× `pdflatex` + `bibtex` over the auto-labeled `main.autolabel.tex`, `-jobname=main`; the converter needs the `.aux` for `\cref` and for every displayed number — see `tex2mdx/autolabel.mjs`) → solution-stripped `-nosol` PDF → tex2mdx conversion → optional `slides.tex`→`slides.pdf` (+ no-slides advisory) → `fig/*.pdf`→SVG (`pdftocairo`) → KaTeX render gate → stamp `cluster:`/`day:` from `schedule.yaml` → stage downloads (incl. `<slug>-slides.pdf/.tex`). Then `index.json`, ordered by the schedule. MDX-authored sheets skip conversion (PDF via `pandoc`). `--check` = converter + render gate only (no PDFs, no slides, no advisory) |
| `tex2mdx/tex2mdx.mjs` | converter CLI: source registry, `.aux` cross-refs, frontmatter + `\title`/`\author` extraction, `\gdef` macro block, bibliography |
| `tex2mdx/autolabel.mjs` | injects `\label{iliad-auto-N}` into every numbered construct (comment/verbatim-aware, same-line, deterministic); the build compiles the injected `main.autolabel.tex` (`-jobname=main`) so the `.aux` carries every displayed number, and the converter reads them back by label name — web numbering is PDF-true, never simulated. Walks the whole document via `texinput.mjs`, so section files are labelled too |
| `tex2mdx/texinput.mjs` | walks a worksheet across its `\input` boundaries in one deterministic order, applying a transform to every file. Returns both the per-file texts (the auto-labelled compile keeps the split, so `file:line` diagnostics stay useful) and the inlined document (what the converter parses and what the `.tex` downloads ship, so a download no longer points at section files it never contained — it still needs `iliad.sty` beside it, which the downloads do not include) |
| `tex2mdx/emit-ast.mjs` | unified-latex typed AST → MDX emitter (no regex parsing of LaTeX) |
| `tex2mdx/shims.mjs` | all dialect knowledge: contract env tables, KaTeX synonyms, macro overrides — `iliad.sty`'s web-side twin |
| `tex2mdx/tikz.mjs` | TikZ → standalone compile → content-addressed `tikz-<sha>.svg` (unchanged diagrams never recompile; CI caches `public/uploads` on `hashFiles('tex/**')`) |
| `tex2mdx/tex2mdx-check.mjs` | the render gate: compiles the MDX with the site's exact plugin pipeline and KaTeX-renders every math span |
| `schedule.mjs` | reads + validates `schedule.yaml` (the one hand-kept curriculum file) for both build steps, and derives each worksheet's cluster, day and position from its order. Run it standalone to print the course order. Data errors are fatal |
| `build-status.mjs` | last step of the content build: `schedule.yaml` + what the build produced → `content/status.json` for `/admin/status`. Which worksheets a day has is the schedule's answer; everything else in the row is read off disk, so the derived columns can't go stale. A built worksheet no day lists is fatal |
| `watch.mjs` | `./run.sh watch`: dev server + rebuild-on-save loop |

Two `package.json`s: the site's (root) and `scripts/tex2mdx/`'s (unified-latex,
bibtex-parse, its own KaTeX) — both need `npm ci`, and CI installs both.

External binaries: `pdflatex` (TeX Live; shell-escape stays OFF — contributor
LaTeX is untrusted), `bibtex`, `pdftocairo` (poppler-utils), `pandoc`
(MDX-authored sheets only). Node ≥ 20.9 for Next 16 (`./run.sh` selects nvm's
Node 22; system Node 18 won't build the site).

npm runtime deps (root): `next`, `react`/`react-dom`, `next-mdx-remote`,
`remark-math` + `rehype-katex` + `katex`, `rehype-slug`, `yaml`,
`server-only`; Tailwind 4 at build time.

## CI, hooks, deploy

One definition, three entry points (details in DEVELOPMENT.md): `npm run ci`
= content build + `next build`, run identically by `./run.sh ci`, the
`.githooks/pre-push` hook (tracked worksheets only), and
`.github/workflows/site.yml`. That workflow serves everything from a single
`gh-pages` branch: `main` → the root (production), each PR → a live preview at
`pr-preview/pr-<N>/`. See DEVELOPMENT.md and PR-PREVIEWS.md.

## Provenance — relation to the original curriculum site

This repo is a deliberate reduction of the original two-repo curriculum
system that lives alongside it in the ILIAD folder:

- **`iliad-curriculum-public`** — the public site (Vercel, ~2,300 lines of
  TS/TSX + the tex2mdx converter). Its content was a build artifact pushed
  into it by the admin's exporter.
- **`iliad-curriculum-admin`** — the CMS (~17,000 lines): Next.js admin app +
  Postgres (Drizzle) as content source-of-truth, Auth.js allowlist, a
  ProseMirror WYSIWYG editor with an MDX round-trip serializer, a
  Claude-CLI conversion worker with job queues, bulk import, and an
  exporter that committed to the public repo. Hetzner + Cloudflare tunnel +
  Vercel infra.

**What carried over from the public repo** (~⅓ of its site code, plus the
converter):

- Verbatim: the rendering shell — `SidebarNav`, `Navbar`, `NavToggle`,
  `NavContext`, `ModulePageShell`, `IliadMark`, `layout.tsx`,
  `globals.css`, `clusters.ts`, `cluster-store.ts` (~385 lines).
- Adapted: `mdx.tsx` (same component catalogue, restyled; Definition/Theorem
  boxes and the compile cache added), `content.ts`, `page.tsx`, the module
  page (downloads row + built-from footer added).
- The whole `scripts/tex2mdx/` converter — 5 of 8 files byte-identical;
  `tex2mdx.mjs`/`emit-ast.mjs`/`shims.mjs` evolved *here* (affiliation
  bylines, `\title` anywhere, `unlisted:`, contract-name strictness) and
  this copy is now the actively developed one.
- New here: `DownloadsRow`, `build-content.mjs`, `watch.mjs`, `iliad.sty`,
  `./run.sh`/`./setup.sh`, the pre-push hook, the GitHub Actions workflow.

**What was dropped from the public repo** (~⅔ of it): the live-preview
system (`preview/` routes + `lib/preview.ts`, which polled admin-pushed
preview branches), the slides/`DeckViewer` pages, Mermaid diagram support
(`MermaidDiagram`, `InlineMd`, the `mermaid` dep), the `/pipeline`
writer/maintainer docs pages (~600 lines — replaced by `docs/` markdown),
the `/about` page, the cookie `gate/` route, the `api/download` route
(static dir listings replaced it), `proxy.ts`, and Vercel hosting itself.

**What was dropped from the admin repo: all of it.** No code was reused —
only its *data contracts* survive: the cluster-table and `content/index.json`
shapes (the cluster table began as a hand-kept copy of what the admin
exporter shipped, and now lives in `schedule.yaml`), the MDX
component/attribute names, and the frontmatter keys. Everything the CMS did is replaced by a
cheaper equivalent: Postgres → git; WYSIWYG editor + Claude conversion
worker → the `iliad.sty` contract + deterministic `tex2mdx`; publish
pipeline + exporter → `build-content.mjs` in CI; auth/allowlist → GitHub
permissions; Hetzner/Vercel → GitHub Pages.

Net: of roughly 19k lines across the two original repos, about 2k live on
here (~800 site + ~1,200 shared converter lines), concentrated entirely in
the public repo's rendering shell and converter.
