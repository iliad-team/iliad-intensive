/**
 * state.mjs — per-run shared state: source registry (for file:line error
 * locations) and the warning/advisory sinks. One CLI invocation = one run,
 * so module-level singletons are the honest representation.
 */

// Source registry: main.tex plus every \input'ed file (comment-stripped, so
// a needle can't false-match inside a comment).
export const SRC_FILES = [];

export function lineOf(needle) {
  if (!needle) return null;
  for (const f of SRC_FILES) {
    const idx = f.text.indexOf(needle);
    if (idx >= 0) return `${f.name}:${f.text.slice(0, idx).split("\n").length}`;
  }
  return null;
}

// warn(msg, needle?): needle is a verbatim source snippet used to report
// file:line. warn() issues print as ERROR and fail CI (exit code 2);
// advise() issues print as non-fatal warnings and never do.
export const warnings = [];
export const warn = (m, needle) => warnings.push({ m, needle });

export const advisories = [];
export const advise = (m, needle) => advisories.push({ m, needle });

export const fmtIssue = ({ m, needle }) => {
  const loc = lineOf(needle);
  return loc ? `${loc}  ${m}` : m;
};

// a short verbatim snippet of an env body, used as a location needle
export const snippetOf = (s) => {
  const l = (s ?? "").split("\n").map((x) => x.trim()).find((x) => x.length > 3) || (s ?? "").trim();
  return l.slice(0, 60) || null;
};
