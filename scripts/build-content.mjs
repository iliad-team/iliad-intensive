#!/usr/bin/env node
/**
 * build-content.mjs — turn tex/<slug>/main.tex into everything the site
 * serves. ONLY the tex sources live in git; all outputs are build artifacts:
 *
 *   content/modules/<slug>.mdx           the page body
 *   content/index.json                   homepage/sidebar listing
 *   public/uploads/<slug>/tikz-*.svg     diagrams (content-addressed)
 *   public/downloads/<slug>/…            pdf/tex/mdx, each ± solutions
 *
 * Worksheets build in parallel (they are fully independent — each writes
 * only its own tex/<slug>/, uploads/<slug>/, downloads/<slug>/ and module
 * file); each worksheet's own steps stay sequential. Logs are buffered per
 * worksheet so parallel output never interleaves.
 *
 * Exit codes: 0 ok · 1 something failed (converter warnings, KaTeX errors,
 * or a PDF build failure) — error messages carry file:line from the converter.
 *
 * Usage:
 *   build-content.mjs [flags] [slug ...]   no slugs = build every worksheet
 *
 * Flags:
 *   --check        converter + render gate only (fast; no PDFs/downloads) —
 *                  what the pre-push hook runs
 *   --jobs N       parallel worksheet builds (default 4)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import YAML from "yaml";
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
const JOBS = Math.max(1, parseInt(args.includes("--jobs") ? args[args.indexOf("--jobs") + 1] : "4", 10) || 4);
// positional args are worksheet slugs; none = build everything
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check") continue;
  if (args[i] === "--jobs") { i++; continue; }
  if (args[i].startsWith("-")) { console.error(`unknown flag ${args[i]} — usage: build-content.mjs [--check] [--jobs N] [slug ...]`); process.exit(1); }
  wanted.push(args[i]);
}

// A worksheet is authored either in LaTeX (main.tex — converted to MDX) or
// directly in MDX (main.mdx — served as-is, PDF via pandoc). tex wins if
// a folder somehow has both.
const allWorksheets = readdirSync(TEX, { withFileTypes: true })
  .filter((d) => d.isDirectory()
    && (existsSync(path.join(TEX, d.name, "main.tex")) || existsSync(path.join(TEX, d.name, "main.mdx"))))
  .map((d) => d.name);
for (const w of wanted) {
  if (!allWorksheets.includes(w)) {
    console.error(`no such worksheet: tex/${w}/ needs a main.tex or main.mdx — available: ${allWorksheets.join(", ")}`);
    process.exit(1);
  }
}
const slugs = wanted.length ? wanted : allWorksheets;

if (slugs.length === 0) { console.error("no tex/<slug>/main.tex or main.mdx sources found"); process.exit(1); }
mkdirSync(MODULES, { recursive: true });

const pexec = promisify(execFile);
const exec = (cmd, argv, opts = {}) =>
  pexec(cmd, argv, { maxBuffer: 64 * 1024 * 1024, ...opts });

// "No solutions" variants of every download format are derived by stripping
// solution blocks from the source — so a handout (or an LLM prompt) can be
// guaranteed spoiler-free. Solution environments never nest.
const stripTexSolutions = (tex) =>
  tex.replace(/[ \t]*\\begin\{solution\}[\s\S]*?\\end\{solution\}[ \t]*\n?/g, "");
const stripMdxSolutions = (mdx) =>
  mdx.replace(/[ \t]*<Solution\b[^>]*>[\s\S]*?<\/Solution>[ \t]*\n?/g, "");

/** Build one worksheet. Returns { ok, text } — text is the complete,
 *  atomically printable log block for this slug. */
