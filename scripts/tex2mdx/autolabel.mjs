/**
 * autolabel.mjs — synthetic \label injection, so every displayed number on
 * the web comes out of LaTeX's .aux instead of a simulated counter.
 *
 * The .aux only records what is \label'ed: an unlabeled theorem is numbered
 * in the PDF but leaves no readable trace. So both consumers of a worksheet
 * run the SAME injection over the whole document — main.tex and everything it
 * \inputs (injectAutoLabelsTree) — before doing anything else:
 *
 *   - build-content.mjs writes an injected copy of each source file alongside
 *     it (main.autolabel.tex, sections/foo.autolabel.tex) and compiles main's
 *     (with -jobname=main, so main.pdf/main.aux keep their names) — the .aux
 *     then carries a number for every numbered construct;
 *   - tex2mdx.mjs injects the identical text before parsing, so the emitter
 *     finds \label{iliad-auto-N} inside each construct and looks its number
 *     up in that .aux.
 *
 * Following \input matters: a multi-file worksheet keeps most of its content
 * in section files, and injecting into main.tex alone left every unlabeled
 * construct there falling back to a simulated counter.
 *
 * Determinism is the whole contract: same input text => same label names.
 * Injections are same-line, so file:line positions in pdflatex logs and
 * converter warnings still match main.tex. Auto-labels are invisible in the
 * PDF, never become web anchors, and never reach the downloads (those copy
 * the pristine main.tex).
 */
import { readOpt, readArg } from "./util.mjs";
import { transformInputTree } from "./texinput.mjs";

export const AUTO_PREFIX = "iliad-auto-";
export const isAutoLabel = (l) => typeof l === "string" && l.startsWith(AUTO_PREFIX);

