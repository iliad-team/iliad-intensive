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
import { applyMathShims } from "./shims.mjs";
import { slug, ghSlug, readGroup, readOpt, readArg } from "./util.mjs";
import { registerTikz } from "./tikz.mjs";

// ---------------------------------------------------------------- tables ---
// simple textual macro translations (no argument handling)
const TEXT_MACROS = {
  ldots: "...", dots: "...", textellipsis: "...",
  S: "§", LaTeX: "LaTeX", TeX: "TeX", ae: "\\ae",
  quad: " ", qquad: " ", enspace: " ", thinspace: " ", ",": " ", " ": " ",
  ";": " ", "!": "", ":": " ", "\n": " ", "'": "", "@": "", "`": "", "^": "",
  '"': "", "~": "",
  "\\": "\n", "%": "%", "&": "&", "#": "#", _: "_", $: "$",
  "{": "\\{", "}": "\\}",
};
// macros dropped with NO arguments consumed
const NOOP_MACROS = new Set([
  "maketitle", "tableofcontents", "centering", "solutionstrue", "solutionsfalse",
  "allowdisplaybreaks", "phantomsection", "sloppy", "AND", "And", "name",
  "height", "width", "depth", "centerline", "noindent", "medskip", "smallskip",
  "bigskip", "hfill", "hfil", "vfill", "vfil", "null", "clearpage", "newpage",
  "par", "today", "itemsep", "protect", "qedhere", "footnotemark", "appendix",
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
  crefname: 3, Crefname: 3,
};
// contract + structural environment signatures for the parser
const ENV_SIGNATURES = {
  exercise: { signature: "o" }, solution: { signature: "o" },
  callout: { signature: "o" }, proof: { signature: "o" },
  theorem: { signature: "o" }, lemma: { signature: "o" },
  proposition: { signature: "o" }, corollary: { signature: "o" },
  definition: { signature: "o" }, fact: { signature: "o" },
  example: { signature: "o" }, remark: { signature: "o" },
  learningoutcomes: {}, summary: {}, hint: {},
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
  // cleveref config — unknown to unified-latex, so the parser needs the
  // signature or the three brace groups survive as literal text
  crefname: { signature: "m m m" }, Crefname: { signature: "m m m" },
};
const THM_KINDS = new Set(["theorem", "lemma", "proposition", "corollary"]);
const THM_COUNTED = new Set(["theorem", "lemma", "proposition", "corollary", "fact", "definition", "example"]);

// ------------------------------------------------------------- run state ---
let ctx = null;                 // caller-supplied context
let anchorMap = {};             // label -> anchor
let authorMacros = {};          // name -> {signature, body(nodes)}
let expandDepth = 0;
let counters = null;
let inExercise = false;
let citedKeys = new Set();      // bib keys cited anywhere on the page

const secNum = () => (counters.appendix ? String.fromCharCode(64 + counters.section) : String(counters.section));
const bucket = (dd) => { const n = +dd; return n <= 5 ? 1 : n <= 10 ? 2 : n <= 17 ? 3 : n <= 25 ? 4 : 5; };

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
    const cr = m.startsWith("\\Cref", i) ? 5 : m.startsWith("\\cref", i) ? 5 : (m.startsWith("\\ref", i) && m[i + 4] === "{") ? 4 : 0;
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
  return rr.map((r, k) => {
    const sameType = r.text.replace(/\s.*$/, "") === name0;
    return `[${k === 0 || !sameType ? r.text : r.text.replace(/^\w+\s/, "")}](#${r.anchor})`;
  }).join(" and ");
}

// --------------------------------------------------------------- helpers ---
const argRaw = (n, i) => (n.args && n.args[i] && n.args[i].content.length ? printRaw(n.args[i].content) : null);
const lastArgRaw = (n) => (n.args && n.args.length ? printRaw(n.args[n.args.length - 1].content) : null);
const walkArg = (n, i) => (n.args && n.args[i] ? walk(n.args[i].content) : "");

