/**
 * emit-ast.mjs — the parse+emit stage, built on unified-latex's typed AST.
 * Replaces the old string-scanning emitter: no regex parsing of LaTeX here.
 *
 * Contract with the caller (tex2mdx.mjs):
 *   emitDocument(bodyTex, ctx) -> mdx string
 * ctx: { refs, CREF_NAME, declaredThms, commentCmds, BIB, warnFrontKeys... }
 * Math bodies are handled as raw strings via printRaw + the shims pipeline —
 * byte-faithful, exactly like the old converter.
 */
import { getParser } from "@unified-latex/unified-latex-util-parse";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import { listNewcommands } from "@unified-latex/unified-latex-util-macros";
import { warn, advise, snippetOf, warnings, advisories } from "./state.mjs";
import { isAutoLabel } from "./autolabel.mjs";
import { applyMathShims } from "./shims.mjs";
import { slug, ghSlug, readGroup, readOpt, readArg, NEST, CHILD } from "./util.mjs";
import { registerTikz } from "./tikz.mjs";

// ---------------------------------------------------------------- tables ---
// simple textual macro translations (no argument handling)
const TEXT_MACROS = {
  ldots: "...", dots: "...", textellipsis: "...",
  S: "§", LaTeX: "LaTeX", TeX: "TeX", ae: "\\ae",
  quad: " ", qquad: " ", enspace: " ", thinspace: " ", ",": " ", " ": " ",
  ";": " ", "!": "", ":": " ", "\n": " ", "'": "", "@": "", "`": "", "^": "",
  '"': "", "~": "",
  "\\": "\n", "%": "%", "&": "&", "#": "#", _: "_",
  // A literal dollar in prose: \$1,000 in the source. What it must NOT reach the
  // page as is a bare $, which remark-math reads as a math delimiter — two prices
  // in a paragraph ("wins \$1,000,000 … and wins \$1,000") then become one bogus
  // math span. `\$` is the fix and stays `\$`: $ is ASCII punctuation, so it is
  // one of the characters a CommonMark backslash escape covers, and micromark
  // consumes the escape before the math extension can see a delimiter.
  // (Inside a math body the escape does not apply — the body is raw, so a $ byte
  // would end the span — which is why shims.mjs swaps in \char36 there instead.)
  $: "\\$",
  "{": "\\{", "}": "\\}",
  // The text-mode names for characters LaTeX reserves. An author reaches for
  // these whenever a sentence contains a pipe or an angle bracket, and pandoc
  // emits them for every such character when a Markdown document is converted.
  textbar: "|", textgreater: ">", textless: "<", textbackslash: "\\",
  textasciitilde: "~", textasciicircum: "^", textquotesingle: "'",
};
// macros dropped with NO arguments consumed
const NOOP_MACROS = new Set([
  "maketitle", "centering", "solutionstrue", "solutionsfalse",
  "allowdisplaybreaks", "phantomsection", "sloppy", "AND", "And", "name",
  "height", "width", "depth", "centerline", "noindent", "medskip", "smallskip",
  "bigskip", "hfill", "hfil", "vfill", "vfil", "null", "clearpage", "newpage",
  "par", "today", "itemsep", "protect", "qedhere", "appendix",
  "LARGE", "Large", "large", "small", "footnotesize", "scriptsize", "normalsize",
  "bfseries", "itshape", "sffamily", "ttfamily", "rmfamily",
  "bgroup", "egroup", "begingroup", "endgroup", "ignorespaces",
  "thesection", "thesubsection", "let",
  "listoftheorems", "pagebreak", "linebreak", "nolinebreak", "nopagebreak",
]);
// macros dropped WITH their arguments (count = number of mandatory args)
const DROP_WITH_ARGS = {
  label: 1, bibliographystyle: 1, bibliography: 1, input: 1, Alph: 1,
  arabic: 1, roman: 1, vspace: 1, hspace: 1, vskip: 1, thispagestyle: 1,
  addvspace: 1, pagestyle: 1, setlength: 2, setcounter: 2, addtocounter: 2,
  addcontentsline: 3, addtocontents: 2, color: 1, email: 1, addr: 1,
  title: 1, author: 1, date: 1, usetikzlibrary: 1, hline: 0,
  renewcommand: 2, newcommand: 2, providecommand: 2, def: 0,
  declareauthor: 3, authorcommand: 2, refstepcounter: 1,
  crefname: 3, Crefname: 3, crefalias: 2,
};
// contract + structural environment signatures for the parser
const ENV_SIGNATURES = {
  exercise: { signature: "o" }, solution: { signature: "o" },
  callout: { signature: "o" }, proof: { signature: "o" },
  theorem: { signature: "o" }, lemma: { signature: "o" },
  proposition: { signature: "o" }, corollary: { signature: "o" },
  definition: { signature: "o" }, fact: { signature: "o" },
  example: { signature: "o" }, remark: { signature: "o" },
  teachingnote: { signature: "o" },
  learningoutcomes: {}, summary: {}, hint: {}, solutionsonly: {}, pdfonly: {},
  abstract: {}, figure: { signature: "o" }, table: { signature: "o" },
  tabular: { signature: "m" }, quote: {}, quotation: {},
  itemize: { signature: "o" }, enumerate: { signature: "o" }, description: { signature: "o" },
};
const CONTRACT_MACROS = {
  difficulty: { signature: "m" }, skippable: { signature: "" }, important: { signature: "" },
  hint: { signature: "m" }, note: { signature: "m" },
  texorpdfstring: { signature: "m m" }, eqref: { signature: "m" },
  citep: { signature: "o o m" }, citet: { signature: "o o m" },
  citealp: { signature: "o o m" }, citetext: { signature: "m" },
  nameref: { signature: "m" }, paragraph: { signature: "m" },
  raisebox: { signature: "m o o m" }, textcolor: { signature: "m m" },
  mbox: { signature: "m" }, makebox: { signature: "o m" }, fbox: { signature: "m" },
  ifdef: { signature: "m m m" }, ifdefined: { signature: "m m m" }, ifcsdef: { signature: "m m m" },
  crefrange: { signature: "m m" }, Crefrange: { signature: "m m" },
  href: { signature: "o m m" },   // \href[opts]{url}{text}
  youtube: { signature: "o m" },  // \youtube[Title]{VIDEO_ID}
  // cleveref config — unknown to unified-latex, so the parser needs the
  // signature or the three brace groups survive as literal text
  crefname: { signature: "m m m" }, Crefname: { signature: "m m m" },
  // \crefalias{counter}{type} — labels made under the alias reach us with the
  // aliased type already stamped in the .aux, so dropping the declaration is
  // all the converter has to do
  crefalias: { signature: "m m" },
};
const THM_COUNTED = new Set(["theorem", "lemma", "proposition", "corollary", "fact", "definition", "example"]);

// ------------------------------------------------------------- run state ---
let ctx = null;                 // caller-supplied context
let anchorMap = {};             // label -> anchor
let droppedLabels = new Set();  // labels inside dropped pdfonly blocks
let authorMacros = {};          // name -> {signature, body(nodes)}
let expandDepth = 0;
let counters = null;
// inside an exercise or solution body — iliad.sty letters both environments'
// first-level enumerates (a),(b),… (level 1 of \iliad@exlists and the solution
// env's own \setlist), so the converter marks their parts the same way.
let letteredParts = false;
let listDepth = 0;             // \item nesting: >0 means this list sits inside an item
let citedKeys = new Set();      // bib keys cited anywhere on the page
let footnotes = [];             // {id, body} in source order; body null until \footnotetext

const secNum = () => (counters.appendix ? String.fromCharCode(64 + counters.section) : String(counters.section));

