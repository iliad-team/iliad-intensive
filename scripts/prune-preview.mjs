#!/usr/bin/env node
/**
 * prune-preview.mjs — cut a PR preview down to the pages the PR changed.
 * Run AFTER `next build` (and strip-hydration), over out/.
 *
 * A preview lives at /pr-preview/pr-N/ on the same origin as production, so a
 * worksheet the PR did not touch already exists at its root path, exactly as
 * the merge would leave it. Publishing a copy under the preview only repeats
 * production — ~165 MB per open PR on the gh-pages tip, of which downloads/
 * (PDFs) and uploads/ (figures) are four fifths.
 *
 * The site build already leaves such pages unrendered (src/lib/preview.ts,
 * read by listSlugs): this script removes the per-worksheet asset directories
 * Next copies wholesale out of public/, and writes out/preview-manifest.json,
 * which the workflow's preview comment reads to say what the preview holds.
 *
 * Driven by the same environment the site build read, so the two cannot
 * disagree about which pages exist:
 *   NEXT_PUBLIC_PREVIEW_PR   set → this is a preview build (else: no-op)
 *   PREVIEW_CHANGED_SLUGS    comma-separated worksheets the PR touched
 *   PREVIEW_FULL             "true" → shared inputs changed; keep everything
 *
 * A production build never reaches the pruning branch: it has no
 * NEXT_PUBLIC_PREVIEW_PR, and the manifest is only written for previews.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchedule } from "./schedule.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const MODULES = path.join(ROOT, "content", "modules");

const PR = process.env.NEXT_PUBLIC_PREVIEW_PR;
if (!PR) process.exit(0);                                   // production build: nothing to do
const RAW = process.env.PREVIEW_CHANGED_SLUGS;
const FULL = /^(1|true)$/i.test(process.env.PREVIEW_FULL ?? "");
const changed = new Set((RAW ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const partial = RAW !== undefined && !FULL;

if (!existsSync(path.join(OUT, "index.html"))) {
  console.error("✗ prune-preview: out/index.html missing — run `next build` first");
  process.exit(1);
}

// Every listed worksheet, with where its page is; the unlisted sheet (the
// format demo) has assets but no index entry, so slugs come from content/.
const schedule = loadSchedule();
const clusterSlug = new Map(schedule.clusters.map((c) => [c.id, c.urlSlug]));
const index = JSON.parse(readFileSync(path.join(ROOT, "content", "index.json"), "utf8"));
const modules = index.map((m) => ({
  slug: m.slug,
  title: m.title,
  code: m.parts > 1 ? `${m.day}.${m.part}` : m.day ?? null,
  path: `/${clusterSlug.get(m.cluster) ?? "page"}/${m.slug}/`,
}));
const allSlugs = existsSync(MODULES)
  ? readdirSync(MODULES).filter((f) => f.endsWith(".mdx")).map((f) => f.slice(0, -".mdx".length))
  : [];

const sizeOf = (dir) => {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? sizeOf(p) : statSync(p).size;
  }
  return n;
};

let removed = 0, bytes = 0;
if (partial) {
  for (const slug of allSlugs) {
    if (changed.has(slug)) continue;
    // The page itself was never rendered (listSlugs filtered it out). If it
    // is there after all, the site build and this script read different
    // environments — refuse rather than publish a preview that lies.
    const m = modules.find((x) => x.slug === slug);
    if (m && existsSync(path.join(OUT, m.path))) {
      console.error(`✗ prune-preview: out${m.path} exists but "${slug}" is not in PREVIEW_CHANGED_SLUGS — the site build and this script disagree`);
      process.exit(1);
    }
    for (const kind of ["downloads", "uploads"]) {
      const dir = path.join(OUT, kind, slug);
      if (!existsSync(dir)) continue;
      // uploads/<slug>/nb/ stays: it holds the images the PR's preview
      // notebooks link (docs/NOTEBOOKS.md), and they link every module's
      // images under this preview, touched or not. A few PNGs per module.
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (kind === "uploads" && e.name === "nb" && e.isDirectory()) continue;
        const p = path.join(dir, e.name);
        bytes += e.isDirectory() ? sizeOf(p) : statSync(p).size;
        rmSync(p, { recursive: true, force: true });
      }
      if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  }
}

const kept = modules.filter((m) => changed.has(m.slug));
const manifest = {
  pr: PR,
  full: !partial,
  changed: kept,
  published: partial ? kept.map((m) => m.slug) : modules.map((m) => m.slug),
};
writeFileSync(path.join(OUT, "preview-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

if (!partial) {
  console.log(`prune-preview: full preview (${FULL ? "shared inputs changed" : "no changed-set given"}) — nothing pruned`);
} else {
  console.log(`prune-preview: partial preview — kept ${kept.length ? kept.map((m) => m.slug).join(", ") : "no worksheet pages"}; ` +
    `removed ${removed} asset dir${removed === 1 ? "" : "s"} (${(bytes / 1048576).toFixed(1)} MB) for unchanged worksheets`);
}
