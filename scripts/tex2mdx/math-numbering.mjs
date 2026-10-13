import { readArg } from "./util.mjs";

// Use the same .aux numbers as \eqref; never invent a counter for unlabeled
// displays. Starred displays and explicit tags retain their authored behavior.
export function numberMath(name, inner, refs) {
  if (!/^(equation|multline|align|alignat|gather)$/.test(name)) return inner;
  const number = (body) => {
    if (/\\(?:tag\b|notag\b|nonumber\b)/.test(body)) return body;
    for (const m of body.matchAll(/\\label\{([^}]*)\}/g)) {
      const num = refs[m[1]]?.num;
      if (num != null && num !== "") return `${body.trimEnd()} \\tag{${num}}`;
    }
    return body;
  };
  if (name === "equation" || name === "multline") return number(inner);

  // Only outer row breaks divide numbered equations. A matrix, cases, split,
  // or a brace group can contain its own \\ without advancing the outer row.
  let out = "", start = 0, braces = 0, envs = 0;
  for (let i = 0; i < inner.length;) {
    if (inner[i] === "\\") {
      const env = /^\\(begin|end)\{[^}]+\}/.exec(inner.slice(i));
      if (env) {
        envs += env[1] === "begin" ? 1 : -1;
        i += env[0].length;
        continue;
      }
      if (braces === 0 && envs === 0) {
        if (inner.startsWith("\\\\", i)) {
          out += number(inner.slice(start, i)) + "\\\\";
          i += 2;
          start = i;
          continue;
        }
        if (/^\\intertext\b/.test(inner.slice(i))) {
          const g = readArg(inner, i + 10);
          if (g) {
            out += number(inner.slice(start, i)) + inner.slice(i, g.end);
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
  return out + number(inner.slice(start));
}
