#!/usr/bin/env node
/**
 * worksheet-cache.mjs — whether a worksheet's build is already done.
 *
 * build-content.mjs skips a worksheet when a hash of its inputs matches the
 * stamp in tex/<slug>/.build-hash and every artifact it would produce is still
 * on disk. That decision lives here, apart from the build, so that CI can make
 * it BEFORE anything is installed: scripts/build-plan.mjs asks it whether any
 * sheet will need TeX, and the workflow skips the TeX Live install when none
 * will. So this file imports Node built-ins only — no npm packages — and both
 * scripts get the same answer from the same code.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEX = path.join(ROOT, "tex");
export const MODULES = path.join(ROOT, "content", "modules");
export const UPLOADS = path.join(ROOT, "public", "uploads");
export const DOWNLOADS = path.join(ROOT, "public", "downloads");

// A worksheet is authored either in LaTeX (main.tex — converted to MDX) or
// directly in MDX (main.mdx — served as-is; a web page only, never a PDF). tex wins if
// a folder somehow has both.
export const allWorksheets = readdirSync(TEX, { withFileTypes: true })
  .filter((d) => d.isDirectory()
    && (existsSync(path.join(TEX, d.name, "main.tex")) || existsSync(path.join(TEX, d.name, "main.mdx"))))
  .map((d) => d.name);

// Artifacts share tex/<slug>/ with sources, so top-level generated files are
// excluded by extension (fig/ is all source, including its .pdf figures, and is
// hashed whole). Anything not listed here counts as an input by default.
// vrb (beamer verbatim), bcf + run.xml (biber), brf (hyperref backref): each
// is written on a deck's or sheet's FIRST build, so leaving one out cost that
// sheet one needless rebuild on the run after every cold build.
export const ARTIFACT_EXT = /\.(pdf|aux|log|out|toc|nav|snm|vrb|bbl|blg|bcf|run\.xml|brf|fls|fdb_latexmk|synctex\.gz)$/i;

const ARTIFACT_NAME = new Set(["main.autolabel.tex", "main-nosol.tex", "main-nosol.mdx", ".build-hash"]);
// Generated files the build writes INSIDE subdirectories, which are otherwise
// hashed whole. Two steps do this: autolabel writes sections/<name>.autolabel.tex
// beside each section source, and minted writes _minted/ + _minted-slides/
// caches whose index file carries a build timestamp. Hashing them made a build
// change its own inputs: the stamp records the pre-build hash, the tree no
// longer matches it afterwards, so every sectioned sheet rebuilt a second time
// after a cold build and any minted deck rebuilt on EVERY run (measured:
// intro-to-ml-engineering, 8-17s per push, forever). Excluded at every depth.
const GENERATED_DIR = /^_minted/;
const GENERATED_FILE = /\.autolabel\.tex$/;

// The decks a worksheet folder ships. `slides.tex` is the deck every folder has
// had so far; a day with more than one lecture adds `slides-<label>.tex` beside
// it (label: lowercase letters, digits, hyphens). Each compiles and is staged on
// its own as <slug>-<stem>.pdf + its source, and the page shows one Slides row
// per deck: slides.tex first, then the rest in filename order — that order is
// the only sequencing there is, so name a second deck with it in mind. A stem
// may not end in -handout: that suffix belongs to the collapsed build, and
// slides-foo-handout.pdf has to mean "the handout of slides-foo".
//
// A deck is LaTeX (.tex, build-content.mjs's pdflatex ladder) or Typst (.typ, one
// `typst compile`); the stem is what names it, so slides.tex and slides.typ in
// one folder is a clash the build refuses rather than picks between.
const DECK_RE = /^(slides(?:-[a-z0-9][a-z0-9-]*)?)\.(tex|typ)$/;
export const deckSources = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => DECK_RE.exec(f))
    .filter((m) => m && !m[1].endsWith("-handout"))
    .map((m) => ({ file: m[0], stem: m[1], ext: m[2] }))
    .sort((a, b) => (a.stem === "slides" ? -1 : b.stem === "slides" ? 1 : a.stem.localeCompare(b.stem)));
};

// ------------------------------- notebooks ----------------------------------
// A .py directly in tex/<slug>/ whose first line starts with "# ! " is a Colab
// notebook master (docs/NOTEBOOKS.md). tex/gen_notebooks.py builds the notebooks
// and .github/workflows/notebooks.yml publishes them; this script never does.
// Masters matter here three ways:
//   1. they are not worksheet inputs, so worksheetHash skips them (and the local
//      .ipynb, sync stamps, trash and support/ that go with them) — a notebook
//      edit never recompiles a PDF;
//   2. \notebooksol{name} / \notebooknosol{name}, and <NotebookSol name="…"/> /
//      <NotebookNoSol name="…"/> in an MDX sheet, resolve here to the notebook's
//      Colab URL, and a name with no master is a build error;
//   3. the fig/ images they show are staged under /uploads/<slug>/nb/, which is
//      where the published notebooks link them.
// colabUrl must match COLAB_URL in tex/gen_notebooks.py.
//
// A PR preview can link the PR's own notebooks: .github/workflows/notebooks.yml
// publishes them to the PR's own `notebooks-pr-<N>` branch (never to
// `notebooks`, which only main writes), and site.yml sets NOTEBOOK_PREVIEW_PR for
// the preview build (same-repo PRs only — a fork's PR gets no notebook preview,
// so its site preview links production's).
//
// But only for the notebooks the PR can have changed. The branch is an input to
// every sheet that links a notebook (worksheetHash), so linking the PR's branch
// from ALL of them rebuilt those sheets — PDFs and decks — on every preview,
// whatever the PR touched: D.2's deck recompiled on a PR that edited one line of
// another day. A notebook the PR did not touch is identical on both branches, so
// linking production's loses nothing. site.yml sets NOTEBOOK_PREVIEW_SLUGS to the
// modules the PR touches ("*" when the generator or the header template changed,
// which changes every notebook); unset, every notebook counts as touched.
const NB_PREVIEW_PR = /^\d+$/.test(process.env.NOTEBOOK_PREVIEW_PR ?? "") ? process.env.NOTEBOOK_PREVIEW_PR : null;
const NB_PREVIEW_SLUGS = process.env.NOTEBOOK_PREVIEW_SLUGS?.trim();
const nbTouched = (owner) => NB_PREVIEW_SLUGS === undefined || NB_PREVIEW_SLUGS === "*"
  || NB_PREVIEW_SLUGS.split(",").map((s) => s.trim()).includes(owner);
/** The branch whose notebooks a link to <owner>'s notebook opens. */
export const nbBranchFor = (owner) =>
  NB_PREVIEW_PR && nbTouched(owner) ? `notebooks-pr-${NB_PREVIEW_PR}` : "notebooks";
