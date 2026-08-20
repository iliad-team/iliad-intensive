#!/usr/bin/env node
/**
 * strip-hydration.mjs — remove the client-side framework from the static
 * export. Run AFTER `next build`, over out/.
 *
 * Worksheet pages are read-only documents: their only interactivity (sidebar
 * toggle, downloads solutions swap) is owned by public/site.js, not React. But
 * the App Router unconditionally ships every page the machinery to hydrate:
 *
 *   1. inline `self.__next_f.push(...)` scripts — the RSC flight payload, a
 *      JSON-escaped copy of the ENTIRE rendered page (~62% of a worksheet's
 *      bytes), and
 *   2. `<script src=".../_next/static/chunks/...">` tags — the React runtime
 *      and page bundles (~650 KB more).
 *
 * There is no supported way to opt a page out, so this strips both after the
 * fact. What hydration bought — none of it needed here:
 *   - client components: worksheet pages have none (site.js replaced them)
 *   - <Link> soft navigation: links fall back to what they already are in the
 *     markup, plain <a href> full-page loads
 *   - prefetching: gone, which for this site is a feature (the homepage
 *     prefetching every worksheet's multi-MB payload was pure waste)
 *
 * /admin/status is EXEMPT: its live-PR overlay (InFlight.tsx) is real client
 * React, so that page keeps its scripts untouched. The per-page index.txt
 * flight files are also kept — that page's router still expects them.
 *
 * The page must be byte-identical markup after the cut: this only ever removes
 * whole <script> / <link rel=preload as=script> elements pointing into the
 * framework, and fails loudly on anything unexpected.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");

/** Every .html under out/, except the /admin/ subtree. */
function htmlFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (path.relative(OUT, p) === "admin") continue;
      files.push(...htmlFiles(p));
    } else if (name.endsWith(".html")) {
      files.push(p);
    }
  }
  return files;
}

/**
 * Remove the inline flight-payload scripts. Found by prefix, closed at the
 * next `</script>` — safe because the payload is JSON-escaped (`<` becomes
 * `\\u003c`), so the literal closer can only be the element's own.
 */
function stripInlineFlight(html) {
  const PREFIXES = [
    '<script>self.__next_f.push(',
    '<script>(self.__next_f=self.__next_f||[]).push(',
  ];
  let removed = 0;
  for (const prefix of PREFIXES) {
    let i;
    while ((i = html.indexOf(prefix)) !== -1) {
      const close = html.indexOf("</script>", i);
      if (close === -1) throw new Error("unterminated flight script");
      html = html.slice(0, i) + html.slice(close + "</script>".length);
      removed++;
    }
  }
  return { html, removed };
}

/** Remove <script src=…/_next/…> bundle tags and their preload hints. */
function stripBundleTags(html) {
  let removed = 0;
  const count = (s) => { removed++; return ""; };
  html = html.replace(/<script[^>]*\bsrc="[^"]*\/_next\/[^"]*"[^>]*><\/script>/g, count);
  html = html.replace(/<link[^>]*\bas="script"[^>]*\/?>/g, count);
  return { html, removed };
}

const files = htmlFiles(OUT);
if (files.length === 0) {
  console.error("✗ no HTML in out/ — run `next build` first");
  process.exit(1);
}

let totalBefore = 0;
let totalAfter = 0;
const rows = [];
for (const file of files) {
  const before = readFileSync(file, "utf8");
  const a = stripInlineFlight(before);
  const b = stripBundleTags(a.html);
  // A page with framework SCRIPTS left after the cut means a pattern this
  // script doesn't know — fail rather than half-strip. (Stylesheet links into
  // /_next/ are fine and must survive: Next keeps its CSS in the same
  // chunks/ directory as the JS.)
  if (b.html.includes("__next_f") || /<script[^>]*\/_next\//.test(b.html)) {
    throw new Error(`${path.relative(OUT, file)}: framework scripts survived the strip`);
  }
  writeFileSync(file, b.html);
  totalBefore += before.length;
  totalAfter += b.html.length;
  if (before.length - b.html.length > 100_000) {
    rows.push(`  ${path.relative(OUT, file).padEnd(52)} ${(before.length / 1048576).toFixed(2)} → ${(b.html.length / 1048576).toFixed(2)} MB`);
  }
}

console.log(`strip-hydration: ${files.length} pages (admin/ exempt)`);
for (const r of rows.sort()) console.log(r);
console.log(
  `  total ${(totalBefore / 1048576).toFixed(2)} → ${(totalAfter / 1048576).toFixed(2)} MB ` +
  `(−${(100 * (1 - totalAfter / totalBefore)).toFixed(0)}%)`,
);
