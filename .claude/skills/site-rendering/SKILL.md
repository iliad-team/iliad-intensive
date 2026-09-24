---
name: site-rendering
description: How the Next.js site in src/ renders what the content build produced — the build-time inputs, every route, the MDX component catalogue and the KaTeX-to-HTML plugin, why worksheet pages ship no React (strip-hydration + site.js + the nav-open class), the base-path rules, /admin/status with its in-browser PR overlay, and /intensives. Read this before changing anything under src/, public/site.js, globals.css or next.config.ts, when a page looks wrong, or when adding a component the converter should emit.
---

# The site (`src/`, ~2,000 lines)

A fully static Next.js 16 app (`output: "export"`, `trailingSlash: true`).
`next build` prerenders every page from files on disk; there is no server, no
API route, no data fetching at request time except the one deliberate
exception on `/admin/status`. **This is not the Next.js in your training
data**: read the relevant page of `node_modules/next/dist/docs/` before writing
Next code (App Router, `params` is a Promise, `generateStaticParams`,
`dynamicParams = false`). `docs/INTERNALS.md` is the human map; this skill is
the mechanics and the rules.

## What the build reads (nothing else)

| Input | Reader | Notes |
|---|---|---|
| `content/modules/*.mdx` | `lib/content.ts` `readModuleMdx`, `listSlugs` | every file becomes a page, listed or not; `PREVIEW_ONLY=<slug>` limits `listSlugs` to one page (the `preview` loop) |
| `content/index.json` | `listIndex` | homepage/sidebar listing, ordering (`position`), heading TOCs, `part/parts` |
| `content/status.json` | `lib/status.ts` `readStatus` | `/admin/status`; null → the page says "run the content build" |
| `schedule.yaml` | `lib/cluster-store.ts` (`server-only`) `listClusters`, `listDays` | cluster labels + URL segments, day codes + titles; degrades to `DEFAULT_CLUSTERS`/`[]` |
| `intensives/*.yaml` | `lib/intensives.ts` (`server-only`) | throws on bad data — a wrong published date is worse than a red build |
| `public/downloads/<slug>/` | `listDownloads`, `listDecks` | which buttons the downloads row offers; deck titles read off the staged `.tex`/`.typ` |
| `license.md` | `app/license/page.tsx` | rendered through the same MDX pipeline |
| `NEXT_PUBLIC_BASE_PATH` | `next.config.ts`, `lib/mdx.tsx`, module page, status page, `PreviewBanner` | sub-path hosting for PR previews; empty in production |
| `NEXT_PUBLIC_COMMIT_SHA` | `components/BuildStamp.tsx` | footer commit link; `npm run ci` defaults it to `git rev-parse HEAD` |
| `NEXT_PUBLIC_PREVIEW_PR` (+`_TITLE`) | `PreviewBanner`, `layout.tsx`, `InFlight.tsx` | banner, `diff.js` load, sticky `#top-stack`, skips the drift check |
| `PREVIEW_CHANGED_SLUGS`, `PREVIEW_FULL`, `NEXT_PUBLIC_DIFF_BASE` | `lib/preview.ts` | partial previews: which worksheets render (`listSlugs`), which get the green tint, and where unpublished pages link (`ModuleLink`, `siteHref`); ignored unless `NEXT_PUBLIC_PREVIEW_PR` is set |

`lib/clusters.ts` is the pure, client-safe half (`clusterUrlSlug`, `pagePath`,
`clusterLabel`, `dayCode`); the fs-reading half is split off so client
components never drag `node:fs` into a bundle.

**Linking to a worksheet page: always `components/ModuleLink.tsx`**, never a
bare `<Link href={pagePath(...)}>`. On a partial PR preview the target page
may not exist in this build, and `ModuleLink` then renders a plain `<a>` to
the live site (a `<Link>` would prefix the base path and 404). Likewise a
root-relative download, upload or body link goes through `siteHref` from
`lib/preview.ts`, which applies the base path or the live origin as
appropriate; the MDX `a` and `Figure` components already do.

## Routes

- `app/layout.tsx` — fonts (Inter, Source Serif 4), an inline blocking script
  that restores the `nav-open` class on `<html>` from localStorage before
  first paint, `<PreviewBanner>`, `<Navbar>`, then `site.js` and, on preview
  builds only, `diff.js`.
