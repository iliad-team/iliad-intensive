#!/usr/bin/env node
/**
 * build-status.mjs — schedule.yaml + what's actually on disk
 *                    → content/status.json  (what /admin/status renders)
 *
 * The split that keeps the page honest:
 *
 *   HAND-KEPT (schedule.yaml)      the curriculum — clusters, teaching days
 *                                  (code, title, lead, Doc tab), which
 *                                  worksheets are each day's material, and
 *                                  where the upstream source is for days
 *                                  nobody has ported yet. The build cannot
 *                                  know these: an unported day has nothing on
 *                                  disk to find, and teaching order is not a
 *                                  property of any file.
 *
 *   DERIVED (here, every build)    is the worksheet live · does it have a
 *                                  compiled deck or only a hosted PDF · which
 *                                  download files exist. Read off disk, so no
 *                                  one has to remember to tick a box after
 *                                  porting a day — and the table cannot claim
 *                                  something the build didn't produce.
 *
 * Days and their worksheets are listed in schedule.yaml's order, which is
 * teaching order — never sorted here.
 *
 * status.json holds facts, not URLs: cluster ids and slugs, never a base-path-
 * prefixed href (the page applies NEXT_PUBLIC_BASE_PATH at render time — see
 * docs/DEVELOPMENT.md on never baking the base path into generated content).
 *
 * Data errors are FATAL, in schedule.mjs (bad roster) and here (a built
 * worksheet no day lists). Each is a one-line fix, and a status page that
 * quietly drops a day is worse than a red build.
 *
 * Usage: build-status.mjs            (also called by build-content.mjs)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadSchedule, ScheduleError } from "./schedule.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
const MODULES = path.join(ROOT, "content", "modules");
const DOWNLOADS = path.join(ROOT, "public", "downloads");
const OUT_FILE = path.join(ROOT, "content", "status.json");

class DataError extends Error {}
const bad = (msg) => { throw new DataError(msg); };

/** Frontmatter of a built module (content/modules/<slug>.mdx). */
function frontmatterOf(slug) {
  const raw = readFileSync(path.join(MODULES, `${slug}.mdx`), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  try {
    return YAML.parse(m[1]) ?? {};
  } catch {
    return null;   // frontmatter validity is the render gate's problem
  }
}

/**
 * The decks one worksheet offers, in the order its page lists them: the
 * `slides:` frontmatter link first (a URL, or `{url, title}`), then every
 * compiled deck — tex/<slug>/slides.tex, then slides-<label>.tex by filename.
 * They stack rather than shadow one another: a day whose main lecture exists
 * only as a hosted deck and whose guest lecture compiles from source shows
 * both. "built" means the source exists; `pdf` says whether this run actually
 * staged it (a --check run compiles no PDFs).
 */
const DECK_RE = /^(slides(?:-[a-z0-9][a-z0-9-]*)?)\.tex$/;
// A deck's own \title{} (beamer's \title[short]{long} included), lightly
// de-TeXed into a label; null when the deck sets none. The site reads the same
// thing off the staged .tex (src/lib/content.ts) — keep the two in step.
function deckTitle(src) {
  const m = /\\title(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(src);
  if (!m) return null;
  const t = m[1]
    .replace(/(^|[^\\])%.*$/gm, "$1")                       // TeX comments inside the argument
    .replace(/\\vspace\*?\{[^}]*\}/g, " ").replace(/\\\\/g, " ")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, "").replace(/[{}]/g, "")
    .replace(/\s+/g, " ").trim();
  return t || null;
}
function decksOf(slug, fm) {
  const decks = [];
  const ext = fm?.slides;
  if (ext) {
    const url = typeof ext === "string" ? ext : ext.url;
    if (url) decks.push({ kind: "external", slug, url: String(url), title: ext.title ? String(ext.title) : null });
  }
  const dir = path.join(TEX, slug);
  const stems = existsSync(dir)
    ? readdirSync(dir).map((f) => DECK_RE.exec(f)).filter((m) => m && !m[1].endsWith("-handout")).map((m) => m[1])
    : [];
  stems.sort((a, b) => (a === "slides" ? -1 : b === "slides" ? 1 : a.localeCompare(b)));
  for (const stem of stems) {
    decks.push({
      kind: "built",
      slug,
      stem,
      title: deckTitle(readFileSync(path.join(dir, `${stem}.tex`), "utf8")),
      pdf: existsSync(path.join(DOWNLOADS, slug, `${slug}-${stem}.pdf`)),
      tex: existsSync(path.join(DOWNLOADS, slug, `${slug}-${stem}.tex`)),
    });
  }
  return decks;
}

