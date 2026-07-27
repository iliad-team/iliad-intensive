#!/usr/bin/env node
/**
 * preview.mjs — view the site at PRODUCTION speed, with rebuild-on-save.
 *
 *   node scripts/preview.mjs [slug]      (usually via: ./run.sh preview [slug])
 *
 * Unlike `watch` (which runs `next dev` and re-renders every page on every
 * request), this serves a real static `next build` from out/ — so viewing and
 * navigating are instant. On each save it rebuilds and the browser reloads
 * itself (an injected SSE snippet).
 *
 * Per-section optimization: with a slug, PREVIEW_ONLY scopes `next build` so it
 * statically generates ONLY that worksheet's page (see listSlugs in
 * src/lib/content.ts) — a save re-renders just the section you edited. Without a
 * slug, the whole site is built and any edited worksheet rebuilds.
 *
 * Note: the scoped build produces an out/ containing the previewed section (+
 * the homepage); links to other, unbuilt modules 404 until you preview them.
 */
import { spawn } from "node:child_process";
import { watch, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
const OUT = path.join(ROOT, "out");
const BUILD = path.join(ROOT, "scripts", "build-content.mjs");
const PORT = Number(process.env.PORT ?? 4321);

const slugArg = process.argv[2] ?? null;
if (slugArg &&
    !existsSync(path.join(TEX, slugArg, "main.tex")) &&
    !existsSync(path.join(TEX, slugArg, "main.mdx"))) {
  console.error(`no such worksheet: tex/${slugArg}/ needs a main.tex or main.mdx`);
  process.exit(1);
}

// --- build: content (fast --check, no PDFs) then a scoped static export ------
// Runs async (spawn, not spawnSync) so the preview server stays responsive and
// the auto-reload signal fires reliably while a build is in flight.
const run = (cmd, args, extraEnv) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd: ROOT, stdio: "inherit", env: { ...process.env, ...extraEnv },
    });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });

async function rebuild(slug) {
  const t0 = Date.now();
  console.log(`↻ building ${slug ?? "all worksheets"} …`);
  if (!(await run("node", [BUILD, "--check", "--no-gate", ...(slug ? [slug] : [])]))) {
    console.log("✗ content build failed (messages above) — fix and save to retry");
    return false;
  }
  if (!(await run("npx", ["next", "build"], slug ? { PREVIEW_ONLY: slug } : {}))) {
    console.log("✗ next build failed (messages above) — fix and save to retry");
    return false;
  }
  console.log(`✓ ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return true;
}

// Serialize builds: a save during a build queues exactly one more run (a slug
// value of null legitimately means "all", so a boolean flag tracks whether one
// is queued rather than overloading the slug value).
let building = false;
let queuedSlug;
let hasQueued = false;
async function trigger(slug) {
  if (building) { queuedSlug = slug; hasQueued = true; return; }
  building = true;
  try {
    if (await rebuild(slug)) notifyReload();
  } finally {
    building = false;
  }
  if (hasQueued) { hasQueued = false; trigger(queuedSlug); }
}

// --- static server for out/, with an injected auto-reload (SSE) --------------
const clients = new Set();
const notifyReload = () => { for (const res of clients) res.write("data: reload\n\n"); };

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript",
  ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".pdf": "application/pdf", ".txt": "text/plain",
  ".map": "application/json", ".mdx": "text/plain",
};

const RELOAD_SNIPPET =
  `<script>(function(){try{var s=new EventSource("/__preview");` +
  `s.onmessage=function(){location.reload()};}catch(e){}})();</script>`;
const inject = (html) =>
  html.includes("</body>") ? html.replace("</body>", RELOAD_SNIPPET + "</body>")
                           : html + RELOAD_SNIPPET;

function resolveFile(url) {
  let fp = path.join(OUT, url);
  if (!fp.startsWith(OUT)) return null;                       // path traversal guard
  try {
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
    else if (!existsSync(fp) && existsSync(fp + ".html")) fp = fp + ".html";
  } catch { /* fall through to existence check */ }
  return existsSync(fp) && statSync(fp).isFile() ? fp : null;
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/__preview") {                                  // SSE auto-reload channel
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let fp = resolveFile(url);
  let code = 200;
  if (!fp) { fp = resolveFile("/404.html"); code = 404; }      // static 404 page if built
  if (!fp) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
  const ext = path.extname(fp).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  if (ext === ".html") {
    res.writeHead(code, { "Content-Type": type });
    res.end(inject(await readFile(fp, "utf8")));
  } else {
    res.writeHead(code, { "Content-Type": type });
    res.end(await readFile(fp));
  }
});

// --- boot: initial build, then serve + watch ---------------------------------
building = true;
const ok = await rebuild(slugArg);
building = false;
server.listen(PORT, () => {
  console.log(`\n▶ preview (production static build) at http://localhost:${PORT}`);
  if (!ok) console.log("  (initial build failed — fix the error above and save to rebuild)");
  console.log(`  editing a worksheet rebuilds it and the browser reloads itself\n`);
});

const ARTIFACT = /\.(aux|log|out|pdf|bbl|blg|brf|toc|fls|synctex(\.gz)?|fdb_latexmk)$|main-nosol\./;
let timer = null;
const pending = new Set();
const watcher = watch(TEX, { recursive: true }, (_event, file) => {
  if (!file || ARTIFACT.test(file)) return;
  const top = file.split(path.sep)[0];
  const isWorksheet = existsSync(path.join(TEX, top, "main.tex")) ||
                      existsSync(path.join(TEX, top, "main.mdx"));
  if (isWorksheet) {
    if (slugArg && top !== slugArg) return;
    pending.add(top);
  } else if (!file.includes(path.sep)) {
    pending.add(slugArg);                                      // shared file (iliad.sty)
  } else {
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    const jobs = [...pending];
    pending.clear();
    for (const s of jobs) trigger(s);
  }, 300);
});
// Editors that save atomically (write a temp file, then rename it over the
// original) make the recursive watcher stat a file that has already vanished —
// a transient ENOENT. Without this handler the 'error' event is unhandled and
// crashes the whole preview on the first save.
watcher.on("error", (err) => {
  if (err && err.code !== "ENOENT") console.error(`watch error: ${err.message}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.close(); process.exit(0); });
}
console.log(`watching tex/${slugArg ?? ""} — edit, save; the browser reloads itself`);
