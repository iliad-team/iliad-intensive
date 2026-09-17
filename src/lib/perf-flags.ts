/**
 * Build-time performance switches for the worksheet pages.
 *
 * The site is a static export, so a flag here is decided at `next build`:
 * flip it, rebuild (or push — CI rebuilds), and every page follows.
 */

/**
 * LAZY_LAYOUT — skip layout and paint of off-screen worksheet blocks
 * (`content-visibility: auto`), so a maths-heavy page such as
 * singular-learning-theory (1,955 formulas, 69k DOM elements) lays out only
 * the screens being read instead of everything before first paint. Measured
 * on one throttled core: main-thread work 2.98s → 1.58s, load 2.65s → 1.53s.
 *
 * How it is wired: when true, the worksheet page puts the LAZY_LAYOUT_CLASS
 * on the article's `.prose` div, and every rule of the feature in
 * `src/app/globals.css` (the block between the "BEGIN content-visibility" and
 * "END content-visibility" markers) is scoped to `.prose.<that class>`. With
 * the flag false the class is never emitted and those rules match nothing —
 * the CSS becomes inert and the page renders exactly as it did before the
 * feature existed.
 *
 * TO DISABLE: set LAZY_LAYOUT = false and rebuild. Nothing else to touch.
 * TO REMOVE FOR GOOD: delete this file, the import + className logic in
 * `src/app/[cluster]/[slug]/page.tsx`, the marked block in globals.css, and
 * the pointer row in docs/INTERNALS.md.
 *
 * Verified layout-invariant on 2026-09-16: with every <details> opened and the
 * page fully scrolled, all 68,877 element boxes on SLT are identical with the
 * flag on and off (see the CSS block's comment for the reasoning and caveats).
 */
export const LAZY_LAYOUT = true;

/** The marker class the CSS is scoped to. Only meaningful when LAZY_LAYOUT is true. */
export const LAZY_LAYOUT_CLASS = "lazy-layout";
