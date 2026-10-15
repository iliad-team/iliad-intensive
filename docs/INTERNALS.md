# Site internals

File-level map of the site. See also [DEVELOPMENT.md](DEVELOPMENT.md) (workflows, commands),
[iliad-sty.md](iliad-sty.md) (authoring contract) and
[commands.md](commands.md) (per-construct syntax).

## The one-sentence version

Fully static Next.js site. `scripts/` converts the LaTeX worksheets in
`tex/` into MDX, SVGs and PDFs; `next build` (`output: "export"`) prerenders
every page into `out/`; GitHub Pages serves the files. No server, database or
API routes; every derived file is gitignored.

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
                                            +one pdf/tex (+handout pdf) per deck
        │
        │  next build  (output: "export", basePath from NEXT_PUBLIC_BASE_PATH)
        ▼
out/                                        static HTML/CSS/JS → GitHub Pages
```

`schedule.yaml` is the one hand-edited input: cluster ids (`A`, `B`, …) →
labels and URL slugs, teaching days, each day's worksheets. It sets site order
and the `/admin/status` roster.

## What the site reads at build time

Complete list of inputs:

| Input | Read by | Used for |
|---|---|---|
| `content/modules/*.mdx` | `src/lib/content.ts` | page bodies + frontmatter; every file here becomes a page, listed or not |
| `content/index.json` | `src/lib/content.ts` | homepage/sidebar listing, order, heading TOCs, `part`/`parts` within a day. Absent ⇒ unlisted but still built |
| `content/status.json` | `src/lib/status.ts` | `/admin/status` table. Missing ⇒ page shows a "run the content build" hint |
| `schedule.yaml` | `src/lib/cluster-store.ts` | `listClusters`: cluster labels and first URL segment (`/learning/<slug>/`); `listDays`: day codes + titles. Both in file order. Clusters fall back to `DEFAULT_CLUSTERS` in `src/lib/clusters.ts` |
| `intensives/*.yaml` | `src/lib/intensives.ts` | `/intensives` pages, one programme per file, a date per teaching day. Malformed data throws (unlike `cluster-store.ts`, which degrades). The content build never reads these |
| `public/downloads/<slug>/` | `src/lib/content.ts` (`listDownloads`) | which download buttons a page shows (dir listing at build time) |
| `public/uploads/<slug>/*.svg` | the browser only | figure `<img>` targets |
| `NEXT_PUBLIC_BASE_PATH` env | `next.config.ts`, `src/lib/mdx.tsx`, module page | sub-path hosting (GitHub Pages project site); applied at render time, never baked into generated MDX |
| `NEXT_PUBLIC_COMMIT_SHA` env | `src/components/BuildStamp.tsx` | commit shown + linked in the footer; set by CI, locally falls back to `git rev-parse HEAD` |
| `NEXT_PUBLIC_PREVIEW_PR` env | `src/components/PreviewBanner.tsx` | PR number, preview builds only; renders the "not the live site" banner |
| `NEXT_PUBLIC_SNAPSHOTS_URL` env | `src/app/dev/diff/page.tsx` | where `/dev/diff` reads page history. Default: `main` of [iliad-intensive-snapshots](https://github.com/iliad-team/iliad-intensive-snapshots) on raw.githubusercontent.com. Override to test a local copy |

## src/ — the whole site, ~800 lines

Routes (`src/app/`):

| File | Role |
|---|---|
| `layout.tsx` | HTML shell: fonts, `globals.css`, `Navbar` |
| `intensives/page.tsx` | directory of programmes in `intensives/*.yaml`, newest first |
| `intensives/[intensive]/page.tsx` | one programme: a row per day (date · code · material from `index.json`; unported days say so) |
| `page.tsx` | homepage: modules from `index.json` by cluster, then day. Multi-part days get a heading (anchor that part pages link to) with parts nested |
| `[cluster]/[slug]/page.tsx` | module page; `generateStaticParams` covers every MDX module. Header (title/cluster/day/summary/contributors), `DownloadsRow`, MDX body, "Built <date> from <source>" footer. `dynamicParams = false`: anything not prerendered 404s |
| `dev/diff/page.tsx` | `/dev/diff`: diff any two historical versions of a page. Static shell; `public/dev-diff.js` fetches pre-rendered versions from iliad-intensive-snapshots. See `docs/PR-PREVIEWS.md` |
| `globals.css` | Tailwind 4 + `prose` typography tweaks |
| `icon.svg` | favicon |

Libraries (`src/lib/`):

| File | Role |
|---|---|
| `content.ts` | fs readers: module MDX + frontmatter, `index.json`, downloads dir |
| `mdx.tsx` | the renderer: `next-mdx-remote` + remark-math/rehype-katex/rehype-slug, plus the components the converter emits: `Callout`, `Exercise`, `Solution` (a `<details>`), `LearningOutcomes`, `Definition`, `Theorem`, `Figure`. Component names are the contract with `scripts/tex2mdx/`. Content-hash cache for `next dev` |
| `clusters.ts` | client-safe cluster helpers + `dayCode()`, the only place a display code like "D.3.1" is built (never stored) |
| `cluster-store.ts` | server-only loaders for `schedule.yaml`: `listClusters()`, `listDays()`. Client components like `SidebarNav` get data as props |

Components (`src/components/`): `ModulePageShell` (sidebar + content grid),
`SidebarNav` (cluster-grouped module list, per-page heading TOC), `Navbar`,
`NavContext`/`NavToggle` (mobile drawer state), `DownloadsRow` (pdf/tex/mdx ±
solutions buttons), `IliadMark` (logo), `DiffControls` (diff view controls,
shared by `PreviewBanner` and `/dev/diff`).

## scripts/ — the content pipeline

| File | Role |
|---|---|
| `build-content.mjs` | One worker per CPU core (`--jobs N`). Skips a sheet (`↷ cached`) if its input hash (own sources, `tex/iliad.sty`, `tex/alphaurl.bst`, `scripts/`, `schedule.yaml`) is unchanged and all artifacts exist; `--no-cache` forces. Ladder: shared-`iliad.sty` shadow guard → PDF (3× `pdflatex` + `bibtex` on `main.autolabel.tex`, `-jobname=main`; see `tex2mdx/autolabel.mjs`) → `-nosol` PDF → tex2mdx → each deck `slides.tex`/`slides-<label>.tex` → `<stem>.pdf` (+ `<stem>-handout.pdf` if the deck mentions `\HANDOUT`; warns if no slides) → `fig/*.pdf` → SVG (`pdftocairo`) → KaTeX render gate → stamp `cluster:`/`day:` from `schedule.yaml` → stage downloads (incl. `<slug>-<stem>.pdf/.tex/-handout.pdf` per deck). Then `index.json` in schedule order. MDX-authored sheets: no conversion, no PDF, just page + `.mdx` download. **Bibtex failure other than "no bibliography" is fatal** (a missing `.bst` turns every `\cite` into `[?]`). `--check`: converter + render gate only |
| `tex2mdx/tex2mdx.mjs` | converter CLI: source registry, `.aux` cross-refs, frontmatter + `\title`/`\author` extraction, `\gdef` macro block, bibliography |
| `tex2mdx/autolabel.mjs` | injects `\label{iliad-auto-N}` into every numbered construct, across `\input` files (comment/verbatim-aware, deterministic). The compiled `.aux` then holds every displayed number, which the converter reads back by label, so web numbering matches the PDF |
| `tex2mdx/texinput.mjs` | walks a worksheet across `\input`s, transforming each file. Returns per-file texts (for the auto-labelled compile, keeping `file:line` diagnostics) and the inlined document (parsed by the converter, shipped as the `.tex` download). That download needs `iliad.sty`, which is not included |
| `tex2mdx/emit-ast.mjs` | unified-latex typed AST → MDX emitter (no regex parsing of LaTeX) |
| `tex2mdx/shims.mjs` | all dialect knowledge: contract env tables, KaTeX synonyms, macro overrides. The web-side twin of `iliad.sty` |
| `tex2mdx/tikz.mjs` | TikZ → standalone compile → content-addressed `tikz-<sha>.svg` (unchanged diagrams never recompile; CI caches `public/uploads` on `hashFiles('tex/**')`) |
| `tex2mdx/tex2mdx-check.mjs` | render gate: compiles the MDX with the site's plugin pipeline and KaTeX-renders every math span |
| `schedule.mjs` | reads + validates `schedule.yaml`; derives each sheet's cluster, day, position. Standalone: prints course order. Data errors are fatal |
| `build-status.mjs` | last step: `schedule.yaml` + build output → `content/status.json`. A built worksheet no day lists is fatal |
| `watch.mjs` | `./run.sh watch`: dev server + rebuild on save |

Two `package.json`s, both need `npm ci` (CI installs both): the site's (root)
and `scripts/tex2mdx/`'s (unified-latex, bibtex-parse, its own KaTeX).

External binaries: `pdflatex` (TeX Live; shell-escape OFF for worksheets, as
contributor LaTeX is untrusted; ON for decks only, which `minted` needs), `bibtex`, `pdftocairo` (poppler-utils). Node ≥ 20.9 for
Next 16; `./run.sh` selects nvm's Node 22 (system Node 18 can't build the site).

Root npm runtime deps: `next`, `react`/`react-dom`, `next-mdx-remote`,
`remark-math` + `rehype-katex` + `katex`, `rehype-slug`, `yaml`,
`server-only`; Tailwind 4 at build time.

## CI, hooks, deploy

`npm run ci` = content build + `next build`. Run identically by `./run.sh ci`,
the `.githooks/pre-push` hook (tracked worksheets only) and
`.github/workflows/site.yml`. The workflow publishes from one `gh-pages`
branch: `main` → root (production), each PR → `pr-preview/pr-<N>/`. See
DEVELOPMENT.md and PR-PREVIEWS.md.

## Provenance — relation to the original curriculum site

Reduced from two repos in the ILIAD folder: `iliad-curriculum-public` (Vercel
site, ~2,300 lines + tex2mdx) and `iliad-curriculum-admin` (~17,000-line CMS:
Postgres, editor, Claude conversion worker, exporter into the public repo).
~2k of ~19k lines survive (~800 site + ~1,200 converter).

- Kept from public, verbatim: `SidebarNav`, `Navbar`, `NavToggle`,
  `NavContext`, `ModulePageShell`, `IliadMark`, `layout.tsx`, `globals.css`,
  `clusters.ts`, `cluster-store.ts`. Adapted: `mdx.tsx`, `content.ts`,
  `page.tsx`, module page.
- `scripts/tex2mdx/` came from public; this copy is now the maintained one.
- New here: `DownloadsRow`, `build-content.mjs`, `watch.mjs`, `iliad.sty`,
  `./run.sh`/`./setup.sh`, pre-push hook, Actions workflow.
- Dropped from public: live preview, `DeckViewer`, Mermaid, `/pipeline` and
  `/about` pages, cookie gate, `api/download`, `proxy.ts`, Vercel.
- Admin repo: no code reused. Surviving data contracts: cluster-table and
  `index.json` shapes, MDX component/attribute names, frontmatter keys.
