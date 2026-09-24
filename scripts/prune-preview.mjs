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
 *   PREVIEW_FULL             "true" → shared inputs changed; keep every page
 *   NEXT_PUBLIC_BASE_PATH    the preview's own path, /pr-preview/pr-<N>
 *   PREVIEW_PROD_ASSETS      optional: `git ls-tree -r gh-pages -- downloads
 *                            uploads` — production's files and their blob ids
 *
 * Then, for EVERY preview, full or partial: a download or figure that is
 * byte-identical to production's file at the same path (same git blob id) is
 * not published again. The file is deleted and every link to it in the
 * preview's HTML is pointed at production's copy — the root path, which on
 * this same origin is that file. A full preview (any PR touching scripts/,
 * src/ or schedule.yaml) used to publish all ~90 MB of PDFs and figures again,
 * and every GitHub Pages deploy re-uploads every preview. A PR that changes a
 * PDF still publishes that PDF: its bytes differ. The one trade: if main later
 * changes such a file, the preview shows main's new copy.
 *
 * A production build never reaches the pruning branch: it has no
 * NEXT_PUBLIC_PREVIEW_PR, and the manifest is only written for previews.
 */
import { createHash } from "node:crypto";
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

// ---- files identical to production's (see the header) ----
const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const PROD = process.env.PREVIEW_PROD_ASSETS;
let shared = [], sharedBytes = 0;
if (BASE && PROD && existsSync(PROD)) {
  const prod = new Map();
  for (const line of readFileSync(PROD, "utf8").split("\n")) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);   // ls-tree: "<mode> blob <id>\t<path>"
    if (m) prod.set(m[2], m[1]);
  }
  const blobId = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  const walk = (rel) => {
    for (const e of readdirSync(path.join(OUT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      // The preview's notebooks link their images under this preview.
      if (e.isDirectory()) { if (!/^uploads\/[^/]+\/nb$/.test(r)) walk(r); continue; }
      if (!prod.has(r)) continue;
      const buf = readFileSync(path.join(OUT, r));
      if (blobId(buf) !== prod.get(r)) continue;
      rmSync(path.join(OUT, r));
      shared.push(r);
      sharedBytes += buf.length;
    }
  };
  for (const kind of ["downloads", "uploads"]) if (existsSync(path.join(OUT, kind))) walk(kind);
  if (shared.length) {
    // "<base>/<file>" wherever a link or src names it, raw or URL-encoded, and
    // only as a whole path (followed by a quote, ?, # or ")").
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const forms = [...new Set(shared.flatMap((r) => [r, encodeURI(r)]))].sort((a, b) => b.length - a.length);
    const re = new RegExp(`${esc(BASE)}/(${forms.map(esc).join("|")})(?=["'?#)])`, "g");
    const html = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (/^(downloads|uploads|_next)$/.test(e.name) && dir === OUT ? [] : html(path.join(dir, e.name)))
        : e.name.endsWith(".html") ? [path.join(dir, e.name)] : []);
    for (const f of html(OUT)) {
      const before = readFileSync(f, "utf8");
      const after = before.replace(re, "/$1");
      if (after !== before) writeFileSync(f, after);
    }
    for (const kind of ["downloads", "uploads"]) {
      // Directories emptied by the removal go too.
      const prune = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name));
        if (d !== OUT && readdirSync(d).length === 0) rmSync(d, { recursive: true }); };
      if (existsSync(path.join(OUT, kind))) prune(path.join(OUT, kind));
    }
  }
}

const kept = modules.filter((m) => changed.has(m.slug));
const manifest = {
  pr: PR,
  full: !partial,
  changed: kept,
  published: partial ? kept.map((m) => m.slug) : modules.map((m) => m.slug),
  linkedToProduction: shared.length,
};
writeFileSync(path.join(OUT, "preview-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

if (!partial) {
  console.log(`prune-preview: full preview (${FULL ? "shared inputs changed" : "no changed-set given"}) — nothing pruned`);
} else {
  console.log(`prune-preview: partial preview — kept ${kept.length ? kept.map((m) => m.slug).join(", ") : "no worksheet pages"}; ` +
    `removed ${removed} asset dir${removed === 1 ? "" : "s"} (${(bytes / 1048576).toFixed(1)} MB) for unchanged worksheets`);
}
if (PROD) {
  console.log(`prune-preview: ${shared.length} download/figure file${shared.length === 1 ? "" : "s"} identical to production's ` +
    `linked there instead of copied (${(sharedBytes / 1048576).toFixed(1)} MB)`);
}
