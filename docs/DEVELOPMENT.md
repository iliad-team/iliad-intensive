# Development & pipeline

Maintainer documentation. Writers only need the root [README](../README.md).
File-level map of the site (what reads what): [INTERNALS.md](INTERNALS.md).

## Architecture

Only site code and LaTeX sources are committed; the rest is built:

```
tex/<slug>/main.tex            <- the ONLY content in git (+ biblo.bib, fig/,
                                   optional slides.tex)
schedule.yaml                  <- committed: the curriculum (clusters ->
                                   days -> worksheets, in taught order)
   |  scripts/build-content.mjs  (runs scripts/tex2mdx/, the AST converter)
   v
content/modules/<slug>.mdx     page body            (gitignored)
content/index.json             listing              (gitignored)
content/status.json            /admin/status data   (gitignored)
public/uploads/<slug>/*.svg    figures + content-addressed TikZ (gitignored)
public/downloads/<slug>/       <slug>.pdf/.tex/.mdx + <slug>-slides.pdf/.tex
                               per-page downloads (gitignored)
   |  next build (output: "export")
   v
out/                           static site -> GitHub Pages
```

Next.js 16, static export (`output: "export"`). `tex/iliad.sty` (loaded as `../iliad`) and its web twin `scripts/tex2mdx/shims.mjs` define the authoring contract.

## Content build

- `node scripts/build-content.mjs [slug ...]` (or `./run.sh content [slug]`): full build; no slugs = every worksheet.
  - `--check`: converter + KaTeX render gate only (fast).
  - `--jobs N`: parallel worksheet builds (default 4).
  - `--no-cache`: force a rebuild.
  - `--quiet`: drop the summary line.
  - Converter ERRORs fail the build (non-zero exit, `file:line`); warnings don't. Clean sheets print nothing.
  - An overfull PDF line is a warning at its source `file:line`. Break it in the source; it overflows on the web too.
