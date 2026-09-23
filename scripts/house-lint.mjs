#!/usr/bin/env node
/**
 * house-lint.mjs — scan every worksheet for violations of the house style that
 * a pattern can find, without building anything.
 *
 * The converter (scripts/tex2mdx/) already advises about some of these, but
 * only for the one sheet it is converting, and only in the middle of a build.
 * This is the whole-repo sweep: every tracked tex/<slug>/main.tex and main.mdx,
 * about a second, no dependencies beyond the converter's own pure helpers
 * (CONTRACT_NAMES, frontMatterOrderIssues) so the two never disagree.
 *
 * The rules are the ones docs/commands.md and docs/iliad-sty.md state, plus the
 * conventions AIXI and Singular Learning Theory set; `--rules` lists them.
 * Anything needing judgment (was a sentence reworded? is this remark really an
 * example?) is out of scope — this only reports what a regex can see.
 *
 * Usage:
 *   node scripts/house-lint.mjs                 # every sheet
 *   node scripts/house-lint.mjs aixi debate     # just these slugs
 *   node scripts/house-lint.mjs path/to/x.tex   # any file, tracked or not
 *   node scripts/house-lint.mjs --rules         # list the rules
 *   node scripts/house-lint.mjs --json          # machine-readable
 *   node scripts/house-lint.mjs --min=warn      # hide info-level findings
 *
 * Exits 1 if any error-level finding is reported, else 0.
 *
 * Silence a finding you have judged to be fine with a comment on the flagged
 * line or the line above it (MDX: {/* house-lint-ignore … *\/}):
 *   % house-lint-ignore literal-number-ref
 *   % house-lint-ignore-file custom-theorem-env       (anywhere; whole file)
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_NAMES } from "./tex2mdx/shims.mjs";
import { frontMatterOrderIssues } from "./tex2mdx/util.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");

const RULES = {
  // metadata
  "summary-missing":        ["error", "no summary: in the metadata block, or it is empty / still TODO"],
  "frontmatter-schedule-key": ["error", "cluster: or day: in frontmatter — that lives in schedule.yaml"],
  "summary-env":            ["info",  "legacy \\begin{summary} in the body — the summary belongs in the %--- iliad --- block"],
  // structure
  "frontmatter-order":      ["warn",  "opening run out of order — video embeds, then Prerequisites, then learning outcomes, then content"],
  "further-reading-not-last": ["warn", "a Further reading / Learn more section is followed by more taught content"],
  "solutions-section-unwrapped": ["warn", "a Solutions section header outside pdfonly+solutionsonly (empty on the web, shown in -nosol)"],
  // references
  "plain-ref":              ["warn",  "\\ref / \\autoref — use \\cref (prints and links the type word)"],
  "typed-ref-word":         ["warn",  "hand-typed type word before a reference (\"Exercise~\\cref{…}\", \"Section~\\ref{…}\")"],
  "typed-subpart":          ["warn",  "\\cref{ex:…}(b) — label the \\item and \\cref it instead"],
  "literal-number-ref":     ["warn",  "a reference typed as literal text (\"Exercise 2.3\", \"Appendix A\") — it will not track renumbering"],
  "ref-into-pdfonly":       ["warn",  "a web-visible \\cref to a label that exists only in the PDF (inside pdfonly) — dead link on the web"],
  // environments
  "solution-unbound":       ["error", "\\begin{solution} without its [ex:label] binding"],
  "solution-dangling":      ["error", "\\begin{solution}[key] names a label that does not exist in the sheet"],
  "exercise-unlabeled":     ["warn",  "an exercise with no \\label of its own — no stable web anchor"],
  "ifsolutions-in-body":    ["warn",  "\\ifsolutions … \\fi in the body — the web cannot evaluate it; use solutionsonly"],
  "contract-redefined":     ["error", "a worksheet (re)defines a name iliad.sty owns"],
  "custom-theorem-env":     ["info",  "\\newtheorem for a non-contract name — the contract discourages own theorem machinery"],
  "hand-rolled-lead-in":    ["warn",  "a bold/italic \"Part 1(a).\", \"Hint:\", \"Remark.\" lead-in doing a contract environment's job"],
  "callout-title-math":     ["warn",  "maths in a callout's title argument — it travels as plain text on the web"],
  // packages and assets
  "reloads-iliad-package":  ["warn",  "re-loads hyperref or cleveref, which iliad.sty loads (and cleveref must load last)"],
  "stmaryrd":               ["warn",  "loads stmaryrd — iliad.sty already provides \\llbracket/\\rrbracket"],
  "youtube-id":             ["error", "\\youtube / <YouTube> takes the 11-character video ID, not a URL"],
  "image-outside-fig":      ["warn",  "an image referenced from, or committed to, somewhere other than fig/ (binary ones then bypass LFS)"],
  "local-iliad-sty":        ["error", "a committed per-folder iliad.sty copy — the shared tex/iliad.sty is the only one"],
  "bare-dollar-amount":     ["warn",  "MDX: a currency amount written with a bare $ — write \\$"],
  // MDX
  "mdx-html-comment":       ["error", "<!-- … --> in MDX is a compile error — use {/* … */}"],
  "mdx-h1":                 ["error", "a # heading in MDX — the title is the page's h1; ## is the top"],
  "mdx-numbered-heading":   ["warn",  "a hand-numbered MDX heading — hand-authored days are not numbered"],
  "mdx-parked-comment":     ["info",  "a {/* … */} comment left in MDX — it ships in the .mdx download; delete it"],
  "mdx-footnote-undefined": ["error", "a [^label] footnote reference with no [^label]: definition"],
};
const LEVELS = { info: 0, warn: 1, error: 2 };