async function buildSlug(slug) {
  const dir = path.join(TEX, slug);
  const mdxOut = path.join(MODULES, `${slug}.mdx`);
  const t0 = Date.now();
  const notes = [];
  const done = (ok, headline = "") => ({
    ok,
    text: (ok
      ? `▸ ${slug} ✓ (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
      : `✗ ${slug}: ${headline}\n`) + notes.map((n) => n.replace(/\s*$/, "") + "\n").join(""),
  });
  const tex = (...argv) =>
    exec(argv[0], argv.slice(1), { cwd: dir });
  const isTex = existsSync(path.join(dir, "main.tex"));

  if (isTex) {
    // 1. PDF FIRST: the converter resolves \cref/\ref through LaTeX's .aux, so
    //    the compile must happen before conversion — a fresh CI checkout has no
    //    .aux, and converting without one reports every \cref as unresolved.
    const PDFLATEX = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error"];
    const compile = async (base) => {
      await tex(...PDFLATEX, `${base}.tex`);
      try { await tex("bibtex", base); } catch { /* no citations — fine */ }
      await tex(...PDFLATEX, `${base}.tex`);
      await tex(...PDFLATEX, `${base}.tex`);
    };
    if (!CHECK_ONLY) {
      try {
        await compile("main");
      } catch {
        const log = path.join(dir, "main.log");
        const errLine = existsSync(log)
          ? (readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("!")) ?? "pdflatex failed")
          : "pdflatex failed";
        return done(false, `PDF build failed: ${errLine.trim()} (see ${path.relative(ROOT, log)})`);
      }
      // no-solutions PDF: compile a solution-stripped copy of the source.
      // Stripping (rather than \solutionsfalse) works for both dialects and
      // doubles as the spoiler-free .tex download.
      writeFileSync(path.join(dir, "main-nosol.tex"),
        stripTexSolutions(readFileSync(path.join(dir, "main.tex"), "utf8")));
      try {
        await compile("main-nosol");
      } catch {
        return done(false, `no-solutions PDF build failed (see ${path.relative(ROOT, path.join(dir, "main-nosol.log"))})`);
      }
    } else if (!existsSync(path.join(dir, "main.aux"))) {
      // --check skips the full PDF build, but the converter still needs the
      // .aux. One best-effort pass generates it; if it fails, the converter's
      // unresolved-ref warnings say exactly what's missing.
      try { await tex(...PDFLATEX, "main.tex"); } catch { /* see above */ }
    }

    // 2. convert (tex → mdx + content-addressed SVGs). The converter exits 2 on
    //    warnings and prints file:line messages — surface them verbatim.
    try {
      const { stdout } = await exec("node", [CONVERTER, path.join(dir, "main.tex"),
        "-o", mdxOut,
        "--tikz-dir", path.join(UPLOADS, slug),
        "--tikz-src", `/uploads/${slug}/`,
      ]);
      const note = stdout.match(/NOTE \(advisory[^]*?(?=\nWrote )/);
      if (note) notes.push(note[0].trim());
    } catch (e) {
      return done(false, `conversion failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    }
  } else {
    // MDX-authored worksheet: no conversion — main.mdx IS the page. It must
    // open with a YAML frontmatter block (the index builder reads it).
    const raw = readFileSync(path.join(dir, "main.mdx"), "utf8");
    if (!/^---\n[\s\S]*?\n---\n/.test(raw)) {
      return done(false, "main.mdx must start with a `---` YAML frontmatter block (title/cluster/summary/contributors)");
    }
    copyFileSync(path.join(dir, "main.mdx"), mdxOut);

    // PDF via pandoc (markdown source, KaTeX-style math; JSX component tags
    // are raw HTML to pandoc and are dropped from the PDF — their contents
    // survive). The frontmatter title becomes a normal \maketitle title;
    // contributors map to \author. No .tex is generated for MDX sheets.
    if (!CHECK_ONLY) {
      writeFileSync(path.join(dir, "main-nosol.mdx"), stripMdxSolutions(raw));
      let authors = [];
      try {
        const fm = YAML.parse(raw.match(/^---\n([\s\S]*?)\n---\n/)[1]) ?? {};
        if (Array.isArray(fm.contributors)) authors = fm.contributors.map(String);
      } catch { /* frontmatter validity is the render gate's problem */ }
      const pandocArgs = (src, out) => [src, "--from", "markdown+tex_math_dollars",
        "-V", "geometry:margin=1in",
        ...authors.flatMap((a) => ["--metadata", `author=${a}`]),
        "-o", out];
      try {
        await tex("pandoc", ...pandocArgs("main.mdx", "main.pdf"));
        await tex("pandoc", ...pandocArgs("main-nosol.mdx", "main-nosol.pdf"));
      } catch (e) {
        return done(false, `pandoc PDF build failed: ${String(e.stderr ?? e.message).trim().split("\n")[0]}`);
      }
    }
  }

  // 3. author figures: fig/*.pdf → public/uploads/<slug>/*.svg; web-native
  //    assets (svg/png/jpg) copy through as-is. The MDX references them by
  //    basename under /uploads/<slug>/; TikZ snippets are handled separately.
  const figDir = path.join(dir, "fig");
  if (existsSync(figDir)) {
    const up = path.join(UPLOADS, slug);
    mkdirSync(up, { recursive: true });
    for (const f of readdirSync(figDir)) {
      if (/\.pdf$/i.test(f)) {
        try {
          await exec("pdftocairo", ["-svg", path.join(figDir, f), path.join(up, f.replace(/\.pdf$/i, ".svg"))]);
        } catch {
          return done(false, `figure conversion failed: fig/${f}`);
        }
      } else if (/\.(svg|png|jpe?g|gif|webp)$/i.test(f)) {
        copyFileSync(path.join(figDir, f), path.join(up, f));
      }
    }
  }

  // 4. render gate: the MDX must compile and every KaTeX span must render
  try {
    await exec("node", [CHECKER, mdxOut]);
  } catch (e) {
    return done(false, `render gate failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }

  // 5. downloads (PDFs were already built in step 1). Every format ships a
  //    with-solutions file and a -nosol variant; MDX-authored sheets have no
  //    .tex to serve.
  if (!CHECK_ONLY) {
    const dl = path.join(DOWNLOADS, slug);
    mkdirSync(dl, { recursive: true });
    copyFileSync(path.join(dir, "main.pdf"), path.join(dl, `${slug}.pdf`));
    copyFileSync(path.join(dir, "main-nosol.pdf"), path.join(dl, `${slug}-nosol.pdf`));
    copyFileSync(mdxOut, path.join(dl, `${slug}.mdx`));
    writeFileSync(path.join(dl, `${slug}-nosol.mdx`), stripMdxSolutions(readFileSync(mdxOut, "utf8")));
    if (isTex) {
      copyFileSync(path.join(dir, "main.tex"), path.join(dl, `${slug}.tex`));
      copyFileSync(path.join(dir, "main-nosol.tex"), path.join(dl, `${slug}-nosol.tex`));
    }
  }
  return done(true);
}

// ---------------------------- worker pool ----------------------------------
let failed = false;
let cursor = 0;
async function worker() {
  while (cursor < slugs.length) {
    const slug = slugs[cursor++];
    let r;
    try {
      r = await buildSlug(slug);
    } catch (e) {
      r = { ok: false, text: `✗ ${slug}: unexpected error: ${e.message}\n` };
    }
    if (!r.ok) failed = true;
    process.stdout.write(r.text);
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, slugs.length) }, worker));

// ---------------------------- index.json -----------------------------------
if (!failed) {
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
  // stable ordering: cluster then title; the example sheet last (format demo)
  entries.sort((a, b) => (a.slug === "example") - (b.slug === "example") || String(a.cluster).localeCompare(String(b.cluster)) || a.title.localeCompare(b.title));
  entries.forEach((e, i) => (e.position = i + 1));
  writeFileSync(path.join(ROOT, "content", "index.json"), JSON.stringify(entries, null, 2) + "\n");
  console.log(`index.json: ${entries.length} modules`);
}

process.exit(failed ? 1 : 0);
