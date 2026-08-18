/**
 * Emit each formula as its own TeX source, for MathJax to typeset in the browser.
 *
 * The site used to render maths with KaTeX at build time. That is correct and
 * instant to read, but it is also why a worksheet page was enormous: KaTeX
 * encodes TeX's box model as nested spans with inline offsets, because CSS has
 * no way to express a fraction or a stretchy delimiter. Measured over
 * singular-learning-theory's 1,908 formulas that came to 3.32 MB and 95,705 DOM
 * nodes — an average of 1,824 bytes and 50 nodes per formula, with a bare `$x$`
 * costing 385 bytes. Doubled by the RSC payload, the page shipped 9.24 MB.
 *
 * The TeX those spans were generated from is ~180 KB. So the maths now ships as
 * its source and MathJax typesets it client-side, with lazy typesetting so only
 * formulas near the viewport cost anything (see the config in layout.tsx).
 *
 * Why this plugin exists at all, rather than leaving `$…$` in the markdown:
 * MDX would try to read the TeX. `{` opens an expression and `<` opens a tag,
 * so `$\{w : f(w) < 1\}$` is a compile error, and `$x^{2}$` silently loses its
 * braces. remark-math already finds the maths reliably; this replaces the KaTeX
 * render step with one that hands the TeX through as an opaque string prop.
 *
 * The delimiters written into the page are `\(…\)` and `\[…\]`, not `$…$`,
 * because those are MathJax's defaults and — unlike `$` — they never collide
 * with prose (a worksheet mentioning "$5" would otherwise open a formula).
 */

import { isMacroDefinitionOnly } from "./tex-macros";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  [key: string]: unknown;
};

export function remarkMathTex() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      const children = node.children;
      if (!children) return;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const display = child.type === "math";

        if (!display && child.type !== "inlineMath") {
          walk(child);
          continue;
        }

        // The `\gdef` header block is config now (see tex-macros.ts), and an
        // untypeset formula shows its own source, so leaving it would print a
        // wall of definitions across the top of every worksheet until MathJax
        // caught up. Drop the node instead.
        if (isMacroDefinitionOnly(child.value ?? "")) {
          children.splice(i, 1);
          i--;
          continue;
        }

        const attributes: Array<Record<string, unknown>> = [
          { type: "mdxJsxAttribute", name: "tex", value: child.value ?? "" },
        ];
        // Boolean shorthand: `value: null` is how mdast-jsx spells `<X display />`.
        if (display) {
          attributes.push({ type: "mdxJsxAttribute", name: "display", value: null });
        }

        children[i] = {
          type: display ? "mdxJsxFlowElement" : "mdxJsxTextElement",
          name: "MathTex",
          attributes,
          children: [],
        };
      }
    };

    walk(tree);
  };
}
