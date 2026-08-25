#!/usr/bin/env node
/**
 * tex2mdx-check.mjs — compile-check a converted .mdx exactly as the website does
 * (remark-math + rehype-katex) and report any KaTeX render errors.
 *
 * Resolves @mdx-js/mdx etc. from the repo's node_modules; runs from anywhere:
 *   node scripts/tex2mdx/tex2mdx-check.mjs content/modules/foo.mdx
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// The MDX toolchain lives in the public repo's node_modules; resolve from there
// so this script runs from anywhere.
const here = path.dirname(new URL(import.meta.url).pathname);
const candidates = [
  path.resolve(here, "../.."),        // scripts/tex2mdx -> repo root
  path.resolve(here, ".."), here, process.cwd(),
];
const repo = candidates.find((c) => existsSync(path.join(c, "node_modules/@mdx-js/mdx")));
if (!repo) { console.error("Could not find iliad-curriculum-public/node_modules. Run `npm install` there."); process.exit(1); }
const req = createRequire(path.join(repo, "package.json"));
const imp = async (name) => (await import(pathToFileURL(req.resolve(name)).href));
const { compile } = await imp("@mdx-js/mdx");
const remarkMath = (await imp("remark-math")).default;
const remarkGfm = (await imp("remark-gfm")).default;
const rehypeKatex = (await imp("rehype-katex")).default;
const katex = (await imp("katex")).default;

const file = process.argv[2];
if (!file) { console.error("usage: node tex2mdx-check.mjs <file.mdx>"); process.exit(1); }
const body = readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

try {
  // remarkGfm because the site loads it (footnotes, tables): a footnote
  // reference with no definition is a *compile* success but a rendering bug,
  // and the gate should see the same tree the page does.
  await compile(body, { remarkPlugins: [remarkMath, remarkGfm], rehypePlugins: [[rehypeKatex, { strict: false, macros: {} }]] });
  console.log("MDX compile: OK");
} catch (e) { console.log("MDX compile: FAIL ::", String(e.message).split("\n")[0]); process.exit(1); }

const macros = {};
// `$` is ASCII punctuation, so `\$` is a CommonMark backslash escape: micromark
// consumes it before the math extension sees a delimiter, and emit-ast.mjs emits
// exactly that for a price in prose. This scan splits on `$` by hand, so it has
// to drop the escapes itself — otherwise two prices in one paragraph read as one
// bogus math span and the gate fails a page that renders fine. (No math body
// reaches here holding a `\$`: shims.mjs rewrites those to \char36.)
let b = body.replace(/\\\$/g, "");
const disp = [...b.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
b = b.replace(/\$\$[\s\S]*?\$\$/g, " ");
const inl = [...b.matchAll(/\$([^$]+?)\$/g)].map((m) => m[1]);
let err = 0, n = 0;
const scan = (arr, display) => arr.forEach((m) => {
  n++;
  const h = katex.renderToString(m, { strict: false, macros, throwOnError: false, displayMode: display });
  if (h.includes("#cc0000") || h.includes("katex-error")) { err++; if (err <= 10) console.log(`  KaTeX err: ${m.replace(/\s+/g, " ").slice(0, 90)}`); }
});
scan(inl, false); scan(disp, true);
console.log(`KaTeX: ${n} spans, ${err} errored`);
process.exit(err ? 1 : 0);
