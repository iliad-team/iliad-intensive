#!/usr/bin/env node
/**
 * check-overflow.mjs — find content that escapes the content column.
 *
 * Renders every built worksheet page in headless Chrome and reports each
 * element whose box extends past the right edge of the content column
 * (`.prose`) — the "math runs off the page" bug, but it catches wide tables,
 * <pre> blocks and images the same way. Elements inside a horizontally
 * scrollable ancestor are fine and skipped.
 *
 * Measured, not guessed: the page is laid out by a real browser with the
 * site's CSS and (awaited) web fonts, so a warning here is a pixel fact.
 * KaTeX formulas are reported with their TeX source (the wrapper's
 * aria-label), so the offending line can be grepped straight back to
 * tex/<slug>/main.tex.
 *
 * Usage:
 *   node scripts/check-overflow.mjs [slug ...] [options]
 *     (no slugs = every worksheet in content/index.json)
 *
 * Options:
 *   --base-url URL   check a running server (e.g. http://localhost:3000)
 *                    instead of serving out/. Handy in the edit loop:
 *                    `./run.sh watch <slug>` + this, no full site build.
 *   --width N        Chrome window width in px (default 1366). The column is
 *                    max-width-capped, so the default catches "wider than the
 *                    column"; rerun with --width 400 for phone layouts.
 *   --strict         exit non-zero when overflows are found (for CI).
 *
 * The fix loop (for a human or an agent):
 *   1. node scripts/build-content.mjs <slug>       # or ./run.sh watch <slug>
 *   2. node scripts/check-overflow.mjs <slug> --base-url http://localhost:3000
 *   3. edit the reported formula in tex/<slug>/main.tex (break the equation,
 *      stack it with align/multline — never change the maths)
 *   4. repeat until the report is clean.
 *
 * No npm dependencies: Chrome is driven over the DevTools protocol with
 * Node's built-in WebSocket (Node >= 22, same as the rest of the repo).
 * Default mode serves out/ itself, transparently stripping the basePath a
 * `run.sh ci` build bakes into its URLs.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchedule } from "./schedule.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "out");
const INDEX = path.join(ROOT, "content", "index.json");

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = { slugs: [], baseUrl: null, width: 1366, strict: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base-url") opt.baseUrl = args[++i];
  else if (args[i] === "--width") opt.width = Number(args[++i]);
  else if (args[i] === "--strict") opt.strict = true;
  else if (args[i].startsWith("--")) fail(`unknown option ${args[i]}`);
  else opt.slugs.push(args[i]);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  fail("needs Node >= 22 (built-in WebSocket) — run via ./run.sh or nvm");
}

// ------------------------------------------------------------------- pages
if (!existsSync(INDEX)) fail("content/index.json missing — run the content build first");
const schedule = loadSchedule();
const clusterSlug = new Map(schedule.clusters.map((c) => [c.id, c.urlSlug]));
let modules = JSON.parse(readFileSync(INDEX, "utf8"));
if (opt.slugs.length) {
  const known = new Set(modules.map((m) => m.slug));
  for (const s of opt.slugs) if (!known.has(s)) fail(`no built worksheet "${s}" in content/index.json`);
  modules = modules.filter((m) => opt.slugs.includes(m.slug));
}
const pages = modules.map((m) => ({
  slug: m.slug,
  path: `/${clusterSlug.get(m.cluster)}/${m.slug}/`,
}));
if (!pages.length) fail("nothing to check");

// ------------------------------------------------- static server over out/
// Only used without --base-url. A `run.sh ci` build prefixes every URL with
// the basePath (/iliad-intensive); detect it from the homepage's asset URLs
// and strip it from requests so both build flavours are servable.
let server = null;
let origin = opt.baseUrl?.replace(/\/$/, "");
let basePath = "";
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain",
};

if (!origin) {
  const home = path.join(OUT_DIR, "index.html");
  if (!existsSync(home)) fail("out/ has no build — run `./run.sh build` (or use --base-url against a dev server)");
  basePath = readFileSync(home, "utf8").match(/["'](\/[^"']*?)?\/_next\//)?.[1] ?? "";
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (basePath && p.startsWith(basePath)) p = p.slice(basePath.length) || "/";
    let file = path.normalize(path.join(OUT_DIR, p));
    if (!file.startsWith(OUT_DIR)) { res.writeHead(403).end(); return; }
    for (const cand of [file, path.join(file, "index.html"), `${file}.html`]) {
      if (existsSync(cand) && !cand.endsWith(path.sep)) {
        try {
          const body = readFileSync(cand);
          res.writeHead(200, { "content-type": MIME[path.extname(cand)] ?? "application/octet-stream" });
          res.end(body);
          return;
        } catch { /* fall through to 404 */ }
      }
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  origin = `http://127.0.0.1:${server.address().port}`;
}

// ------------------------------------------------------------------ chrome
const chromeBin = process.env.CHROME ??
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .find((b) => spawnSync(b, ["--version"], { stdio: "ignore" }).status === 0);
if (!chromeBin) fail("no Chrome/Chromium found (set $CHROME to the binary)");