// ------------------------------------------------------------ math paths ---
function mathClean(m) {
  m = applyMathShims(m);
  // resolve \cref/\ref/\cite inside math to plain text; unwrap \resizebox
  let out = "", i = 0;
  while (i < m.length) {
    if (m.startsWith("\\resizebox", i)) {
      let j = i + 10; for (let k = 0; k < 2; k++) { const g = readArg(m, j); j = g ? g.end : j; }
      const g3 = readArg(m, j); j = g3 ? g3.end : j;
      out += (g3 ? g3.content : "").replace(/\\displaystyle/g, "").replace(/\$/g, ""); i = j; continue;
    }
    const cr = (m.startsWith("\\Cref", i) || m.startsWith("\\cref", i)) ? 5 : (m.startsWith("\\ref", i) && m[i + 4] === "{") ? 4 : 0;
    if (cr) { const g = readArg(m, i + cr); if (g) { out += g.content.split(",").map((l) => resolveRef(l.trim()).text).join(" and "); i = g.end; continue; } }
    if (m.startsWith("\\cite", i)) { let j = i + 5; const o = readOpt(m, j); if (o) j = o.end; const g = readArg(m, j); if (g) { const e = ctx.BIB[g.content.trim()]; if (e) citedKeys.add(g.content.trim()); out += e ? e.disp : g.content.trim(); i = g.end; continue; } }
    out += m[i]; i++;
  }
  return out;
}

function mathEnvToDollar(name, inner) {
  inner = mathClean(inner);
  inner = inner.replace(/\\label\{[^}]*\}/g, "");
  if (/^align\*?$|^alignat\*?$|^gather\*?$/.test(name)) {
    const env = name.replace(/\*$/, "") === "gather" ? "gathered" : "aligned";
    if (inner.includes("\\intertext")) {
      // split into displays around the prose
      const parts = [];
      let rest = inner;
      for (;;) {
        const idx = rest.indexOf("\\intertext");
        if (idx < 0) { parts.push({ math: rest }); break; }
        const g = readArg(rest, idx + 10);
        if (!g) { parts.push({ math: rest }); break; }
        parts.push({ math: rest.slice(0, idx), text: g.content });
        rest = rest.slice(g.end);
      }
      return parts.map((p) => {
        const mm = p.math.replace(/\\\\\s*$/, "").trim();
        let s = mm ? `$$\n\\begin{${env}}${mm}\\end{${env}}\n$$` : "";
        if (p.text != null) s += `\n\n${p.text.trim()}\n\n`;
        return s;
      }).join("");
    }
    // \tag inside aligned is illegal in KaTeX: render as right-hand annotations
    let inner2 = "";
    for (let i = 0; i < inner.length; i++) {
      if (inner.startsWith("\\tag", i)) {
        let j = i + 4; if (inner[j] === "*") j++;
        const g = readArg(inner, j);
        if (g) { inner2 += `\\quad\\text{(${g.content})}`; i = g.end - 1; continue; }
      }
      inner2 += inner[i];
    }
    return `$$\n\\begin{${env}}${inner2}\\end{${env}}\n$$`;
  }
  return `$$\n${inner.trim()}\n$$`;
}

// display body containing a diagram: render whole body as one SVG
function tikzDisplay(inner) {
  const lab = inner.match(/\\label\{([^}]*)\}/);
  const body = inner.replace(/\\label\{[^}]*\}/g, "").trim();
  const { src } = registerTikz(body, true);
  const fig = `<Figure src="${src}" alt="diagram" />`;
  if (lab) { anchorMap[lab[1]] = slug(lab[1]); return `\n\n<div id="${slug(lab[1])}">\n${fig}\n</div>\n\n`; }
  return `\n\n${fig}\n\n`;
}

function displayMath(envName, rawInner) {
  if (/\\begin\{tikz(picture|cd)\}/.test(rawInner)) return tikzDisplay(rawInner);
  const lab = rawInner.match(/\\label\{([^}]*)\}/);
  const math = mathEnvToDollar(envName, rawInner);
  if (lab) { anchorMap[lab[1]] = slug(lab[1]); return `\n\n<div id="${slug(lab[1])}">\n\n${math}\n\n</div>\n\n`; }
  return `\n\n${math}\n\n`;
}

// -------------------------------------------------------------- cross-refs ---
function resolveRef(label) {
  const r = ctx.refs[label];
  const anchor = anchorMap[label] ?? slug(label);
  if (!r) { warn(`unresolved \\cref/\\ref: ${label}`, label); return { text: label, num: label, anchor }; }
  return { text: r.name ? `${r.name} ${r.num}` : r.num, num: r.num, anchor };
}

// In-text citation: author-year text linking to the entry in the
// page-bottom References list (never straight to the external URL — the
// URL is clickable from the entry itself).
function citeLink(key) {
  const e = ctx.BIB[key];
  if (!e) { warn(`unknown \\cite key: ${key}`, `{${key}}`); return key; }
  citedKeys.add(key);
  return `[${e.disp}](#bib-${slug(key)})`;
}

