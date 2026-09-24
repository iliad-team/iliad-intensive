---
name: content-build
description: How a worksheet in tex/<slug>/ becomes a page, a PDF and a set of downloads — the scripts/build-content.mjs ladder (PDF → convert → decks → figures → render gate → stage), the per-worksheet cache, auto-labels and the .aux, the -nosol strip, schedule.yaml → index.json/status.json, and the ./run.sh loops that drive it all. Read this when a build is red, when a number/anchor/download on the web is wrong, when touching scripts/build-content.mjs, build-status.mjs or schedule.mjs, or before running anything in this repo for the first time.
---

# The content build

**One sentence:** `node scripts/build-content.mjs` turns every `tex/<slug>/`
into `content/modules/<slug>.mdx` + `public/uploads/<slug>/*.svg` +
`public/downloads/<slug>/*`, then writes `content/index.json` and
`content/status.json`; `next build` then prerenders whatever `content/` holds.
Nothing it writes is committed. `docs/DEVELOPMENT.md` is the human-facing
version of this page; this skill is the file-level truth as of 2026-09-22 and
notes where the docs have drifted.

## Commands (always through `./run.sh`)

`./run.sh` loads nvm and picks Node 22 from `.nvmrc` — system Node 18 cannot
run Next 16. Every subcommand is an npm script in `package.json`.

| Command | What it runs | Use it for |
|---|---|---|
| `./run.sh content [slug…] [--check] [--no-cache] [--jobs N]` | `build-content.mjs` | the real thing: PDFs, decks, downloads |
| `./run.sh watch [slug]` | `watch.mjs`: `build-content --check --quiet` on save + `next dev` | fast edit loop, **no browser auto-reload**, port 3000 |
| `./run.sh preview [slug]` | `preview.mjs`: `build-content --check --no-gate` + scoped `next build` + static server with SSE reload | production-speed pages, auto-reload, port 4321 |
| `./run.sh ci [slug…]` | `npm run ci` = content build (+`CI_SLUGS`) → `next build` → `strip-hydration` → `check-overflow` (advisory) | exactly what CI runs; exit 0 = CI green |
| `./run.sh build` | `next build` only | static export → `out/` |
| `./run.sh slugs` / `-i` | list slugs / pick with fzf | |
| `node scripts/schedule.mjs` | validate + print `schedule.yaml` | after any schedule edit |

`ci` is a compound script, so slugs cannot be passed as `npm run ci -- slug`;
`run.sh` exports `CI_SLUGS` instead, which scopes only the content half.

Flags of `build-content.mjs`: `--check` (converter + render gate only, no
PDFs/decks/downloads, no `.build-hash` written), `--no-gate` (skip the KaTeX
gate; only `preview.mjs` passes it), `--no-cache`, `--quiet`, `--jobs N`
(default = CPU core count; the docs still say 4).

## The per-worksheet ladder, in order

`buildSlug(slug)` in `scripts/build-content.mjs`. Worksheets build in a worker
pool, each sheet's steps sequential, logs buffered so output never interleaves.
A sheet that builds cleanly prints nothing; the run ends in one `✓` summary.

0. **Guards.** `schedule.yaml` is loaded first and a bad schedule aborts before
   any TeX runs. A `tex/<slug>/iliad.sty` that differs from `tex/iliad.sty`
   is fatal (it would shadow the shared contract). `slides.tex` + `slides.typ`
   for one stem is fatal.
1. **Cache check** (full builds only) — see below.
2. **PDF first** (LaTeX sheets). Writes `main.autolabel.tex` (and
   `sections/*.autolabel.tex` for `\input` files), then
   `pdflatex → bibtex → pdflatex → pdflatex` with `-jobname=main`, cwd the
   sheet folder, `BSTINPUTS` pointing at `tex/` so the vendored
   `alphaurl.bst` resolves. **No `-shell-escape` for worksheets** (contributor
   LaTeX is untrusted). bibtex failures are fatal except "no bibliography at
   all" — a swallowed failure once shipped three sheets with every `\cite` as
   `[?]`. Overfull `\hbox` lines in `main.log` become non-fatal warnings named
   by `file:line`. Then the same ladder over `main-nosol.tex`.
   Under `--check` there is no PDF build, only one best-effort `pdflatex` pass
   when `main.aux` is missing.
3. **Convert.** `node scripts/tex2mdx/tex2mdx.mjs main.tex -o content/modules/<slug>.mdx --tikz-dir public/uploads/<slug> --tikz-src /uploads/<slug>/`.
   Output goes to `tex/<slug>/convert.log`. Exit 2 = ERRORs = build fails;
   the `NOTE (warning…)` block is re-emitted as `⚠ warning:` lines. See the
   `tex2mdx` skill for what the converter does.
   **MDX-authored sheets** (`main.mdx`) skip conversion: the file is copied
   as-is after checks — must open with YAML frontmatter, must not set
   `cluster:`/`day:`, gets the same `summary:` and front-matter-order
   warnings the converter gives LaTeX sheets. No PDF, ever (pandoc leaked
   solutions and JSX).
