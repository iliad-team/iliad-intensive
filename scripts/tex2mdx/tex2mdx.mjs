#!/usr/bin/env node
/**
 * tex2mdx.mjs — faithful converter from an ILIAD worksheet .tex to MDX.
 *
 * Pipeline stages (each in its own module):
 *   util.mjs   tokenizer primitives          state.mjs  warnings + file:line
 *   shims.mjs  ALL dialect tables/transforms tikz.mjs   diagrams -> SVG
 *   this file  parse + emit (the stage the unified-latex port will replace)
 *
 * Design: copy prose and math byte-for-byte; translate only known markup;
 * fail loud (file:line WARN + visible TODO marker) on anything unrecognised.
 * Cross-references come from LaTeX's own .aux. Exit code 2 on warnings.
 *
 * Usage: tex2mdx.mjs input.tex [-o out.mdx] [--aux f.aux] [--tikz-dir d]
 *        [--tikz-src /url/prefix/] [--no-render-tikz]
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGroup, stripComments, tidy } from "./util.mjs";
import { SRC_FILES, warnings, warn, advisories, advise, fmtIssue } from "./state.mjs";
import { MACRO_OVERRIDE, MACRO_SKIP, applyShims, trimMacroBody,
         CREF_NAME_DEFAULTS, CONTRACT_NAMES, KNOWN_FRONT_KEYS } from "./shims.mjs";
import { initTikz, renderTikzSnippets, tikzCount } from "./tikz.mjs";
import { injectAutoLabels } from "./autolabel.mjs";
import { emitDocument, texToPlain } from "./emit-ast.mjs";
import { entries as bibtexEntries } from "bibtex-parse";

// Optional yaml lib (from the public repo's node_modules) for strict
// frontmatter validation; structural checks are the fallback.
let YAMLLIB = null;
{
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    here, path.resolve(here, ".."), path.resolve(here, "../.."), process.cwd(),
  ];
  const repo = candidates.find((c) => existsSync(path.join(c, "node_modules/yaml")));
  if (repo) {
    try {
      const req = createRequire(path.join(repo, "package.json"));
      YAMLLIB = (await import(pathToFileURL(req.resolve("yaml")).href)).default;
    } catch { /* structural fallback below */ }
  }
}

// ----------------------------- args ---------------------------------------
let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      aux: { type: "string" },
      "tikz-dir": { type: "string" },
      "tikz-src": { type: "string" },
      "no-render-tikz": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  console.error(String(e.message)); process.exit(1);
}
if (parsed.values.help || parsed.positionals.length !== 1) {
  console.log("usage: tex2mdx.mjs input.tex [-o out.mdx] [--aux f.aux] [--tikz-dir d] [--tikz-src /url/] [--no-render-tikz]");
  process.exit(parsed.values.help ? 0 : 1);
}
const input = parsed.positionals[0];
const output = parsed.values.output
  ?? path.join(path.dirname(input), path.basename(input, path.extname(input)) + ".mdx");
const auxPath = parsed.values.aux ?? null;
let tikzDir = parsed.values["tikz-dir"] ?? null;
let tikzSrc = parsed.values["tikz-src"] ?? null;
const renderTikz = !parsed.values["no-render-tikz"];
// TikZ assets: content-addressed SVGs (tikz-<sha>.svg). Defaults keep local
// preview working; CI points --tikz-dir at public/uploads/<slug>/.
const moduleSlug = path.basename(output, ".mdx");
if (!tikzDir) tikzDir = path.join(path.dirname(output), moduleSlug + "-tikz");
if (!tikzSrc) tikzSrc = `/uploads/${moduleSlug}/`;
if (!tikzSrc.endsWith("/")) tikzSrc += "/";

