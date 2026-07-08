/**
 * shims.mjs — ALL dialect knowledge, as declarative tables plus pure
 * string→string math transforms. This is the file you edit when a new .tex
 * corpus arrives; the core converter should rarely change.
 *
 * Stage contract: everything here is pure (no state, no I/O).
 */
import { readOpt, readArg } from "./util.mjs";

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

// Author macros never exported to KaTeX (layout/scaffolding).
export const MACRO_SKIP = new Set([
  "\\mytitle", "\\mysubsection", "\\exmaxsym", "\\thesection",
  "\\crefrangeconjunction", "\\thesubsection",
]);

// Package commands with no KaTeX implementation but an exact synonym.
// Applied to math bodies and generated \gdef macro bodies.
export const KATEX_SHIMS = [
  [/\\mathds\b/g, "\\mathbb"],      // dsfont
  [/\\bm\b/g, "\\boldsymbol"],      // bm
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
  "exercise", "solution", "proof", "callout", "remark",
  "definition", "theorem", "lemma", "proposition", "corollary", "fact", "example",
  "label", "cref", "Cref", "hint", "note", "solutionbox", "exercisebox", "ifsolutions",
]);

export const KNOWN_FRONT_KEYS = new Set([
  "title", "cluster", "summary", "learningOutcomes", "contributors", "slug",
  // unlisted: true — page is built and reachable by URL but excluded from
  // content/index.json (homepage/sidebar). Used by the template worksheet.
  "unlisted",
]);

// ------------------------------------------------------------------ tikz ---
// Packages copied from the document preamble into standalone diagram
// snippets (math/diagram packages only — never layout/hyperref).
export const TIKZ_PKG_OK = new Set([
  "tikz", "tikz-cd", "tikzcd", "pgfplots", "xcolor", "amsmath",
  "amssymb", "amsfonts", "mathtools", "bm", "dsfont", "stmaryrd", "cancel",
  "mathrsfs", "bbm", "upgreek", "physics", "adjustbox", "graphicx",
]);
