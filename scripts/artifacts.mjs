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
import { readFileSync } from "node:fs";
import path from "node:path";

export const BUILD_ARTIFACT =
  /\.(aux|log|out|pdf|bbl|blg|brf|toc|fls|synctex(\.gz)?|fdb_latexmk)$|main-nosol\.|\.autolabel\./;

/**
 * The notebook side of a module folder (docs/NOTEBOOKS.md): masters, the local
 * notebooks and sync state tex/gen_notebooks.py keeps beside them, and support/.
 * None of it is a worksheet input, so the watchers ignore it too. `file` is
 * relative to tex/.
 */
export const NOTEBOOK_SIDE = /(^|[\\/])(support|\.trash)([\\/]|$)|\.ipynb$|(^|[\\/])\.[^\\/]+\.sync$|\.from-notebook\.py$/;
export const isNotebookSide = (texDir, file) => {
  if (NOTEBOOK_SIDE.test(file)) return true;
  if (!/^[^\\/]+[\\/][^\\/]+\.py$/.test(file)) return false;   // masters sit directly in tex/<slug>/
  try { return readFileSync(path.join(texDir, file), "utf8").startsWith("# ! "); } catch { return false; }
};
