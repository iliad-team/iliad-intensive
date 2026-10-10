#!/usr/bin/env node
/**
 * build-plan.mjs — will this content build need TeX Live?
 *
 * CI runs this after restoring the worksheet cache and before installing
 * anything. A sheet whose build is cached (worksheet-cache.mjs, the same check
 * build-content.mjs makes) compiles nothing; an uncached one needs TeX Live if
 * it has a main.tex, a LaTeX deck or a fig/*.pdf figure. When no uncached sheet
 * needs it, site.yml skips the ~70 s TeX install: that is every PR that touches
 * only MDX sheets, notebooks, the site or the docs.
 *
 * Node built-ins only (via worksheet-cache.mjs), so it runs before `npm ci`.
 * Must see the same NOTEBOOK_PREVIEW_* environment as the build, since the
 * notebooks branch is part of some sheets' hashes.
 *
 * Prints what it decided; on GitHub Actions also writes `tex=true|false` to
 * $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { allWorksheets, worksheetHash, cacheHit, needsTex } from "./worksheet-cache.mjs";

const uncached = allWorksheets.filter((slug) => !cacheHit(slug, worksheetHash(slug)));
const tex = uncached.filter(needsTex);

console.log(`build plan: ${allWorksheets.length - uncached.length}/${allWorksheets.length} worksheets cached`
  + (uncached.length ? `; to build: ${uncached.join(", ")}` : ""));
console.log(tex.length
  ? `build plan: TeX Live needed for ${tex.join(", ")}`
  : "build plan: no TeX Live needed");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tex=${tex.length > 0}\n`);
