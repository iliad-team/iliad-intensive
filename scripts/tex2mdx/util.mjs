/**
 * util.mjs — tokenizer primitives shared by every pipeline stage.
 * Pure functions, no state.
 */

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

// github-slugger-compatible for plain ASCII heading text (matches rehype-slug)
export const ghSlug = (text) => text.toLowerCase().trim()
  .replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Dedent every line, trim trailing spaces, collapse 3+ newlines. LaTeX source
// indentation is cosmetic, but in Markdown leading spaces are semantic.
export const tidy = (s) =>
  s.replace(/^[ \t]+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
