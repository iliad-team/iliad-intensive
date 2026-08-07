import katex from "katex";

/**
 * Render math to an HTML *string* instead of a React element tree.
 *
 * `rehype-katex` renders each formula with KaTeX and then parses the result
 * back into hast, which MDX compiles into JSX — so a single formula becomes
 * ~50 React elements. That is correct, and it is also why the worksheet pages
 * are the largest thing this site ships: React Server Components serialize the
 * element tree into the RSC payload, where every element costs a JSON tuple
 * like ["$","span",null,{"className":"mord","children":…}] rather than the 19
 * bytes the same span costs as markup. singular-learning-theory has 1,908
 * formulas and ~96,700 such tuples.
 *
 * KaTeX's own `renderToString` already returns finished markup. Handing that
 * string to `dangerouslySetInnerHTML` means the payload carries one opaque
 * string per formula instead of a tree.
 *
 * It also renders in `output: "mathml"`, so the browser lays the math out
 * natively and KaTeX's positioned <span> tree is never generated at all. On
 * singular-learning-theory's 1,908 formulas, measured by re-rendering every one:
 *
 *   htmlAndMathml (KaTeX's default)  3.32 MB of math markup
 *   html          (visual only)      2.61 MB
 *   mathml        (this)             0.70 MB
 *
 * MathML Core is supported by every browser Next itself targets
 * (node_modules/next/dist/shared/lib/modern-browserslist-target.js:
 * chrome 111, edge 111, firefox 111, safari 16.4). The trade is typography:
 * KaTeX's HTML output reproduces TeX metrics faithfully, while native MathML
 * rendering varies between browsers.
 *
 * This runs on the mdast `math` / `inlineMath` nodes that remark-math produces,
 * so it REPLACES rehype-katex rather than running alongside it.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  [key: string]: unknown;
};

const OPEN = '<span class="katex">';
const CLOSE = "</span>";

/**
 * KaTeX embeds the formula's original TeX in an <annotation> inside every
 * <semantics>. We ship the LaTeX source as a download already, so the per-
 * formula copy is redundant — 1,908 of them cost ~0.14 MB a page before the
 * payload multiplies it. <semantics> is still valid with just its first child.
 */
const ANNOTATION = /<annotation encoding="application\/x-tex">[\s\S]*?<\/annotation>/g;

/**
 * The rendered markup rides as a plain string attribute on <KatexHtml>, which
 * does the injection (see the component in mdx.tsx). Emitting
 * `dangerouslySetInnerHTML={{__html: …}}` directly from a plugin would mean
 * hand-building an ESTree for the object literal, and MDX silently drops an
 * expression attribute it cannot read — the first cut of this did exactly that
 * and shipped 1,908 empty `<span class="katex"></span>` elements. A string
 * attribute has no such failure mode.
 */
export function remarkKatexHtml() {
  return (tree: MdastNode) => {
    // Fresh per file, so a page's own \gdef macros persist across its formulas
    // but never leak into another page — the same contract the `macros: {}`
    // passed to rehype-katex had.
    const macros: NonNullable<katex.KatexOptions["macros"]> = {};

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

        const rendered = katex.renderToString(child.value ?? "", {
          // MathML only: the browser renders the math itself, so KaTeX's
          // hand-positioned <span> tree — 2.6 MB of the 3.3 MB of math markup
          // on singular-learning-theory — is never generated.
          output: "mathml",
          displayMode: display,
          strict: false,
          throwOnError: false,
          macros,
        });

        // In mathml mode BOTH inline and display come back wrapped in
        // <span class="katex">; display is carried by display="block" on the
        // <math> element, not by a katex-display wrapper (that wrapper only
        // exists in html mode). Re-create the wrapper as the JSX element and
        // inject the rest. If KaTeX ever changes this shape the assumption is
        // wrong, and a build that fails loudly beats one that silently ships
        // different markup.
        if (!rendered.startsWith(OPEN) || !rendered.endsWith(CLOSE)) {
          throw new Error(
            `remark-katex-html: unexpected KaTeX output shape for ${
              display ? "display" : "inline"
            } math — expected it to start with ${OPEN} and end with ${CLOSE}. ` +
              `Got: ${rendered.slice(0, 120)}…`,
          );
        }

        const attributes = [
          {
            type: "mdxJsxAttribute",
            name: "html",
            value: rendered
              .slice(OPEN.length, -CLOSE.length)
              .replace(ANNOTATION, ""),
          },
        ];
        // Boolean shorthand: `value: null` is how mdast-jsx spells `<X display />`.
        if (display) {
          attributes.push({
            type: "mdxJsxAttribute",
            name: "display",
            value: null as unknown as string,
          });
        }

        children[i] = {
          type: display ? "mdxJsxFlowElement" : "mdxJsxTextElement",
          name: "KatexHtml",
          attributes,
          children: [],
        };
      }
    };

    walk(tree);
  };
}