function crefLinks(csv, keepFirstNameOnly) {
  const labels = csv.split(",").map((x) => x.trim()).filter(Boolean);
  if (labels.length === 0) { warn("empty \\cref{} with no labels — dropped", "\\cref{}"); return ""; }
  const rr = labels.map(resolveRef);
  if (rr.length === 1) return `[${rr[0].text}](#${rr[0].anchor})`;
  const name0 = rr[0].text.replace(/\s.*$/, "");
  const parts = rr.map((r, k) => {
    const sameType = r.text.replace(/\s.*$/, "") === name0;
    return `[${k === 0 || !sameType ? r.text : r.text.replace(/^\w+\s/, "")}](#${r.anchor})`;
  });
  // Prose list, like cleveref's own: "A and B", "A, B and C".
  return parts.length === 2
    ? parts.join(" and ")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// --------------------------------------------------------------- helpers ---
const argRaw = (n, i) => (n.args && n.args[i] && n.args[i].content.length ? printRaw(n.args[i].content) : null);
const lastArgRaw = (n) => (n.args && n.args.length ? printRaw(n.args[n.args.length - 1].content) : null);
const walkArg = (n, i) => (n.args && n.args[i] ? walk(n.args[i].content) : "");

// The [..] argument of a macro, wherever the parser put it. unified-latex gives
// \item three argument slots — two empty positional ones around the bracketed
// group — so indexing args[0] silently misses every \item[label].
const bracketArg = (n) => {
  const a = (n.args ?? []).find((x) => x.openMark === "[" && x.content.length);
  return a ? printRaw(a.content) : null;
};

// plain text for JSX attributes. A JSX attribute is an inert string: KaTeX
// never sees it, so math cannot survive here — dropping it silently turned
// "point A ($h_A \approx 0.03$)" into "point A ()" on the page. Where the
// attribute is the only option (a box title, an <img alt>) that is worth an
// advisory; `quiet` suppresses it for alt text, whose caption is emitted
// separately as renderable children.
function mdToPlain(md, quiet = false) {
  const s = md.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const hadMath = /\$\$?[^$]*\$\$?/.test(s);
  const out = s
    .replace(/\$\$?[^$]*\$\$?/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ").trim();
  if (!quiet && hadMath) {
    advise(`math is dropped from "${out.slice(0, 70)}" — it becomes a plain attribute (a box title, or the page title), which cannot render math; reword it in words`, snippetOf(s));
  }
  return out;
}
const toPlain = (nodesOrStr, quiet) =>
  mdToPlain(typeof nodesOrStr === "string" ? walkStr(nodesOrStr) : walk(nodesOrStr), quiet)
    .replace(/"/g, "'");
const attr = (nodesOrStr) => toPlain(nodesOrStr, false);
const attrQuiet = (nodesOrStr) => toPlain(nodesOrStr, true);

function walkStr(texStr) {           // parse a raw string fragment and walk it
  return walk(parser().parse(texStr).content);
}

// item text beginning with display math must paragraph-break after the marker;
// text already opening on its own line (a nested list) keeps that break as-is
const itemJoin = (lead, txt) =>
  txt.startsWith("$$") ? `${lead}\n\n${txt}` : txt.startsWith("\n") ? `${lead}${txt}` : `${lead} ${txt}`;

// The \label bound to the environment itself: the first \label at the TOP
// LEVEL of the env body. LaTeX binds any top-level \label to the environment
// (labels inside nested enumerates/equations bind to those instead, so we
// don't descend). Placement is the author's choice; right after \begin is
// merely the clearest style. Injected auto-labels (autolabel.mjs) are skipped:
// they carry the aux number but must never become the env's identity/anchor.
function leadingLabel(nodes) {
  for (const n of nodes) {
    if (n.type === "macro" && n.content === "label") {
      const l = lastArgRaw(n);
      if (l && !isAutoLabel(l)) return l;
    }
  }
  return null;
}
// the injected auto-label, if the environment has one (top level, like above)
function autoLabelOf(nodes) {
  for (const n of nodes) {
    if (n.type === "macro" && n.content === "label") {
      const l = lastArgRaw(n);
      if (isAutoLabel(l)) return l;
    }
  }
  return null;
}
// Displayed number for a numbered construct: the author's label or the
// injected auto-label resolved through the .aux (both name the same counter
// value). `sim` is the counter-simulated fallback — reached only when the
// construct has no aux entry at all (an env expanded from an author macro,
// or an aux that predates auto-labels and could not be regenerated).
function displayNum(nodes, label, sim, what) {
  const num = (label && ctx.refs[label]?.num) || ctx.refs[autoLabelOf(nodes) ?? ""]?.num;
  if (num) return num;
  warn(`displayed number for ${what} not found in the .aux — using a simulated counter, which can drift from the PDF`, snippetOf(printRaw(nodes)));
  return sim;
}
function allLabels(nodes) {
  const out = [];
  const rec = (ns) => ns.forEach((n) => {
    if (n.type === "macro" && n.content === "label") { const l = lastArgRaw(n); if (l) out.push(l); }
    if (Array.isArray(n.content)) rec(n.content);
    if (n.args) n.args.forEach((a) => rec(a.content));
  });
  rec(nodes);
  return out;
}
// consume leading contract mark macros (\important, plus the legacy
// \difficulty / \skippable) from nodes
function takeMarks(nodes) {
  let dd = "", star = false, skip = false;
  const rest = [];
  let scanning = true;
  for (const n of nodes) {
    if (scanning && (n.type === "whitespace" || n.type === "parbreak")) { rest.push(n); continue; }
    if (scanning && n.type === "macro" && n.content === "difficulty") { dd = (lastArgRaw(n) ?? "").trim(); continue; }
    if (scanning && n.type === "macro" && n.content === "important") { star = true; continue; }
    if (scanning && n.type === "macro" && n.content === "skippable") { skip = true; continue; }
    if (scanning && n.type === "macro" && n.content === "label") { rest.push(n); continue; }
    scanning = false;
    rest.push(n);
  }
  return { dd, star, skip, rest };
}

// ------------------------------------------------------------------ lists ---
// Nodes before the first \item are discarded. Only list-parameter setup lives
// there legitimately (\itemsep=2pt, the \setlength pair \tightlist expands to);
// real body text is a LaTeX error ("Something's wrong--perhaps a missing
// \item") that fails the PDF build before the converter ever runs, so there is
// nothing here for us to police.
function splitItems(nodes) {
  const items = []; let cur = null;
  for (const n of nodes) {
    if (n.type === "macro" && n.content === "item") {
      if (cur) items.push(cur);
      cur = { optLabel: bracketArg(n), nodes: [] };
      continue;
    }
    if (cur) cur.nodes.push(n);
  }
  if (cur) items.push(cur);
  return items;
}

// Place a nested list inside the item that owns it. Two cases, and the CHILD
// tags the child left mark its lines for both:
//
//   attached — nothing has closed the item yet, so indent the child's lines and
//     everything after them to the content column this item's own marker sets
//     ("1. " -> 3). Prose resuming after the child also needs a blank line, or
//     Markdown reads it as a lazy continuation of the *child's* last item.
//   detached — a blank line earlier in the item means an unindented block (a
//     display-math fence, say) has already ended it as far as Markdown is
//     concerned. The child is a top-level block, not ours to indent; fence it
//     with blank lines so the prose around it does not fold into the list.
//
// Lines before any nested list are left alone in both cases: lazy continuation
// already keeps them in the item, and re-indenting them is pure churn.
function indentBody(item, width) {
  const pad = NEST.repeat(width);
  const lines = item.split("\n");
  const first = lines.findIndex((l) => l.startsWith(CHILD));
  if (first === -1) return item;          // no nested list: nothing to place
  const last = lines.reduce((at, l, i) => (l.startsWith(CHILD) ? i : at), -1);
  const attached = !lines.slice(0, first).includes("");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const isChild = lines[i].startsWith(CHILD);
    const line = lines[i].replace(CHILD, "");
    if (!attached) {
      if ((i === first || i === last + 1) && line !== "" && out.at(-1) !== "") out.push("");
      out.push(line);
    } else if (i === 0 || (!isChild && i < first)) {
      out.push(line);
    } else {
      if (line !== "" && !isChild && lines[i - 1].startsWith(CHILD)) out.push("");
      out.push(line === "" ? "" : pad + line);
    }
  }
  return out.join("\n");
}

function emitList(env, n) {
  const items = splitItems(n.content);
  const letters = env === "enumerate" && letteredParts;
  // \item[(i)] *replaces* LaTeX's marker: the list prints the author's labels
  // and no bullets. Emit a list whose every item carries one the way an
  // exercise's lettered parts already are — bold label, no marker — rather than
  // stacking a bullet in front of the label written to stand in for it.
  const labelled = items.length > 0 && items.every((it) => it.optLabel);
  const bare = letters || labelled;
  const wasIn = letteredParts; letteredParts = false;
  listDepth++;
  const out = items.map((it, k) => {
    // The label is markdown body text, not a JSX attribute, so it is walked
    // (not flattened through attr) and its math renders like any other. Bold
    // it the way LaTeX's own list styling does — unless the author already
    // marked it up (\item[\textbf{[00]}]), where another ** would nest and
    // emit literal asterisks.
    const lab = it.optLabel ? walkStr(it.optLabel).trim() : null;
    const lead = lab ? (/[*_`]/.test(lab) ? `${lab} ` : `**${lab}** `) : "";
    // An item whose body opens with a nested list (\item then \begin{enumerate})
    // gets a newline of its own: trimming to the child's first tagged line would
    // glue that line's marker onto ours.
    const body = walk(it.nodes);
    const txt = new RegExp(`^\\s*${CHILD}`).test(body)
      ? `\n${body.trimStart()}`.replace(/\s+$/, "")
      : body.trim();
    // An explicit \item[..] wins over the synthesized (a)/(b) marker: it is
    // what the PDF prints, and authors use it to name parts they refer back to.
    if (bare) return indentBody(itemJoin((lead || `**(${String.fromCharCode(97 + k)})** `).trim(), txt), 0);
    const marker = env === "enumerate" ? `${k + 1}.` : "-";
    return indentBody(itemJoin(`${marker} ${lead}`.trim(), txt), marker.length + 1);
  }).join(bare ? "\n\n" : "\n");
  letteredParts = wasIn;
  listDepth--;
  // A list inside an \item is that item's child: hand it back tagged and
  // attached, for the item to indent to its own content column. Emitted as its
  // own top-level block it would read as a sibling list and the nesting would
  // be lost.
  if (listDepth > 0) return `\n${out.replace(/^(?!$)/gm, CHILD)}\n`;
  return `\n\n${out}\n\n`;
}

// ------------------------------------------------------------ environments ---
const envName = (n) => {
  const e = n.env;
  if (typeof e === "string") return e;
  if (Array.isArray(e)) return e.map((x) => x.content ?? "").join("");
  return e && typeof e === "object" ? (e.content ?? "") : String(e ?? "");
};

function emitEnv(n) {
  const env = envName(n);
  // math environments: recover raw source, use the string math pipeline
  if (/^(equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|displaymath)$/.test(env)) {
    return displayMath(env, printRaw(n.content));
  }
  if (env === "tikzpicture" || env === "tikzcd") {
    const opt = argRaw(n, 0);
    const envSrc = `\\begin{${env}}${opt != null ? `[${opt}]` : ""}\n${printRaw(n.content)}\n\\end{${env}}`;
    const { src } = registerTikz(envSrc, env === "tikzcd");
    return `\n\n<Figure src="${src}" alt="diagram" />\n\n`;
  }
  if (env === "itemize" || env === "enumerate" || env === "description") return emitList(env, n);
  if (env === "center") return walk(n.content);
  if (env === "quote" || env === "quotation") {
    return "\n\n" + walk(n.content).trim().split("\n").map((l) => (l ? "> " + l : ">")).join("\n") + "\n\n";
  }
  if (env === "abstract") return `\n\n**Abstract.** ${walk(n.content).trim()}\n\n`;
  // summary is hoisted into the frontmatter (tex2mdx.mjs); the page header
  // displays it, so it renders nothing in the body.
  if (env === "summary") return "";
  if (env === "verbatim" || env === "lstlisting" || env === "alltt") {
    return "\n\n```\n" + printRaw(n.content).trim() + "\n```\n\n";
  }
  if (env === "tabular") return emitTabular(n);
  if (env === "figure" || env === "table") return emitFigure(n);

  const label = leadingLabel(n.content);
  if (label) anchorMap[label] = slug(label);
  const id = label ? ` id="${slug(label)}"` : "";
  const opt = argRaw(n, 0);

  // theorem-family number: read from the .aux (author label or injected
  // auto-label — see displayNum); the counter is kept only as its fallback
  let thmNum = null;
  const declared = ctx.declaredThms[env];
  if (THM_COUNTED.has(env) || (env === "remark" && ctx.remarkNumbered) || (declared && !BUILTIN_ENVS.has(env))) {
    counters.thm[secNum()] = (counters.thm[secNum()] || 0) + 1;
    thmNum = displayNum(n.content, label, `${secNum()}.${counters.thm[secNum()]}`, env);
  }

  let mdx = null;
  switch (env) {
    case "exercise": {
      // A leading \difficulty renders as the same plain [n] the PDF prints —
      // no component attribute, no UI chrome, no validation (author's choice).
      const { dd, star, skip, rest } = takeMarks(n.content);
      counters.ex[secNum()] = (counters.ex[secNum()] || 0) + 1;
      const num = displayNum(n.content, label, `${secNum()}.${counters.ex[secNum()]}`, "exercise");
      const wasIn = letteredParts; letteredParts = true;
      const inner = walk(rest);
      letteredParts = wasIn;
      if (!label) advise(`exercise ${num} has no \\label — no stable anchor emitted, and no solution can reference it`, snippetOf(printRaw(n.content)));
      if (label) for (const l of allLabels(n.content)) if (!(l in anchorMap)) anchorMap[l] = slug(label);
      // ★ = \important (the sheet's key exercises); (∗) = legacy \skippable
      mdx = `<Exercise${id}>\n` +
        `**Exercise ${num}${star ? " (★)" : ""}${skip ? " (∗)" : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}${dd ? ` [${dd}]` : ""}.** ` +
        `${inner.trim()}\n</Exercise>`;
      break;
    }
    case "learningoutcomes": {
      // A plain box. The body is ordinary LaTeX: a single itemize of outcomes,
      // or several \subsection*{...} groups each with its own itemize. We just
      // walk it — but while inside, group headings (\subsection* etc.) render
      // as bold lines rather than real markdown headings, so they don't emit
      // page anchors or land in the table of contents (see emitHeading).
      const wasLO = inLearningOutcomes; inLearningOutcomes = true;
      const body = walk(n.content).trim();
      inLearningOutcomes = wasLO;
      mdx = `<LearningOutcomes>\n\n${body}\n\n</LearningOutcomes>`;
      break;
    }
    case "solution": {
      // `for` is a relocation marker, not part of the output: after the full
      // emit, relocateSolutions() moves every bound solution directly under
      // its exercise (the PDF keeps the authored placement; the web always
      // pairs them) and strips the attribute.
      let forAttr = "";
      if (opt) {
        const key = opt.trim();
        if (!ctx.refs[key]) warn(`solution names [${key}] but no such label exists in the sheet`, `[${key}]`);
        forAttr = ` for="${anchorMap[key] ?? slug(key)}"`;
      } else {
        warn("solution without [ex:label] — every solution must name its exercise", snippetOf(printRaw(n.content)));
      }
      // A solution's first-level enumerate letters its parts (a),(b),… exactly
      // as the exercise's does (iliad.sty sets the same \setlist in both), so
      // the parts line up with the exercise they answer and with the in-text
      // "part (a)" references.
      const wasIn = letteredParts; letteredParts = true;
      const body = walk(n.content).trim();
      letteredParts = wasIn;
      mdx = `<Solution${forAttr}>\n\n${body}\n\n</Solution>`;
      break;
    }
    case "solutionsonly":
      // Content shown only in the solutions build. Rendered as plain inline
      // content, bracketed by invisible JSX-comment markers so the -nosol
      // stripper (stripMdxSolutions) can remove the whole span.
      mdx = `{/* iliad:solutionsonly:start */}\n\n${walk(n.content).trim()}\n\n{/* iliad:solutionsonly:end */}`;
      break;
    case "pdfonly":
      // Content kept in both PDF variants but absent from the web: dropped
      // whole, unwalked, so nothing inside (headings, anchors, \crefs) leaks
      // into the page, the TOC, or the .mdx downloads. Labels defined inside
      // are recorded: a \cref to one from visible prose resolves via the aux
      // and would silently emit a dead link, so emitDocument advises on it.
      for (const l of allLabels(n.content)) droppedLabels.add(l);
      mdx = "";
      break;
    // Definition/theorem family render axiom-style: a bold markdown lead
    // inside the coloured box (math in titles renders; no header chrome).
    case "definition":
      mdx = `<Definition${id}>\n\n**Definition${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Definition>`;
      break;
    case "theorem": case "lemma": case "proposition": case "corollary": {
      const kindName = env.charAt(0).toUpperCase() + env.slice(1);
      mdx = `<Theorem${id}>\n\n**${kindName}${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Theorem>`;
      break;
    }
    case "fact":
      mdx = `<Callout type="note">\n\n**Fact${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      break;
    case "remark":
      mdx = `<Callout type="note">\n\n**Remark${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      break;
    case "example":
      mdx = `<Callout type="tip">\n\n**Example${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      break;
    case "callout": {
      const type = ["note", "tip", "warning"].includes((opt ?? "").trim()) ? opt.trim() : "note";
      mdx = `<Callout type="${type}"${id}>\n\n${walk(n.content).trim()}\n\n</Callout>`;
      break;
    }
    case "proof":
      mdx = `<Solution title="${opt ? attr(opt) : "Proof"}">\n\n${walk(n.content).trim()}\n\n</Solution>`;
      break;
    // hint environment — its own component, NOT <Solution title="Hint">:
    // hints are unbound (never relocated) and must survive the -nosol
    // variants, whose stripper removes every <Solution> block.
    case "hint":
      mdx = `<Hint>\n\n${walk(n.content).trim()}\n\n</Hint>`;
      break;
    // teaching note — teacher-facing, so its own component and not a Callout:
    // <TeachingNote> is collapsed and carries data-component="teaching-note",
    // which keeps that material findable. The optional argument is the label on
    // the closed box; the component's own default supplies it when absent.
    case "teachingnote":
      mdx = `<TeachingNote${opt ? ` title="${attr(opt)}"` : ""}>\n\n${walk(n.content).trim()}\n\n</TeachingNote>`;
      break;
    default: {
      if (declared) {
        mdx = `<Callout type="note">\n\n**${declared}${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      } else {
        warn(`unknown environment "${env}" — wrapper dropped, contents converted as plain prose`, `\\begin{${env}}`);
        mdx = `{/* TODO(tex2mdx): env ${env} */}\n${walk(n.content)}`;
      }
    }
  }
  if (label && /^<Callout/.test(mdx)) mdx = `<div id="${slug(label)}">\n${mdx}\n</div>`;
  return `\n${mdx}\n`;
}

const BUILTIN_ENVS = new Set(Object.keys(ENV_SIGNATURES).concat([
  "tikzpicture", "tikzcd", "center", "verbatim", "lstlisting", "alltt",
]));

function emitTabular(n) {
  const rows = [];
  const content = printRaw(n.content).replace(/\\hline|\\toprule|\\midrule|\\bottomrule/g, "");
  const cells = (row) => {
    const cs = []; let c = "", d = 0;
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (ch === "\\" && row[k + 1]) { c += ch + row[++k]; continue; }
      if (ch === "{") d++; if (ch === "}") d--;
      if (ch === "&" && d === 0) { cs.push(c); c = ""; continue; }
      c += ch;
    }
    cs.push(c); return cs;
  };
  for (const row of content.split("\\\\")) if (row.trim()) rows.push(cells(row));
  if (!rows.length) return "";
  const md = rows.map((r) => `| ${r.map((c) => walkStr(c).trim().replace(/\n+/g, " ")).join(" | ")} |`);
  md.splice(1, 0, `|${" --- |".repeat(rows[0].length)}`);
  return `\n\n${md.join("\n")}\n\n`;
}

function emitFigure(n) {
  const raw = printRaw(n.content);
  const im = raw.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/);
  const cm = raw.match(/\\caption\{/);
  let caption = "";
  if (cm) { const g = readGroup(raw, cm.index + cm[0].length - 1); caption = g ? g.content : ""; }
  const fl = raw.match(/\\label\{([^}]*)\}/);
  const figLabel = fl ? fl[1] : null;
  if (figLabel) anchorMap[figLabel] = slug(figLabel);
  let src;
  if (im) {
    const base = im[1].split("/").pop().replace(/\.(pdf|eps)$/i, ".svg");
    src = `${ctx.tikzSrc}${base}`;
  } else {
    const tm = raw.match(/\\begin\{(tikzpicture|tikzcd)\}/);
    if (!tm) { warn("figure with no \\includegraphics or tikz content omitted", snippetOf(raw)); return `\n<Callout type="note">\n_[Figure omitted in conversion — see the source PDF.]_\n</Callout>\n`; }
    const tEnv = tm[1];
    const tEnd = raw.indexOf(`\\end{${tEnv}}`);
    src = registerTikz(raw.slice(tm.index, tEnd + `\\end{${tEnv}}`.length), tEnv === "tikzcd").src;
  }
  // The caption is emitted as CHILDREN so it goes through the MDX pipeline and
  // its math renders; only `alt` stays flattened, because HTML alt text cannot
  // hold math at all (attrQuiet, so that inherent loss draws no advisory).
  const capMd = caption ? walkStr(caption).trim() : "";
  const altMd = caption ? attrQuiet(caption) : "";
  const fig = capMd
    ? `<Figure src="${src}" alt="${altMd || "figure"}">\n\n${capMd}\n\n</Figure>`
    : `<Figure src="${src}" alt="figure" />`;
  return `\n${figLabel ? `<div id="${slug(figLabel)}">\n${fig}\n</div>` : fig}\n`;
}

// A \texttt{} body is code, so it lands in a Markdown code span verbatim — but
// "verbatim" is the *characters the author meant*, not the LaTeX that spells
// them. Inside \texttt one still has to write \_ for an underscore, {[} for a
// bracket that would otherwise start an optional argument, \textbar{} for a
// pipe; pandoc emits all of these when it converts a Markdown code span. Passing
// the raw source through put that spelling on the page: a formula written
// `a* = argmax_a E[U | do(A=a)]` in the source displayed as
// a*\ =\ argmax\_a\ E{[}U\ \textbar{}\ do(A=a){]}.
const TEXTTT_UNESCAPE = [
  [/\\textbackslash\{\}|\\textbackslash\b/g, "\\"],   // first: it introduces no others
  [/\\textbar\{\}|\\textbar\b/g, "|"],
  [/\\textgreater\{\}|\\textgreater\b/g, ">"],
  [/\\textless\{\}|\\textless\b/g, "<"],
  [/\\textasciitilde\{\}|\\textasciitilde\b/g, "~"],
  [/\\textasciicircum\{\}|\\textasciicircum\b/g, "^"],
  [/\\textquotesingle\{\}|\\textquotesingle\b/g, "'"],
  [/\{\[\}/g, "["], [/\{\]\}/g, "]"],
  [/\\([_${}&#%~^])/g, "$1"],
  [/\\ /g, " "],                                       // pandoc's escaped space
];
const texttt = (s) => TEXTTT_UNESCAPE.reduce((acc, [re, to]) => acc.replace(re, to), s);

// ---------------------------------------------------------------- macros ---
function emitMacro(n) {
  const name = n.content;
  if (name in TEXT_MACROS) return TEXT_MACROS[name];
  if (NOOP_MACROS.has(name)) return "";
  if (name in DROP_WITH_ARGS) return "";   // body \newcommands already harvested in phase A
  if (ctx.commentCmds.has(name)) return "";

  switch (name) {
    case "textbf": return `**${walkArg(n, 0)}**`;
    case "emph": case "textit": case "textsl": return `*${walkArg(n, 0)}*`;
    case "texttt": return "`" + texttt(lastArgRaw(n) ?? "") + "`";
    case "textnormal": case "textrm": case "textup": case "textsf": case "textsc": case "textmd":
      return walkArg(n, 0);
    case "textcolor": return walkArg(n, 1);
    case "raisebox": return walkArg(n, 3);
    case "mbox": case "fbox": return walkArg(n, 0);
    case "makebox": return walkArg(n, 1);
    case "texorpdfstring": return walkArg(n, 0);
    case "href": {
      // \href[opts]{url}{text}: unified-latex's signature is "o m m", so the
      // url is the second-to-last arg and the text the last. Compute from the
      // arg count so this is robust whether or not the optional slot is present.
      const k = n.args ? n.args.length : 0;
      const url = (k >= 2 ? argRaw(n, k - 2) : null) ?? "";
      const txt = (k >= 1 ? walkArg(n, k - 1).trim() : "") || url;
      return `[${txt}](${url})`;
    }
    case "url": return `<${lastArgRaw(n) ?? ""}>`;
    case "cref": case "Cref": return crefLinks(lastArgRaw(n) ?? "");
    case "ref": { const r = resolveRef((lastArgRaw(n) ?? "").trim()); return `[${r.text.replace(/^\w+\s/, "")}](#${r.anchor})`; }
    case "eqref": { const r = resolveRef((lastArgRaw(n) ?? "").trim()); return `[(${r.num})](#${r.anchor})`; }
    case "nameref": { const r = resolveRef((lastArgRaw(n) ?? "").trim()); return `[${r.text}](#${r.anchor})`; }
    case "crefrange": case "Crefrange": {
      const ra = resolveRef((argRaw(n, 0) ?? "").trim()); const rb = resolveRef((argRaw(n, 1) ?? "").trim());
      const plural = ra.text.replace(/^(\w+)\s.*/, "$1") + "s";
      return `[${plural} ${ra.num ?? ""}–${rb.text.replace(/^\w+\s/, "")}](#${ra.anchor})`;
    }
    case "hyperref": {
      const key = argRaw(n, 0);
      const r = key ? resolveRef(key.trim()) : null;
      const t = walkArg(n, n.args.length - 1);
      return r ? `[${t}](#${r.anchor})` : t;
    }
    case "cite": {
      // args = [optional note, key]: the note is arg 0 only when both exist
      const loc = n.args && n.args.length >= 2 ? argRaw(n, 0) : null;
      const keys = (lastArgRaw(n) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const locTxt = loc ? `, ${walkStr(loc)}` : "";
      return `(${keys.map(citeLink).join("; ")}${locTxt})`;
    }
    case "citep": case "citet": case "citealp": {
      const opts = (n.args ?? []).slice(0, -1).map((a) => printRaw(a.content)).filter(Boolean);
      const pre = opts.length === 2 ? opts[0] : null;
      const post = opts.length === 2 ? opts[1] : (opts.length === 1 ? opts[0] : null);
      const keys = (lastArgRaw(n) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const body = `${pre ? walkStr(pre) + " " : ""}${keys.map(citeLink).join("; ")}${post ? `, ${walkStr(post)}` : ""}`;
      return name === "citep" ? `(${body})` : body;
    }
    case "citetext": return `(${walkArg(n, 0)})`;
    case "footnote": return footnoteRef(walkArg(n, n.args ? n.args.length - 1 : 0));
    case "footnotemark": return footnoteRef(null);
    case "footnotetext": {
      const body = walkArg(n, n.args ? n.args.length - 1 : 0);
      if (fillFootnoteText(body)) return "";
      // No mark to attach to: keep the words where they are rather than emit a
      // definition nothing references, which the renderer would silently drop.
      advise("\\footnotetext with no \\footnotemark before it — kept inline, in parentheses", snippetOf(body));
      return ` (${body})`;
    }
    case "youtube": {
      // \youtube[Title]{VIDEO_ID}: like \href, the ID is the LAST arg and the
      // title arg 0 only when both slots are present.
      const k = n.args ? n.args.length : 0;
      const id = ((k >= 1 ? argRaw(n, k - 1) : null) ?? "").trim();
      // explicit [Title] wins; else the title tex2mdx pre-fetched from oEmbed
      const title = (k >= 2 ? walkStr(argRaw(n, 0) ?? "") : "").trim()
        || (ctx.videoTitles?.[id] ?? "");
      if (!/^[A-Za-z0-9_-]{11}$/.test(id))
        warn(`\\youtube expects the 11-character video ID (the watch URL's v= value), got "${id}"`, id);
      return `\n\n<YouTube id="${id}"${title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""} />\n\n`;
    }
    case "hint": return `[*Hint:* ${walkArg(n, 0)}]`;
    case "note": return `[*Note:* ${walkArg(n, 0)}]`;
    // \difficulty is not contract UI — it renders as the same plain [n]
    // text the PDF prints, wherever the author put it.
    case "difficulty": return `**[${lastArgRaw(n) ?? ""}]** `;
    case "important": return "**(★)** ";
    case "skippable": return "**(∗)** ";   // legacy "skip on a first pass" mark
    case "paragraph": {
      // Bold run-in heading. Add a trailing period only if the author's title
      // doesn't already end in terminal punctuation (avoids "Prerequisites..").
      const t = walkArg(n, 0).trim();
      return `\n\n**${/[.!?:]$/.test(t) ? t : t + "."}** `;
    }
    case "ifdef": case "ifdefined": case "ifcsdef": {
      const nm = (argRaw(n, 0) ?? "").trim().replace(/^\\/, "");
      return walkArg(n, nm in authorMacros ? 1 : 2);
    }
    case "item": return "";   // stray \item outside a list
    case "section": case "subsection": case "subsubsection": return emitHeading(n);
    // \tableofcontents: emit a placeholder; the real ToC is built from the
    // surviving headings once emission + pruning are done (see emitDocument).
    case "tableofcontents": return "\n\n<!--ILIAD_TOC-->\n\n";
    // \ensuremath{X} in prose: X typeset as math. This is how a macro is made
    // usable in both modes (amsthm's \qed is \ensuremath{\square}), so a ported
    // document reaches for it whenever one macro has to work in a sentence and
    // in an equation. Inside math it is redundant and shims.mjs drops it.
    case "ensuremath": {
      const inner = mathClean(argRaw(n, 0) ?? "").replace(/\s+/g, " ").trim();
      return inner ? `$${inner}$` : "";
    }
  }

  // author-defined macro: expand and re-walk
  const am = authorMacros[name];
  if (am && expandDepth < 12) {
    let body = am.body;
    (n.args ?? []).forEach((a, k) => { body = body.split(`#${k + 1}`).join(`{${printRaw(a.content)}}`); });
    expandDepth++;
    const out = walkStr(body);
    expandDepth--;
    return out;
  }
  warn(`unhandled command \\${name}`, `\\${name}`);
  return `{/* TODO(tex2mdx): \\${name} */}`;
}

// -------------------------------------------------------------- headings ---
function emitHeading(n, runLabels = []) {
  const name = n.content;
  const starred = !!argRaw(n, 0);
  const titleNodes = n.args[n.args.length - 1].content;
  // Inside a learningoutcomes box, group headings are just bold lines — no
  // numbering, no TOC entry, no anchor.
  if (inLearningOutcomes) return `\n\n**${walk(titleNodes).trim()}**\n\n`;
  // the labels following the heading are absorbed by walk() lookahead and
  // passed in: the displayed number is their .aux value (the injected
  // auto-label, or any author label — same counter); the walked-along
  // counters are only the fallback
  let sim;
  if (name === "subsubsection") {
    if (!starred) counters.subsubsec++;
    sim = `${secNum()}.${counters.subsec}.${counters.subsubsec}`;
  } else if (name === "subsection") {
    if (!starred) { counters.subsec++; counters.subsubsec = 0; }
    sim = `${secNum()}.${counters.subsec}`;
  } else {
    if (!starred) { counters.section++; counters.subsec = 0; counters.subsubsec = 0; }
    sim = secNum();
  }
  let headText = walk(titleNodes).trim();
  if (!starred) {
    let num = runLabels.filter(Boolean).map((l) => ctx.refs[l]?.num).find(Boolean);
    if (!num) {
      warn(`displayed number for \\${name} not found in the .aux — using a simulated counter, which can drift from the PDF`, snippetOf(printRaw(titleNodes)));
      num = sim;
    }
    headText = `${num}${name === "section" ? "." : ""} ${headText}`;
  }
  pendingHeading = { text: headText, level: name === "section" ? "##" : name === "subsection" ? "###" : "####" };
  return `\n\n${pendingHeading.level} ${headText}\n\n`;
}
let pendingHeading = null;
let inLearningOutcomes = false;

// ------------------------------------------------------------------ walk ---
function walk(nodes) {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.type) {
      case "string": {
        // LaTeX text ligatures. The parser emits each `, ', and - as its own
        // string node, so a run is N identical adjacent nodes:
        //   ``...''  -> "..."   (lone apostrophes like it's are left alone)
        //   --       -> – (en dash)      ---  -> — (em dash)
        // Math and \verb bypass this handler, so derivatives ($L''$) and
        // command flags (\verb|--flag|) are unaffected.
        const prevSame = i > 0 && nodes[i - 1].type === "string" &&
          nodes[i - 1].content === n.content;
        if ((n.content === "`" || n.content === "'") && prevSame) {
          out = out.slice(0, -1) + '"';
        } else if (n.content === "-" && prevSame) {
          out = out.slice(0, -1) + (out.endsWith("–") ? "—" : "–");
        } else if (n.content === "~") {
          out += " ";                 // LaTeX tie -> non-breaking space
        } else out += n.content;
        break;
      }
      case "whitespace": out += " "; break;
      case "parbreak": out += "\n\n"; break;
      case "comment": break;
      case "group": out += walk(n.content); break;
      case "inlinemath": {
        const inner = mathClean(printRaw(n.content)).replace(/\s+/g, " ").trim();
        out += `$${inner}$`; break;
      }
      case "displaymath": out += displayMath("displaymath", printRaw(n.content)); break;
      case "mathenv": out += displayMath(envName(n), printRaw(n.content)); break;
      case "environment": out += emitEnv(n); break;
      case "verbatim": out += "\n\n```\n" + (n.content ?? "").trim?.() + "\n```\n\n"; break;
      case "verb": out += "`" + n.content + "`"; break;
      case "macro": {
        // heading label lookahead: \section{..}\label{auto}\label{..} — the
        // whole run of following \labels is absorbed: the injected auto-label
        // carries the heading's .aux number, author labels bind its anchor
        if ((n.content === "section" || n.content === "subsection" || n.content === "subsubsection")) {
          const runLabels = [];
          let j = i;
          for (;;) {
            let k = j + 1;
            while (k < nodes.length && (nodes[k].type === "whitespace" || nodes[k].type === "parbreak")) k++;
            if (k < nodes.length && nodes[k].type === "macro" && nodes[k].content === "label") {
              runLabels.push(lastArgRaw(nodes[k])); j = k;
            } else break;
          }
          const h = emitHeading(n, runLabels);
          if (!inLearningOutcomes && pendingHeading) {
            for (const l of runLabels) if (l && !isAutoLabel(l)) anchorMap[l] = ghSlug(pendingHeading.text);
          }
          i = j;
          out += h;
          break;
        }
        // \setcounter{section}{n} adjusts the section counter (appendix trick)
        if (n.content === "setcounter" && argRaw(n, 0) === "section") {
          counters.section = parseInt(argRaw(n, 1) ?? "0", 10); break;
        }
        if (n.content === "appendix") { counters.appendix = true; counters.section = 0; break; }
        out += emitMacro(n);
        break;
      }
      default: break;
    }
  }
  return out;
}

// --------------------------------------------------------------- parsing ---
// plain-text rendering of a small tex fragment (titles, author names) —
// usable before emitDocument; falls back to a bare default parser.
export function texToPlain(texStr) {
  const p = _parser ?? getParser({ environments: ENV_SIGNATURES, macros: CONTRACT_MACROS });
  const saved = ctx;
  if (!ctx) ctx = { refs: {}, BIB: {}, declaredThms: {}, commentCmds: new Set(), remarkNumbered: false, tikzSrc: "/" };
  // title fragments degrade gracefully: no warnings from unknown macros here.
  // Advisories DO survive — the frontmatter title/summary are attributes too,
  // so math in \title{} is dropped and the author needs to hear about it.
  const w = warnings.length;
  const out = mdToPlain(walkFragment(p, texStr));
  warnings.length = w;
  ctx = saved;
  return out.replace(/"/g, "'");
}
function walkFragment(p, texStr) {
  try { return walk(p.parse(texStr).content); } catch { return texStr; }
}

let _parser = null;
const parser = () => _parser;

// ------------------------------------------------- solution relocation ---
// The PDF keeps solutions where the author put them (often a back-of-sheet
// appendix); the web always shows each solution directly beneath its
// exercise. The mandatory [ex:label] binding names the target.

// `open` points at an opening `<Tag`; returns the index just past the
// matching `</Tag>`, depth-aware (a solution may contain a proof, which
// also emits as <Solution>). -1 if unbalanced.
function findBlockEnd(s, open, tag) {
  const openTok = `<${tag}`, closeTok = `</${tag}>`;
  let depth = 0, i = open;
  for (;;) {
    const o = s.indexOf(openTok, i), c = s.indexOf(closeTok, i);
    if (c === -1) return -1;
    if (o !== -1 && o < c) { depth++; i = o + openTok.length; }
    else { depth--; i = c + closeTok.length; if (depth === 0) return i; }
  }
}

function relocateSolutions(md) {
  const mark = (k) => `<!--iliad:moved:${k}-->`;
  // 1. lift every bound solution out, leaving a numbered marker behind
  const sols = [];
  let out = "", last = 0;
  const openRe = /<Solution for="([^"]*)">/g;
  for (let m; (m = openRe.exec(md)); ) {
    const end = findBlockEnd(md, m.index, "Solution");
    if (end === -1) {
      warn("a <Solution> block is unbalanced — it and every solution after it stay where the author put them", snippetOf(md.slice(m.index, m.index + 200)));
      break;
    }
    sols.push({ anchor: m[1], body: "<Solution>" + md.slice(m.index + m[0].length, end) });
    out += md.slice(last, m.index) + mark(sols.length - 1);
    last = end;
    openRe.lastIndex = end;
  }
  out += md.slice(last);

  // 2. reinsert each directly after its exercise, after any solution already
  //    placed there (multiple solutions for one exercise keep their order)
  sols.forEach((s, k) => {
    let at = -1;
    const ex = out.indexOf(`<Exercise id="${s.anchor}">`);
    if (ex !== -1) at = findBlockEnd(out, ex, "Exercise");
    if (at === -1) {
      // No matching exercise: the label exists (emission warns when it does
      // not) but does not belong to one, so there is nothing to move under.
      // Put the solution back where the author had it. The replacement is a
      // FUNCTION: as a string, every `$$` in the body — i.e. every display
      // math fence — would be eaten as a $-substitution pattern.
      warn(`solution names [${s.anchor}], which is not an exercise — it stays where the author put it instead of moving under one`, snippetOf(s.body));
      out = out.replace(mark(k), () => s.body);
      return;
    }
    for (;;) {
      // skip solutions already reinserted here and any adjacent <Hint>
      // block: the hint reads before the answer
      const ws = /^\s*/.exec(out.slice(at))[0].length;
      const tag = out.startsWith("<Solution", at + ws) ? "Solution"
        : out.startsWith("<Hint>", at + ws) ? "Hint" : null;
      if (!tag) break;
      const e = findBlockEnd(out, at + ws, tag);
      if (e === -1) break;
      at = e;
    }
    out = out.slice(0, at) + `\n\n${s.body}` + out.slice(at);
  });

  // 3. drop the position markers. Headings are NEVER pruned, even when
  //    relocation empties them: the converter is faithful to the source, so a
  //    section that renders empty is a .tex problem for the author to fix and
  //    must stay visible (with its anchor, so \crefs to it keep resolving).
  //    An authored solutions appendix belongs in pdfonly — that is how a sheet
  //    keeps the emptied heading off the web (see docs/iliad-sty.md).
  out = out.replace(/\n*<!--iliad:moved:[^>]*-->\n*/g, "\n\n");

  // 4. the \tableofcontents placeholder is filled by the caller AFTER tidy(),
  //    because tidy() dedents every line and would flatten the nested list.
  return out;
}

// -------------------------------------------------------------- contents ---
// \tableofcontents becomes an in-page ToC on the web, built from every heading
// the page emits — the same set LaTeX lists, since headings are never dropped.
// The converter already numbers headings ("1", "1.1", "4.2.1") identically to
// LaTeX, so the numbers are read straight off the heading text and the anchors
// are the same ghSlug the site (rehype-slug) and build-content's index use —
// guaranteeing the links resolve. References is converter-added (not a source
// section) and is left out.
export function buildToc(out) {
  const items = [];
  for (const line of out.split("\n")) {
    const h = /^(#{2,4}) +(.+?)\s*$/.exec(line);
    if (!h) continue;
    const text = h[2].replace(/\*\*|\*/g, "").trim();
    if (!text || text === "References") continue;
    const indent = "  ".repeat(h[1].length - 2);
    items.push(`${indent}- [${text}](#${ghSlug(text)})`);
  }
  return items.length ? `**Contents**\n\n${items.join("\n")}` : "";
}


// -------------------------------------------------------------- references ---
// LaTeX typesets its own bibliography; on the web every cited entry gets an
// anchored item at the bottom of the page. In-text citations link down here;
// an entry whose bib record has a URL makes its title the outbound link.
function emitBibliography() {
  const keys = [...citedKeys].filter((k) => ctx.BIB[k]);
  if (keys.length === 0) return "";
  keys.sort((a, b) => ctx.BIB[a].disp.localeCompare(ctx.BIB[b].disp));
  const items = keys.map((k) => {
    const e = ctx.BIB[k];
    const title = e.title ? e.title.replace(/\.$/, "") : null;
    const titleMd = title ? (e.url ? `[*${title}*](${e.url}).` : `*${title}*.`)
      : (e.url ? `[${e.url}](${e.url}).` : "");
    const head = e.authorsFull ? `${e.authorsFull}${e.year ? ` (${e.year})` : ""}.` : `${e.disp}.`;
    const body = [head, titleMd, e.venue ? `${e.venue.replace(/\.$/, "")}.` : ""].filter(Boolean).join(" ");
    return `<div id="bib-${slug(k)}">\n\n${body}\n\n</div>`;
  });
  return `\n\n## References\n\n${items.join("\n\n")}\n`;
}

// --------------------------------------------------------------- footnotes ---
// \footnote{…} becomes a GFM footnote: a [^N] reference where the author put
// it, and the note itself in a definition appended below. The renderer collects
// the definitions into one list at the foot of the page — the web equivalent of
// what the PDF puts at the foot of the sheet — so the definitions' position in
// the file is bookkeeping, not layout.
//
// \footnotemark + \footnotetext is the split form LaTeX needs when the mark sits
// somewhere it can't carry the text, like a theorem's title argument. The mark
// takes the next number and the following \footnotetext fills it in, which is
// how LaTeX pairs them too.
const footnoteRef = (body) => {
  footnotes.push({ id: footnotes.length + 1, body });
  return `[^${footnotes.length}]`;
};
const fillFootnoteText = (body) => {
  const open = footnotes.find((f) => f.body === null);
  if (open) open.body = body;
  return Boolean(open);
};
function emitFootnotes() {
  if (footnotes.length === 0) return "";
  const defs = footnotes.map((f) => {
    if (f.body === null) {
      warn(`\\footnotemark with no \\footnotetext after it — footnote ${f.id} would render empty`, "\\footnotemark");
      return `[^${f.id}]: (no \\footnotetext in the source)`;
    }
    if (/\n[ \t]*\n/.test(f.body.trim())) {
      advise(`footnote ${f.id} spans paragraphs in the source; the page renders it as one`, snippetOf(f.body));
    }
    // One line per definition. A blank line would end the definition, and the
    // 4-space indent that continues one is also the indent that starts a code
    // block — so paragraph breaks inside a note collapse to spaces instead.
    return `[^${f.id}]: ${f.body.replace(/\s+/g, " ").trim()}`;
  });
  return `\n\n${defs.join("\n\n")}\n`;
}

export function emitDocument(bodyTex, context) {
  ctx = context;
  anchorMap = {};
  droppedLabels = new Set();
  authorMacros = {};
  citedKeys = new Set();
  footnotes = [];
  letteredParts = false;
  listDepth = 0;

  // phase A: default parse of preamble+body to harvest author macro definitions
  const p0 = getParser({ environments: ENV_SIGNATURES, macros: CONTRACT_MACROS });
  const fullAst = p0.parse(context.preamble + "\n" + bodyTex);
  const macroSigs = { ...CONTRACT_MACROS };
  const silencedWarn = console.warn, silencedLog = console.log;
  console.warn = () => {}; console.log = () => {};
  let newcommands;
  try { newcommands = listNewcommands(fullAst); }
  finally { console.warn = silencedWarn; console.log = silencedLog; }
  for (const nc of newcommands) {
    const nArgs = nc.signature ? nc.signature.split(" ").filter((s) => s === "m").length : 0;
    if (/o/.test(nc.signature ?? "")) {
      if (!(("\\" + nc.name) in ctx.macroOverride)) warn(`macro \\${nc.name} has an optional arg; not auto-translated (override or expand manually)`, nc.name);
      continue;   // optional-arg macros are not expandable by us
    }
    macroSigs[nc.name] = { signature: nc.signature || "" };
    authorMacros[nc.name] = { signature: nc.signature || "", body: printRaw(nc.body) };
  }
  // simple \def\name{...} (parameterless)
  for (const m of (context.preamble + bodyTex).matchAll(/\\def\s*\\([a-zA-Z]+)\s*\{/g)) {
    const g = readGroup(context.preamble + bodyTex, m.index + m[0].length - 1);
    if (g && !(m[1] in authorMacros)) { authorMacros[m[1]] = { signature: "", body: g.content }; macroSigs[m[1]] ??= { signature: "" }; }
  }

  // phase B: re-parse the body with full signatures (args attach correctly)
  _parser = getParser({ environments: { ...ENV_SIGNATURES, ...ctx.declaredEnvSigs }, macros: macroSigs });
  const ast = _parser.parse(bodyTex);

  // pass 1: populate anchorMap (discard output; warnings discarded via snapshot)
  counters = { section: 0, subsec: 0, subsubsec: 0, appendix: false, ex: {}, thm: {} };
  const wSnap = context.warnSnapshot();
  walk(ast.content);
  context.warnRestore(wSnap);

  // pass 2: emit, move every solution up under its exercise, then append
  // the References list for everything the page cited and the definitions for
  // every footnote it took. Pass 1's numbering is thrown away with its output.
  counters = { section: 0, subsec: 0, subsubsec: 0, appendix: false, ex: {}, thm: {} };
  citedKeys = new Set();
  footnotes = [];
  const md = relocateSolutions(walk(ast.content)) + emitBibliography() + emitFootnotes();

  // a \cref may target a label inside a dropped pdfonly block — it resolves
  // via the aux, so the link emits but points at nothing. Tell the author.
  for (const l of droppedLabels) {
    if (isAutoLabel(l)) continue;
    if (md.includes(`](#${anchorMap[l] ?? slug(l)})`)) {
      advise(`prose links to "${l}", which sits inside a pdfonly block and is dropped from the page — the web link is dead; move the \\cref inside pdfonly or reword`, l);
    }
  }
  return md;
}
