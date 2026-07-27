#!/usr/bin/env node
/**
 * build-status.mjs — content/days.yml + what's actually on disk
 *                    → content/status.json  (what /admin/status renders)
 *
 * The split that keeps the page honest:
 *
 *   HAND-KEPT (content/days.yml)   the day roster — code, title, lead, Doc
 *                                  tab, and where the upstream source is for
 *                                  days nobody has ported yet. The build
 *                                  cannot know these: an unported day has
 *                                  nothing on disk to find.
 *
 *   DERIVED (here, every build)    is the worksheet live · does it have a
 *                                  compiled deck or only a hosted PDF · which
 *                                  download files exist. Read off disk, so no
 *                                  one has to remember to tick a box after
 *                                  porting a day — and the table cannot claim
 *                                  something the build didn't produce.
 *
 * A worksheet joins a day from its own frontmatter (`day: B.4`), never from
 * the roster — one file to touch when you port, and the roster stays put.
 *
 * status.json holds facts, not URLs: cluster ids and slugs, never a base-path-
 * prefixed href (the page applies NEXT_PUBLIC_BASE_PATH at render time — see
 * docs/DEVELOPMENT.md on never baking the base path into generated content).
 *
 * Data errors here are FATAL: a duplicate code, an unknown `day:` reference or
 * a missing required field is a one-line fix, and a status page that quietly
 * drops a day is worse than a red build.
 *
 * Usage: build-status.mjs            (also called by build-content.mjs)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
const MODULES = path.join(ROOT, "content", "modules");
const DOWNLOADS = path.join(ROOT, "public", "downloads");
const DAYS_FILE = path.join(ROOT, "content", "days.yml");
const CLUSTERS_FILE = path.join(ROOT, "content", "clusters.json");
const OUT_FILE = path.join(ROOT, "content", "status.json");

const SOURCE_KINDS = new Set(["ready", "readings", "partial", "missing"]);

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
 * The deck for one worksheet, by the precedence documented in days.yml:
 * compiled slides.tex (hosted here) → the sheet's own `slides:` URL → none.
 * "built" means the source exists; `pdf` says whether this run actually
 * staged it (a --check run compiles no PDFs).
 */
function deckOf(slug, fm) {
  if (existsSync(path.join(TEX, slug, "slides.tex"))) {
    return {
      kind: "built",
      slug,
      pdf: existsSync(path.join(DOWNLOADS, slug, `${slug}-slides.pdf`)),
      tex: existsSync(path.join(DOWNLOADS, slug, `${slug}-slides.tex`)),
    };
  }
  if (fm?.slides) return { kind: "external", slug, url: String(fm.slides) };
  return { kind: "none", slug };
}

/**
 * @param {{check?: boolean}} opts  check: this came from a --check run
 *   (watch / preview / pre-push), which compiles no PDFs — so the deck and
 *   PDF columns understate reality. Recorded in status.json and said out loud
 *   on the page, rather than reading as "the deck disappeared".
 */
