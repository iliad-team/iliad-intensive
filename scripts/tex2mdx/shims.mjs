/**
 * shims.mjs — ALL dialect knowledge, as declarative tables plus pure
 * string→string math transforms. This is the file you edit when a new .tex
 * corpus arrives; the core converter should rarely change.
 *
 * Stage contract: everything here is pure (no state, no I/O).
 */
import { readOpt, readArg, readGroup } from "./util.mjs";

// ---------------------------------------------------------------- macros ---
// Author macros KaTeX can't take verbatim (optional args / \mathchoice / text
// tricks): the generated \gdef uses this body instead.
export const MACRO_OVERRIDE = {
  // Author-defined macros whose DEFINITION BODIES use TeX that KaTeX cannot
  // execute. The converter exports every author macro to KaTeX verbatim;
  // these three are the exceptions where verbatim export would fail:
  "\\TV": "\\mathrm{TV}",       // defined with an optional arg — no KaTeX \gdef equivalent
  "\\aes": "\\text{\\ae}",     // defined via text-mode \textnormal — KaTeX rejects in math
  "\\exmax": "\\mathop{\\overset{\\max}{\\sum}}\\limits",   // defined via \mathchoice — TeX primitive KaTeX lacks
};

// Author macros never exported to KaTeX (layout/scaffolding). These are
// LaTeX structural / page-layout commands a worksheet may (re)define for the
// PDF; they are never math and would otherwise pollute the KaTeX \gdef block.
export const MACRO_SKIP = new Set([
  "\\mytitle", "\\mysubsection", "\\exmaxsym", "\\thesection",
  "\\crefrangeconjunction", "\\thesubsection",
  "\\section", "\\subsection", "\\subsubsection", "\\paragraph",
  "\\headrulewidth", "\\footrulewidth", "\\solutionlistskip",
  // KaTeX has \llbracket/\rrbracket natively and renders them properly.
  // iliad.sty builds them from kernel pieces ([\![ … ]\!]) only because
  // stmaryrd costs ~79 MB of CI download for those two glyphs — a PDF-side
  // workaround the web has no reason to inherit. The converter never sees the
  // package's own definitions, so these entries only catch a sheet that still
  // defines them locally; skipping the export leaves KaTeX's real glyphs in
  // force, where exporting would also \gdef them recursively.
  "\\llbracket", "\\rrbracket",
]);

// Package commands with no KaTeX implementation but an exact synonym.
// Applied to math bodies and generated \gdef macro bodies.
export const KATEX_SHIMS = [
  [/\\mathds\b/g, "\\mathbb"],      // dsfont
  [/\\bm\b/g, "\\boldsymbol"],      // bm
  // \ensuremath{X} is "X, in math mode either way" — the standard way to write a
  // macro that works in a sentence and in an equation alike (amsthm's \qed is
  // \ensuremath{\square}). Inside math it is already redundant, so drop the
  // command and keep its braces: {X} is the same group to KaTeX. It matters here
  // rather than only in MATH_TRANSFORMS because a \gdef body reaches KaTeX
  // through this table, and that is where such a macro is defined.
  // Prose usage is a real inline-math span — see emit-ast.mjs.
  [/\\ensuremath\s*(?=\{)/g, ""],
];
export const applyShims = (s) =>
  KATEX_SHIMS.reduce((acc, [re, to]) => acc.replace(re, to), s);

// trim a macro body, but a trailing control-space (`\ `) must survive —
// plain .trim() would leave a bare `\` that escapes the \gdef's closing brace
export const trimMacroBody = (b) => {
  let t = b.trim();
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(t)) t += " ";
  return t;
};

