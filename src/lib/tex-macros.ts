/**
 * Pull a worksheet's `\gdef` macros out of its MDX, for MathJax's config.
 *
 * Worksheets open with a block of definitions — singular-learning-theory has
 * 19 of them — written as one formula at the top of the file:
 *
 *   $\gdef\R{\mathbb{R}}\gdef\W{\mathcal{W}}…$
 *
 * KaTeX handled that by itself: the renderer kept one macro table per file, so
 * a `\gdef` in the first formula was still in scope in the last. MathJax can do
 * the same in principle (`\gdef` is global across a page), but not under LAZY
 * typesetting — formulas are then typeset in scroll order, so the definitions
 * would not reliably have run before a formula that uses them. Reading the
 * definitions out here and handing them to MathJax as config removes the
 * ordering question entirely.
 *
 * Macros are per PAGE, never merged site-wide: `\KL` is `\mathrm{KL}` in
 * singular-learning-theory and `D_{\text{KL}}` in solomonoff-induction, so a
 * shared table would silently rewrite one worksheet's notation.
 */

/**
 * A macro name (no backslash) mapped to its replacement.
 *
 * MathJax spells a macro taking arguments as `[body, argCount]`, so
 * `\gdef\Sn#1#2{S_{n}(#1 \parallel #2)}` becomes
 * `Sn: ["S_{n}(#1 \parallel #2)", 2]`. solomonoff-induction has one.
 */
export type TexMacros = Record<string, string | [string, number]>;

/**
 * Read from `start` (the index of the opening brace) to its matching close,
 * honouring nesting and `\{` escapes. A regex cannot do this: `\gdef\KL{D_{\text{KL}}}`
 * nests two deep, and `[^}]*` truncates it to `D_{\text{KL` — which then fails
 * to parse, in the reader's browser, on a page that built cleanly.
 */
function readGroup(src: string, start: number): { body: string; end: number } | null {
  if (src[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }   // skip the escaped character
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;  // unbalanced; caller leaves the text alone
}

// The parameter text between the name and the body: `#1#2` in
// `\gdef\Sn#1#2{…}`. Missing this silently DROPPED that macro, leaving
// \Sn undefined in the browser on a page that built green.
const DEF = /\\(?:gdef|global\s*\\def|def|newcommand\s*)\\([A-Za-z]+)\s*((?:#\d\s*)*)/g;

/** Every `\gdef\Name{…}` in the source, as MathJax expects them (no backslash). */
export function extractMacros(source: string): TexMacros {
  const macros: TexMacros = {};
  DEF.lastIndex = 0;
  for (let m; (m = DEF.exec(source)); ) {
    const group = readGroup(source, DEF.lastIndex);
    if (!group) continue;
    // Later definitions win, matching TeX: a redefinition overrides.
    const argCount = (m[2].match(/#\d/g) ?? []).length;
    macros[m[1]] = argCount > 0 ? [group.body, argCount] : group.body;
    DEF.lastIndex = group.end;
  }
  return macros;
}

/**
 * True when a formula is nothing but definitions — the header block above.
 *
 * KaTeX rendered it to an empty span, so it was invisible. MathJax would too,
 * eventually — but until it is typeset a formula IS its own source on screen,
 * so leaving it in would print a wall of `\gdef\R{\mathbb{R}}…` across the top
 * of every worksheet for the first second. The definitions are in the config by
 * now, so the node is dropped.
 */
export function isMacroDefinitionOnly(tex: string): boolean {
  if (!/\\(?:gdef|def|newcommand)/.test(tex)) return false;
  // Walk the definitions, collecting whatever sits between and after them.
  // Nothing left over means the formula is pure header and can be dropped.
  let rest = "";
  let cursor = 0;
  DEF.lastIndex = 0;
  for (let m; (m = DEF.exec(tex)); ) {
    rest += tex.slice(cursor, m.index);
    const group = readGroup(tex, DEF.lastIndex);
    if (!group) return false;          // malformed — leave the formula alone
    cursor = group.end;
    DEF.lastIndex = group.end;
  }
  rest += tex.slice(cursor);
  return rest.trim() === "";
}