// ----------------------------- .aux → refs --------------------------------
// Build label -> { name, num }.  name from cleveref type: section/subsection
// => "Problem", the shared theorem counter => "Theorem".
// One best-effort pdflatex pass over the auto-labeled source (numbers are
// written to the .aux as they occur, so a single pass is enough for refs).
// Compiles from a temp dir with cwd at the sheet so relative inputs
// (../iliad.sty, bib, figures) resolve.
function generateAux(texFile) {
  const dir = mkdtempSync(path.join(tmpdir(), "tex2mdx-"));
  const base = path.basename(texFile, ".tex");
  writeFileSync(path.join(dir, base + ".autolabel.tex"), rawTex);
  try {
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-output-directory=" + dir,
      "-jobname=" + base, path.join(dir, base + ".autolabel.tex")],
      { cwd: path.dirname(path.resolve(texFile)), stdio: "ignore" });
  } catch { /* nonstop: warnings are fine as long as the aux got written */ }
  const gen = path.join(dir, base + ".aux");
  return existsSync(gen) ? gen : null;
}
function ensureAux(texFile) {
  if (auxPath && existsSync(auxPath)) return auxPath;
  const sib = path.join(path.dirname(texFile), path.basename(texFile, ".tex") + ".aux");
  if (existsSync(sib)) return sib;
  const gen = generateAux(texFile);
  if (!gen) { console.error("Could not generate .aux (pdflatex failed). Pass --aux."); process.exit(1); }
  return gen;
}
// Printed name per cref type. Defaults are the capitalised type; a sheet's own
// \crefname{type}{Singular}{Plural} declarations (preamble) override — this is
// how the AIXI dialect's section->"Problem" mapping is picked up.
const CREF_NAME = { ...CREF_NAME_DEFAULTS };
function applyCrefnames(pre) {
  const re = /\\[cC]refname\{([a-zA-Z]+)\}\{([^}]*)\}\{[^}]*\}/g;
  let m;
  while ((m = re.exec(pre))) {
    const name = m[2].trim();
    if (name) CREF_NAME[m[1]] = name[0].toUpperCase() + name.slice(1);
  }
  // thmtools: \declaretheorem[..., name=X or refname={X,Xs}, ...]{env}
  const dt = /\\declaretheorem\s*\[([^\]]*)\]\s*\{([a-zA-Z]+)\}/g;
  while ((m = dt.exec(pre))) {
    const rn = m[1].match(/refname=\{?([^,}\]]+)/);
    const nm = rn || m[1].match(/name=([^,\]]+)/);
    if (nm) { const t = nm[1].trim(); if (t) CREF_NAME[m[2]] = t[0].toUpperCase() + t.slice(1); }
  }
}
function parseAux(auxFile) {
  const aux = readFileSync(auxFile, "utf8");
  const refs = {};
  // \newlabel{KEY@cref}{{[type][..][..]NUMBER}{...}...}  — NUMBER may itself be
  // braced (e.g. {3.1(a)} for enumerate subparts aliased to a counter).
  const re = /\\newlabel\{([^}]+)@cref\}\{\{\[([a-zA-Z]+)\](?:\[[^\]]*\])*\s*([^}]*)\}/g;
  let m;
  while ((m = re.exec(aux))) {
    const key = m[1], type = m[2];
    let num = m[3].trim();
    if (num.startsWith("{")) num = num.slice(1);   // braced number: {3.1(a)}
    refs[key] = { name: CREF_NAME[type] || (type[0].toUpperCase() + type.slice(1)), num };
  }
  // plain (non-cleveref) labels: \newlabel{key}{{NUM}{page}...} — no type
  // info, so refs print just the number (which is what \ref prints anyway)
  const re2 = /\\newlabel\{([^}]+)\}\{\{([^{}]*)\}/g;
  while ((m = re2.exec(aux))) {
    if (m[1].endsWith("@cref") || m[1] in refs) continue;
    refs[m[1]] = { name: "", num: m[2].replace(/\\[a-zA-Z]+\s*/g, "").trim() };
  }
  return refs;
}