// ------------------------------------------------------- math transforms ---
// Pure rewrites applied to every math body before it reaches KaTeX.
// Order matters; each entry is (string) => string.
export const MATH_TRANSFORMS = [
  applyShims,

  // a literal \$ inside $...$ terminates micromark's math span even though
  // KaTeX itself accepts \$ — the escape doesn't exist at the markdown layer.
  // \char36 is the same glyph with no $ byte, valid in math and \text mode.
  (m) => m.replace(/\\\$/g, "\\char36 "),

  // amsthm/text-mode commands with no KaTeX meaning
  (m) => m.replace(/\\qedhere\b/g, ""),
  (m) => m.replace(/\\footnotemark\b/g, ""),

  // diffcoeff: \diff[n]{f}{x} -> \frac{d^n f}{d x^n}; \diffp -> partials
  (m) => {
    let out = "", i = 0;
    while (i < m.length) {
      const dm = /^\\diff(p?)\*?/.exec(m.slice(i));
      if (dm) {
        let j = i + dm[0].length;
        const op = readOpt(m, j); let pow = null;
        if (op) { pow = op.content; j = op.end; }
        const g1 = readArg(m, j); const g2 = g1 ? readArg(m, g1.end) : null;
        if (g1 && g2) {
          const d = dm[1] ? "\\partial" : "\\mathrm{d}";
          out += pow
            ? `\\frac{${d}^{${pow}} ${g1.content}}{${d} ${g2.content}^{${pow}}}`
            : `\\frac{${d} ${g1.content}}{${d} ${g2.content}}`;
          i = g2.end; continue;
        }
      }
      out += m[i]; i++;
    }
    return out;
  },

  // KaTeX's array env rejects @{...} column expressions:
  // \begin{array}{@{}ccc|c@{}} -> {ccc|c}
  (m) => m.replace(/(\\begin\{array\}\s*)\{([^{}]*(?:@\{[^{}]*\}[^{}]*)+)\}/g,
    (m0, pre, spec) => `${pre}{${spec.replace(/@\{[^{}]*\}/g, "")}}`),
];
export const applyMathShims = (m) => MATH_TRANSFORMS.reduce((acc, f) => f(acc), m);

// ------------------------------------------------ brace-less math args ---
// TeX lets a mandatory argument be a single token, so `\frac12` IS `\frac{1}{2}`
// and `\sqrt23` is `\sqrt{2}3`. Authors write it constantly.
//
// unified-latex only splits a digit run into separate tokens where it parses in
// MATH mode, and it does not count `aligned`, `gathered`, `cases`, `array` or
// the `matrix` family as math environments. Inside those the run "12" stays ONE
// string node, so the argument grabber swallows it whole and prints
// `\frac{12}{&}` or `\frac{12}{\right}` — which then fails the KaTeX gate,
// usually pointing at an equation nowhere near the real one. Top-level
// `\[ … \]` and `split` happen to be fine, which is why this stayed hidden.
//
// Depending on which environments the parser happens to know is the fragile
// part, so normalise the SOURCE instead: rewrite every brace-less mandatory
// argument of these math macros into an explicit group, exactly as TeX reads
// it. Idempotent — an already-braced argument is re-emitted unchanged — and
// applied to the converter's in-memory copy only, never back to tex/.
export const BRACELESS_ARG_MACROS = {
  frac: 2, dfrac: 2, tfrac: 2, cfrac: 2,
  binom: 2, dbinom: 2, tbinom: 2,
  sqrt: 1,
};

// Regions that SHOW TeX rather than execute it: a \frac12 there is the point.
const VERBATIM_RE =
  /\\begin\{(verbatim\*?|lstlisting|alltt|minted)\}[\s\S]*?\\end\{\1\}|\\verb\*?(.)[\s\S]*?\2/g;

