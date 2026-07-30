/**
 * util.mjs — tokenizer primitives shared by every pipeline stage.
 * Pure functions, no state.
 */
import { slug as ghSlugger } from "github-slugger";

// s[i] must be the opening delimiter. Returns {content, end} (end past close).
export function readGroup(s, i, open = "{", close = "}") {
  if (s[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === open) depth++;
    else if (s[j] === close) { depth--; if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 }; }
  }
  return null;
}

// optional [..] arg immediately at i (skips leading spaces). Returns {content,end}|null
export function readOpt(s, i) {
  let j = i; while (/\s/.test(s[j])) j++;
  if (s[j] !== "[") return null;
  return readGroup(s, j, "[", "]");
}

// {..} arg, skipping leading spaces
export function readArg(s, i) {
  let j = i; while (/\s/.test(s[j])) j++;
  return readGroup(s, j, "{", "}");
}

// Remove `%...` to EOL unless the % is escaped (\%). Preserves line count.
export function stripComments(tex) {
  return tex.split("\n").map((line) => {
    let out = "";
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") { out += line[i] + (line[i + 1] ?? ""); i++; continue; }
      if (line[i] === "%") break;
      out += line[i];
    }
    return out;
  }).join("\n");
}

export const slug = (label) =>
  label.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// Heading-anchor slug for cross-references and the sidebar TOC. Uses the very
// same github-slugger the site's rehype-slug uses to render heading ids, so a
// generated anchor always lands on the real heading — the old hand-rolled
// approximation dropped every non-ASCII character (á/ö/ž, Greek, …) and so
// produced dead links on any heading that had one. Stateless: rehype-slug's
// per-document duplicate suffixing (-1, -2) is not reproduced here, so two
// identically-named headings still resolve to the first — a pre-existing
// corner, not something this changes.
export const ghSlug = (text) => ghSlugger(text);

// Dedent every line, trim trailing spaces, collapse 3+ newlines. LaTeX source
// indentation is cosmetic, but in Markdown leading spaces are semantic.
export const tidy = (s) =>
  s.replace(/^[ \t]+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