// --------------------------- read + split ---------------------------------
// Auto-labels first (see autolabel.mjs): the identical injection ran over the
// source the .aux was compiled from, so every numbered construct's displayed
// number is read out of the .aux — never simulated — by matching label names.
const { text: rawTex, labels: autoLabels } = injectAutoLabels(readFileSync(input, "utf8"));
// Inline \input{file} recursively (multi-file worksheets are fine — pdflatex
// resolves them, so the converter must too; silently dropping them would lose
// content). \input{preamble}-style extensionless names get .tex appended.
function inlineInputs(src, dir, depth = 0) {
  if (depth > 8) { warn("\\input nesting too deep — stopping"); return src; }
  return src.replace(/\\input\{([^}]+)\}/g, (m0, f) => {
    const file = path.join(dir, /\.\w+$/.test(f) ? f : f + ".tex");
    if (!existsSync(file)) { warn(`\\input{${f}} not found — file missing, content dropped`, m0); return ""; }
    const sub = stripComments(readFileSync(file, "utf8"));
    SRC_FILES.push({ name: path.relative(path.dirname(input), file) || f, text: sub });
    return inlineInputs(sub, path.dirname(file), depth + 1);
  });
}
const mainStripped = stripComments(rawTex);
SRC_FILES.push({ name: path.basename(input), text: mainStripped });
const tex = inlineInputs(mainStripped, path.dirname(input));

const docStart = tex.indexOf("\\begin{document}");
const docEnd = tex.indexOf("\\end{document}");
const preamble = tex.slice(0, docStart);
let body = tex.slice(docStart + "\\begin{document}".length, docEnd);

applyCrefnames(preamble);                    // before parseAux: names depend on it
let refs = parseAux(ensureAux(input));
// self-heal a stale .aux: one compiled before auto-labels existed (or from an
// editor's own run on the pristine source) has none of the injected names —
// regenerate from the injected source rather than falling back to simulation.
if (autoLabels.length && !(autoLabels[autoLabels.length - 1] in refs)) {
  const regen = generateAux(input);
  if (regen) refs = parseAux(regen);
  if (!(autoLabels[autoLabels.length - 1] in refs)) {
    warn("the .aux has no auto-label entries (stale, and regenerating failed) — displayed numbering falls back to simulated counters");
  }
}
initTikz({ tikzDir, tikzSrc, getRefs: () => refs }, preamble);
// dialect detection: iliad.sty sheets use the exercise env; legacy sheets use
const usesExerciseEnv = /\\begin\{exercise\}/.test(body);
// legacy sheets may declare remark as a numbered theorem-family env
const remarkNumbered = /\\newtheorem\{remark\}/.test(preamble);

// Author-declared theorem-like environments (\newtheorem / thmtools
// \declaretheorem). Any declared env the converter doesn't handle natively is
// auto-mapped to a numbered callout — authors' custom envs are free-zone.
const declaredThms = {};
for (const m of preamble.matchAll(/\\declaretheorem\s*(\[[^\]]*\])?\s*\{([a-zA-Z]+)\}/g)) {
  const nm = (m[1] ?? "").match(/name=([^,\]]+)/);
  declaredThms[m[2]] = nm ? nm[1].trim() : m[2][0].toUpperCase() + m[2].slice(1);
}
for (const m of preamble.matchAll(/\\newtheorem\*?\{([a-zA-Z]+)\}(?:\[[a-zA-Z]*\])?\{([^}]*)\}/g)) {
  declaredThms[m[1]] = m[2];
}

// margin-comment commands from the commenting package (\declareauthor{leon}..
// => \leon{...} is a review comment): dropped entirely, with their argument.
const commentCmds = new Set();
for (const m of preamble.matchAll(/\\declareauthor\{([a-zA-Z]+)\}/g)) commentCmds.add(m[1]);