const profile = mkdtempSync(path.join(tmpdir(), "iliad-overflow-"));
const chrome = spawn(chromeBin, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  `--window-size=${opt.width},1200`, `--user-data-dir=${profile}`,
  "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const devtools = await new Promise((ok, err) => {
  let buf = "";
  const t = setTimeout(() => err(new Error("Chrome did not announce a DevTools port")), 15000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) { clearTimeout(t); ok(m[1]); }
  });
  chrome.on("exit", () => err(new Error("Chrome exited during startup")));
}).catch((e) => { cleanup(); fail(e.message); });

function cleanup() {
  try { chrome.kill(); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  server?.close();
}

// Minimal CDP client over one page target.
const httpBase = `http://${new URL(devtools).host}`;
const target = await (await fetch(`${httpBase}/json/new?url=about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error("CDP socket failed")); });

let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, err } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? err(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method && eventWaiters.has(msg.method)) {
    eventWaiters.get(msg.method)();
    eventWaiters.delete(msg.method);
  }
};
const send = (method, params = {}) => new Promise((ok, err) => {
  const id = nextId++;
  pending.set(id, { ok, err });
  ws.send(JSON.stringify({ id, method, params }));
});
const nextEvent = (method) => new Promise((ok) => eventWaiters.set(method, ok));

await send("Page.enable");

// -------------------------------------------------------- in-page detector
// Runs after web fonts settle. An element "overflows" when its box crosses
// the content column's right edge and no ancestor scrolls horizontally.
// Offenders collapse onto their nearest presentational wrapper (the KaTeX
// span, a table, a <pre>) so each formula is reported once, labelled with
// the nearest preceding anchor id for finding it on the page.
const DETECT = `(async () => {
  await document.fonts.ready;
  const container = document.querySelector(".prose") || document.body;
  const limit = container.getBoundingClientRect().right + 1;
  // Scrollable ancestors handle their overflow; hidden/clip ancestors crop
  // it (a 1px clipped box measures huge inside — e.g. KaTeX's a11y MathML
  // tree — but nothing escapes onto the page).
  const contained = (el) => {
    for (let n = el.parentElement; n && n !== container.parentElement; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  const wraps = new Map();
  for (const el of container.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= limit) continue;
    if (contained(el)) continue;
    // Collapse onto the presentational wrapper; a display formula's outer
    // .katex-display is the one carrying the TeX-source aria-label.
    let wrap = el.closest(".katex-display, .katex, table, pre, figure") || el;
    wrap = wrap.closest(".katex-display") ?? wrap;
    const over = Math.round(r.right - limit + 1);
    if (over > (wraps.get(wrap) ?? 0)) wraps.set(wrap, over);
  }
  const anchors = [...document.querySelectorAll("[id]")];
  const anchorFor = (el) => {
    let best = null;
    for (const a of anchors) {
      const pos = a.compareDocumentPosition(el);
      if (a.contains(el) || (pos & Node.DOCUMENT_POSITION_FOLLOWING)) best = a;
    }
    return best ? best.id : null;
  };
  const out = [];
  for (const [wrap, over] of wraps) {
    const cls = wrap.classList;
    const kind = cls?.contains("katex-display") ? "display math"
      : cls?.contains("katex") ? "inline math"
      : wrap.tagName.toLowerCase();
    const tex = wrap.getAttribute?.("aria-label") ?? "";
    const snippet = (tex || wrap.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    out.push({ kind, over, anchor: anchorFor(wrap), snippet });
  }
  return out.sort((a, b) => b.over - a.over);
})()`;

// -------------------------------------------------------------------- run
let totalOverflows = 0;
let failures = 0;
try {
  for (const page of pages) {
    const loaded = nextEvent("Page.loadEventFired");
    await send("Page.navigate", { url: `${origin}${basePath}${page.path}` });
    await Promise.race([loaded, new Promise((_, e) => setTimeout(() => e(new Error("load timeout")), 20000))])
      .catch((e) => { throw new Error(`${page.slug}: ${e.message}`); });
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: DETECT, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) {
      console.error(`✗ ${page.slug}: detector threw — ${exceptionDetails.exception?.description ?? "unknown"}`);
      failures++;
      continue;
    }
    const found = result.value;
    if (!found.length) {
      console.log(`✓ ${page.slug}`);
      continue;
    }
    totalOverflows += found.length;
    console.log(`⚠ ${page.slug} — ${found.length} overflow${found.length === 1 ? "" : "s"} past the column edge (at ${opt.width}px):`);
    for (const f of found) {
      const at = f.anchor ? `after #${f.anchor}` : "(no anchor)";
      console.log(`    +${String(f.over).padStart(4)}px  ${f.kind}  ${at}\n            ${f.snippet}`);
    }
  }
} finally {
  cleanup();
}

if (failures) process.exit(1);
if (totalOverflows) {
  console.log(`\n⚠ ${totalOverflows} overflow${totalOverflows === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}.`);
  if (opt.strict) process.exit(1);
} else {
  console.log(`\n✓ no overflow on ${pages.length} page${pages.length === 1 ? "" : "s"}.`);
}
