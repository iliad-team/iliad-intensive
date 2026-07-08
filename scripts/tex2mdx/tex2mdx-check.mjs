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
const rehypeKatex = (await imp("rehype-katex")).default;
const katex = (await imp("katex")).default;

const file = process.argv[2];
if (!file) { console.error("usage: node tex2mdx-check.mjs <file.mdx>"); process.exit(1); }
const body = readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

try {
  await compile(body, { remarkPlugins: [remarkMath], rehypePlugins: [[rehypeKatex, { strict: false, macros: {} }]] });
  console.log("MDX compile: OK");
} catch (e) { console.log("MDX compile: FAIL ::", String(e.message).split("\n")[0]); process.exit(1); }

const macros = {};
let b = body;
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