// ------------------- %--- iliad --- frontmatter block ---------------------
// A YAML block carried in comments at the top of the .tex (invisible to
// LaTeX). Lifted verbatim into the MDX frontmatter.
function parseIliadBlock(raw) {
  const open = raw.match(/^%---\s*iliad\s*-*\s*$/m);
  if (!open) return null;                            // absent → advisory later
  const close = raw.match(/^%---\s*end\s*-*\s*$/m);
  if (!close || close.index < open.index) {
    warn("frontmatter block: '%--- iliad ---' opened but no '%--- end ---' terminator found");
    return null;
  }
  const out = [];
  for (const l of raw.slice(open.index + open[0].length, close.index).split("\n")) {
    if (/^\s*$/.test(l)) continue;
    if (!/^%/.test(l)) { warn(`frontmatter block: non-comment line inside the block: "${l.trim().slice(0, 50)}"`, l.trim().slice(0, 50)); continue; }
    out.push(l.replace(/^%[ \t]?/, ""));
  }
  return out.length ? out : null;
}
const iliadBlock = parseIliadBlock(rawTex);
// A present-but-misspecified block is a hard failure (WARN => exit 2);
// a missing block only draws an advisory (TODO placeholders are emitted).
// The parsed frontmatter block, kept for the summary checks further down (a
// `summary: >-` block scalar is only readable through the YAML parser).
let frontBlock = null;
if (iliadBlock) {
  const text = iliadBlock.join("\n");
  if (YAMLLIB) {
    try {
      const parsed = YAMLLIB.parse(text);
      frontBlock = parsed;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warn("frontmatter block is not a YAML mapping (expected `key: value` lines)");
      } else {
        for (const k of Object.keys(parsed)) {
          if (!KNOWN_FRONT_KEYS.has(k)) warn(`unknown frontmatter key "${k}" — known keys: ${[...KNOWN_FRONT_KEYS].join(", ")}`, `${k}:`);
        }
      }
    } catch (e) {
      warn(`frontmatter block is not valid YAML: ${String(e.message).split("\n")[0]}`);
    }
  } else {
    // structural fallback: every line must be a key, a list item, or the
    // indented continuation of a block scalar (`summary: >-` …)
    let inBlockScalar = false;
    for (const l of iliadBlock) {
      if (inBlockScalar && (/^\s/.test(l) || l === "")) continue;
      inBlockScalar = false;
      if (!/^[A-Za-z][\w-]*:/.test(l) && !/^\s+- /.test(l) && !/^\s+\w+:/.test(l))
        warn(`frontmatter block line doesn't look like YAML: "${l.slice(0, 50)}"`, l.slice(0, 50));
      const km = l.match(/^([A-Za-z][\w-]*):/);
      if (km && !KNOWN_FRONT_KEYS.has(km[1])) warn(`unknown frontmatter key "${km[1]}" — known keys: ${[...KNOWN_FRONT_KEYS].join(", ")}`, `${km[1]}:`);
      if (/^[A-Za-z][\w-]*:\s*[|>][+-]?\s*$/.test(l)) inBlockScalar = true;
    }
  }
}

