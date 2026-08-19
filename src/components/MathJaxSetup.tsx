"use client";

import { useEffect } from "react";
import type { TexMacros } from "@/lib/tex-macros";
import { extractMacros } from "@/lib/tex-macros";

// basePath is applied to <Link>, CSS and fonts but NOT to a script URL we build
// ourselves, exactly as Figure has to prefix its <img src>. The deployed site
// lives under /iliad-intensive, so without this the loader 404s in production
// and on every PR preview while working perfectly on localhost.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const LOADER_SRC = `${BASE_PATH}/mathjax/tex-chtml.js`;

// Module scope so the loader is fetched once per page, and — the part that
// matters — so a re-running effect AWAITS the in-flight load instead of
// concluding MathJax is not ready yet. See the effect for what that cost.
let loaderPromise: Promise<void> | null = null;

/**
 * The shape we rely on, not a full typing of MathJax. `startup` is written by
 * us as config (`typeset: false`) and then REPLACED by MathJax with its own
 * runtime object carrying `promise` — hence both halves being optional.
 */
type MathJaxGlobal = Record<string, unknown> & {
  startup?: { typeset?: boolean; promise?: Promise<unknown> };
  typesetPromise?: () => Promise<unknown>;
};

declare global {
  interface Window {
    MathJax?: MathJaxGlobal;
  }
}

/**
 * Configure MathJax for one worksheet and typeset it, explicitly, after mount.
 *
 * Why this is a client component driving the sequence by hand, rather than two
 * <script> tags in the server HTML — which is how this was first written, and
 * which was WRONG in a way that took a reader on a different machine to expose:
 *
 * MathJax's own startup typesets the page as soon as it decides the document is
 * ready. That puts it in a race with Next hydrating the same DOM. When MathJax
 * lost, everything worked. When MathJax won, the page ended up with ZERO
 * typeset formulas, no fonts ever requested, and every formula left as visible
 * TeX source — permanently, unaffected by reloading, while `MathJax.typesetPromise()`
 * from the console rendered all 1,909 of them instantly. It reproduced on one
 * machine and never on ours, which is exactly what a race looks like.
 *
 * So the race is removed rather than tuned. `startup.typeset: false` disables
 * MathJax's automatic pass, the loader is injected from an effect (which runs
 * after hydration has finished with the DOM), and typesetting is triggered
 * once, by us, when both sides are done.
 *
 * Injecting via createElement also fixes a second failure: React does not
 * execute a <script> it renders during a client-side navigation, so arriving at
 * a worksheet by that route previously gave a page with no maths at all.
 *
 * The macro table is per page (`\KL` differs between worksheets), which is why
 * this is configured here and not hoisted into the root layout.
 */
export function MathJaxSetup({ source }: { source: string }) {
  // Reading days carry no maths at all (ai-alignment-intro,
  // alignment-in-practice, mechanistic-interpretability). Loading a 1.1 MB
  // typesetter to render nothing is the exact cost this change exists to
  // remove, so those pages get no MathJax.
  const hasMath = /(?<!\\)\$/.test(source);
  const macros: TexMacros = hasMath ? extractMacros(source) : {};
  // A string, so the effect does not re-run on every render just because
  // extractMacros returned a new object with identical contents.
  const macrosKey = JSON.stringify(macros);

  useEffect(() => {
    if (!hasMath) return;

    if (!window.MathJax) {
      window.MathJax = {
        // ui/lazy typesets a formula only when it scrolls near the viewport.
        // Without it a worksheet's 1,908 formulas are typeset up front: measured
        // at 4x CPU throttle that is ~3.8s before the maths is readable and a
        // 2.4s frozen tab, against ~0.85s and 0.43s with lazy on.
        loader: { load: ["ui/lazy"] },
        startup: {
          // The whole point: no automatic pass, so nothing races hydration.
          typeset: false,
        },
        options: {
          // Start typesetting well before a formula is visible. The default
          // 200px renders just-in-time, which makes the page visibly grow as
          // formulas land while you read; a larger margin does that off-screen.
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
    }

    // Deliberately NOT cancellable, and deliberately not keyed on the macros
    // OBJECT. The first version was both, and it reproduced the very bug this
    // component exists to fix — 6 loads out of 6, zero formulas:
    //
    //   `macros` is a fresh object each render, so hydration's re-render tore
    //   the effect down (setting cancelled = true, muting the pending load
    //   handler) and re-ran it. The re-run found the loader already requested
    //   and called typeset immediately — but MathJax had not executed yet, so
    //   `startup.promise` did not exist, the guard returned early, and nothing
    //   ever asked MathJax to render.
    //
    // So: one shared load promise, awaited rather than short-circuited, and no
    // teardown path that can silence the only code that triggers typesetting.
    // Typesetting twice would merely be wasted work; typesetting zero times is
    // a page of raw TeX.
    if (!loaderPromise) {
      loaderPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = LOADER_SRC;
        script.async = true;
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () =>
          reject(new Error(`could not load ${LOADER_SRC}`)),
        );
        document.head.appendChild(script);
      });
    }

    loaderPromise
      .then(() => window.MathJax?.startup?.promise)
      .then(() => window.MathJax?.typesetPromise?.())
      .catch((err: unknown) => {
        console.error("MathJax failed to typeset this worksheet:", err);
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMath, macrosKey]);

  return null;
}