4. **Stamp** `cluster:` and `day:` (quoted — cluster `0` would otherwise be a
   YAML number and falsy in TS) into the MDX frontmatter from the schedule.
5. **Decks.** Every `slides.tex` / `slides-<label>.tex` / same stems as
   `.typ`. LaTeX decks: the same 3× ladder **with `-shell-escape`** (minted
   needs Pygments) and `bibtex` or `biber` chosen by grepping the source for
   `biblatex`/`\addbibresource`. A deck mentioning `\HANDOUT` also builds
   `<stem>-handout.pdf` via `\def\HANDOUT{}\input{<stem>}`. Typst decks:
   one `typst compile --ignore-system-fonts [--font-path fonts/]`; `TYPST=`
   overrides the binary. Any deck failure is fatal (a memory note records
   David wants this to stay fatal). A sheet with no deck at all draws a
   non-fatal warning, full builds only.
6. **Figures.** `fig/*.pdf` → `pdftocairo -svg` into `public/uploads/<slug>/`;
   svg/png/jpg/gif/webp copied through. TikZ was already handled inside the
   converter (content-addressed `tikz-<sha>.svg`).
7. **Render gate.** `tex2mdx-check.mjs` compiles the MDX with the site's
   exact plugin set and KaTeX-renders every `$…$`/`$$…$$`. Log in
   `rendergate.log`. Fatal.
8. **Stage downloads** (full builds only) into `public/downloads/<slug>/`:
   `<slug>.mdx`, `<slug>-nosol.mdx` (bare `<Solution>` blocks and
   `solutionsonly` spans stripped, orphan footnotes pruned); for LaTeX sheets
   also `<slug>.pdf`, `<slug>-nosol.pdf`, `<slug>.tex` (the document
   **inlined** across `\input`, so it compiles alone — it still needs
   `iliad.sty` beside it), `<slug>-nosol.tex`; per deck `<slug>-<stem>.pdf`,
   `<slug>-<stem>.tex|typ`, and `<slug>-<stem>-handout.pdf`.

After the pool: **`content/index.json`** (every built module with
`unlisted: false` and a schedule position; fields `slug, title, cluster, day,
part, parts, frontmatter, position, headings` where headings are the `##`/`###`
lines with github-style slugs) sorted by schedule position. Then
**`content/status.json`** via `build-status.mjs`, which runs even after a
sheet failed so the status page keeps rendering, and is itself fatal on a
built worksheet no day lists.

## Why the web's numbers come from LaTeX (auto-labels)

The `.aux` only records `\label`ed things. So `tex2mdx/autolabel.mjs` injects a
same-line `\label{iliad-auto-N}` into every numbered construct (theorem family,
exercise, remark, author-declared `\newtheorem`/`\declaretheorem` envs,
unstarred headings), deterministically. The build compiles that injected copy
under `-jobname=main`, so `main.aux` carries a number for everything, and the
converter runs the *identical* injection before parsing and looks each
construct's number up by label name. Consequences:

- A displayed number that disagrees with the PDF means the `.aux` is stale or
  the construct got no label (e.g. an env expanded from an author macro); the
  converter warns "using a simulated counter" and falls back.
- The converter self-heals a stale `.aux` (one with no `iliad-auto-*` entries)
  by regenerating it in a temp dir with one pdflatex pass.
- Auto-labels never become anchors, never reach the downloads (those ship the
  pristine source), and are invisible in the PDF.
- The walk order across `\input` files (`texinput.mjs`) is part of the
  contract: every consumer must go through `injectAutoLabelsTree` /
  `transformInputTree` or labels drift. `\include` is deliberately not
  followed and warns.

## The cache (`tex/<slug>/.build-hash`)

A full build skips a sheet (`↷ cached`) when its stored hash matches AND every
artifact it would stage is present (including every `/uploads/<slug>/…` path
its MDX references, because `public/uploads` lives in a *separate* CI cache).

Hashed: the sheet's own folder minus LaTeX artifacts (`fig/` hashed whole),
`tex/iliad.sty`, `tex/alphaurl.bst`, `scripts/build-content.mjs`,
`scripts/schedule.mjs`, all of `scripts/tex2mdx/`. **Not** hashed, on purpose:
`schedule.yaml` (moving a sheet to another day only changes two stamped lines,
so a cache hit re-checks the stamp and rewrites it in place — `restampIfMoved`,
which also refreshes the staged `.mdx` downloads) and the rest of `scripts/`
(`build-status.mjs`, `preview.mjs`, `watch.mjs` cannot change artifacts).
`docs/DEVELOPMENT.md` still says the hash spans all of `scripts/` and
`schedule.yaml`; the code is the truth. `--no-cache` if you suspect a stale
artifact. The stamp is written only after a clean full build.

