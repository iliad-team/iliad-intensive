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
 * KaTeX's own `renderToString` already returns the finished HTML. Handing that
 * string to `dangerouslySetInnerHTML` gives the browser identical DOM while
 * the payload carries one opaque string per formula instead of a tree.
 *
 * This runs on the mdast `math` / `inlineMath` nodes that remark-math produces,
 * so it REPLACES rehype-katex rather than running alongside it.
 *
 * `output: "html"` drops the other half of KaTeX's default output: a hidden
 * `katex-mathml` copy of every formula, emitted only for screen readers and
 * costing roughly as many bytes again as the visual tree ($A$ is 385 bytes
 * with it, 194 without) — twice over, since each page embeds the markup a
 * second time in its RSC payload. The visual `katex-html` tree is untouched,
 * so the page looks identical. Screen readers get the TeX source instead: the
 * wrapper <KatexHtml> renders carries it as an aria-label (see mdx.tsx),
 * which is what KaTeX's visual tree — permanently aria-hidden — never gave
 * them anyway.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  [key: string]: unknown;
};

const OPEN_INLINE = '<span class="katex">';
const OPEN_DISPLAY = '<span class="katex-display">';
const CLOSE = "</span>";
/** What a formula with no visible output (e.g. a \gdef-only block) renders to. */
const EMPTY_HTML = '<span class="katex-html" aria-hidden="true"></span>';

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
          displayMode: display,
          output: "html",
          strict: false,
          throwOnError: false,
          macros,
        });

        // Re-create KaTeX's own outer wrapper as the JSX element and inject the
        // rest, so the element tree matches what rehype-katex produced. (Not
        // byte-identical: React used to re-serialize KaTeX's inline styles and
        // drop their trailing ";", where the raw string keeps it. Same computed
        // style, ~180 bytes a page.) If KaTeX ever changes that wrapper the
        // assumption is wrong, and a build that fails loudly beats one that
        // silently ships different markup.
        const open = display ? OPEN_DISPLAY : OPEN_INLINE;
        if (!rendered.startsWith(open) || !rendered.endsWith(CLOSE)) {
          throw new Error(
            `remark-katex-html: unexpected KaTeX output shape for ${
              display ? "display" : "inline"
            } math — expected it to start with ${open} and end with ${CLOSE}. ` +
              `Got: ${rendered.slice(0, 120)}…`,
          );
        }

        const inner = rendered.slice(open.length, -CLOSE.length);
        const attributes = [
          {
            type: "mdxJsxAttribute",
            name: "html",
            value: inner,
          },
        ];
        // The TeX source, for the wrapper's aria-label — the accessible
        // stand-in for the dropped MathML. Skipped when the formula renders
        // to nothing (a \gdef-only macro block): labelling an invisible
        // element would make screen readers announce the definitions.
        if (inner !== EMPTY_HTML && inner !== OPEN_INLINE + EMPTY_HTML + CLOSE) {
          attributes.push({
            type: "mdxJsxAttribute",
            name: "tex",
            value: child.value ?? "",
          });
        }
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
