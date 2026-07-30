/**
 * watch-lib.mjs — the file-watch loop shared by watch.mjs and preview.mjs.
 *
 * Both dev loops watch tex/ identically; only what they DO with a batch of
 * changed worksheets differs (watch.mjs rebuilds for `next dev`, preview.mjs
 * re-exports a static build). This owns the part that is the same: the artifact
 * filter, the debounce, worksheet detection, and the atomic-save ENOENT guard —
 * so the two can't drift (they had, e.g. only one ignored main.autolabel.tex).
 */
import { watch, existsSync } from "node:fs";
import path from "node:path";

// LaTeX/converter artifacts are written next to the sources; a change to one of
// them must never trigger a rebuild, or the watcher loops on its own output.
export const ARTIFACT =
  /\.(aux|log|out|pdf|bbl|blg|brf|toc|nav|snm|fls|synctex(\.gz)?|fdb_latexmk)$|main-nosol\.|main\.autolabel\./;

/**
 * Watch tex/ and, after a short debounce, call onBatch(slugs) with the
 * worksheet slugs to (re)build. A change to a shared file at the tex/ root
 * (e.g. iliad.sty) rebuilds the watched scope (slugArg, or all when null).
 */
export function watchWorksheets(TEX, slugArg, onBatch, { debounceMs = 300 } = {}) {
  let timer = null;
  const pending = new Set();
  const watcher = watch(TEX, { recursive: true }, (_event, file) => {
    if (!file || ARTIFACT.test(file)) return;
    const top = file.split(path.sep)[0];
    const isWorksheet = existsSync(path.join(TEX, top, "main.tex")) ||
                        existsSync(path.join(TEX, top, "main.mdx"));
    if (isWorksheet) {
      if (slugArg && top !== slugArg) return;
      pending.add(top);
    } else if (!file.includes(path.sep)) {
      pending.add(slugArg);   // shared file (e.g. iliad.sty): rebuild the watched scope
    } else {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      const jobs = [...pending];
      pending.clear();
      onBatch(jobs);
    }, debounceMs);
  });
  // Atomic-save editors (write temp + rename) make the recursive watcher stat a
  // file that has already vanished — a transient ENOENT. Without this handler
  // the 'error' event is unhandled and crashes the watcher on the first save.
  watcher.on("error", (err) => {
    if (err && err.code !== "ENOENT") console.error(`watch error: ${err.message}`);
  });
  return watcher;
}