// ---------------- static contract checks (iliad.sty dialect) --------------
if (usesExerciseEnv && !iliadBlock) {
  advise("no %--- iliad --- frontmatter block at the top of main.tex — the page summary will be missing");
}
{ // duplicate labels break cross-referencing (last definition silently wins)
  const seen = new Set();
  for (const m of tex.matchAll(/\\label\{([^}]*)\}/g)) {
    if (seen.has(m[1])) warn(`duplicate \\label{${m[1]}} — labels must be unique within a worksheet`, m[0]);
    seen.add(m[1]);
  }
}
{ // hand-rolled references drift when things renumber; \cref prints AND links
  // the type word and follows the label wherever it goes. \eqref, \ref* (the
  // number-only form used inside custom \hyperref text) and \crefrange are all
  // fine and don't match here.
  const code = tex.replace(/(^|[^\\])%.*$/gm, "$1"); // commented-out code is nobody's business
  for (const m of code.matchAll(/\\ref\{([^}]*)\}/g)) {
    advise(`plain \\ref{${m[1]}} — use \\cref (prints and links the type, and survives renumbering)`, m[0]);
  }
  // \hyperref whose visible text hand-writes a "Type N" — the number is frozen.
  // Nested-brace text (the roadmap-node pattern carrying \ref*) never matches
  // the flat [^{}]* group, which is exactly right: those pull their numbers
  // from the label.
  for (const m of code.matchAll(/\\hyperref\[[^\]]*\]\{([^{}]*)\}/g)) {
    if (/\\ref\*?\{/.test(m[1])) continue;
    if (/(Appendix|Appendices|Section|Chapter|Exercise|Problem|Theorem|Lemma|Proposition|Corollary|Definition|Example|Figure|Table|Remark|Callout)\s*~?\s*[A-Z0-9]/.test(m[1])) {
      advise(`\\hyperref with hand-written reference text "${m[1].slice(0, 40)}" — use \\cref so the text tracks the label`, m[0]);
    }
  }
}
// redefining the contract breaks the converter's guarantees
if (usesExerciseEnv) {
  for (const m of tex.matchAll(/\\renew(?:command|environment)\s*\{?\\?([a-zA-Z]+)\}?/g)) {
    if (CONTRACT_NAMES.has(m[1])) warn(`redefining contract name "${m[1]}" is forbidden — the converter relies on iliad.sty's definition`, m[0]);
  }
}

