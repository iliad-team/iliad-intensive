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

// One column of deliberate Markdown indentation, emitted as a marker rather
// than as a space so tidy() below can tell it from LaTeX's cosmetic source
// indentation — which is noise, and which it still strips.
export const NEST = "\u0001";
// Line tag: "this line came from a list nested inside an \item". The enclosing
// item consumes and strips it (emit-ast's indentBody), so it never gets here.
export const CHILD = "\u0002";

// Dedent every line, trim trailing spaces, collapse 3+ newlines. LaTeX source
// indentation is cosmetic, but in Markdown leading spaces are semantic — so a
// line's leading run is rebuilt from its NEST markers alone, and whatever the
// author's source wrapping put there is dropped.
export const tidy = (s) =>
  s.replace(/^(?:[ \t]|\u0001)+/gm, (m) => " ".repeat((m.match(/\u0001/g) ?? []).length))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
// ---------------------------------------------------- front-matter order ---
// Every sheet opens the same way (docs/commands.md §"Front matter opens the
// sheet"): the overview lives in the header as `summary:` (never a body
// section), then video embeds, then Prerequisites, then the learning-outcomes
// box, then the content. The mirror rule is "Further reading goes last".
//
// This is the shared judgment; the LaTeX path (tex2mdx.mjs) and the MDX path
// (build-content.mjs) each extract the positions from their own syntax and
// report the returned issues as non-fatal warnings — order is style, never
// fatal.
//
// Each field is null (absent) or {at, needle}: a source offset plus a snippet
// that locates it for file:line reporting (the MDX path passes no needle and
// derives the line from `at` instead — each issue carries the offending
// item's offset back out).
export function frontMatterOrderIssues({ overview, video, prereqs, outcomes, content }) {
  const issues = [];
  if (overview) issues.push({
    msg: 'an "Overview" section in the body — the overview is the header\'s job: fold it into `summary:` and drop the section',
    needle: overview.needle, at: overview.at,
  });
  // Only the opening run is held to the order: a video embedded after the
  // content has started is illustrating a point, not front matter.
  const vid = video && (!content || video.at < content.at) ? video : null;
  const seq = [
    ["the video embed", vid],
    ["the Prerequisites section", prereqs],
    ["the learning-outcomes box", outcomes],
  ].filter(([, p]) => p);
  for (let i = 1; i < seq.length; i++) {
    if (seq[i][1].at < seq[i - 1][1].at) issues.push({
      msg: `${seq[i - 1][0]} sits after ${seq[i][0]} — the front matter order is video embeds, then Prerequisites, then the learning outcomes`,
      needle: seq[i - 1][1].needle, at: seq[i - 1][1].at,
    });
  }
  if (content) {
    for (const [what, p] of seq) {
      if (p.at > content.at) issues.push({
        msg: `${what} sits after the sheet's content has started — front matter opens the sheet, before the first content section`,
        needle: p.needle, at: p.at,
      });
    }
  }
  return issues;
}