function braceMathArgsSegment(s) {
  let out = "", i = 0;
  while (i < s.length) {
    if (s[i] !== "\\") { out += s[i]; i++; continue; }
    const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
    const arity = m && BRACELESS_ARG_MACROS[m[1]];
    if (arity) {
      let j = i + m[0].length, opt = "", ok = true;
      const o = readOpt(s, j);                 // \sqrt[3]{x}
      if (o) { opt = `[${o.content}]`; j = o.end; }
      const args = [];
      for (let k = 0; k < arity; k++) {
        let t = j; while (t < s.length && /\s/.test(s[t])) t++;
        if (s[t] === "{") {                    // already a group — keep verbatim
          const g = readGroup(s, t);
          if (!g) { ok = false; break; }
          args.push(g.content); j = g.end;
        } else if (s[t] === "\\") {            // a control sequence is one token
          const cs = /^\\([a-zA-Z]+\*?|.)/.exec(s.slice(t));
          if (!cs || cs[0] === "\\\\") { ok = false; break; }
          args.push(cs[0]); j = t + cs[0].length;
        } else if (t < s.length && !"}]&$%^_~".includes(s[t])) {
          args.push(s[t]); j = t + 1;          // exactly one character, as TeX
        } else { ok = false; break; }          // no argument there to take
      }
      if (ok && args.length === arity) {
        out += `\\${m[1]}${opt}${args.map((a) => `{${a}}`).join("")}`;
        i = j; continue;
      }
    }
    // not ours (or malformed): copy the escape through untouched
    out += s[i] + (s[i + 1] ?? ""); i += 2;
  }
  return out;
}

export function braceMathArgs(src) {
  let out = "", last = 0;
  for (const m of src.matchAll(VERBATIM_RE)) {
    out += braceMathArgsSegment(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + braceMathArgsSegment(src.slice(last));
}


// ------------------------------------------------------------ cross-refs ---
// Printed name per cref type. Defaults are the capitalised type; a sheet's
// own \crefname / thmtools refname declarations override at runtime.
export const CREF_NAME_DEFAULTS = { equation: "Equation" };

// amsthm theorem family sharing one counter, numbered within section.
export const THM_FAMILY = new Set([
  "theorem", "lemma", "proposition", "corollary", "fact", "definition", "example",
]);

// -------------------------------------------------------------- contract ---
// Redefining these breaks the converter's guarantees (checked when the sheet
// uses the iliad.sty exercise dialect).
export const CONTRACT_NAMES = new Set([
  "exercise", "solution", "proof", "callout", "remark", "learningoutcomes", "summary",
  "authorname", "affiliation",
  "definition", "theorem", "lemma", "proposition", "corollary", "fact", "example",
  "label", "cref", "Cref", "hint", "note", "important", "solutionbox", "exercisebox", "ifsolutions",
  "solutionsonly", "pdfonly", "teachingnote", "youtube",
]);

// Frontmatter describes the WORKSHEET. Where it sits in the course — its
// cluster and its teaching day — belongs to schedule.yaml, which lists the slug
// under its day; the build stamps `cluster:`/`day:` into the generated MDX from
// there. So neither is a key here, and writing one draws the unknown-key
// warning (which fails the build) rather than quietly contradicting the
// schedule.
export const KNOWN_FRONT_KEYS = new Set([
  "title", "summary", "contributors", "slug",
  // unlisted: true — page is built and reachable by URL but excluded from
  // content/index.json (homepage/sidebar), and excused from the schedule.
  // Used by the template worksheet.
  "unlisted",
  // slides: <url> — a link to an externally hosted slide deck (e.g. a Drive
  // PDF). Rendered as an outbound "Slides ↗" link; nothing is served or
  // compiled our end. For a deck with LaTeX source, drop a slides.tex in the
  // worksheet folder instead and the build compiles + hosts the PDF.
  "slides",
]);

// ------------------------------------------------------------------ tikz ---
// Packages copied from the document preamble into standalone diagram
// snippets (math/diagram packages only — never layout/hyperref).
export const TIKZ_PKG_OK = new Set([
  "tikz", "tikz-cd", "tikzcd", "pgfplots", "xcolor", "amsmath",
  "amssymb", "amsfonts", "mathtools", "bm", "dsfont", "stmaryrd", "cancel",
  "mathrsfs", "bbm", "upgreek", "physics", "adjustbox", "graphicx",
]);
