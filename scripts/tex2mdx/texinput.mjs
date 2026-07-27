/**
 * texinput.mjs — walk a worksheet across its \input boundaries.
 *
 * A worksheet may be one main.tex or a main.tex that \inputs a sections/
 * directory. Anything that rewrites the source before handing it to pdflatex
 * or to the converter has to see the WHOLE document, not just main.tex:
 *
 *   - autolabel.mjs injects a \label into every numbered construct, so its
 *     number can be read out of the .aux instead of simulated;
 *   - the -nosol build strips solution blocks, so the spoiler-free handout
 *     really is spoiler-free.
 *
 * Both used to run over main.tex alone. In a single-file worksheet that is the
 * whole document and nothing was wrong; in a multi-file one it silently missed
 * everything inside \input — unlabeled headings fell back to simulated numbers,
 * and solutions living in a section file survived into main-nosol.pdf.
 *
 * transformInputTree() applies a transform to every file of the document in a
 * single deterministic order (a file in full, then its inputs, depth-first in
 * order of appearance) and returns both shapes a caller might need:
 *
 *   - `files`, one entry per source file with its transformed text, for
 *     callers that want to preserve the file split (the auto-labelled compile
 *     does, so pdflatex's file:line diagnostics keep pointing at real sources);
 *   - `flat`, the whole document inlined into one string, for callers that
 *     want a self-contained result (the converter parses it; the -nosol .tex
 *     download ships it, so what a reader downloads actually compiles).
 *
 * Determinism is the contract autolabel.mjs depends on: every consumer walks
 * via this function, so all of them assign the same label to the same
 * construct. The order only has to be stable, not to match reading order.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// regions where a \input is literal text, not an inclusion
const VERBATIM = new Set(["verbatim", "Verbatim", "lstlisting", "alltt", "minted", "comment"]);

/** \input{...} occurrences pdflatex will actually expand — comment- and
 *  verbatim-aware, so `% \input{old}` and a \input inside a listing are
 *  skipped. Returns [{ start, end, arg }] in source order. */
export function findInputs(tex) {
  const hits = [];
  let i = 0, verb = null;
  while (i < tex.length) {
    const c = tex[i];
    if (verb) {                                   // only \end{<verb>} matters
      const closer = `\\end{${verb}}`;
      if (tex.startsWith(closer, i)) { i += closer.length; verb = null; } else i++;
      continue;
    }
    if (c === "%") {                              // comment: skip to EOL
      const eol = tex.indexOf("\n", i);
      i = eol === -1 ? tex.length : eol + 1;
      continue;
    }
    if (c !== "\\") { i++; continue; }
    let m = /^\\begin\{([a-zA-Z*]+)\}/.exec(tex.slice(i));
    if (m) { if (VERBATIM.has(m[1])) verb = m[1]; i += m[0].length; continue; }
    m = /^\\input\s*\{([^}]*)\}/.exec(tex.slice(i));
    if (m) { hits.push({ start: i, end: i + m[0].length, arg: m[1] }); i += m[0].length; continue; }
    // \include is NOT followed: it carries \clearpage semantics that inlining
    // would silently change. Say so rather than skip it quietly — an unnoticed
    // miss here means solutions surviving into a -nosol build.
    m = /^\\include\s*\{([^}]*)\}/.exec(tex.slice(i));
    if (m) { hits.push({ start: i, end: i + m[0].length, arg: m[1], include: true }); i += m[0].length; continue; }
    i += 2;                                       // any other \x escape
  }
  return hits;
}

/** Resolve an \input argument the way pdflatex does: an extensionless name
 *  gets .tex appended. Returns null when the file is missing. */
export function resolveInput(dir, arg) {
  const file = path.join(dir, /\.\w+$/.test(arg) ? arg : `${arg}.tex`);
  return existsSync(file) ? file : null;
}

/**
 * Apply `visit(file, rawText)` to every file of the document.
 *
 * @param mainFile absolute path to main.tex
 * @param visit    (file, rawText, ctx) => transformed text. Called ONCE per
 *                 file, in document order; thread any counter through a
 *                 closure. `ctx.inDoc` says whether this file is pulled in
 *                 after \begin{document} — false for main.tex itself and for
 *                 a preamble include like \input{macros}, true for a section.
 * @param childSuffix when set (e.g. ".autolabel"), each \input in the returned
 *                 per-file text is repointed at a sibling derived copy —
 *                 \input{sections/01} becomes \input{sections/01.autolabel} —
 *                 and that copy's path is what `files` reports. Omit to leave
 *                 \input arguments untouched.
 * @param warn     (message) => void, for missing files and runaway nesting.
 * @returns { files: [{ path, text }], flat } — `files[0]` is main, carrying
 *                 mainFile's own path (the caller decides where to write it).
 */
export function transformInputTree(mainFile, { visit, childSuffix = null, warn = () => {} } = {}) {
  const files = [];

  // An \input arg -> the arg naming its derived sibling. The ".tex" is spelled
  // out rather than left implicit: "sections/01.autolabel" would leave TeX to
  // decide whether ".autolabel" is already an extension.
  const derivedArg = (arg) => `${arg.replace(/\.tex$/, "")}${childSuffix}.tex`;

  // `flat` is assembled in true document order, so a running flag over the
  // chunks appended so far answers "are we past \begin{document} yet?" for
  // each \input as it is reached.
  let sawBeginDoc = false;
  const append = (chunk) => {
    if (!sawBeginDoc && chunk.includes("\\begin{document}")) sawBeginDoc = true;
    return chunk;
  };

  const walk = (file, outPath, depth) => {
    if (depth > 8) { warn("\\input nesting too deep — stopping"); return ""; }
    // Transform first, then look for \input in the RESULT: a transform may
    // remove an \input (stripping a solutions block that contained one), and
    // then it must not be followed.
    const text = visit(file, readFileSync(file, "utf8"), { inDoc: sawBeginDoc });
    const dir = path.dirname(mainFile);           // TeX resolves \input from the
    const slot = files.length;                    // main document's directory,
    files.push(null);                             // not the including file's
    let self = "", flat = "", pos = 0;
    for (const h of findInputs(text)) {
      self += text.slice(pos, h.start);
      flat += append(text.slice(pos, h.start));
      pos = h.end;
      if (h.include) {
        warn(`\\include{${h.arg}} is not followed — use \\input, or auto-labels `
           + "and the -nosol strip will miss everything in that file");
        self += text.slice(h.start, h.end);
        flat += text.slice(h.start, h.end);
        continue;
      }
      const child = resolveInput(dir, h.arg);
      if (!child) {
        warn(`\\input{${h.arg}} not found — file missing, content dropped`);
        continue;                                 // drop it from both shapes
      }
      self += childSuffix ? `\\input{${derivedArg(h.arg)}}` : text.slice(h.start, h.end);
      flat += walk(child, childSuffix ? path.join(dir, derivedArg(h.arg)) : child, depth + 1);
    }
    self += text.slice(pos);
    flat += append(text.slice(pos));
    files[slot] = { path: outPath, text: self };
    return flat;
  };

  const flat = walk(mainFile, mainFile, 0);
  return { files, flat };
}
