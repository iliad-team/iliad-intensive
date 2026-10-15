import { readArg } from "./util.mjs";

// Displays LaTeX numbers: one number for equation/multline, one per outer row
// for align/alignat/gather. Starred forms are unnumbered and never match.
export const NUMBERED_MATH = /^(equation|multline|align|alignat|gather)$/;

// A row LaTeX leaves unnumbered, or one already carrying a label or a tag.
// Comments are ignored, so a commented-out \label does not count.
const SUPPRESSED = /\\(?:tag\b|notag\b|nonumber\b)/;
const uncommented = (s) => s.replace(/(^|[^\\])%.*$/gm, "$1");

// Rebuild a numbered display with onRow applied to each numbered unit: the
// whole body for equation/multline, each outer row otherwise. Only outer row
// breaks divide numbered equations. A matrix, cases, split, or a brace group
// can contain its own \\ without advancing the outer row. Comment-aware, so
// it runs on raw source (autolabel.mjs) as well as stripped (numberMath).
export function mapRows(name, inner, onRow) {
  if (!NUMBERED_MATH.test(name)) return inner;
  if (name === "equation" || name === "multline") return onRow(inner);

  let out = "", start = 0, braces = 0, envs = 0;
  for (let i = 0; i < inner.length;) {
    if (inner[i] === "%") {
      const eol = inner.indexOf("\n", i);
      i = eol === -1 ? inner.length : eol + 1;
      continue;
    }
    if (inner[i] === "\\") {
      const env = /^\\(begin|end)\{[^}]+\}/.exec(inner.slice(i));
      if (env) {
        envs += env[1] === "begin" ? 1 : -1;
        i += env[0].length;
        continue;
      }
      if (braces === 0 && envs === 0) {
        if (inner.startsWith("\\\\", i)) {
          out += onRow(inner.slice(start, i)) + "\\\\";
          i += 2;
          start = i;
          continue;
        }
        if (/^\\intertext\b/.test(inner.slice(i))) {
          const g = readArg(inner, i + 10);
          if (g) {
            out += onRow(inner.slice(start, i)) + inner.slice(i, g.end);
            i = g.end;
            start = i;
            continue;
          }
        }
      }
      const command = /^\\(?:[a-zA-Z]+|[\s\S])/.exec(inner.slice(i));
      i += command ? command[0].length : 1;
      continue;
    }
    if (inner[i] === "{") braces++;
    else if (inner[i] === "}") braces--;
    i++;
  }
  return out + onRow(inner.slice(start));
}

// Whether LaTeX numbers this row but nothing labels it: the rows autolabel.mjs
// gives an \label, so the .aux records every number the PDF prints. An empty
// row (after a trailing \\) is not typeset, so it gets nothing.
export function wantsLabel(row) {
  const s = uncommented(row);
  return s.trim() !== "" && !SUPPRESSED.test(s) && !/\\label\{/.test(s);
}

// Use the same .aux numbers as \eqref; never invent a counter for unlabeled
// displays. Starred displays and explicit tags retain their authored behavior.
// autolabel.mjs labels every numbered row, so in practice each one has a label.
export function numberMath(name, inner, refs) {
  return mapRows(name, inner, (body) => {
    if (SUPPRESSED.test(body)) return body;
    for (const m of body.matchAll(/\\label\{([^}]*)\}/g)) {
      const num = refs[m[1]]?.num;
      if (num != null && num !== "") return `${body.trimEnd()} \\tag{${num}}`;
    }
    return body;
  });
}