- `./run.sh watch [slug]`: dev server + rebuild on save (`scripts/watch.mjs`).
- `./run.sh ci [slug ...]`: full CI ladder (content build + static site build). Slugs scope only the content half (via `CI_SLUGS`; `npm run ci -- slug` won't work). `next build` renders whatever `content/` already holds.
- `./run.sh slugs`: list worksheet slugs. `-i`/`--pick` in place of a slug picks via fzf for `watch`/`preview`/`content`/`ci`.
- `./setup.sh`: idempotent local install (apt TeX/poppler, nvm Node 22, npm deps).

- **Order matters: the PDF compiles before conversion.** `\cref`/`\ref` resolve through the `.aux`; `--check` runs one `pdflatex` pass if it's missing.
- Every displayed number comes from the `.aux`. `tex2mdx/autolabel.mjs` adds `\label{iliad-auto-N}` to every numbered construct; the build compiles the result, `main.autolabel.tex`, under `-jobname=main`. A stale `.aux` without these labels is regenerated.
- The injection follows `\input` (`tex2mdx/texinput.mjs`): `sections/foo.tex` gets `sections/foo.autolabel.tex`, so log errors name the file you edit. Other source rewrites (e.g. the `-nosol` strip) must use the same walk.
- `scripts/build-status.mjs` runs last and writes `content/status.json` (`schedule.yaml` joined with what was built) for `/admin/status`.
  - Porting a worksheet = adding its slug under its day in `schedule.yaml`.
  - Data errors are fatal: duplicate day code, slug with no worksheet, worksheet no day lists, bad `source:` value.
  - `--check` runs are marked `checkOnly`.
- `unlisted: true` in frontmatter builds the page but keeps it out of `content/index.json`
- Decks: every `slides.tex` and `slides-<label>.tex` in `tex/<slug>/` compiles (pdflatex+bibtex) and stages as `<slug>-<stem>.pdf`/`.tex`. No MDX, no `-nosol` variant.
  - A deck mentioning `\HANDOUT` also gets `<stem>-handout.pdf` (staged as `<slug>-<stem>-handout.pdf`)
  - One Slides row per deck, ordered: `slides:` frontmatter URL, `slides`, `slides-<label>`. Multiple rows are labelled by each deck's `\title{}` (`src/lib/content.ts` `listDecks`, mirrored in `build-status.mjs`).
  - No `slides*.tex`/`slides*.typ` = non-fatal warning (not under `--check`).
- **Typst decks.** `slides.typ` / `slides-<label>.typ` compile with `typst compile --ignore-system-fonts` (plus `--font-path tex/<slug>/fonts/` if present), staged as `<slug>-<stem>.pdf`/`.typ`.
  - No handout variant, no bibliography pass. Row labels come from `#set document(title: "…")`.
  - A stem present as both `.tex` and `.typ` fails the build.
  - Pinned binary from `scripts/install-typst.sh` (used by CI and `./setup.sh`). `TYPST=/path/to/typst` overrides it.
  - Built-in fonts only (Libertinus, New Computer Modern, DejaVu Sans Mono); any other font ships under `fonts/`.
- Generated MDX uses `/uploads/…` URLs; `NEXT_PUBLIC_BASE_PATH` is applied at render time. **Never bake the base path into generated content: it double-prefixes.**
- Caching: each worksheet records a hash of its inputs in `tex/<slug>/.build-hash`. If it matches and artifacts exist, it prints `↷ <slug> cached` and skips. CI keeps artifacts in `actions/cache`. The hash covers the sheet plus `tex/iliad.sty`, `tex/alphaurl.bst`, `scripts/` and `schedule.yaml`.

## House-style lint (no build needed)

`node scripts/house-lint.mjs [slug ... | file.tex ...]` (or `./run.sh lint`) checks every `tex/<slug>/main.tex` and `main.mdx` in under a second for:

- hand-typed references (`\ref`, `Exercise~\cref`, `\cref{..}(b)`, literal "Exercise 2.3")
- front-matter order; Further reading not last
- unbound or dangling solutions; unlabelled exercises; `\ifsolutions` in the body
- hand-rolled `\textit{Hint:}` / `\emph{Remark.}` lead-ins instead of a contract environment; contract redefinitions
- missing or `TODO` summary; `cluster:`/`day:` in frontmatter
- bad `\youtube` IDs; images outside `fig/`
- MDX pitfalls: `<!-- -->`, `#` headings, undefined footnotes, bare `$` amounts, parked `{/* */}` comments

Flags: `--rules` lists rules and levels; `--min=warn` hides info; `--json` for tools. Exits 1 only on an error-level finding. Rules follow [commands.md](commands.md) and [iliad-sty.md](iliad-sty.md) and share the converter's `CONTRACT_NAMES`/`frontMatterOrderIssues`.

The build lints every sheet it rebuilds and prints non-fatal notes:

    ⚠ warning: tex/aixi/main.tex:1433  "Remark" as a typed lead-in — use remark [house-lint hand-rolled-lead-in]

- Skips info level and rules the build already reports (`BUILD_SKIP`).
- Cached sheets stay silent; `./run.sh lint` sweeps everything.
- On GitHub Actions findings are also `::warning` PR annotations.

Silence a finding with `% house-lint-ignore <rule>` on the line or the line above (`{/* house-lint-ignore <rule> */}` in MDX), or `% house-lint-ignore-file <rule>` anywhere in the file.

## Overflow check (math wider than the page)

`node scripts/check-overflow.mjs [slug ...]` renders built pages in headless system Chrome and warns about anything wider than the content column (math, tables, `<pre>`, images). KaTeX offenders are reported with their TeX source and nearest anchor id.

- Non-fatal in `./run.sh ci`; `--strict` exits non-zero.
- Without `--base-url` it serves `out/` itself (needs a prior `./run.sh build`/`ci`).
- `--width N` (default 1366); `--width 400` for phone layouts.

Fix loop: run `./run.sh watch <slug>`, then after each save `node scripts/check-overflow.mjs <slug> --base-url http://localhost:3000`. Break or stack the reported equation (never change the maths) until clean.

## CI & deploy

- `.github/workflows/site.yml`: every PR runs the full ladder (conversion, render gate, PDFs, site build). On pass it deploys a preview to `gh-pages/pr-preview/pr-<N>/` (URL commented, removed on close). `main` deploys to the `gh-pages` root. See [`PR-PREVIEWS.md`](PR-PREVIEWS.md) for the hosting model and the one-time Pages source setting (`gh-pages` / root).
- Pre-push hook: `git config core.hooksPath .githooks` rejects pushes when conversion fails (bypass once with `--no-verify`). For hard enforcement, make the `build` job a required status check on `main`.

## Local site dev

Needs Node ≥ 20.9; `./run.sh` selects Node 22 via nvm.

```bash
npm install                          # once
node scripts/build-content.mjs      # tex -> mdx/index/uploads/downloads
./run.sh                                # dev server -> http://localhost:3000
./run.sh build                          # static export -> out/
```

Production is served at the root of iliad-intensive.org, so needs no base path. For a sub-path host, build with `NEXT_PUBLIC_BASE_PATH=/sub/path ./run.sh build`.

## What renders a module

- `src/lib/mdx.tsx`: MDX → React with KaTeX math (incl. per-page `\gdef` macros) and the curriculum components (Callout, Exercise, Solution, LearningOutcomes, Definition, Theorem, Figure). Component names match converter output.
- `src/app/[cluster]/[slug]/page.tsx`: module page (header, sidebar, body), generated from `content/modules/*.mdx`. `content/index.json` only controls homepage/sidebar listing.
- `schedule.yaml`: hand-edited curriculum (cluster ids → labels/URL slugs, teaching days, each day's worksheets). `node scripts/schedule.mjs` validates it and prints the order.