// ------------------------------------------------------------------ helpers ---

/** Replace every TeX comment with spaces, keeping offsets and newlines. */
function stripTexComments(src) {
  let out = "";
  for (const line of src.split("\n")) {
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "%") continue;
      let bs = 0;
      for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) { cut = i; break; }
    }
    out += (cut < 0 ? line : line.slice(0, cut) + " ".repeat(line.length - cut)) + "\n";
  }
  return out.slice(0, -1);
}

/** Replace MDX {/* … *\/} comments and ``` fences with spaces, keeping offsets. */
function blankMdx(src, { comments = true } = {}) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  let out = src.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank);
  if (comments) out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);
  return out;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: off - starts[lo] + 1 };
  };
}

/** Spans of every \begin{name}…\end{name}, outermost only, nesting-aware. */
function envSpans(text, name) {
  const re = new RegExp(`\\\\(begin|end)\\{${name}\\}`, "g");
  const spans = [];
  let depth = 0, start = 0, bodyStart = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m[1] === "begin") { if (depth++ === 0) { start = m.index; bodyStart = re.lastIndex; } }
    else if (depth > 0 && --depth === 0) spans.push({ start, bodyStart, bodyEnd: m.index, end: re.lastIndex });
  }
  return spans;
}
const inSpans = (spans, off) => spans.some((s) => off >= s.start && off < s.end);

