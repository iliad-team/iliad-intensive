/**
 * artifacts.mjs — what a build writes next to the sources it reads.
 *
 * Both file watchers (watch.mjs, preview.mjs) rebuild on any change under
 * tex/. A build writes into that same tree — LaTeX's .aux/.log/.pdf, the
 * solution-stripped copy, the auto-labelled copies — so anything it produces
 * must be ignored or the watcher rebuilds forever off its own output.
 *
 * Shared because the two lists drifted once already: preview.mjs never
 * excluded main.autolabel.tex and looped on every worksheet.
 */
export const BUILD_ARTIFACT =
  /\.(aux|log|out|pdf|bbl|blg|brf|toc|fls|synctex(\.gz)?|fdb_latexmk)$|main-nosol\.|\.autolabel\./;
