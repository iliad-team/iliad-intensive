import type { TexMacros } from "@/lib/tex-macros";
import { extractMacros } from "@/lib/tex-macros";

// basePath is applied to <Link>, CSS and fonts but NOT to a raw <script src>,
// exactly as Figure has to prefix its <img src>. The deployed site lives under
// /iliad-intensive, so without this the loader 404s in production and on every
// PR preview while working perfectly on localhost.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Configure and load MathJax for one worksheet.
 *
 * Rendered by the worksheet page rather than the root layout, for two reasons:
 * only worksheets contain maths, and the macro table is per page (`\KL` differs
 * between worksheets), so the config cannot be hoisted into a shared layout.
 *
 * Order matters and is guaranteed here: MathJax reads `window.MathJax` when its
 * script executes, so the config element is emitted immediately before the
 * loader, in the same component. Splitting them across layout and page would
 * make correctness depend on where Next chose to put each tag.
 */
export function MathJaxSetup({ source }: { source: string }) {
  // Reading days carry no maths at all (ai-alignment-intro,
  // alignment-in-practice, mechanistic-interpretability). Loading a 1.1 MB
  // typesetter to render nothing is the exact cost this change exists to
  // remove, so those pages emit no MathJax at all.
  if (!/(?<!\\)\$/.test(source)) return null;

  const macros: TexMacros = extractMacros(source);

  const config = {
    // ui/lazy typesets a formula only when it scrolls near the viewport.
    // Without it a worksheet's 1,908 formulas are typeset up front: measured at
    // 4x CPU throttle that is ~3.8s before the maths is readable and a 2.4s
    // frozen tab, against ~0.85s and 0.43s with lazy on.
    loader: { load: ["ui/lazy"] },
    options: {
      // Start typesetting well before a formula is actually visible. The
      // default 200px is enough to render just-in-time, which means the page
      // visibly grows as formulas land while you read; a larger margin renders
      // further ahead so the reflow happens off-screen.
      lazyMargin: "800px",
      // Never typeset inside code — a shell snippet containing \( would
      // otherwise be eaten as maths.
      skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    },
    tex: {
      // \(…\) and \[…\] are MathJax's defaults and, unlike $, cannot be
      // triggered by prose (a worksheet mentioning "$5" stays "$5").
      inlineMath: [["\\(", "\\)"]],
      displayMath: [["\\[", "\\]"]],
      // This worksheet's own \gdef header, hoisted out of the body so lazy
      // typesetting cannot run a formula before its definitions.
      macros,
    },
  };

  return (
    <>
      <script
        // Plain data, serialised by us — no user input reaches this.
        dangerouslySetInnerHTML={{ __html: `window.MathJax = ${JSON.stringify(config)};` }}
      />
      {/* tex-chtml, not tex-chtml-full: the worksheets use \boldsymbol and
          \cancel, which this component fetches on demand from
          /mathjax/input/tex/extensions/. Those are vendored alongside it — the
          whole directory, not only the two in use, so a worksheet reaching for
          another extension cannot 404. Readers still download only what their
          page actually needs, which -full would not give.

          This failed silently at first: MathJax's startup promise rejects on a
          missing extension, and under lazy typesetting the rejection only
          happens once a reader scrolls to the formula that needs it. */}
      <script src={`${BASE_PATH}/mathjax/tex-chtml.js`} async />
    </>
  );
}