export function buildStatus({ check = false } = {}) {
  if (!existsSync(DAYS_FILE)) bad(`missing ${path.relative(ROOT, DAYS_FILE)} — the day roster for /admin/status`);

  let doc;
  try {
    doc = YAML.parse(readFileSync(DAYS_FILE, "utf8"));
  } catch (e) {
    bad(`content/days.yml is not valid YAML: ${String(e.message).split("\n")[0]}`);
  }
  if (!doc || !Array.isArray(doc.days)) bad("content/days.yml must be a `days:` list");

  const clusters = JSON.parse(readFileSync(CLUSTERS_FILE, "utf8")) ?? [];
  const clusterIds = new Set(clusters.map((c) => String(c.id)));
  // Module pages live at /<cluster-urlSlug>/<slug>, so a cluster called
  // "admin" would put a worksheet at /admin/status. Next resolves the static
  // route first, meaning the *worksheet* silently becomes unreachable — a
  // confusing failure to debug, and free to rule out here.
  const clash = clusters.find((c) => String(c.urlSlug) === "admin");
  if (clash) {
    bad(`content/clusters.json: cluster "${clash.id}" uses urlSlug "admin", which collides ` +
        "with the /admin/status page — rename it (a worksheet under it would be unreachable)");
  }

  // ---- the roster -----------------------------------------------------------
  const days = new Map();
  for (const [i, d] of doc.days.entries()) {
    const where = `content/days.yml: days[${i}]`;
    for (const k of ["code", "title", "lead", "doc", "source"]) {
      if (!d?.[k]) bad(`${where} is missing required key \`${k}\``);
    }
    const code = String(d.code);
    if (days.has(code)) bad(`${where}: duplicate day code "${code}"`);
    if (!SOURCE_KINDS.has(d.source)) {
      bad(`${where}: source: "${d.source}" — must be one of ${[...SOURCE_KINDS].join(", ")}`);
    }
    // The letter before the dot is the cluster; a day in an unknown cluster
    // would silently sort into nowhere on the page.
    const cluster = code.split(".")[0];
    if (!clusterIds.has(cluster)) {
      bad(`${where}: day code "${code}" implies cluster "${cluster}", which is not in content/clusters.json`);
    }
    days.set(code, {
      code,
      cluster,
      title: String(d.title),
      lead: String(d.lead),
      doc: String(d.doc),
      // `declared` is what the roster says; `kind` is what's true now (the two
      // differ once a worksheet claims the day). Keeping both means porting a
      // reading day doesn't erase the fact that it IS a reading day.
      source: { kind: d.source, declared: d.source, url: d.sourceUrl ?? null, note: d.note ?? null },
      slidesUrl: d.slides ?? null,   // day-level fallback deck (hosted elsewhere)
      modules: [],
    });
  }

  // ---- what's actually built, attached to its day -------------------------
  const unassigned = [];
  const builtSlugs = existsSync(MODULES)
    ? readdirSync(MODULES).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, "")).sort()
    : [];
  for (const slug of builtSlugs) {
    const fm = frontmatterOf(slug);
    if (!fm) continue;
    const entry = {
      slug,
      title: fm.title ?? slug,
      cluster: fm.cluster ?? null,
      unlisted: fm.unlisted === true,
      pdf: existsSync(path.join(DOWNLOADS, slug, `${slug}.pdf`)),
      deck: deckOf(slug, fm),
    };
    if (!fm.day) {
      // No `day:` at all — a template or a stray. Surfaced on the page rather
      // than hidden, except the deliberately unlisted example sheet.
      if (!entry.unlisted) unassigned.push(entry);
      continue;
    }
    const code = String(fm.day);
    const day = days.get(code);
    if (!day) {
      bad(`tex/${slug}/ declares day: ${code}, which is not a day in content/days.yml — ` +
          `fix the typo or add the day (codes: ${[...days.keys()].join(", ")})`);
    }
    day.modules.push(entry);
  }

  // ---- roll up the two derived columns ------------------------------------
  for (const day of days.values()) {
    day.modules.sort((a, b) => a.title.localeCompare(b.title));
    // material: live once any worksheet for this day is built and listed.
    day.live = day.modules.some((m) => !m.unlisted);
    // slides: best deck any worksheet offers, else the day-level hosted URL.
    const decks = day.modules.map((m) => m.deck).filter((d) => d.kind !== "none");
    if (decks.some((d) => d.kind === "built")) day.slides = { kind: "built", decks };
    else if (decks.length) day.slides = { kind: "external", decks };
    else if (day.slidesUrl) day.slides = { kind: "external", decks: [{ kind: "external", url: day.slidesUrl }] };
    else day.slides = { kind: "none", decks: [] };
    // source: derived once ported — the roster's guess never outlives reality.
    if (day.modules.length) day.source = { ...day.source, kind: "in-repo" };
  }

  const list = [...days.values()];   // roster order is the schedule's order
  const status = {
    checkOnly: check,
    days: list,
    unassigned,
    counts: {
      days: list.length,
      live: list.filter((d) => d.live).length,
      decksBuilt: list.filter((d) => d.slides.kind === "built").length,
      decksHosted: list.filter((d) => d.slides.kind === "external").length,
      // by what the day IS, not by whether it happens to be ported
      readingDays: list.filter((d) => d.source.declared === "readings").length,
      awaitingSource: list.filter((d) => d.source.kind === "missing" || d.source.kind === "partial").length,
    },
  };
  writeFileSync(OUT_FILE, JSON.stringify(status, null, 2) + "\n");
  return status;
}

// CLI: run standalone to regenerate just status.json.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const s = buildStatus();
    console.log(`status.json: ${s.counts.live}/${s.counts.days} days live → /admin/status`);
  } catch (e) {
    console.error(e instanceof DataError ? `✗ ${e.message}` : e);
    process.exit(1);
  }
}
