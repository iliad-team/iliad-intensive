/**
 * tikz.mjs — the diagram stage: extract TikZ/tikz-cd source, compile it
 * standalone against a whitelist-filtered copy of the document's own
 * preamble, and emit content-addressed SVGs (tikz-<sha>.svg). Unchanged
 * diagrams are cache hits, which is what makes CI builds incremental.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGroup } from "./util.mjs";
import { TIKZ_PKG_OK } from "./shims.mjs";
import { warn } from "./state.mjs";

let cfg = null;                    // { tikzDir, tikzSrc, getRefs }
let tikzPreamble = "";
const snippets = new Map();        // hash -> full standalone .tex source

export function initTikz(options, preamble) {
  cfg = options;
  tikzPreamble = buildTikzPreamble(preamble);
}

export const tikzCount = () => snippets.size;

// A whitelist-filtered copy of the doc's preamble: math/diagram packages,
// tikz configuration, and every macro definition (diagrams use the author's
// notation). \renewcommand is guarded so it can't fail in the standalone.
function buildTikzPreamble(pre) {
  const keep = [];
  for (const m of pre.matchAll(/\\usepackage\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
    const pkgs = m[2].split(",").map((s) => s.trim()).filter((p) => TIKZ_PKG_OK.has(p));
    if (pkgs.length) keep.push(`\\usepackage${m[1] ?? ""}{${pkgs.join(",")}}`);
  }
  if (!keep.some((l) => /[{,]tikz[},]/.test(l))) keep.push("\\usepackage{tikz}");
  // tikz/color configuration statements (1-3 brace groups each)
  for (const m of pre.matchAll(/\\(usetikzlibrary|tikzset|tikzcdset|pgfplotsset|definecolor|colorlet|PassOptionsToPackage)\b/g)) {
    let j = m.index + m[0].length, groups = 0;
    while (groups < 3) {
      let k = j; while (k < pre.length && /\s/.test(pre[k])) k++;
      if (pre[k] !== "{") break;
      const g = readGroup(pre, k); if (!g) break;
      j = g.end; groups++;
    }
    if (groups) keep.push(pre.slice(m.index, j));
  }
  for (const m of pre.matchAll(/\\(new|renew|provide)command\*?\s*\{?(\\[a-zA-Z]+)\}?\s*(?:\[\d+\])?\s*(?:\[[^\]]*\])?\s*/g)) {
    const g = readGroup(pre, m.index + m[0].length);
    if (!g) continue;
    if (m[1] === "renew") keep.push(`\\providecommand{${m[2]}}{}`);
    keep.push(pre.slice(m.index, g.end));
  }
  for (const m of pre.matchAll(/\\DeclareMathOperator\*?\s*\{\\[a-zA-Z]+\}\s*/g)) {
    const g = readGroup(pre, m.index + m[0].length);
    if (g) keep.push(pre.slice(m.index, g.end));
  }
  return keep.join("\n");
}

// Diagrams may contain \hyperref/\ref/\cref to labels that don't exist in
// the standalone snippet — resolve them to their printed text via the .aux.
function resolveTikzRefs(body) {
  const refs = cfg.getRefs();
  let out = "", i = 0;
  while (i < body.length) {
    if (body.startsWith("\\hyperref", i)) {
      const o = /^\\hyperref\s*\[([^\]]*)\]/.exec(body.slice(i));
      if (o) {
        const g = readGroup(body, i + o[0].length);
        if (g) { out += g.content; i = g.end; continue; }
      }
    }
    out += body[i]; i++;
  }
  return out.replace(/\\([cC])?ref\*?\{([^}]*)\}/g, (m0, c, k) =>
    refs[k] ? (c ? `${refs[k].name} ${refs[k].num}` : refs[k].num) : k);
}

export function registerTikz(body, mathMode) {
  body = resolveTikzRefs(body);
  const snippet = [
    "\\documentclass[border=2pt]{standalone}",
    tikzPreamble,
    "\\begin{document}",
    mathMode ? `$\\displaystyle ${body}$` : body,
    "\\end{document}", "",
  ].join("\n");
  const hash = createHash("sha256").update(snippet).digest("hex").slice(0, 12);
  snippets.set(hash, snippet);
  return { hash, src: `${cfg.tikzSrc}tikz-${hash}.svg` };
}

export function renderTikzSnippets() {
  if (!snippets.size) return 0;
  mkdirSync(cfg.tikzDir, { recursive: true });
  let rendered = 0;
  for (const [hash, snippet] of snippets) {
    const svgPath = path.join(cfg.tikzDir, `tikz-${hash}.svg`);
    if (existsSync(svgPath)) continue;          // content-addressed cache hit
    const work = mkdtempSync(path.join(tmpdir(), "tikz-"));
    const texFile = path.join(work, "d.tex");
    writeFileSync(texFile, snippet);
    try {
      execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory=" + work, texFile], { stdio: "pipe" });
      execFileSync("pdftocairo", ["-svg", path.join(work, "d.pdf"), svgPath], { stdio: "pipe" });
      rendered++;
    } catch {
      const log = existsSync(path.join(work, "d.log")) ? readFileSync(path.join(work, "d.log"), "utf8") : "";
      const errLine = (log.split("\n").find((l) => l.startsWith("!")) ?? "compile failed").trim();
      warn(`tikz render failed (tikz-${hash}.svg): ${errLine} — snippet kept at ${texFile}`);
    }
  }
  return rendered;
}
