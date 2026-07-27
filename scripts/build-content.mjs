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
 * Where each page sits in the course — its cluster, its teaching day, and the
 * order it is listed in — comes from schedule.yaml (see scripts/schedule.mjs),
 * never from the worksheet itself; the build stamps it into the generated MDX.
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
import { injectAutoLabelsTree } from "./tex2mdx/autolabel.mjs";
import { transformInputTree } from "./tex2mdx/texinput.mjs";
import { buildStatus } from "./build-status.mjs";
import { loadSchedule, ScheduleError } from "./schedule.mjs";

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
// --no-gate skips the KaTeX render gate. The preview loop passes this: `next
// build` renders the same math right after (via rehype-katex), so the gate is
// redundant there — a bad equation shows as a visible error in the browser
// instead of failing the build. The full build / CI never pass it.
const NO_GATE = args.includes("--no-gate");
const JOBS = Math.max(1, parseInt(args.includes("--jobs") ? args[args.indexOf("--jobs") + 1] : "4", 10) || 4);
// positional args are worksheet slugs; none = build everything
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check" || args[i] === "--no-gate") continue;
  if (args[i] === "--jobs") { i++; continue; }
  if (args[i].startsWith("-")) { console.error(`unknown flag ${args[i]} — usage: build-content.mjs [--check] [--no-gate] [--jobs N] [slug ...]`); process.exit(1); }
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

// The curriculum: which day each worksheet is the material for, and the order
// clusters/days/worksheets are taught in. Loaded before anything is built —
// a typo in schedule.yaml should cost a second, not a full PDF ladder.
let SCHEDULE;
try {
  SCHEDULE = loadSchedule();
} catch (e) {
  console.error(e instanceof ScheduleError ? `✗ ${e.message}` : e);
  process.exit(1);
}

const pexec = promisify(execFile);
const exec = (cmd, argv, opts = {}) =>
  pexec(cmd, argv, { maxBuffer: 64 * 1024 * 1024, ...opts });

// "No solutions" variants of every download format are derived by stripping
// solution blocks from the source — so a handout (or an LLM prompt) can be
// guaranteed spoiler-free. Solution environments never nest.
// Strip both the `solution` answer blocks and the `solutionsonly` (answer-key /
// instructor-aside) blocks — everything meant to vanish from the spoiler-free
// -nosol downloads.
const stripTexSolutions = (tex) =>
  tex
    .replace(/[ \t]*\\begin\{solution\}[\s\S]*?\\end\{solution\}[ \t]*\n?/g, "")
    .replace(/[ \t]*\\begin\{solutionsonly\}[\s\S]*?\\end\{solutionsonly\}[ \t]*\n?/g, "");
// MDX: strip only bare <Solution> answer blocks — titled ones
// (<Solution title="Hint">, ...title="Proof">) stay, matching what
// stripTexSolutions keeps in the .tex. Depth-aware because an answer may
// itself contain a titled proof block. Also strip solutionsonly spans, which
// the converter brackets with invisible {/* iliad:solutionsonly:* */} markers.
const stripMdxSolutions = (mdx) => {
  mdx = mdx.replace(
    /\n?\{\/\* iliad:solutionsonly:start \*\/\}[\s\S]*?\{\/\* iliad:solutionsonly:end \*\/\}[ \t]*\n?/g,
    "");
  let out = "", i = 0;
  for (;;) {
    const s = mdx.indexOf("<Solution>", i);
    if (s === -1) return out + mdx.slice(i);
    let depth = 0, j = s;
    for (;;) {
      const o = mdx.indexOf("<Solution", j), c = mdx.indexOf("</Solution>", j);
      if (c === -1) { j = -1; break; }
      if (o !== -1 && o < c) { depth++; j = o + "<Solution".length; }
      else { depth--; j = c + "</Solution>".length; if (depth === 0) break; }
    }
    if (j === -1) return out + mdx.slice(i);   // unbalanced — leave untouched
    out += mdx.slice(i, s).replace(/[ \t]+$/, "");
    i = j + (mdx[j] === "\n" ? 1 : 0);
  }
};