export const colabUrl = (branch, slug, name, kind) =>
  `https://colab.research.google.com/github/iliad-team/iliad-intensive/blob/${branch}/${slug}/${name}_${kind}.ipynb`;
// Does any of a module's sources link a notebook? Then the branch it links is an input to its build.
const NB_LINK = /\\notebook(?:no)?sol\b|<Notebook(?:No)?Sol\b/;
// The notebook each link names: \notebooksol[text]{ref} or <NotebookSol name="ref">.
const NB_REF = /\\notebook(?:no)?sol\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}|<Notebook(?:No)?Sol\s+name\s*=\s*"([^"]*)"/g;
const sheetSources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory()
    ? (!/^(\.|_minted|node_modules$|support$)/.test(e.name) && !e.isSymbolicLink() ? sheetSources(path.join(dir, e.name)) : [])
    : /\.(tex|mdx)$/.test(e.name) ? [readFileSync(path.join(dir, e.name), "utf8")] : []);
const linksNotebooks = (dir) => sheetSources(dir).some((text) => NB_LINK.test(text));
/**
 * The notebooks branch a sheet's links point at, web and PDF alike. One branch
 * per sheet, because pdflatex gets a single \iliadnbbranch. The PR's branch
 * holds every notebook, so a sheet linking any touched notebook takes it; so does
 * a link whose target cannot be read off the source (a macro argument, say).
 */
