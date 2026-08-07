"use client";

import { useEffect } from "react";
import katex from "katex";

/**
 * Typesets every `<span data-tex>` the build left behind (see
 * src/lib/remark-math-client.ts). Mounted once per worksheet page.
 *
 * Rendered in batches inside requestAnimationFrame rather than one blocking
 * loop: singular-learning-theory has 1,908 formulas, and doing them all in a
 * single synchronous pass freezes the tab. Batching keeps the page scrollable
 * while the math fills in, which is the fairest version of this approach —
 * a naive loop would make it look worse than it has to.
 *
 * `\gdef` macros are shared across a page's formulas in document order, the
 * same scope the server-side renderer gives them.
 */
export function MathRenderer() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("span[data-tex]"),
    );
    if (nodes.length === 0) return;

    const macros: Record<string, unknown> = {};
    let i = 0;
    let cancelled = false;
    const BATCH = 50;

    const started = performance.now();

    const step = () => {
      if (cancelled) return;
      const end = Math.min(i + BATCH, nodes.length);
      for (; i < end; i++) {
        const el = nodes[i];
        try {
          katex.render(el.dataset.tex ?? "", el, {
            displayMode: el.dataset.display === "1",
            strict: false,
            throwOnError: false,
            macros: macros as never,
          });
        } catch {
          // throwOnError:false already renders errors visibly; this is only
          // for a katex.render() that fails outright, where leaving the raw
          // TeX in place beats blanking the formula.
          el.textContent = el.dataset.tex ?? "";
        }
      }
      if (i < nodes.length) {
        requestAnimationFrame(step);
      } else {
        // Read this in the console to see what the approach actually costs.
        console.log(
          `[math] typeset ${nodes.length} formulas in ${Math.round(
            performance.now() - started,
          )}ms`,
        );
      }
    };

    requestAnimationFrame(step);
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