- `app/page.tsx` — homepage: hero paragraph, then clusters in `schedule.yaml`
  order, each a list sorted by `position`; consecutive worksheets of one day
  are grouped under an `<h3 id="<day code>">` (the anchor a part page's
  breadcrumb links to); single-worksheet days stay flat. `prefetch={false}`
  everywhere a worksheet is linked — payloads are multi-MB.
- `app/[cluster]/[slug]/page.tsx` — the module page. `generateStaticParams`
  enumerates every MDX module with its cluster's URL segment; a request under
  the wrong segment 404s. Header = title, `Cluster X`, `D.3.1 · Day title`
  (linked to the homepage day anchor when the day has parts), summary,
  contributors, `<DownloadsRow>`; body = `<MdxBody>` inside `.prose`; footer =
  built date, link to the source file it was built from, commit, licence.
- `app/admin/status/page.tsx` — see below.
- `app/intensives/page.tsx`, `app/intensives/[intensive]/page.tsx` — a
  directory of programmes (newest first) and one calendar per file: a row per
  date, the day's built worksheets from `index.json`, 🚧 for a teaching day
  with nothing built, the `rhythm:` block once above the table.
- `app/license/page.tsx`.

## Rendering MDX (`lib/mdx.tsx`)

`MdxBody` calls `compileMDX` (next-mdx-remote/rsc) with
`remarkPlugins: [remarkMath, remarkGfm, remarkKatexHtml]` and
`rehypePlugins: [rehypeSlug]`, cached by a sha1 of the source (64 entries)
so `next dev` doesn't re-render unchanged pages.

**`lib/remark-katex-html.ts` replaces rehype-katex.** It renders each
`math`/`inlineMath` mdast node with `katex.renderToString({output: "html"})`
and swaps in a `<KatexHtml html tex display>` JSX node. Reason: rehype-katex
turned every formula into ~50 React elements, which the RSC payload serialised
as JSON tuples (singular-learning-theory: 1,908 formulas, ~96,700 tuples).
`output: "html"` also drops KaTeX's hidden MathML copy; the TeX source rides
as `aria-label` on the wrapper instead (a memory note: MathML was rejected
twice on looks, do not reintroduce it). Per-file `macros` object = the page's
`\gdef` block scope. The plugin throws if KaTeX's outer wrapper ever changes
shape.

The component catalogue — names are the contract with the converter, styling
is the site's own: `a` (prefixes `BASE_PATH` on root-relative hrefs, because
raw MDX `<a>` gets no automatic basePath), `KatexHtml`, `Callout`
(note/tip/warning, optional `title`, `id`), `Exercise` (`id`), `Solution`
(`<details>`, `title`), `Hint` (`<details>`), `TeachingNote` (`<details>`,
`data-component="teaching-note"`), `LearningOutcomes`, `Definition`,
`Theorem`, `Figure` (`src` prefixed with `BASE_PATH`; caption as *children* so
math renders; `w-full` because TikZ SVGs carry tiny pt sizes), `YouTube`
(youtube-nocookie iframe + watch link). Adding a component: here, in
`emit-ast.mjs`, in `docs/commands.md`, and for the PDF side in `tex/iliad.sty`.

## No client React on worksheet pages

Worksheet pages are documents. After `next build`, `scripts/strip-hydration.mjs`
deletes every inline `self.__next_f.push(...)` flight script and every
`<script src=…/_next/…>` / `<link as="script">` from every page **except
`out/admin/`** (the status page hydrates), and fails loudly if any framework
script survives. `index.txt` flight files are kept for that page's router.
Roughly 62% of a worksheet's bytes were the flight payload.

So all client behaviour lives in `public/site.js` (~60 lines, vanilla,
feature-detected by id): the `#nav-toggle` button toggles `nav-open` on
`<html>` and stores it under `localStorage["iliad.navOpen"]`; a click on a
link inside `#module-sidebar` closes the sidebar below `lg`; the
`#solutions-toggle` checkbox swaps every `a[data-sol]` between its
`data-sol`/`data-nosol` hrefs. `ModulePageShell` renders **both** layout
states in the markup and `globals.css`'s `#page-shell` rules pick one from
`html.nav-open`; `NavToggle` ships both icons and `aria-expanded="false"`
which site.js syncs. `body:has(#module-sidebar)` hides the toggle where there
is nothing to toggle. `<Link>` degrades to plain `<a>` full-page loads.
Consequence for you: **a new interaction on a worksheet page goes in
`site.js`, not in a `"use client"` component**; a client component there
would render its server HTML and then never hydrate.

