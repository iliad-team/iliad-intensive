#!/usr/bin/env node
/**
 * watch.mjs — live authoring loop: run the dev site and rebuild worksheets
 * on every save.
 *
 *   node scripts/watch.mjs [slug]     (usually via: ./run watch [slug])
 *
 * With a slug, only that worksheet rebuilds on change; without, any saved
 * worksheet rebuilds. Rebuilds run in fast --check mode (conversion + render
 * gate — no PDFs), which is what the browser preview needs; run
 * `./run content` for the full artifact build when you want PDFs/downloads.
 * A change to a shared file (iliad.sty at the tex/ root) rebuilds everything
 * being watched.
 */
import { spawn, spawnSync } from "node:child_process";
import { watch, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
const BUILD = path.join(ROOT, "scripts", "build-content.mjs");

const slugArg = process.argv[2] ?? null;
if (slugArg && !existsSync(path.join(TEX, slugArg, "main.tex")) && !existsSync(path.join(TEX, slugArg, "main.mdx"))) {
  console.error(`no such worksheet: tex/${slugArg}/ needs a main.tex or main.mdx`);
  process.exit(1);
}

function build(slug) {
  const t0 = Date.now();
  const argv = [BUILD, "--check", ...(slug ? [slug] : [])];
  const r = spawnSync("node", argv, { cwd: ROOT, stdio: "inherit" });
  console.log(r.status === 0
    ? `↻ rebuilt ${slug ?? "all worksheets"} in ${((Date.now() - t0) / 1000).toFixed(1)}s — refresh the browser`
    : `↻ build FAILED (messages above) — fix and save to retry`);
}

// initial build so the site starts with current content
build(slugArg);

// the dev site, live in this terminal; Ctrl+C stops both
const dev = spawn("npx", ["next", "dev"], { cwd: ROOT, stdio: "inherit" });
dev.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { dev.kill("SIGTERM"); process.exit(0); });
}

// LaTeX/pandoc runs write artifacts next to the sources — never rebuild on
// those, or the watcher would loop forever.
const ARTIFACT = /\.(aux|log|out|pdf|bbl|blg|brf|toc|fls|synctex(\.gz)?|fdb_latexmk)$|main-nosol\./;

let timer = null;
const pending = new Set();
watch(TEX, { recursive: true }, (_event, file) => {
  if (!file || ARTIFACT.test(file)) return;
  const top = file.split(path.sep)[0];
  const isWorksheet = existsSync(path.join(TEX, top, "main.tex")) || existsSync(path.join(TEX, top, "main.mdx"));
  if (isWorksheet) {
    if (slugArg && top !== slugArg) return;
    pending.add(top);
  } else if (!file.includes(path.sep)) {
    pending.add(null); // shared file (e.g. iliad.sty): rebuild the watched scope
  } else {
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    const jobs = pending.has(null) ? [slugArg] : [...pending];
    pending.clear();
    for (const s of jobs) build(s);
  }, 300);
});

console.log(`watching tex/${slugArg ?? ""} — edit, save, refresh`);