// --------------------------- preamble → gdef ------------------------------
function buildGdef(pre) {
  const parts = [];
  const seen = new Set();
  const add = (name, arity, bodyStr) => {
    if (seen.has(name) || MACRO_SKIP.has(name)) return;
    // a body containing $ would terminate the $-delimited \gdef block itself,
    // silently killing every macro defined after it — skip, contained
    if (bodyStr.includes("$")) { warn(`macro ${name} body contains $ (text-mode construct) — not exported to KaTeX`, name); seen.add(name); return; }
    seen.add(name);
    if (MACRO_OVERRIDE[name] !== undefined) { parts.push(`\\gdef${name}${MACRO_OVERRIDE[name] === "" ? "" : "{" + MACRO_OVERRIDE[name] + "}"}`); return; }
    const params = Array.from({ length: arity }, (_, k) => `#${k + 1}`).join("");
    parts.push(`\\gdef${name}${params}{${bodyStr}}`);
  };
  // \newcommand{\name}[n][opt]{body}  and \renewcommand
  // macro names may be braced ({\foo}) or bare (\foo)
  const nc = /\\(?:new|renew|provide)command\s*\{?(\\[a-zA-Z]+)\}?\s*(?:\[(\d+)\])?\s*(?:\[[^\]]*\])?\s*/g;
  let m;
  while ((m = nc.exec(pre))) {
    const name = m[1], arity = m[2] ? parseInt(m[2]) : 0;
    const g = readGroup(pre, nc.lastIndex);
    if (!g) continue;
    const hasOpt = /\]\s*\[/.test(pre.slice(m.index, nc.lastIndex)) || /\[\d+\]\s*\[/.test(pre.slice(m.index, nc.lastIndex));
    if (hasOpt && !MACRO_OVERRIDE[name]) { warn(`macro ${name} has an optional arg; not auto-translated (override or expand manually)`, name); }
    if (MACRO_SKIP.has(name)) { nc.lastIndex = g.end; continue; }
    add(name, arity, applyShims(trimMacroBody(g.content)));
    nc.lastIndex = g.end;
  }
  // simple \def\name{body} (parameterless) — common toggle idiom
  const df = /\\def\s*\\([a-zA-Z]+)\s*\{/g;
  while ((m = df.exec(pre))) {
    const g = readGroup(pre, m.index + m[0].length - 1);
    if (!g) continue;
    df.lastIndex = g.end;
  }
  // \DeclareMathOperator*{\name}{body} — body read with readGroup (it may
  // contain nested braces, e.g. {\mathbf{H}}, which a [^}]* regex truncates)
  const op = /\\DeclareMathOperator(\*?)\s*\{(\\[a-zA-Z]+)\}\s*/g;
  while ((m = op.exec(pre))) {
    const star = m[1] ? "*" : "", name = m[2];
    const g = readGroup(pre, m.index + m[0].length);
    if (!g) continue;
    if (MACRO_OVERRIDE[name] !== undefined) add(name, 0, "");
    else add(name, 0, `\\operatorname${star}{${applyShims(g.content)}}`);
    op.lastIndex = g.end;
  }
  return parts.join("");
}
const gdef = buildGdef(preamble + "\n" + body);   // \newcommand is legal mid-document too

// --------------------------- bib → citations ------------------------------
function parseBib() {
  // \bibliography{name} names the .bib; fall back to the legacy biblo.bib
  const bm = tex.match(/\\bibliography\{([^}]+)\}/);
  const stem = bm ? bm[1].trim().replace(/\.bib$/, "") : "biblo";
  let bibFile = path.join(path.dirname(input), stem + ".bib");
  if (!existsSync(bibFile)) bibFile = path.join(path.dirname(input), "biblo.bib");
  if (!existsSync(bibFile)) return {};
  const out = {};
  let entries;
  try { entries = bibtexEntries(readFileSync(bibFile, "utf8")); }
  catch (e) { warn(`could not parse ${path.basename(bibFile)}: ${String(e.message).slice(0, 80)}`); return {}; }
  const clean = (s) => (s == null ? null
    : String(s).replace(/[{}]/g, "").replace(/\\&/g, "&").replace(/~/g, " ")
      .replace(/\s+/g, " ").trim() || null);
  for (const e of entries) {
    if (!e.key) continue;
    const author = e.AUTHOR ?? null, year = e.YEAR ?? null;
    const url = e.URL ?? e.HOWPUBLISHED ?? null;
    let disp = e.key, authorsFull = null;
    if (author) {
      const people = String(author).replace(/[{}]/g, "").split(/\s+and\s+/)
        .map((a) => a.trim()).filter(Boolean);
      const names = people.map((a) => (a.includes(",") ? a.split(",")[0].trim() : a.split(/\s+/).pop()));
      disp = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
      if (year) disp += ` ${year}`;
      // "Last, First" -> "First Last"; full list for the References entry
      const full = people.map((a) => (a.includes(",") ? a.split(",").map((x) => x.trim()).reverse().join(" ") : a));
      authorsFull = full.length <= 2 ? full.join(" and ") : `${full.slice(0, -1).join(", ")}, and ${full.at(-1)}`;
    }
    out[e.key] = {
      disp,
      url: url && /^https?:/.test(String(url)) ? String(url)
        : e.EPRINT ? `https://arxiv.org/abs/${clean(e.EPRINT)}` : null,
      // the fields the page-bottom References list is typeset from
      authorsFull: clean(authorsFull),
      year: clean(year),
      title: clean(e.TITLE),
      venue: clean(e.JOURNAL ?? e.BOOKTITLE ?? e.SCHOOL ?? e.INSTITUTION ?? e.PUBLISHER
        ?? (e.EPRINT ? `arXiv:${e.EPRINT}` : null)),
    };
  }
  return out;
}
const BIB = parseBib();