/** Balanced {…} group starting at text[i] === "{". */
function group(text, i) {
  if (text[i] !== "{") return null;
  let d = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "\\") { j++; continue; }
    if (text[j] === "{") d++;
    else if (text[j] === "}" && --d === 0) return { content: text.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/** The `%--- iliad ---` block of a main.tex, or YAML frontmatter of a main.mdx. */
function readMeta(raw, kind) {
  const lines = raw.split("\n");
  let from, to, strip;
  if (kind === "tex") {
    from = lines.findIndex((l) => /^%-+\s*iliad\s*-+\s*$/.test(l));
    if (from < 0) return null;
    to = lines.findIndex((l, i) => i > from && /^%-+\s*end\s*-+\s*$/.test(l));
    strip = (l) => l.replace(/^% ?/, "");
  } else {
    if (lines[0].trim() !== "---") return null;
    from = 0;
    to = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    strip = (l) => l;
  }
  if (to < 0) to = lines.length;
  const keys = {};
  for (let i = from + 1; i < to; i++) {
    const m = strip(lines[i]).match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value) || value === "") { // block scalar / nested map
      const parts = [];
      for (let j = i + 1; j < to && /^\s+\S/.test(strip(lines[j])); j++) parts.push(strip(lines[j]).trim());
      value = parts.join(" ");
    }
    keys[m[1]] = { value: value.replace(/^["']|["']$/g, ""), line: i + 1 };
  }
  return { keys, line: from + 1 };
}

// -------------------------------------------------------------------- lint ---

const TYPE_WORDS = "Exercises?|Problems?|Sections?|Subsections?|Theorems?|Lemmas?|Definitions?|Propositions?|"
  + "Corollar(?:y|ies)|Examples?|Remarks?|Appendi(?:x|ces)|Figures?|Tables?|Callouts?|Parts?|Facts?";
// amsmath & co. reload harmlessly; these two do not (docs/iliad-sty.md).
const PKGS_FROM_ILIAD = ["hyperref", "cleveref"];
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|pdf|eps)$/i;
const CONTRACT_ENVS = ["exercise", "solution", "proof", "callout", "remark", "learningoutcomes",
  "definition", "theorem", "lemma", "proposition", "corollary", "fact", "example", "hint",
  "solutionsonly", "pdfonly", "teachingnote"];

function lintFile(rel, raw, tracked) {
  const kind = rel.endsWith(".mdx") ? "mdx" : "tex";
  const findings = [];
  const at = lineIndex(raw);

  // Suppressions read from the raw text, before comments are stripped.
  const fileIgnores = new Set();
  const lineIgnores = new Map(); // line -> Set(rule) (applies to that line and the next)
  raw.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(/house-lint-ignore(-file)?\s+([\w,\s-]+?)(?:\*\/\}|$)/g)) {
      const rules = m[2].split(/[\s,]+/).filter(Boolean);
      if (m[1]) rules.forEach((r) => fileIgnores.add(r));
      else for (const ln of [i + 1, i + 2]) {
        if (!lineIgnores.has(ln)) lineIgnores.set(ln, new Set());
        rules.forEach((r) => lineIgnores.get(ln).add(r));
      }
    }
  });
  const report = (rule, off, msg) => {
    const { line, col } = typeof off === "number" ? at(off) : { line: off.line, col: 1 };
    if (fileIgnores.has(rule) || lineIgnores.get(line)?.has(rule)) return;
    findings.push({ file: rel, line, col, rule, level: RULES[rule][0], msg: msg ?? RULES[rule][1] });
  };
  const each = (re, text, fn) => { for (const m of text.matchAll(re)) fn(m); };

  // ---- metadata (both kinds)
  const meta = readMeta(raw, kind);
  const sum = meta?.keys.summary;
  const legacySummary = kind === "tex" && /^[^%\n]*\\begin\{summary\}/m.test(raw); // hoisted by the converter
  if (!sum && legacySummary) { /* reported as summary-env below */ }
  else if (!sum) report("summary-missing", { line: meta?.line ?? 1 },
    meta ? "no summary: key in the metadata block" : "no metadata block (and so no summary) at the top of the file");
  else if (!sum.value || /^TODO\b/i.test(sum.value)) report("summary-missing", { line: sum.line }, `summary is ${sum.value ? "still TODO" : "empty"}`);
  for (const k of ["cluster", "day"]) if (meta?.keys[k]) report("frontmatter-schedule-key", { line: meta.keys[k].line },
    `frontmatter sets \`${k}:\` — list the slug under its day in schedule.yaml instead`);

  if (kind === "mdx") return lintMdx(raw, report), findings;

  // ---- TeX
  const code = stripTexComments(raw);
  const docAt = code.indexOf("\\begin{document}");
  const bodyOff = docAt < 0 ? 0 : docAt;
  const body = code.slice(bodyOff);
  const B = (re, fn) => each(re, body, (m) => fn(m, bodyOff + m.index));
  const pdfonly = envSpans(code, "pdfonly");

  B(/\\begin\{summary\}/g, (m, o) => report("summary-env", o));

  // front matter order — same judgment as the converter, but Prerequisites may
  // also be a \paragraph (SLT, power-seeking), which the converter does not see.
  {
    const pos = { video: null, prereqs: null, outcomes: null, content: null };
    const re = /\\((?:sub)*section|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g;
    for (let m; (m = re.exec(body)); ) {
      if (/\\(re)?newcommand\*?\s*\{?$|\\let\s*$/.test(body.slice(Math.max(0, m.index - 16), m.index))) continue;
      const g = group(body, re.lastIndex - 1);
      if (!g) continue;
      const t = g.content.replace(/\\[a-zA-Z]+\s*/g, "").replace(/[{}]/g, "").trim().toLowerCase();
      const item = { at: bodyOff + m.index };
      if (/^prerequisites?\b/.test(t)) pos.prereqs ??= item;
      else if (m[1] === "paragraph" || /^(overview|introduction)\b/.test(t)) continue;
      else pos.content ??= item;
    }
    const lo = body.indexOf("\\begin{learningoutcomes}");
    if (lo >= 0) pos.outcomes = { at: bodyOff + lo };
    const yt = body.search(/\\youtube\b/);
    if (yt >= 0) pos.video = { at: bodyOff + yt };
    for (const i of frontMatterOrderIssues(pos)) report("frontmatter-order", i.at, i.msg);
  }

  // Further reading is the last \section before the appendix / bibliography.
  {
    const stop = Math.min(...["\\appendix", "\\bibliography{", "\\printbibliography", "\\end{document}"]
      .map((s) => body.indexOf(s)).filter((i) => i >= 0), body.length);
    const secs = [];
    const re = /\\section\*?\s*(?:\[[^\]]*\])?\s*\{/g;
    for (let m; (m = re.exec(body)) && m.index < stop; ) {
      if (inSpans(pdfonly, bodyOff + m.index)) continue;
      if (/\\(re)?newcommand\*?\s*\{?$|\\let\s*$/.test(body.slice(Math.max(0, m.index - 16), m.index))) continue;
      const g = group(body, re.lastIndex - 1);
      if (g) secs.push({ at: bodyOff + m.index, title: g.content });
    }
    const fr = secs.findIndex((s) => /further\s+read|learn\s+more/i.test(s.title));
    if (fr >= 0 && fr < secs.length - 1) report("further-reading-not-last", secs[fr].at,
      `"${secs[fr].title}" is followed by ${secs.length - 1 - fr} more section(s) (next: "${secs[fr + 1].title}") — pointers out close the sheet`);
  }

  B(/\\section\*?\s*\{\s*(Solutions?|Worked solutions)\s*\}/gi, (m, o) => {
    if (!inSpans(pdfonly, o)) report("solutions-section-unwrapped", o);
  });

  // references
  B(/\\(ref|autoref)\{([^}]*)\}/g, (m, o) => report("plain-ref", o, `\\${m[1]}{${m[2]}} — use \\cref`));
  B(new RegExp(`\\b(${TYPE_WORDS})(?:~|\\s)*\\\\(ref|cref|Cref)\\{([^}]*)\\}`, "g"), (m, o) =>
    report("typed-ref-word", o, `"${m[1]}" typed before \\${m[2]}{${m[3]}} — \\cref prints the type word itself`));
  B(/\\[cC]ref\{([^}]*)\}\s*~?\(([a-z]|[ivx]+)\)/g, (m, o) =>
    report("typed-subpart", o, `\\cref{${m[1]}}(${m[2]}) hand-writes the part — \\label the \\item`));
  // \textbf{Part 1(a).} / \emph{Hint: …} / \textit{Remark.} — prose standing in
  // for exercise/enumerate/hint/remark, which is what numbers and collapses them.
  const LEAD = /\\(?:textbf|textit|emph|textsc)\s*\{\s*((?:Part|Exercise|Problem|Question)\s*~?\s*\d+(?:\.\d+)*\s*(?:\([a-z]\))?|Parts?\s*\([a-z]\)|Hint|Remark|Note|Solution|Proof|Definition|Theorem|Lemma|Example)(?:\s*\([^)]*\))?\s*[.:)]/g;
  const leadIns = [];
  const proofs = envSpans(code, "proof");
  B(LEAD, (m, o) => {
    leadIns.push([o - bodyOff, m[0].length]);
    if (/^Parts?\b/.test(m[1]) && inSpans(proofs, o)) return; // a proof walking a theorem's parts
    const env = /^(Part|Exercise|Problem|Question)/.test(m[1]) ? "exercise / an enumerate \\item" : m[1].toLowerCase();
    report("hand-rolled-lead-in", o, `"${m[1]}" as a typed lead-in — use ${env === "note" ? "a callout" : env}`);
  });
  {
    // Literal "Exercise 2.3". Citation optional args (\cite[Theorem 3]{…}) and
    // headings are someone else's numbering or the sheet's own title, so blank
    // them first; a match followed by "of/in \cite" also points outside.
    let scan = body;
    for (const [i, n] of leadIns) scan = scan.slice(0, i) + " ".repeat(n) + scan.slice(i + n);
    scan = scan
      .replace(/\\cite\w*\s*(\[[^\]]*\]\s*){1,2}/g, (s) => s.replace(/[^\n]/g, " "))
      .replace(/\\(?:sub)*section\*?\s*(\[[^\]]*\])?\s*\{[^\n]*/g, (s) => s.replace(/[^\n]/g, " "))
      .replace(/\\label\{[^}]*\}/g, (s) => s.replace(/[^\n]/g, " "));
    each(new RegExp(`\\b(${TYPE_WORDS})(?:~|\\s)+(\\d+(?:\\.\\d+)*(?:\\([a-z]\\))?|[A-Z](?:\\.\\d+)*)(?![\\w-])`, "g"), scan, (m) => {
      // someone else's numbering: a citation nearby, or "their/the paper's …"
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 60);
      const before = body.slice(Math.max(0, m.index - 40), m.index);
      if (/\\cite|\b(of|in)\s+(the|his|her|their|[A-Z])/.test(after) || /\b(their|the paper'?s?|his|her)\b[^.]*$/.test(before)) return;
      // "Part 7: …" is a title; only "Part 1(a)" is a sheet's own subpart
      if (/^Parts?$/.test(m[1]) && !/\(/.test(m[2])) return;
      report("literal-number-ref", bodyOff + m.index, `"${m[0].replace(/\s+/g, " ")}" typed by hand — use \\cref`);
    });
  }
  {
    const pdfLabels = new Set();
    for (const s of pdfonly) for (const m of code.slice(s.start, s.end).matchAll(/\\label\{([^}]*)\}/g)) pdfLabels.add(m[1]);
    if (pdfLabels.size) B(/\\(?:[cC]ref|ref|eqref|crefrange|Crefrange)\{([^}]*)\}/g, (m, o) => {
      if (inSpans(pdfonly, o)) return;
      const hit = m[1].split(",").map((s) => s.trim()).find((l) => pdfLabels.has(l));
      if (hit) report("ref-into-pdfonly", o, `reference to "${hit}", which is defined only inside pdfonly`);
    });
  }

  // environments
  const labels = new Set([...code.matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]));
  B(/\\begin\{solution\}(\s*\[([^\]]*)\])?/g, (m, o) => {
    if (!m[1]) report("solution-unbound", o);
    else if (!labels.has(m[2].trim())) report("solution-dangling", o, `solution is bound to [${m[2]}], but no \\label{${m[2]}} exists`);
  });
  for (const s of envSpans(code, "exercise")) {
    let inner = code.slice(s.bodyStart, s.bodyEnd);
    for (const env of ["enumerate", "itemize", "description", "hint", "solution"])
      for (const t of envSpans(inner, env).reverse()) inner = inner.slice(0, t.start) + inner.slice(t.end);
    if (!/\\label\{/.test(inner)) report("exercise-unlabeled", s.start);
  }
  B(/\\ifsolutions\b/g, (m, o) => report("ifsolutions-in-body", o));
  each(/\\(newtheorem|newenvironment|renewenvironment|NewDocumentEnvironment|RenewDocumentEnvironment|DeclareDocumentEnvironment)\*?\s*\{([^}]*)\}/g, code, (m) => {
    if (CONTRACT_NAMES.has(m[2]) || CONTRACT_ENVS.includes(m[2])) report("contract-redefined", m.index, `\\${m[1]}{${m[2]}} — "${m[2]}" is iliad.sty's`);
    else if (m[1] === "newtheorem") report("custom-theorem-env", m.index, `\\newtheorem{${m[2]}} — own theorem machinery; check the web renders it`);
  });
  each(/\\(renewcommand|newcommand|def|let|DeclareRobustCommand)\*?\s*\{?\\([a-zA-Z]+)/g, code, (m) => {
    if (CONTRACT_NAMES.has(m[2])) report("contract-redefined", m.index, `\\${m[1]}\\${m[2]} — "\\${m[2]}" is iliad.sty's`);
  });
  B(/\\begin\{callout\}\s*\[[^\]]*\]\s*\[([^\]]*\$[^\]]*)\]/g, (m, o) => report("callout-title-math", o, `callout title "${m[1]}" contains maths`));

  // packages
  each(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, code, (m) => {
    for (const p of m[1].split(",").map((s) => s.trim())) {
      if (p === "stmaryrd") report("stmaryrd", m.index);
      if (PKGS_FROM_ILIAD.includes(p)) report("reloads-iliad-package", m.index, `loads ${p}, which iliad.sty already loads${p === "hyperref" ? " (configure it with \\hypersetup instead)" : ""}`);
    }
  });

  // assets
  B(/\\youtube\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, (m, o) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(m[1].trim())) report("youtube-id", o, `\\youtube{${m[1]}} — pass the 11-character ID`);
  });
  B(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, (m, o) => {
    if (!/^(\.\/)?fig\//.test(m[1].trim())) report("image-outside-fig", o, `\\includegraphics{${m[1]}} — figures live in fig/`);
  });
  const dir = path.dirname(rel);
  for (const f of tracked) {
    if (!f.startsWith(dir + "/")) continue;
    const sub = f.slice(dir.length + 1);
    if (sub === "iliad.sty") report("local-iliad-sty", { line: 1 }, `${f} is committed`);
    else if (IMG_EXT.test(sub) && !sub.startsWith("fig/")) report("image-outside-fig", { line: 1 }, `${f} is committed outside fig/`);
  }
  return findings;
}