In CI the same artifacts are restored from `actions/cache` (key never hits,
`restore-keys: worksheets-` pulls the newest), so an untouched day is not
recompiled there either.

## `schedule.yaml` rules (`scripts/schedule.mjs`, fatal, one-line fixes)

- Cluster: `id`, `label`, `urlSlug` required and unique; `urlSlug` never
  `admin` (it would shadow `/admin/status`).
- Day: `code`, `title`, `lead`, `doc` required, plus `source` (`ready` |
  `partial` | `missing`) unless `port: never`, which forbids `source`,
  `sourceUrl` and any `worksheets`. `lead: none` is the only way to have no
  lead. The code's letter must equal the enclosing cluster id; codes unique.
- `worksheets:` slugs must exist as `tex/<slug>/main.tex|mdx` and belong to
  exactly one day. Order is position: `bySlug[slug] = {cluster, day,
  position (1-based, whole course), part, parts}`. `part/parts` is what makes
  `D.3.1`/`D.3.2` on the site; the canonical code stays undotted.
- Every built worksheet must be listed by a day or carry `unlisted: true`
  (only `tex/example` does).

## Worktrees and the symlinked `node_modules`

`./new-worktree.sh <name> origin/main` creates `worktrees/<name>` and symlinks
both `node_modules` (root and `scripts/tex2mdx/`). Inside such a worktree the
content build works but `next build` (so `ci`, `watch`, `preview`, and the
pre-push hook) fails: Turbopack refuses symlinked `node_modules`. Either run
the site build from the main checkout on that branch, or replace the symlinks
with real `npm ci` installs. Never `npm install` through the symlink. The
`port-day` skill has the full ritual; `tsconfig.json` excludes `worktrees/`
and `.claude/worktrees/` so stale worktrees don't fail type-checking.

## When it's red: where to look

| Symptom | Look at |
|---|---|
| `✗ <slug>: PDF build failed: ! …` | `tex/<slug>/main.log`, first line starting `!` — remember the compiled file is `main.autolabel.tex`, same line numbers as `main.tex` |
| `bibtex (main): …` | a `.bst` or `.bib` that cannot be opened; check `\bibliographystyle` and `BSTINPUTS` |
| `conversion failed` | `tex/<slug>/convert.log`; ERROR lines carry `file:line`; see the `tex2mdx` skill |
| `render gate failed` | `tex/<slug>/rendergate.log`: `MDX compile: FAIL` is a markup/JSX problem, `KaTeX err:` names the formula |
| `slides build failed (<job>)` | `tex/<slug>/<job>.log`; for `-handout` jobs the source is the `\def\HANDOUT{}` wrapper |
| `no-solutions PDF build failed` | `main-nosol.log`; usually a `\cref` to a label that lived inside a solution |
| `tex/<slug>/ is not listed by any day` | add the slug under its day in `schedule.yaml`, or `unlisted: true` |
| `✗ schedule.yaml: …` | the message names the cluster/day index and the key |
| page shows wrong day/cluster | run a full build; a cached sheet is re-stamped on every hit, a `--check` output is not |
| numbering differs from the PDF | stale `.aux`; delete `tex/<slug>/main.aux` or `--no-cache` |
| watcher rebuilds forever | something writes a file not matched by `BUILD_ARTIFACT` in `scripts/artifacts.mjs` |

Full CI ladder locally: `./run.sh ci <slug>`; overflow check against a dev
server: `node scripts/check-overflow.mjs <slug> --base-url http://localhost:3000`
(needs Chrome on PATH or `$CHROME`, Node 22).

## Invariants — do not break

- Generated MDX is host-agnostic: figure URLs are `/uploads/<slug>/…`; the
  site prefixes `NEXT_PUBLIC_BASE_PATH` at render time. Never bake a base
  path into content or `status.json` (previews would double-prefix).
- PDF before conversion; the converter needs the `.aux`.
- Both PDF variants and the `.tex` downloads come from the *pristine* source
  (auto-labels are a compile-time copy).
- Worksheets compile without `-shell-escape`; only decks get it.
- Deck failures, bibtex failures, converter ERRORs, render-gate failures and
  schedule/status data errors are fatal. Missing summary, overfull lines,
  missing decks, front-matter order are warnings.
- A `--check` run must never write `.build-hash` or downloads.
- `content/`, `public/uploads`, `public/downloads`, `out/`, every LaTeX
  artifact and `.build-hash` are gitignored; never commit them.
