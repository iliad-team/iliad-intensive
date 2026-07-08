# tex2mdx — worksheet LaTeX → MDX pipeline

```
main.tex ──▶ tex2mdx.mjs ──▶ <slug>.mdx  +  tikz-<sha>.svg diagrams
                 │                │
                 │                └── tex2mdx-check.mjs: compiles the MDX with
                 │                    the site's exact pipeline; KaTeX-renders
                 │                    every span. Never ship unchecked output.
                 └── exit 2 on any WARN (file:line); advisories don't fail CI
```

Stages:

| file       | role |
| ---        | --- |
| `tex2mdx.mjs` | CLI + orchestration: sources, .aux cross-refs, frontmatter, \gdef macro block, bib (via `bibtex-parse`) |
| `emit-ast.mjs`| the emitter: **unified-latex typed AST → MDX** (no regex parsing of LaTeX). Math bodies pass through `printRaw` + the shim pipeline. |
| `shims.mjs`| **all dialect knowledge**: macro overrides, KaTeX synonym table, pure math transforms, contract/env tables. Edit this when a new corpus arrives. |
| `tikz.mjs` | diagrams → standalone compile (real TeX) → content-addressed SVG |
| `util.mjs` | tokenizer primitives (brace reader for math strings, slugs) |
| `state.mjs`| per-run warning/advisory sinks + source registry (file:line) |

External binaries: `pdflatex` (aux generation, diagram compile — keep
`-shell-escape` OFF), `pdftocairo` (poppler-utils).

Usage:
```sh
node tex2mdx.mjs path/to/main.tex -o out.mdx --tikz-dir public/uploads/<slug> --tikz-src /uploads/<slug>/
node tex2mdx-check.mjs out.mdx     # want: MDX compile OK, 0 errored
```
