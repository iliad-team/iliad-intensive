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
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

// A worksheet is authored either in LaTeX (main.tex — converted to MDX) or
// directly in MDX (main.mdx — served as-is, PDF via pandoc). tex wins if
// a folder somehow has both.
const slugs = readdirSync(TEX, { withFileTypes: true })
  .filter((d) => d.isDirectory()
    && (existsSync(path.join(TEX, d.name, "main.tex")) || existsSync(path.join(TEX, d.name, "main.mdx"))))
  .map((d) => d.name)
  .filter((s) => !only || s === only);

if (slugs.length === 0) { console.error("no tex/<slug>/main.tex or main.mdx sources found"); process.exit(1); }
mkdirSync(MODULES, { recursive: true });

let failed = false;
const fail = (slug, why) => { failed = true; console.error(`\n✗ ${slug}: ${why}`); };

// "No solutions" variants of every download format are derived by stripping
// solution blocks from the source — so a handout (or an LLM prompt) can be
// guaranteed spoiler-free. Solution environments never nest.
const stripTexSolutions = (tex) =>
  tex.replace(/[ \t]*\\begin\{solution\}[\s\S]*?\\end\{solution\}[ \t]*\n?/g, "");
const stripMdxSolutions = (mdx) =>
  mdx.replace(/[ \t]*<Solution\b[^>]*>[\s\S]*?<\/Solution>[ \t]*\n?/g, "");

for (const slug of slugs) {
  const dir = path.join(TEX, slug);
  const mdxOut = path.join(MODULES, `${slug}.mdx`);
  process.stdout.write(`▸ ${slug} `);
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  const isTex = existsSync(path.join(dir, "main.tex"));

  if (isTex) {
    // 1. PDF FIRST: the converter resolves \cref/\ref through LaTeX's .aux, so
    //    the compile must happen before conversion — a fresh CI checkout has no
    //    .aux, and converting without one reports every \cref as unresolved.
    if (!CHECK_ONLY) {
      try {
        run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
        try { run("bibtex main"); } catch { /* no citations — fine */ }
        run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
        run("pdflatex -interaction=nonstopmode -halt-on-error main.tex");
      } catch {
        const log = path.join(dir, "main.log");
        const errLine = existsSync(log)
          ? (readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("!")) ?? "pdflatex failed")
          : "pdflatex failed";
        fail(slug, `PDF build failed: ${errLine.trim()} (see ${path.relative(ROOT, log)})`);
        continue;
      }
      // no-solutions PDF: compile a solution-stripped copy of the source.
      // Stripping (rather than \solutionsfalse) works for both dialects and
      // doubles as the spoiler-free .tex download.
      writeFileSync(path.join(dir, "main-nosol.tex"),
        stripTexSolutions(readFileSync(path.join(dir, "main.tex"), "utf8")));
      try {
        run("pdflatex -interaction=nonstopmode -halt-on-error main-nosol.tex");
        try { run("bibtex main-nosol"); } catch { /* no citations — fine */ }
        run("pdflatex -interaction=nonstopmode -halt-on-error main-nosol.tex");
        run("pdflatex -interaction=nonstopmode -halt-on-error main-nosol.tex");
      } catch {
        fail(slug, `no-solutions PDF build failed (see ${path.relative(ROOT, path.join(dir, "main-nosol.log"))})`);
        continue;
      }
    } else if (!existsSync(path.join(dir, "main.aux"))) {
      // --check skips the full PDF build, but the converter still needs the
      // .aux. One best-effort pass generates it; if it fails, the converter's
      // unresolved-ref warnings say exactly what's missing.
      try { run("pdflatex -interaction=nonstopmode -halt-on-error main.tex"); } catch { /* see above */ }
    }

    // 2. convert (tex → mdx + content-addressed SVGs). The converter exits 2 on
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
  } else {
    // MDX-authored worksheet: no conversion — main.mdx IS the page. It must
    // open with a YAML frontmatter block (the index builder reads it).
    const raw = readFileSync(path.join(dir, "main.mdx"), "utf8");
    if (!/^---\n[\s\S]*?\n---\n/.test(raw)) {
      fail(slug, "main.mdx must start with a `---` YAML frontmatter block (title/cluster/summary/contributors)");
      continue;
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
        execFileSync("pandoc", pandocArgs("main.mdx", "main.pdf"), { cwd: dir, stdio: "pipe" });
        execFileSync("pandoc", pandocArgs("main-nosol.mdx", "main-nosol.pdf"), { cwd: dir, stdio: "pipe" });
      } catch (e) {
        fail(slug, `pandoc PDF build failed: ${String(e.stderr ?? e.message).trim().split("\n")[0]}`);
        continue;
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
          execFileSync("pdftocairo", ["-svg", path.join(figDir, f), path.join(up, f.replace(/\.pdf$/i, ".svg"))], { stdio: "pipe" });
        } catch {
          fail(slug, `figure conversion failed: fig/${f}`);
        }
      } else if (/\.(svg|png|jpe?g|gif|webp)$/i.test(f)) {
        copyFileSync(path.join(figDir, f), path.join(up, f));
      }
    }
  }

  // 4. render gate: the MDX must compile and every KaTeX span must render
  try {
    execFileSync("node", [CHECKER, mdxOut], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    fail(slug, `render gate failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    continue;
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