export const nbBranchForSheet = (slug) => {
  const owners = new Set();
  let unread = false;
  for (const text of sheetSources(path.join(TEX, slug))) {
    if (!NB_LINK.test(text)) continue;
    const refs = [...text.matchAll(NB_REF)].map((m) => (m[1] ?? m[2]).trim());
    if (!refs.length) unread = true;
    for (const ref of refs) owners.add(ref.includes("/") ? ref.split("/")[0] : slug);
  }
  if (unread && NB_PREVIEW_PR) return `notebooks-pr-${NB_PREVIEW_PR}`;
  return [...owners].map(nbBranchFor).find((b) => b !== "notebooks") ?? "notebooks";
};
export const isMaster = (p) => {
  if (!p.endsWith(".py")) return false;
  try { return readFileSync(p, "utf8").startsWith("# ! "); } catch { return false; }
};
export const notebookMasters = (slug) => {
  const dir = path.join(TEX, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => isMaster(path.join(dir, f))).map((f) => f.slice(0, -3)).sort();
};
// Every master in the repo as "<slug>/<name>", computed once per build.
let ALL_MASTERS = null;
const allNotebookMasters = () => (ALL_MASTERS ??= readdirSync(TEX, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => notebookMasters(d.name).map((n) => `${d.name}/${n}`)).sort());
// The notebook side of a module folder, which the worksheet build ignores.
const isNotebookFile = (dir, e) =>
  e.name === "support" || e.name === ".trash" || /\.ipynb$/.test(e.name) || /^\..+\.sync$/.test(e.name)
  || /\.from-notebook\.py$/.test(e.name) || (e.isFile() && isMaster(path.join(dir, e.name)));

const hashPath = (h, p) => {
  if (!existsSync(p)) return;
  h.update(path.basename(p));
  h.update(readFileSync(p));
};
function hashDir(h, root, all = false) {
  if (!existsSync(root)) return;
  for (const e of readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    // node_modules is a symlink in every worktree (new-worktree.sh) and is
    // pinned by the lockfiles anyway — never walk it.
    if (e.name === "node_modules" || e.isSymbolicLink()) continue;
    if (!all && (ARTIFACT_NAME.has(e.name) || ARTIFACT_EXT.test(e.name))) continue;
    if (!all && isNotebookFile(root, e)) continue;
    if (e.isDirectory() ? GENERATED_DIR.test(e.name) : GENERATED_FILE.test(e.name)) continue;
    const p = path.join(root, e.name);
    h.update(e.name);
    if (e.isDirectory()) hashDir(h, p, true);
    else h.update(readFileSync(p));
  }
}