/**
 * @param {{check?: boolean, schedule?: object}} opts
 *   check: this came from a --check run (watch / preview / pre-push), which
 *     compiles no PDFs — so the deck and PDF columns understate reality.
 *     Recorded in status.json and said out loud on the page, rather than
 *     reading as "the deck disappeared".
 *   schedule: an already-loaded schedule.yaml (build-content.mjs loads it up
 *     front to fail fast); omitted, it is read here.
 */
export function buildStatus({ check = false, schedule } = {}) {
  const sched = schedule ?? loadSchedule();

  // ---- the roster, in schedule order --------------------------------------
  const days = new Map();
  for (const d of sched.days) {
    days.set(d.code, {
      code: d.code,
      cluster: d.cluster,
      title: d.title,
      lead: d.lead,
      doc: d.doc,
      source: { ...d.source },
      slidesUrl: d.slidesUrl,
      port: d.port,   // "never" = deliberately not ported; grey on the page
      modules: [],
    });
  }

  // ---- what's actually built, in the order its day lists it ---------------
  // Each day pulls its own worksheets, so intra-day order is the schedule's
  // (D.3 reads Solomonoff Induction, then AIXI) rather than alphabetical.
  const scheduled = new Set();
  for (const d of sched.days) {
    const day = days.get(d.code);
    for (const slug of d.worksheets) {
      scheduled.add(slug);
      // Listed but not built yet: a --check run that skipped it, or a slug
      // whose worksheet failed this run. The day just isn't live.
      if (!existsSync(path.join(MODULES, `${slug}.mdx`))) continue;
      const fm = frontmatterOf(slug);
      if (!fm) continue;
      day.modules.push({
        slug,
        title: fm.title ?? slug,
        cluster: d.cluster,
        unlisted: fm.unlisted === true,
        pdf: existsSync(path.join(DOWNLOADS, slug, `${slug}.pdf`)),
        decks: decksOf(slug, fm),
      });
    }
  }

  // A worksheet nobody scheduled has no row, no position and no cluster — so
  // it would vanish from the site rather than appear in the wrong place. Fatal
  // here, where both halves are known. `unlisted: true` opts out (the
  // format-demo sheet is deliberately outside the curriculum).
  const builtSlugs = existsSync(MODULES)
    ? readdirSync(MODULES).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, "")).sort()
    : [];
  for (const slug of builtSlugs) {
    if (scheduled.has(slug)) continue;
    // Stale artifact of a removed or renamed worksheet. Test for the SOURCE,
    // not the directory: CI restores tex/*/.build-hash and tex/*/*.pdf from
    // the worksheet cache, which recreates the old folder on disk after a
    // rename, so a directory check here fails the build on debris.
    const src = ["main.tex", "main.mdx"].some((f) => existsSync(path.join(TEX, slug, f)));
    if (!src) continue;
    if (frontmatterOf(slug)?.unlisted === true) continue;
    bad(`tex/${slug}/ is not listed by any day in schedule.yaml — add the slug under its ` +
        "day's `worksheets:` (or set `unlisted: true` in its frontmatter to keep it off the course)");
  }

  // ---- roll up the two derived columns ------------------------------------
  for (const day of days.values()) {
    // material: live once any worksheet for this day is built and listed.
    day.live = day.modules.some((m) => !m.unlisted);
    // slides: every deck the day's worksheets offer (page order), else the
    // day-level hosted URL.
    const decks = day.modules.flatMap((m) => m.decks);
    if (decks.some((d) => d.kind === "built")) day.slides = { kind: "built", decks };
    else if (decks.length) day.slides = { kind: "external", decks };
    else if (day.slidesUrl) day.slides = { kind: "external", decks: [{ kind: "external", url: day.slidesUrl }] };
    else day.slides = { kind: "none", decks: [] };
    // source: derived once ported — the schedule's guess never outlives reality.
    if (day.modules.length) day.source = { ...day.source, kind: "in-repo" };
  }

  const list = [...days.values()];   // schedule order = teaching order
  const status = {
    checkOnly: check,
    days: list,
    counts: {
      days: list.length,
      live: list.filter((d) => d.live).length,
      decksBuilt: list.filter((d) => d.slides.kind === "built").length,
      decksHosted: list.filter((d) => d.slides.kind === "external").length,
      awaitingSource: list.filter((d) => d.source.kind === "missing" || d.source.kind === "partial").length,
      neverPort: list.filter((d) => d.port === "never").length,
    },
  };
  writeFileSync(OUT_FILE, JSON.stringify(status, null, 2) + "\n");
  return status;
}

// CLI: run standalone to regenerate just status.json.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const s = buildStatus();
    console.log(`status.json: ${s.counts.live}/${s.counts.days - s.counts.neverPort} days live → /admin/status`);
  } catch (e) {
    console.error(e instanceof DataError || e instanceof ScheduleError ? `✗ ${e.message}` : e);
    process.exit(1);
  }
}