// ------------------------------ frontmatter -------------------------------
// title: \title{...} anywhere in the (comment-stripped) document — some
// sheets set it after \begin{document}, which LaTeX allows before \maketitle.
const stdTitleM = tex.match(/\\title\{/);
let title = "TODO";
if (stdTitleM) {
  const g = readGroup(tex, stdTitleM.index + stdTitleM[0].length - 1);
  if (g) title = texToPlain(g.content.split("\\hfill")[0]);
}
// contributors: \author{...}. Plain "A \and B" works; so do affiliation
// blocks — \authorname{X}\\ \affiliation{Y} renders as "X (Y)".
let contributors = [];
const authorM = tex.match(/\\author\{/);
if (authorM) {
  const g = readGroup(tex, authorM.index + authorM[0].length - 1);
  if (g) {
    contributors = g.content.split(/\\and\b/).map((chunk) => {
      const arg = (cmd) => {
        const m = chunk.match(new RegExp(`\\\\${cmd}\\s*\\{`));
        if (!m) return null;
        const gg = readGroup(chunk, m.index + m[0].length - 1);
        return gg ? texToPlain(gg.content).trim() : null;
      };
      const name = arg("authorname")
        ?? texToPlain(chunk.replace(/\\affiliation\s*\{[^{}]*\}/g, " ").replace(/\\\\/g, " ")).trim();
      const affil = arg("affiliation");
      return affil ? `${name} (${affil})` : name;
    }).filter(Boolean);
  }
}
// summary: \begin{summary}...\end{summary} in the body — hoisted into the
// frontmatter (the env renders nothing on the web; the page header shows it).
let bodySummary = null;
const sumM = body.match(/\\begin\{summary\}([\s\S]*?)\\end\{summary\}/);
if (sumM) bodySummary = texToPlain(sumM[1]).replace(/\s+/g, " ").trim();

// frontmatter: nothing is mandatory. Values are one-line scalars, except
// summary, which may be a YAML block scalar (`summary: >-` + indented lines).
// title/contributors/summary fall back to \title{}/\author{}/\begin{summary}
// in the LaTeX. An explicit frontmatter key takes precedence.
// Missing title/contributors draw advisories, never failures. `cluster:`/`day:`
// are stamped in later by build-content.mjs from schedule.yaml, and are not
// keys an author may write (see KNOWN_FRONT_KEYS).
const blockKeys = new Set((iliadBlock ?? []).filter((l) => /^[A-Za-z]/.test(l)).map((l) => l.split(":")[0]));
const front = [
  "---",
  ...(blockKeys.has("title") || title === "TODO" ? [] : [`title: ${JSON.stringify(title)}`]),
  ...(blockKeys.has("contributors") || !contributors.length ? [] : ["contributors:", ...contributors.map((c) => `  - ${c}`)]),
  ...(blockKeys.has("summary") || !bodySummary ? [] : [`summary: ${JSON.stringify(bodySummary)}`]),
  ...(iliadBlock ?? []),
  "---",
].join("\n");
if (blockKeys.has("summary") && bodySummary)
  advise("summary given both as a frontmatter key and a \\begin{summary} block — the frontmatter key wins");
if (!blockKeys.has("title") && title === "TODO")
  advise("no title: in the frontmatter block and no \\title{} — the page falls back to its slug");
if (!blockKeys.has("contributors") && !contributors.length)
  advise("no contributors: in the frontmatter block and no \\author{} — the page shows no authors");
// A summary is optional but load-bearing: it is the page's lede AND its blurb in
// the homepage/sidebar index, so a sheet that ships without one reads as
// unfinished. `summary: TODO` is what a port writes when the source has no
// summary to transcribe (nobody may invent one), which makes it easy to forget.
if (iliadBlock) {
  const declared = typeof frontBlock?.summary === "string" ? frontBlock.summary.trim() : null;
  const missing = !blockKeys.has("summary") && !bodySummary;
  if (missing)
    advise("no summary: in the frontmatter block — the page and its index entry show no lede");
  else if (blockKeys.has("summary") && !declared)
    advise("summary: in the frontmatter block is empty — the page and its index entry show no lede");
  else if (declared && /^todo\b/i.test(declared))
    advise(`summary: is still a placeholder ("${declared.slice(0, 40)}") — the page ships it verbatim as its lede`);
}

// ---------------------------- video titles --------------------------------
// \youtube with no [Title]: the web build queries the title from YouTube's
// oEmbed endpoint (public, no API key) so the embed still gets a caption and
// an accessible iframe title. Lookups are cached beside the output; a failed
// lookup (offline CI, deleted video) degrades to an advisory and an untitled
// embed. The PDF never sees any of this — pdflatex cannot fetch, and authors
// compile on Overleaf with no build step — it prints the watch URL instead.
const videoTitles = {};
{
  const wanted = new Set();
  for (const m of body.matchAll(/\\youtube\s*(\[[^\]]*\])?\s*\{\s*([A-Za-z0-9_-]{11})\s*\}/g)) {
    if (!m[1] || m[1] === "[]") wanted.add(m[2]);
  }
  if (wanted.size) {
    const cachePath = path.join(path.dirname(output), ".video-titles.json");
    let cache = {};
    try { cache = JSON.parse(readFileSync(cachePath, "utf8")); } catch { /* cold cache */ }
    let dirty = false;
    for (const id of wanted) {
      if (typeof cache[id] === "string") { videoTitles[id] = cache[id]; continue; }
      try {
        const watch = `https://www.youtube.com/watch?v=${id}`;
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
          { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        videoTitles[id] = cache[id] = String((await r.json()).title ?? "").trim();
        dirty = true;
      } catch (e) {
        advise(`\\youtube{${id}}: title lookup failed (${e.message}) — the embed ships untitled; pass [Title] to set one by hand`, id);
      }
    }
    if (dirty) { try { writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n"); } catch { /* cache is best-effort */ } }
  }
}

// ------------------------------ run ---------------------------------------
// AST emit (two passes handled inside emit-ast)
const bodyMdx = tidy(emitDocument(body, {
  refs,
  videoTitles,
  preamble,
  declaredThms,
  declaredEnvSigs: Object.fromEntries(Object.keys(declaredThms).map((e) => [e, { signature: "o" }])),
  remarkNumbered,
  commentCmds,
  BIB,
  tikzSrc,
  macroOverride: MACRO_OVERRIDE,
  warnSnapshot: () => [warnings.length, advisories.length],
  warnRestore: ([w, a]) => { warnings.length = w; advisories.length = a; },
}));
// The page's macros ride in a leading inline-math span, where KaTeX picks up the
// \gdef's. A sheet that defines none must not get an empty one: `$$` on its own
// line is a display-math OPENER to remark-math, which then swallows the rest of
// the page into one unclosed span (and every worksheet in the repo happened to
// define at least one macro, so nothing hit this until a ported reading guide
// did).
const result = `${front}\n\n${gdef.trim() ? `$${gdef}$\n\n` : ""}${bodyMdx}\n`;
writeFileSync(output, result);

// render extracted diagrams (content-addressed: unchanged ones are skipped,
// which is what makes this incremental in CI)
let tikzRendered = 0;
if (renderTikz) tikzRendered = renderTikzSnippets();

console.log(`gdef macros: ${(gdef.match(/\\gdef/g) || []).length}  |  bib: ${Object.keys(BIB).length}  |  aux refs: ${Object.keys(refs).length}${tikzCount() ? `  |  tikz: ${tikzCount()} diagrams (${tikzRendered} newly rendered -> ${tikzDir})` : ""}`);
const uniqW = Array.from(new Set(warnings.map(fmtIssue)));
console.log(`WARN (${warnings.length} total, ${uniqW.length} unique):`);
console.log(uniqW.slice(0, 40).map((w) => "  - " + w).join("\n"));
const uniqA = Array.from(new Set(advisories.map(fmtIssue)));
if (uniqA.length) {
  console.log(`NOTE (advisory, does not fail CI) (${uniqA.length}):`);
  console.log(uniqA.slice(0, 40).map((a) => "  - " + a).join("\n"));
}
console.log(`Wrote ${output} (${result.split("\n").length} lines)`);
// non-zero exit when anything WARN'd, so CI/hooks can gate on it (advisories don't count)
if (warnings.length) process.exitCode = 2;
