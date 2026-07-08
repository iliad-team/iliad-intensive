# Iliad Intensive — curriculum site

Minimal static website for the Iliad Intensive curriculum. The repo holds the
**site code** and (eventually) the **LaTeX worksheet sources**; everything
derived from them is a build artifact that never gets committed:

```
tex sources  ──(tex → mdx converter, CI)──▶  content/modules/*.mdx   (gitignored)
                                             content/index.json      (gitignored)
                                             public/uploads/*        (gitignored, figures)
                        site build  ──▶      out/                    (static export)
```

The site is a Next.js 16 app configured for full static export
(`output: "export"`), so `next build` emits a plain `out/` directory servable
by any static host, GitHub Pages included.

## The pipeline

```
tex/<slug>/main.tex            <- the ONLY content in git
   |  scripts/build-content.mjs  (runs scripts/tex2mdx/, the AST converter)
   v
content/modules/<slug>.mdx     page body            (gitignored)
content/index.json             listing              (gitignored)
public/uploads/<slug>/*.svg    diagrams, content-addressed (gitignored)
public/downloads/<slug>/       <slug>.pdf/.tex/.mdx per-page downloads (gitignored)
   |  next build (output: "export")
   v
out/                           static site -> GitHub Pages
```

- `node scripts/build-content.mjs` — full build. `--check` = converter +
  KaTeX render gate only (fast). `--only <slug>` restricts to one worksheet.
  Non-zero exit on any failure, with the converter's `file:line` messages.
- CI: `.github/workflows/site.yml` — every PR runs the full ladder
  (conversion, render gate, PDFs, site build); pushes to `main` also deploy
  to Pages. Diagram SVGs are cached by content hash, so unchanged diagrams
  never recompile.
- Push protection: `git config core.hooksPath .githooks` enables a pre-push
  hook that rejects pushes when conversion fails (bypass once with
  `--no-verify`). For hard enforcement, make the `build` job a required
  status check on `main`.
- Authoring contract for `tex/` worksheets: see
  `tex/template/main.tex` (living example) — bare-title exercises,
  `\difficulty{}`/`\skippable` marks, labelled solutions.

## Local build

Requires Node ≥ 20.9 (system Node 18 won't do) — the `./run` wrapper selects
Node 22 via nvm from any shell, fish included:

```bash
npm install     # once (run inside `nvm use 22` shell, or: ./run — it prints the node used)
./run           # dev server → http://localhost:3000
./run build     # static export → out/
```

With no generated content present the homepage shows "No public modules yet."
To preview with content, drop files into the (gitignored) artifact paths:

- `content/modules/<slug>.mdx` — a converted module
- `content/index.json` — the module index the homepage/sidebar read
  (array of `{slug, title, cluster, position?, frontmatter, headings?}`;
  see `src/lib/content.ts` for the exact types)
- `public/uploads/<slug>/…` — any figures the MDX references

For hosting under a sub-path (e.g. a GitHub Pages project site), build with
`NEXT_PUBLIC_BASE_PATH=/iliad-intensive ./run build`.

## What renders a module

- `src/lib/mdx.tsx` — MDX → React with KaTeX math (incl. per-page `\gdef`
  macros) and the curriculum components (Callout, Exercise, Solution,
  Definition, Theorem, Figure). Kept in lockstep with the curriculum admin's
  `src/lib/mdx/render.tsx`.
- `src/app/[cluster]/[slug]/page.tsx` — module page: frontmatter header
  (title, cluster, summary, contributors, learning outcomes) + sidebar + body.
- `content/clusters.json` — cluster ids → labels/URL slugs (hand-edited).