// built-in constructs whose number the web displays (THM_COUNTED in
// emit-ast.mjs, plus exercise; remark is included — harmless when a sheet
// leaves remarks unnumbered, its label just goes unread)
const BUILTIN_NUMBERED = [
  "theorem", "lemma", "proposition", "corollary", "fact", "definition", "example",
  "exercise", "remark",
];
const HEADING = /^\\(section|subsection|subsubsection)(?=[[{\s])/;
// regions where "\begin{theorem}" is literal text, not a construct
const VERBATIM = new Set(["verbatim", "Verbatim", "lstlisting", "alltt", "minted", "comment"]);

// numbered environments this sheet uses: built-ins + author-declared theorem
// envs (same declarations tex2mdx reads for its callout mapping; a starred
// \newtheorem* is unnumbered, so it is deliberately not matched)
function numberedEnvs(tex) {
  const envs = new Set(BUILTIN_NUMBERED);
  for (const m of tex.matchAll(/\\declaretheorem\s*(?:\[[^\]]*\])?\s*\{([a-zA-Z]+)\}/g)) envs.add(m[1]);
  for (const m of tex.matchAll(/\\newtheorem\{([a-zA-Z]+)\}/g)) envs.add(m[1]);
  return envs;
}

// Returns { text, labels } — labels in document order. Comment- and
// verbatim-aware; only the document body (after \begin{document}) is touched.
//
// opts lets a caller run the injection across a multi-file worksheet, one file
// at a time, without the numbering restarting (see injectAutoLabelsTree):
//   startN — number to continue from, so labels stay unique document-wide
//   inDoc  — true for a file reached via \input, which has no \begin{document}
//            of its own but is nonetheless inside the body
// `envs` is also accepted, because the \newtheorem declarations live in
// main.tex's preamble and a section file must be told about them.
export function injectAutoLabels(tex, opts = {}) {
  const envs = opts.envs ?? numberedEnvs(tex);
  const labels = [];
  let out = "", i = 0, n = opts.startN ?? 0;
  let inDoc = opts.inDoc ?? false, verb = null;

  const nextLabel = () => { const l = `${AUTO_PREFIX}${++n}`; labels.push(l); return l; };

  while (i < tex.length) {
    const c = tex[i];
    if (c !== "\\") {
      if (c === "%" && !verb) {           // comment: copy to end of line
        const eol = tex.indexOf("\n", i);
        const end = eol === -1 ? tex.length : eol + 1;
        out += tex.slice(i, end); i = end; continue;
      }
      out += c; i++; continue;
    }

    // at a backslash
    if (verb) {                           // only \end{<verb>} matters here
      const closer = `\\end{${verb}}`;
      if (tex.startsWith(closer, i)) { out += closer; i += closer.length; verb = null; }
      else { out += tex[i] + (tex[i + 1] ?? ""); i += 2; }
      continue;
    }
    if (tex.startsWith("\\verb", i)) {    // \verb<delim>...<delim> (also \verb*)
      let j = i + 5;
      if (tex[j] === "*") j++;
      const d = tex[j];
      const close = d != null ? tex.indexOf(d, j + 1) : -1;
      const end = close === -1 ? j + 1 : close + 1;
      out += tex.slice(i, end); i = end; continue;
    }

    let m = /^\\begin\{([a-zA-Z*]+)\}/.exec(tex.slice(i));
    if (m) {
      const env = m[1];
      out += m[0]; i += m[0].length;
      if (env === "document") inDoc = true;
      else if (VERBATIM.has(env)) verb = env;
      else if (inDoc && envs.has(env)) {
        // the optional arg (title) must stay directly after \begin{env}
        const o = readOpt(tex, i);
        if (o) { out += tex.slice(i, o.end); i = o.end; }
        out += `\\label{${nextLabel()}}`;
      }
      continue;
    }

    m = HEADING.exec(tex.slice(i));                     // starred = unnumbered,
    if (inDoc && m) {                                   // excluded by the regex
      let j = i + m[0].length;
      const o = readOpt(tex, j);                        // \section[short]{title}
      if (o) j = o.end;
      const g = readArg(tex, j);
      if (g) {
        out += tex.slice(i, g.end) + `\\label{${nextLabel()}}`;
        i = g.end; continue;
      }
    }

    out += tex[i] + (tex[i + 1] ?? ""); i += 2;         // any other \x escape
  }
  return { text: out, labels, endN: n };
}

/**
 * The same injection, across a whole worksheet including everything it
 * \inputs. Single-file sheets behave exactly as before; multi-file sheets now
 * get labels inside their section files too, which is what lets the converter
 * read those numbers from the .aux instead of simulating them.
 *
 * Returns transformInputTree's { files, flat } plus the label list. Callers
 * that compile take `files` (the file split survives, so pdflatex's file:line
 * diagnostics still point at real sources); callers that parse take `flat`.
 *
 * Every consumer must come through here: the label a construct gets depends on
 * the walk order, and the .aux is only readable by the converter if both sides
 * agree on it.
 *
 * `postProcess` runs AFTER injection (the converter strips comments there), so
 * it cannot perturb which construct gets which label. `onFile` sees each
 * file's final text, for callers that track source positions.
 */
export function injectAutoLabelsTree(mainFile, { warn = () => {}, postProcess = null, onFile = null } = {}) {
  const labels = [];
  let n = 0, envs = null;
  const { files, flat } = transformInputTree(mainFile, {
    childSuffix: ".autolabel",
    warn,
    visit: (file, raw, { inDoc }) => {
      // \newtheorem lives in main.tex's preamble, so a section file would
      // otherwise not know which of its environments are numbered. main.tex is
      // visited first, so its declarations are in hand by the time one is
      // reached — and a sheet that declares more later still contributes them.
      envs = envs === null ? numberedEnvs(raw) : new Set([...envs, ...numberedEnvs(raw)]);
      const r = injectAutoLabels(raw, { startN: n, inDoc, envs });
      n = r.endN;
      labels.push(...r.labels);
      const text = postProcess ? postProcess(r.text) : r.text;
      onFile?.(file, text);
      return text;
    },
  });
  return { files, flat, labels };
}