`suppressHydrationWarning` on `<html>` and on every `<details>` is deliberate:
the inline nav script and native `<details>` toggling both change the DOM
before React could hydrate on the one page that does.

## Base path — the three places, and the rule

Production is served at the root of `iliad-intensive.org`; a PR preview at
`/pr-preview/pr-N/`. `next.config.ts` sets `basePath` from
`NEXT_PUBLIC_BASE_PATH`, which covers `<Link>`, CSS and fonts. It does **not**
cover raw `<img src>`, raw `<a href>` in MDX, download hrefs, or script tags,
so `Figure` and the `a` component (via `siteHref`), `DownloadsRow` (via the
`basePath` prop — its files are always the page's own), the status page chips
(via `siteHref`) and `layout.tsx`'s script tags prefix it by hand. The rule:
generated content (`content/`, `status.json`) never contains a base path;
render-time code always applies it. Getting this wrong shows up only on a
preview, never locally.

## Ordering and day codes

Nothing sorts by title. `index.json` `position` is the schedule order and every
list uses it (`sortedItems`, `SidebarNav`, the intensive calendar).
`dayCode(day, part, parts)` in `lib/clusters.ts` is the only place `D.3.1` is
composed: display only, never stored. Note `SidebarNav` has its own hard-coded
`CLUSTER_ORDER = ["0","A","B","C","D","E","Other"]`; the homepage and status
page take cluster order from `schedule.yaml` — a new cluster id must be added
to that array or it sorts to the end of the sidebar.

## `/admin/status` and the live overlay

The table is server-rendered from `status.json` (`build-status.mjs` joins the
schedule with what the build produced; the `content-build` skill explains the
data). Five tones (`TONE`: good/ok/wait/none/gone), each carried three ways
(tint, glyph, word), with a legend. "admin" is a name, not access control.

`components/InFlight.tsx` (`"use client"`) is the one thing not from the build:
in the reader's browser it fetches the repo's open PRs (unauthenticated GitHub
API, 60/hour/IP, two calls per load) and `GET /compare/<deployed sha>...main`
to say whether the deployed commit is still main's tip. Rules it obeys and you
must keep: **strictly additive** — JS off, offline, rate-limited, or repo
private → the page is exactly the build's; it never changes a cell's glyph or
words, only splits the amber "outstanding" tint into violet where an open PR's
title claims that day; the join key is a day code inside `[…]` in the PR
title (`dayCodesIn`); on a preview build (`NEXT_PUBLIC_PREVIEW_PR` set) the
compare is skipped and the line names the PR instead. The violet tone lives in
`components/flight-tone.ts`, a separate module with no `"use client"`, because
a server component importing a value from a client module gets `undefined`
(silently, class="… undefined").

## Styling

Tailwind 4 via `@tailwindcss/postcss` + `@tailwindcss/typography`. `globals.css`
owns the tokens (`--background`, `--link`, `--header-h: 3rem` for the navbar
itself, `--top-h` for everything stuck to the top — equal to `--header-h` on
production, measured by `site.js` from `#top-stack` on previews — which
`scroll-padding-top` and the sticky sidebar derive from, and `--prose-w:
680px` which `.prose` and the diff columns share), the serif body, the
`#page-shell` two-mode layout, and the diff-view classes (folds, stretch mode,
the `.diff-current` ring). Light mode only, on purpose. Reading pages are 720px wide; the
intensive calendar 860px; status 1100px.

## Verifying a change

1. `./run.sh ci <slug>` from the main checkout (a symlinked worktree cannot
   run `next build`; see the `content-build` skill). Type errors and lint
   fail the real build; only `PREVIEW_ONLY` builds skip them.
2. Look at the page in `./run.sh preview <slug>` (real static build) rather
   than `next dev` when the question is what ships.
3. `node scripts/check-overflow.mjs <slug>` for anything that widens content;
   `--width 400` for phones.
4. If it touches links, images or downloads, think about the preview base
   path — the only place it breaks is on the PR preview.
5. The strip must still succeed: a page that gains a `"use client"` child will
   fail `strip-hydration` or silently not hydrate.