/**
 * A $ that reads as currency: unescaped, an amount, then an English word, with
 * nothing mathematical before the next $. MDX only — in a .tex sheet a bare
 * "$500" breaks the PDF, so the author has already had to write \$.
 */
function bareDollars(text, fn) {
  for (const m of text.matchAll(/(^|[\s(])\$(\d[\d,]*(?:\.\d+)?[kKmMbB]?)(?=\s+[a-z]{2,}\b)/g)) {
    const from = m.index + m[0].length;
    const span = text.slice(from).match(/^[^$\n]*/)[0]; // up to the next $ or line end
    if (/[\\^_={}]/.test(span)) continue;
    fn(m.index + m[1].length);
  }
}

function lintMdx(raw, report) {
  const text = blankMdx(raw);
  const each = (re, fn) => { for (const m of text.matchAll(re)) fn(m, m.index); };

  each(/<!--/g, (m, o) => report("mdx-html-comment", o));
  each(/^# \S/gm, (m, o) => report("mdx-h1", o));
  each(/^#{2,4} +\d+(\.\d+)*\.?\s/gm, (m, o) => report("mdx-numbered-heading", o));
  for (const m of blankMdx(raw, { comments: false }).matchAll(/\{\/\*/g)) {
    if (!/house-lint-ignore/.test(raw.slice(m.index, raw.indexOf("*/}", m.index)))) report("mdx-parked-comment", m.index);
  }

  const pos = { video: null, prereqs: null, outcomes: null, content: null };
  each(/^(#{2,4}) +(.*)$/gm, (m, o) => {
    const t = m[2].trim().toLowerCase();
    if (/^prerequisites?\b/.test(t)) pos.prereqs ??= { at: o };
    else if (!/^(overview|introduction)\b/.test(t)) pos.content ??= { at: o };
  });
  const lo = text.indexOf("<LearningOutcomes");
  if (lo >= 0) pos.outcomes = { at: lo };
  const yt = text.indexOf("<YouTube");
  if (yt >= 0) pos.video = { at: yt };
  for (const i of frontMatterOrderIssues(pos)) report("frontmatter-order", i.at, i.msg);

  const secs = [...text.matchAll(/^## +(.*)$/gm)].map((m) => ({ at: m.index, title: m[1].trim() }));
  const fr = secs.findIndex((s) => /further\s+read|learn\s+more/i.test(s.title));
  if (fr >= 0 && fr < secs.length - 1 && !secs.slice(fr + 1).every((s) => /^references?$/i.test(s.title)))
    report("further-reading-not-last", secs[fr].at, `"${secs[fr].title}" is followed by "${secs[fr + 1].title}" — pointers out close the sheet`);

  each(/<YouTube\b[^>]*\bid=["']([^"']*)["']/g, (m, o) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(m[1])) report("youtube-id", o, `<YouTube id="${m[1]}"> — pass the 11-character ID`);
  });

  const defs = new Set([...text.matchAll(/^\[\^([^\]]+)\]:/gm)].map((m) => m[1]));
  each(/\[\^([^\]]+)\](?!:)/g, (m, o) => { if (!defs.has(m[1])) report("mdx-footnote-undefined", o, `[^${m[1]}] has no definition`); });

  // outside $…$ spans, a $ before an amount is currency
  bareDollars(text.replace(/\$\$[\s\S]*?\$\$/g, (s) => s.replace(/[^\n]/g, " ")), (i) => report("bare-dollar-amount", i));
}

// --------------------------------------------------------------------- main ---

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "tex"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--rules")) {
  const w = Math.max(...Object.keys(RULES).map((k) => k.length));
  for (const [id, [lvl, desc]] of Object.entries(RULES)) console.log(`${id.padEnd(w)}  ${lvl.padEnd(5)}  ${desc}`);
  process.exit(0);
}
const json = argv.includes("--json");
const min = LEVELS[(argv.find((a) => a.startsWith("--min=")) ?? "--min=info").slice(6)] ?? 0;
const targets = argv.filter((a) => !a.startsWith("--"));
const files = targets.filter((a) => /\.(tex|mdx)$/.test(a));
const slugs = targets.filter((a) => !files.includes(a));

const tracked = trackedFiles();
const sheets = (tracked
  ? tracked.filter((f) => /^tex\/[^/]+\/main\.(tex|mdx)$/.test(f))
  : readdirSync(TEX).flatMap((d) => ["tex", "mdx"].map((e) => `tex/${d}/main.${e}`)).filter((f) => existsSync(path.join(ROOT, f))))
  .filter((f) => !targets.length || slugs.includes(f.split("/")[1]))
  .concat(files.map((f) => {
    const rel = path.relative(ROOT, path.resolve(f));
    return rel.startsWith("..") ? path.resolve(f) : rel;
  }));
for (const s of slugs) if (!sheets.some((f) => f.split("/")[1] === s)) console.error(`house-lint: no worksheet tex/${s}/main.{tex,mdx}`);

const all = sheets.flatMap((f) => lintFile(f, readFileSync(path.resolve(ROOT, f), "utf8"), tracked ?? [])
  .sort((a, b) => a.line - b.line || a.col - b.col))
  .filter((f) => LEVELS[f.level] >= min);

if (json) console.log(JSON.stringify(all, null, 2));
else {
  let last = null;
  for (const f of all) {
    if (f.file !== last) console.log(`\n${f.file}`), (last = f.file);
    console.log(`  ${String(f.line).padStart(5)}:${String(f.col).padEnd(3)} ${f.level.padEnd(5)} ${f.rule.padEnd(26)} ${f.msg}`);
  }
  const n = (l) => all.filter((f) => f.level === l).length;
  console.log(`\n${sheets.length} sheet(s): ${n("error")} error(s), ${n("warn")} warning(s), ${n("info")} info`);
}
process.exit(all.some((f) => f.level === "error") ? 1 : 0);
