#!/usr/bin/env node
/**
 * build-content.mjs — turn tex/<slug>/main.tex into everything the site
 * serves. ONLY the tex sources live in git; all outputs are build artifacts:
 *
 *   content/modules/<slug>.mdx           the page body
 *   content/index.json                   homepage/sidebar listing
 *   public/uploads/<slug>/tikz-*.svg     diagrams (content-addressed)
 *   public/downloads/<slug>/<slug>.pdf   compiled worksheet (solutions on)
 *   public/downloads/<slug>/<slug>.tex   the source
 *   public/downloads/<slug>/<slug>.mdx   the markdown
 *
 * Exit codes: 0 ok · 1 something failed (converter warnings, KaTeX errors,
 * or a PDF build failure) — error messages carry file:line from the converter.
 *
 * Flags:
 *   --check        converter + render gate only (fast; no PDFs/downloads) —
 *                  what the pre-push hook runs
 *   --only <slug>  restrict to one worksheet
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
const MODULES = path.join(ROOT, "content", "modules");
const UPLOADS = path.join(ROOT, "public", "uploads");
const DOWNLOADS = path.join(ROOT, "public", "downloads");
const CONVERTER = path.join(ROOT, "scripts", "tex2mdx", "tex2mdx.mjs");
const CHECKER = path.join(ROOT, "scripts", "tex2mdx", "tex2mdx-check.mjs");
// Generated MDX is host-agnostic: figure URLs are plain /uploads/… paths.
// The site's Figure component applies NEXT_PUBLIC_BASE_PATH at render time —
// prefixing here too would double it (…/iliad-intensive/iliad-intensive/…).

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const slugs = readdirSync(TEX, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(TEX, d.name, "main.tex")))
  .map((d) => d.name)
  .filter((s) => !only || s === only);

if (slugs.length === 0) { console.error("no tex/<slug>/main.tex sources found"); process.exit(1); }
mkdirSync(MODULES, { recursive: true });

let failed = false;
const fail = (slug, why) => { failed = true; console.error(`\n✗ ${slug}: ${why}`); };

for (const slug of slugs) {
  const dir = path.join(TEX, slug);
  const mdxOut = path.join(MODULES, `${slug}.mdx`);
  process.stdout.write(`▸ ${slug} `);

  // 1. convert (tex → mdx + content-addressed SVGs). The converter exits 2 on
  //    warnings and prints file:line messages — surface them verbatim.
  try {
    const out = execFileSync("node", [CONVERTER, path.join(dir, "main.tex"),
      "-o", mdxOut,
      "--tikz-dir", path.join(UPLOADS, slug),
      "--tikz-src", `/uploads/${slug}/`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const note = out.match(/NOTE \(advisory[^]*?(?=\nWrote )/);
    if (note) console.log("\n" + note[0].trim());
  } catch (e) {
    fail(slug, `conversion failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    continue;
  }

  // 2. render gate: the MDX must compile and every KaTeX span must render
  try {
    execFileSync("node", [CHECKER, mdxOut], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    fail(slug, `render gate failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    continue;
  }

  if (!CHECK_ONLY) {
    // 3. PDF (solutions shown) + downloads
    const dl = path.join(DOWNLOADS, slug);
    mkdirSync(dl, { recursive: true });
    try {
      const run = (cmd) => execSync(cmd, { cwd: dir, stdio: "pipe" });
      run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
      try { run("bibtex main"); } catch { /* no citations — fine */ }
      run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
      run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
      copyFileSync(path.join(dir, "main.pdf"), path.join(dl, `${slug}.pdf`));
    } catch (e) {
      const log = path.join(dir, "main.log");
      const errLine = existsSync(log)
        ? (readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("!")) ?? "pdflatex failed")
        : "pdflatex failed";
      fail(slug, `PDF build failed: ${errLine.trim()} (see ${path.relative(ROOT, log)})`);
      continue;
    }
    copyFileSync(path.join(dir, "main.tex"), path.join(dl, `${slug}.tex`));
    copyFileSync(mdxOut, path.join(dl, `${slug}.mdx`));
  }
  console.log("✓");
}

// 4. index.json from the generated frontmatter + headings
if (!failed) {
  const YAML = (await import("yaml")).default;
  const ghSlug = (t) => t.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const entries = [];
  // index reflects every built module, not just the ones this run touched
  const allSlugs = readdirSync(MODULES).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
  for (const slug of allSlugs) {
    const raw = readFileSync(path.join(MODULES, `${slug}.mdx`), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const fm = YAML.parse(m[1]);
    if (fm.unlisted) continue; // built + reachable by URL, but never listed
    const headings = [];
    for (const hm of m[2].matchAll(/^(#{2,3}) (.+)$/gm)) {
      const text = hm[2].replace(/\*\*|\*/g, "").trim();
      headings.push({ level: hm[1].length, text, slug: ghSlug(text) });
    }
    entries.push({ slug, title: fm.title ?? slug, cluster: fm.cluster ?? "0", frontmatter: fm, position: entries.length + 1, headings });
  }
  // stable ordering: cluster then title; template last (it's the format demo)
  entries.sort((a, b) => (a.slug === "template") - (b.slug === "template") || String(a.cluster).localeCompare(String(b.cluster)) || a.title.localeCompare(b.title));
  entries.forEach((e, i) => (e.position = i + 1));
  writeFileSync(path.join(ROOT, "content", "index.json"), JSON.stringify(entries, null, 2) + "\n");
  console.log(`index.json: ${entries.length} modules`);
}

process.exit(failed ? 1 : 0);