// plain text for JSX attributes
function mdToPlain(md) {
  return md
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\$\$?[^$]*\$\$?/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ").trim();
}
const attr = (nodesOrStr) =>
  mdToPlain(typeof nodesOrStr === "string" ? walkStr(nodesOrStr) : walk(nodesOrStr)).replace(/"/g, "'");

function walkStr(texStr) {           // parse a raw string fragment and walk it
  return walk(parser().parse(texStr).content);
}

// item text beginning with display math must paragraph-break after the marker
const itemJoin = (lead, txt) => (txt.startsWith("$$") ? `${lead}\n\n${txt}` : `${lead} ${txt}`);

// The \label bound to the environment itself: the first \label at the TOP
// LEVEL of the env body. LaTeX binds any top-level \label to the environment
// (labels inside nested enumerates/equations bind to those instead, so we
// don't descend). Placement is the author's choice; right after \begin is
// merely the clearest style.
function leadingLabel(nodes) {
  for (const n of nodes) {
    if (n.type === "macro" && n.content === "label") return lastArgRaw(n);
  }
  return null;
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
function splitItems(nodes) {
  const items = []; let cur = null;
  for (const n of nodes) {
    if (n.type === "macro" && n.content === "item") {
      if (cur) items.push(cur);
      cur = { optLabel: argRaw(n, 0), nodes: [] };
      continue;
    }
    if (cur) cur.nodes.push(n);
  }
  if (cur) items.push(cur);
  return items;
}

function emitList(env, n) {
  const items = splitItems(n.content);
  const letters = env === "enumerate" && inExercise;
  const wasIn = inExercise; inExercise = false;
  const out = items.map((it, k) => {
    const lead = it.optLabel ? `**${attr(it.optLabel)}** ` : "";
    const txt = walk(it.nodes).trim();
    if (letters) return itemJoin(`**(${String.fromCharCode(97 + k)})** ${lead}`.trim(), txt);
    const marker = env === "enumerate" ? `${k + 1}.` : "-";
    return itemJoin(`${marker} ${lead}`.trim(), txt);
  }).join(letters ? "\n\n" : "\n");
  inExercise = wasIn;
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

  // theorem-family number: aux wins for labeled envs, else simulated
  let thmNum = null;
  const declared = ctx.declaredThms[env];
  if (THM_COUNTED.has(env) || (env === "remark" && ctx.remarkNumbered) || (declared && !BUILTIN_ENVS.has(env))) {
    counters.thm[secNum()] = (counters.thm[secNum()] || 0) + 1;
    thmNum = (label && ctx.refs[label]?.num) || `${secNum()}.${counters.thm[secNum()]}`;
  }

  let mdx = null;
  switch (env) {
    case "exercise": {
      // A leading \difficulty renders as the same plain [n] the PDF prints —
      // no component attribute, no UI chrome, no validation (author's choice).
      const { dd, star, skip, rest } = takeMarks(n.content);
      counters.ex[secNum()] = (counters.ex[secNum()] || 0) + 1;
      const num = `${secNum()}.${counters.ex[secNum()]}`;
      const wasIn = inExercise; inExercise = true;
      const inner = walk(rest);
      inExercise = wasIn;
      if (!label) advise(`exercise ${num} has no \\label — no stable anchor emitted, and no solution can reference it`, snippetOf(printRaw(n.content)));
      if (label) for (const l of allLabels(n.content)) if (!(l in anchorMap)) anchorMap[l] = slug(label);
      // ★ = \important (the sheet's key exercises); (∗) = legacy \skippable
      mdx = `<Exercise${id}>\n` +
        `**Exercise ${num}${star ? " (★)" : ""}${skip ? " (∗)" : ""}${opt ? ` (${walkStr(opt).trim()})` : ""}${dd ? ` [${dd}]` : ""}.** ` +
        `${inner.trim()}\n</Exercise>`;
      break;
    }
    case "learningoutcomes": {
      // iliad.sty's environment opens its own itemize, so the \items sit bare
      // in the env body — emit them as a markdown list. A sheet that nests an
      // explicit itemize instead has no bare \items; walk handles it.
      const items = splitItems(n.content);
      const body = items.length
        ? items.map((it) => `- ${walk(it.nodes).trim()}`).join("\n")
        : walk(n.content).trim();
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
      mdx = `<Solution${forAttr}>\n\n${walk(n.content).trim()}\n\n</Solution>`;
      break;
    }
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
      mdx = `<Callout type="note">\n\n**Fact${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${attr(opt)})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      break;
    case "remark":
      mdx = `<Callout type="note">\n\n**Remark${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${attr(opt)})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
      break;
    case "example":
      mdx = `<Callout type="tip">\n\n**Example${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${attr(opt)})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
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
    default: {
      if (declared) {
        mdx = `<Callout type="note">\n\n**${declared}${thmNum ? ` ${thmNum}` : ""}${opt ? ` (${attr(opt)})` : ""}.** ${walk(n.content).trim()}\n\n</Callout>`;
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
  const capMd = caption ? attr(caption) : "";
  const fig = `<Figure src="${src}" alt="${capMd || "figure"}"${capMd ? ` caption="${capMd}"` : ""} />`;
  return `\n${figLabel ? `<div id="${slug(figLabel)}">\n${fig}\n</div>` : fig}\n`;
}

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
    case "texttt": return "`" + (lastArgRaw(n) ?? "") + "`";
    case "textnormal": case "textrm": case "textup": case "textsf": case "textsc": case "textmd":
      return walkArg(n, 0);
    case "textcolor": return walkArg(n, 1);
    case "raisebox": return walkArg(n, 3);
    case "mbox": case "fbox": return walkArg(n, 0);
    case "makebox": return walkArg(n, 1);
    case "texorpdfstring": return walkArg(n, 0);
    case "href": return `[${walkArg(n, 1)}](${argRaw(n, 0) ?? ""})`;
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
    case "footnote": case "footnotetext": return ` (${walkArg(n, n.args ? n.args.length - 1 : 0)})`;
    case "hint": return `[*Hint:* ${walkArg(n, 0)}]`;
    case "note": return `[*Note:* ${walkArg(n, 0)}]`;
    // \difficulty is not contract UI — it renders as the same plain [n]
    // text the PDF prints, wherever the author put it.
    case "difficulty": return `**[${lastArgRaw(n) ?? ""}]** `;
    case "important": return "**(★)** ";
    case "skippable": return "**(∗)** ";   // legacy "skip on a first pass" mark
    case "paragraph": return `\n\n**${walkArg(n, 0).trim()}.** `;
    case "ifdef": case "ifdefined": case "ifcsdef": {
      const nm = (argRaw(n, 0) ?? "").trim().replace(/^\\/, "");
      return walkArg(n, nm in authorMacros ? 1 : 2);
    }
    case "item": return "";   // stray \item outside a list
    case "section": case "subsection": case "subsubsection": return emitHeading(n);
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
function emitHeading(n) {
  const name = n.content;
  const starred = !!argRaw(n, 0);
  const titleNodes = n.args[n.args.length - 1].content;
  // label immediately after the heading is absorbed by walk() lookahead;
  // here we only compute numbering + text
  let headText;
  if (name === "subsubsection") {
    if (!starred) counters.subsubsec++;
    headText = `${starred ? "" : secNum() + "." + counters.subsec + "." + counters.subsubsec + " "}${walk(titleNodes).trim()}`;
  } else if (name === "subsection") {
    if (!starred) { counters.subsec++; counters.subsubsec = 0; }
    headText = `${starred ? "" : secNum() + "." + counters.subsec + " "}${walk(titleNodes).trim()}`;
  } else {
    if (!starred) { counters.section++; counters.subsec = 0; counters.subsubsec = 0; }
    headText = `${starred ? "" : secNum() + ". "}${walk(titleNodes).trim()}`;
  }
  pendingHeading = { text: headText, level: name === "section" ? "##" : name === "subsection" ? "###" : "####" };
  return `\n\n${pendingHeading.level} ${headText}\n\n`;
}
let pendingHeading = null;

// ------------------------------------------------------------------ walk ---
function walk(nodes) {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.type) {
      case "string": out += n.content; break;
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
        // heading label lookahead: \section{..}\label{..}
        if ((n.content === "section" || n.content === "subsection" || n.content === "subsubsection")) {
          const h = emitHeading(n);
          // find following \label (skipping whitespace)
          let j = i + 1;
          while (j < nodes.length && (nodes[j].type === "whitespace" || nodes[j].type === "parbreak")) j++;
          if (j < nodes.length && nodes[j].type === "macro" && nodes[j].content === "label") {
            const l = lastArgRaw(nodes[j]);
            if (l) anchorMap[l] = ghSlug(pendingHeading.text);
            i = j;
          }
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
  // title fragments degrade gracefully: no warnings from unknown macros here
  const w = warnings.length, a = advisories.length;
  const out = mdToPlain(walkFragment(p, texStr));
  warnings.length = w; advisories.length = a;
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
    if (end === -1) break;
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
      // no matching exercise (contract violation, warned at emission) —
      // put the solution back where the author had it
      out = out.replace(mark(k), s.body);
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

  // 3. prune headings whose whole section emptied out (a "Solutions"
  //    appendix, say). The markers are the evidence: only sections a
  //    solution actually left are candidates; pruned headings leave a
  //    marker too, so an emptied parent section cascades.
  const isMark = (l) => /^<!--iliad:moved:[^>]*-->$/.test(l.trim());
  const lines = out.split("\n");
  const pruned = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < lines.length; i++) {
      const h = /^(#{2,6}) /.exec(lines[i]);
      if (!h) continue;
      let j = i + 1, marks = 0, content = false;
      while (j < lines.length) {
        const hh = /^(#{2,6}) /.exec(lines[j]);
        if (hh && hh[1].length <= h[1].length) break;
        if (isMark(lines[j])) marks++;
        else if (hh || lines[j].trim() !== "") { content = true; break; }
        j++;
      }
      if (!content && marks > 0) {
        pruned.push(lines[i].slice(h[0].length).trim());
        lines.splice(i, j - i, "<!--iliad:moved:h-->");
        changed = true;
      }
    }
  }
  out = lines.join("\n").replace(/\n*<!--iliad:moved:[^>]*-->\n*/g, "\n\n");

  // a \cref may still point at a pruned heading — tell the author
  for (const text of pruned) {
    const plain = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|\*/g, "").trim();
    if (out.includes(`](#${ghSlug(plain)})`)) {
      advise(`section "${plain}" emptied by solution relocation was dropped, but prose still links to it — reword the sentence that points at the solutions section`, plain);
    }
  }
  return out;
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

export function emitDocument(bodyTex, context) {
  ctx = context;
  anchorMap = {};
  authorMacros = {};
  citedKeys = new Set();
  inExercise = false;

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
  // the References list for everything the page cited
  counters = { section: 0, subsec: 0, subsubsec: 0, appendix: false, ex: {}, thm: {} };
  citedKeys = new Set();
  return relocateSolutions(walk(ast.content)) + emitBibliography();
}