export const worksheetHash = (slug) => {
  const h = createHash("sha256");
  hashDir(h, path.join(TEX, slug));                    // the sheet's own sources
  hashPath(h, path.join(TEX, "iliad.sty"));            // shared worksheet contract
  hashPath(h, path.join(TEX, "alphaurl.bst"));         // vendored bibliography style
  // A sheet that links notebooks depends on which notebooks exist ANYWHERE: its
  // \notebooksol{name} or {other-slug/name} is checked against them. So renaming
  // or deleting a master re-checks every sheet that links one, in any module. And
  // the branch it links is baked into its page and PDF, so a preview linking the
  // PR's notebooks never shares production's cached copy — while one linking
  // production's (nbBranchForSheet) does. Sheets without notebook links hash neither.
  if (linksNotebooks(path.join(TEX, slug))) {
    h.update(`notebooks:${allNotebookMasters().join(",")}`);
    h.update(`nb-branch:${nbBranchForSheet(slug)}`);
  }
  // Only the scripts that can change a worksheet's ARTIFACTS. Hashing the whole
  // scripts/ tree was safe but far too wide: build-status.mjs writes nothing but
  // content/status.json, and preview.mjs / watch.mjs write nothing at all, yet
  // touching any of them recompiled every PDF — measured at 66.6s for a change
  // that could not alter a single byte of output.
  hashPath(h, path.join(ROOT, "scripts", "build-content.mjs"));  // the ladder
  hashPath(h, path.join(ROOT, "scripts", "worksheet-cache.mjs")); // this file
  hashPath(h, path.join(ROOT, "scripts", "schedule.mjs"));       // reads the schedule
  hashDir(h, path.join(ROOT, "scripts", "tex2mdx"), true);       // the converter
  // schedule.yaml is deliberately NOT hashed. Where a sheet sits in the course
  // decides two frontmatter lines and nothing else — no PDF, no prose, no
  // figure. Hashing it meant adding one day to the curriculum recompiled all
  // eleven PDF ladders (66.6s measured). The stamp is verified against the
  // schedule on every cache hit instead, and rewritten in place if it moved,
  // which costs about a millisecond and cannot go stale.
  return h.digest("hex");
};

// A skip is only safe if everything downstream is already present. That includes
// the figures: public/uploads belongs to the separate diagram cache, so if that
// one missed while this one hit, a skipped worksheet would ship broken images.
// Checking the uploads the cached MDX actually references closes that gap.
export const outputsPresent = (slug) => {
  const dl = path.join(DOWNLOADS, slug);
  const mdx = path.join(MODULES, `${slug}.mdx`);
  // Mirror exactly what step 5 stages, or a sheet becomes permanently
  // uncacheable. An MDX-authored sheet is a web page and builds no PDF or .tex
  // at all, so only the two .mdx downloads are guaranteed for it.
  const need = [mdx, path.join(dl, `${slug}.mdx`), path.join(dl, `${slug}-nosol.mdx`)];
  if (existsSync(path.join(TEX, slug, "main.tex"))) {
    need.push(path.join(dl, `${slug}.pdf`), path.join(dl, `${slug}-nosol.pdf`),
              path.join(dl, `${slug}.tex`), path.join(dl, `${slug}-nosol.tex`));
  }
  for (const d of deckSources(path.join(TEX, slug))) need.push(path.join(dl, `${slug}-${d.stem}.pdf`));
  if (!need.every(existsSync)) return false;
  // Anchored on the slug, because this build only ever writes figures to
  // public/uploads/<slug>/. A bare /uploads/ match would also hit external URLs
  // that happen to contain that segment (ai-alignment-intro cites one), and the
  // worksheet would then never be cacheable.
  const refs = new RegExp(`/uploads/${slug}/([^\\s"')]+)`, "g");
  for (const m of readFileSync(mdx, "utf8").matchAll(refs)) {
    if (!existsSync(path.join(UPLOADS, slug, decodeURIComponent(m[1])))) return false;
  }
  return true;
};

/** Is `slug`'s build already done? `hash` is its worksheetHash. */
export const cacheHit = (slug, hash) => {
  const stamp = path.join(TEX, slug, ".build-hash");
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === hash && outputsPresent(slug);
};

/**
 * Does building `slug` run TeX Live? pdflatex for a LaTeX sheet or deck (and the
 * converter's TikZ pictures, which only a LaTeX sheet has), pdftocairo (poppler,
 * installed with it) for a fig/*.pdf figure. A Typst deck needs only typst, and
 * an MDX sheet with none of these needs nothing.
 */
export const needsTex = (slug) => {
  const dir = path.join(TEX, slug);
  const fig = path.join(dir, "fig");
  return existsSync(path.join(dir, "main.tex"))
    || deckSources(dir).some((d) => d.ext === "tex")
    || (existsSync(fig) && readdirSync(fig).some((f) => /\.pdf$/i.test(f)));
};
