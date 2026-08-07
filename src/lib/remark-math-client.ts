/**
 * Ship the raw TeX and let the browser typeset it — the model
 * davidquarel.github.io uses (MathJax from a CDN, rendered on load).
 *
 * The server output for a formula is a placeholder carrying its source:
 *
 *   <span data-tex="\int_0^1 f(x)\,dx" data-display="1"></span>
 *
 * which is ~40 bytes against the ~1.7 KB the same formula costs as rendered
 * KaTeX markup. `MathRenderer` (a client component) fills them in on mount.
 *
 * The trade is the opposite of server rendering: the page ships tiny, but the
 * math is absent until JS runs, and the work scales with formula count —
 * singular-learning-theory has 1,908, roughly 100x the heaviest post on the
 * blog this imitates.
 *
 * This replaces rehype-katex; nothing is rendered at build time. The KaTeX
 * error gate in scripts/tex2mdx still catches bad TeX before it ships, so a
 * broken formula cannot reach the browser unnoticed.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  [key: string]: unknown;
};

export function remarkMathClient() {
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

        const attributes = [
          { type: "mdxJsxAttribute", name: "tex", value: child.value ?? "" },
        ];
        if (display) {
          attributes.push({
            type: "mdxJsxAttribute",
            name: "display",
            value: null as unknown as string,
          });
        }

        children[i] = {
          type: display ? "mdxJsxFlowElement" : "mdxJsxTextElement",
          name: "MathClient",
          attributes,
          children: [],
        };
      }
    };

    walk(tree);
  };
}