// Where a page sits in the course comes from schedule.yaml, never from the
// worksheet: the build stamps `cluster:` and `day:` into the generated
// frontmatter here. Everything downstream (the site's module pages,
// build-status.mjs) reads the generated MDX, so it sees the schedule's answer
// and cannot disagree with it. An unscheduled sheet — the unlisted format demo
// — keeps whatever its own frontmatter says.
const stampSchedule = (mdxOut, slug) => {
  const sc = SCHEDULE.bySlug.get(slug);
  if (!sc) return;
  const raw = readFileSync(mdxOut, "utf8");
  if (!raw.startsWith("---\n")) return;   // no frontmatter: the render gate's problem
  writeFileSync(mdxOut, `---\ncluster: ${sc.cluster}\nday: ${sc.day}\n${raw.slice(4)}`);
};

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
  // A worksheet MAY ship a slide deck as slides.tex (any dialect — usually
  // beamer). It is compiled to slides.pdf and hosted alongside the downloads;
  // it is never converted to MDX (slides aren't a web page, only a download).
  const hasSlidesTex = existsSync(path.join(dir, "slides.tex"));

  // Guardrail: main.tex loads iliad.sty local-first (for standalone use of a
  // copied folder), so a stray per-folder copy in the repo tree would shadow
  // the shared tex/iliad.sty and build differently here than on CI. Gitignore
  // keeps them out of commits; this keeps them from skewing local builds.
  const localSty = path.join(dir, "iliad.sty");
  if (existsSync(localSty)
      && readFileSync(localSty, "utf8") !== readFileSync(path.join(TEX, "iliad.sty"), "utf8")) {
    return done(false, `tex/${slug}/iliad.sty differs from the shared tex/iliad.sty — ` +
      "delete the local copy (the build uses ../iliad.sty in the repo)");
  }

  if (isTex) {
    // 1. PDF FIRST: the converter resolves \cref/\ref through LaTeX's .aux, so
    //    the compile must happen before conversion — a fresh CI checkout has no
    //    .aux, and converting without one reports every \cref as unresolved.
    const PDFLATEX = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error"];
    const compile = async (base, src = `${base}.tex`) => {
      await tex(...PDFLATEX, `-jobname=${base}`, src);
      try { await tex("bibtex", base); } catch { /* no citations — fine */ }
      await tex(...PDFLATEX, `-jobname=${base}`, src);
      await tex(...PDFLATEX, `-jobname=${base}`, src);
    };
    // The web shows every displayed number (headings, theorems, exercises)
    // straight out of the .aux, keyed by injected auto-labels (autolabel.mjs).
    // So the compiled copy is the source + those labels — written to
    // main.autolabel.tex and compiled under -jobname=main, keeping
    // main.pdf/main.aux their names. Injection is same-line, so main.log
    // line numbers still match main.tex. \label emits nothing visible: the
    // PDF is unchanged. Downloads still ship the pristine source.
    //
    // The walk follows \input, so a multi-file worksheet gets a labelled copy
    // of each section file too (sections/foo.autolabel.tex), with main's
    // \input repointed at them. Keeping the files split rather than inlining
    // them is what preserves main.log's file:line diagnostics.
    const writeAutolabel = () => {
      for (const f of injectAutoLabelsTree(path.join(dir, "main.tex")).files)
        writeFileSync(f.path === path.join(dir, "main.tex")
          ? path.join(dir, "main.autolabel.tex") : f.path, f.text);
    };
    if (!CHECK_ONLY) {
      writeAutolabel();
      try {
        await compile("main", "main.autolabel.tex");
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
      //
      // Strip across \input, or a multi-file worksheet keeps every solution
      // that lives in a section file — main.tex has none of its own, so the
      // "spoiler-free" handout was identical to the full one. Unlike the
      // auto-label copy this one is INLINED into a single file: it is a
      // download, and a reader who gets main-nosol.tex alone must be able to
      // compile it without the section files it would otherwise \input.
      writeFileSync(path.join(dir, "main-nosol.tex"),
        transformInputTree(path.join(dir, "main.tex"),
          { visit: (_f, raw) => stripTexSolutions(raw) }).flat);
      try {
        await compile("main-nosol");
      } catch {
        return done(false, `no-solutions PDF build failed (see ${path.relative(ROOT, path.join(dir, "main-nosol.log"))})`);
      }
    } else if (!existsSync(path.join(dir, "main.aux"))) {
      // --check skips the full PDF build, but the converter still needs the
      // .aux (with the auto-labels). One best-effort pass generates it; if it
      // fails, the converter's unresolved-ref warnings say exactly what's
      // missing. (A pre-existing stale .aux is fine either way: the converter
      // detects missing auto-labels and regenerates one itself.)
      writeAutolabel();
      try { await tex(...PDFLATEX, "-jobname=main", "main.autolabel.tex"); } catch { /* see above */ }
    }

    // 2. convert (tex → mdx + content-addressed SVGs). The converter exits 2 on
    //    warnings and prints file:line messages — surface them verbatim.
    const convLog = path.join(dir, "convert.log");
    try {
      const { stdout, stderr } = await exec("node", [CONVERTER, path.join(dir, "main.tex"),
        "-o", mdxOut,
        "--tikz-dir", path.join(UPLOADS, slug),
        "--tikz-src", `/uploads/${slug}/`,
      ]);
      writeFileSync(convLog, `${stdout}${stderr ?? ""}`);   // warnings kept for inspection
      const note = stdout.match(/NOTE \(advisory[^]*?(?=\nWrote )/);
      if (note) notes.push(note[0].trim());
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      writeFileSync(convLog, out);
      return done(false, `conversion failed (see ${path.relative(ROOT, convLog)}):\n${out}`);
    }
  } else {
    // MDX-authored worksheet: no conversion — main.mdx IS the page. It must
    // open with a YAML frontmatter block (the index builder reads it).
    const raw = readFileSync(path.join(dir, "main.mdx"), "utf8");
    if (!/^---\n[\s\S]*?\n---\n/.test(raw)) {
      return done(false, "main.mdx must start with a `---` YAML frontmatter block (title/summary/contributors)");
    }
    // Place in the course belongs to schedule.yaml, not to the sheet. (The
    // converter's unknown-key warning covers the LaTeX dialect; this is the
    // same rule for an MDX-authored sheet, which has no such check.)
    const owned = ["cluster", "day"].filter((k) => new RegExp(`^${k}:`, "m").test(raw.match(/^---\n([\s\S]*?)\n---\n/)[1]));
    if (owned.length) {
      return done(false, `main.mdx frontmatter sets \`${owned.join("`, `")}\` — ` +
        "that lives in schedule.yaml (list the slug under its day) and is stamped in at build time");
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
      // Preflight the one non-obvious dependency of pandoc's default PDF
      // template: lmodern.sty. The `lmodern` apt package is only a Recommends,
      // so `apt-get install --no-install-recommends` (both CI and setup.sh)
      // skips it — yet a full local TeX Live ships it, so a broken build sails
      // through locally and fails only on CI with an opaque "Error producing
      // PDF". Fail here instead, everywhere, with the actual fix. (This exact
      // gap broke the first MDX-authored sheet's CI run.)
      try {
        await exec("kpsewhich", ["lmodern.sty"]);
      } catch {
        return done(false,
          "pandoc PDF needs lmodern.sty, which is not installed. Install the " +
          "`lmodern` apt package (a Recommends, so --no-install-recommends skips " +
          "it) and keep setup.sh and .github/workflows/site.yml in sync.");
      }
      try {
        await tex("pandoc", ...pandocArgs("main.mdx", "main.pdf"));
        await tex("pandoc", ...pandocArgs("main-nosol.mdx", "main-nosol.pdf"));
      } catch (e) {
        // Surface the REAL error: pandoc's first stderr line is a useless
        // "Error producing PDF."; the cause (missing .sty, bad glyph, …) is in
        // the lines that follow. Keep the tail so CI logs actually say why.
        const detail = String(e.stderr || e.stdout || e.message).trim();
        return done(false, `pandoc PDF build failed:\n${detail.split("\n").slice(-40).join("\n")}`);
      }
    }
  }

  // 2.4 stamp the schedule's answer for cluster + day into the generated page,
  //     before anything reads or ships it (render gate, downloads, index).
  stampSchedule(mdxOut, slug);

  // 2.5 slides: compile slides.tex → slides.pdf (same 3× pdflatex + bibtex
  //     ladder as the worksheet). No -nosol variant, no MDX conversion.
  //     --check skips it (it produces no page, only a download).
  if (!CHECK_ONLY && hasSlidesTex) {
    const SLIDES_PDFLATEX = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error"];
    try {
      await tex(...SLIDES_PDFLATEX, "slides.tex");
      try { await tex("bibtex", "slides"); } catch { /* no citations — fine */ }
      await tex(...SLIDES_PDFLATEX, "slides.tex");
      await tex(...SLIDES_PDFLATEX, "slides.tex");
    } catch {
      const log = path.join(dir, "slides.log");
      const errLine = existsSync(log)
        ? (readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("!")) ?? "pdflatex failed")
        : "pdflatex failed";
      return done(false, `slides build failed: ${errLine.trim()} (see ${path.relative(ROOT, log)})`);
    }
  }

  // 2.6 slides advisory (full build only — not the --check watch/pre-push
  //     loop): every worksheet ought to have a compilable deck. Never fatal.
  //     slides.tex → hosted PDF (ideal, no note); a `slides:` frontmatter URL
  //     → external PDF only; nothing → no deck at all.
  if (!CHECK_ONLY && !hasSlidesTex) {
    let slidesUrl = null;
    try {
      const fm = readFileSync(mdxOut, "utf8").match(/^---\n([\s\S]*?)\n---/);
      if (fm) slidesUrl = (YAML.parse(fm[1]) ?? {}).slides ?? null;
    } catch { /* frontmatter validity is the render gate's problem */ }
    notes.push(slidesUrl
      ? "⚠ advisory: slides only in PDF form (external `slides:` link, no LaTeX source to build)"
      : "⚠ advisory: no slides for this worksheet (add slides.tex to build a deck, or a `slides:` frontmatter URL to link one)");
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

  // 4. render gate: the MDX must compile and every KaTeX span must render.
  //    Skipped under --no-gate (preview: `next build` renders the math anyway).
  if (!NO_GATE) {
    const gateLog = path.join(dir, "rendergate.log");
    try {
      const { stdout, stderr } = await exec("node", [CHECKER, mdxOut]);
      writeFileSync(gateLog, `${stdout}${stderr ?? ""}`);
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      writeFileSync(gateLog, out);
      return done(false, `render gate failed (see ${path.relative(ROOT, gateLog)}):\n${out}`);
    }
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
      // Ship the document inlined, not just main.tex: a multi-file worksheet's
      // main.tex \inputs section files that are not part of the download, so
      // on its own it does not compile. (main-nosol.tex is already inlined.)
      writeFileSync(path.join(dl, `${slug}.tex`),
        transformInputTree(path.join(dir, "main.tex"), { visit: (_f, raw) => raw }).flat);
      copyFileSync(path.join(dir, "main-nosol.tex"), path.join(dl, `${slug}-nosol.tex`));
    }
    // slides deck (no solutions variant): ship the PDF to view/download and
    // the .tex to download. Named <slug>-slides.* so listDownloads finds them.
    if (hasSlidesTex) {
      copyFileSync(path.join(dir, "slides.pdf"), path.join(dl, `${slug}-slides.pdf`));
      copyFileSync(path.join(dir, "slides.tex"), path.join(dl, `${slug}-slides.tex`));
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
    // Unscheduled and not unlisted is an error — but build-status.mjs owns that
    // message (it knows every built module and every day), so here it is only
    // skipped: with no place in the schedule there is no position to give it.
    const sc = SCHEDULE.bySlug.get(slug);
    if (!sc) continue;
    const headings = [];
    for (const hm of m[2].matchAll(/^(#{2,3}) (.+)$/gm)) {
      const text = hm[2].replace(/\*\*|\*/g, "").trim();
      headings.push({ level: hm[1].length, text, slug: ghSlug(text) });
    }
    entries.push({ slug, title: fm.title ?? slug, cluster: sc.cluster, day: sc.day, frontmatter: fm, position: sc.position, headings });
  }
  // Ordering is schedule.yaml's, start to finish: cluster order, then day
  // order, then a day's own worksheet order. Titles never enter into it — an
  // alphabetical fallback would put AIXI before Solomonoff Induction, which is
  // backwards, and nothing about the two files could say so.
  entries.sort((a, b) => a.position - b.position);
  writeFileSync(path.join(ROOT, "content", "index.json"), JSON.stringify(entries, null, 2) + "\n");
  console.log(`index.json: ${entries.length} modules`);
}

// ---------------------------- status.json ----------------------------------
// The /admin/status table: schedule.yaml (the hand-kept curriculum) joined
// with what this build actually produced. Runs even after a worksheet failure
// so the page keeps rendering the days that DO work — but a worksheet no day
// lists is a data error and fails the build.
try {
  const s = buildStatus({ check: CHECK_ONLY, schedule: SCHEDULE });
  const n = s.counts.decksBuilt;
  console.log(`status.json: ${s.counts.live}/${s.counts.days} days live, ` +
    `${n} deck${n === 1 ? "" : "s"} built → /admin/status`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
