#!/usr/bin/env node
/**
 * schedule.mjs — read and validate schedule.yaml, the one hand-kept
 * description of the course: clusters → teaching days → worksheets, each level
 * in taught order.
 *
 * Both build steps load it through here, so there is exactly one parser and one
 * set of error messages. build-content.mjs uses it to stamp each generated page
 * with its cluster and day and to order content/index.json; build-status.mjs
 * uses it as the day roster behind /admin/status.
 *
 * Position is derived from the file's own order — cluster order, then day
 * order, then a day's worksheet order. Nothing in the repo re-sorts it, so what
 * you see in schedule.yaml is what the site presents.
 *
 * Data errors here are FATAL and always one-line fixes. A schedule that half
 * loads is worse than a red build: the site would quietly drop a day, or order
 * a cluster by accident.
 *
 * Usage: import { loadSchedule } — or run it to validate and print the order.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEX = path.join(ROOT, "tex");
export const SCHEDULE_FILE = path.join(ROOT, "schedule.yaml");

/** Where a day's buildable source is, for a day with no worksheet yet. */
export const SOURCE_KINDS = new Set(["ready", "readings", "partial", "missing"]);

export class ScheduleError extends Error {}
const bad = (msg) => { throw new ScheduleError(msg); };

/** Worksheet folders that exist — a slug the schedule names must be one. */
function worksheetsOnDisk() {
  if (!existsSync(TEX)) return new Set();
  return new Set(readdirSync(TEX, { withFileTypes: true })
    .filter((d) => d.isDirectory()
      && (existsSync(path.join(TEX, d.name, "main.tex")) || existsSync(path.join(TEX, d.name, "main.mdx"))))
    .map((d) => d.name));
}

/**
 * @returns {{
 *   clusters: {id: string, label: string, urlSlug: string}[],
 *   days: {code: string, cluster: string, title: string, lead: string,
 *          doc: string, source: {kind: string, url: string|null, note: string|null},
 *          slidesUrl: string|null, worksheets: string[]}[],
 *   bySlug: Map<string, {slug: string, cluster: string, day: string, position: number}>,
 *   order: string[],
 * }}
 *   `days` is in schedule order (cluster order, then within a cluster), and
 *   `order` is every scheduled slug in curriculum order. `bySlug.position` is
 *   1-based, and is what content/index.json sorts by.
 */
export function loadSchedule() {
  if (!existsSync(SCHEDULE_FILE)) {
    bad("missing schedule.yaml — the curriculum order (clusters → days → worksheets)");
  }
  let doc;
  try {
    doc = YAML.parse(readFileSync(SCHEDULE_FILE, "utf8"));
  } catch (e) {
    bad(`schedule.yaml is not valid YAML: ${String(e.message).split("\n")[0]}`);
  }
  if (!doc || !Array.isArray(doc.clusters) || doc.clusters.length === 0) {
    bad("schedule.yaml must be a `clusters:` list with at least one cluster");
  }

  const onDisk = worksheetsOnDisk();
  const clusters = [];
  const days = [];
  const bySlug = new Map();
  const order = [];
  const seenId = new Set();
  const seenUrlSlug = new Set();
  const seenCode = new Set();

  for (const [ci, c] of doc.clusters.entries()) {
    const where = `schedule.yaml: clusters[${ci}]`;
    for (const k of ["id", "label", "urlSlug"]) {
      if (!c?.[k]) bad(`${where} is missing required key \`${k}\``);
    }
    const id = String(c.id);
    const urlSlug = String(c.urlSlug);
    if (seenId.has(id)) bad(`${where}: duplicate cluster id "${id}"`);
    if (seenUrlSlug.has(urlSlug)) bad(`${where}: duplicate urlSlug "${urlSlug}" — it is a URL path segment, so it must be unique`);
    // Worksheets live at /<urlSlug>/<slug>, so a cluster called "admin" would
    // put one at /admin/status. Next resolves the static route first, meaning
    // the *worksheet* silently becomes unreachable — a confusing failure to
    // debug, and free to rule out here.
    if (urlSlug === "admin") {
      bad(`${where}: urlSlug "admin" collides with the /admin/status page — ` +
          "rename it (a worksheet under it would be unreachable)");
    }
    seenId.add(id);
    seenUrlSlug.add(urlSlug);
    clusters.push({ id, label: String(c.label), urlSlug });

    if (c.days === undefined || c.days === null) continue;
    if (!Array.isArray(c.days)) bad(`${where}: \`days\` must be a list`);
    for (const [di, d] of c.days.entries()) {
      const dWhere = `schedule.yaml: cluster ${id} days[${di}]`;
      for (const k of ["code", "title", "lead", "doc", "source"]) {
        if (!d?.[k]) bad(`${dWhere} is missing required key \`${k}\``);
      }
      const code = String(d.code);
      if (seenCode.has(code)) bad(`${dWhere}: duplicate day code "${code}"`);
      seenCode.add(code);
      // The code carries the cluster, and the page groups by it — a day filed
      // under the wrong cluster would sort into the wrong block on the site.
      const implied = code.split(".")[0];
      if (implied !== id) {
        bad(`${dWhere}: day code "${code}" implies cluster "${implied}" but it is listed under cluster "${id}"`);
      }
      if (!SOURCE_KINDS.has(d.source)) {
        bad(`${dWhere}: source: "${d.source}" — must be one of ${[...SOURCE_KINDS].join(", ")}`);
      }
      let sheets = [];
      if (d.worksheets !== undefined && d.worksheets !== null) {
        if (!Array.isArray(d.worksheets)) bad(`${dWhere}: \`worksheets\` must be a list of slugs`);
        sheets = d.worksheets.map(String);
      }
      for (const slug of sheets) {
        if (!onDisk.has(slug)) {
          bad(`${dWhere}: worksheet "${slug}" has no tex/${slug}/main.tex or main.mdx — ` +
              `fix the slug, or drop it until the material is ported (worksheets present: ${[...onDisk].sort().join(", ")})`);
        }
        const already = bySlug.get(slug);
        if (already) {
          bad(`${dWhere}: worksheet "${slug}" is already listed under day ${already.day} — ` +
              "a worksheet belongs to exactly one day");
        }
        bySlug.set(slug, { slug, cluster: id, day: code, position: order.length + 1 });
        order.push(slug);
      }
      days.push({
        code,
        cluster: id,
        title: String(d.title),
        lead: String(d.lead),
        doc: String(d.doc),
        source: { kind: d.source, url: d.sourceUrl ?? null, note: d.note ?? null },
        slidesUrl: d.slides ?? null,   // day-level fallback deck (hosted elsewhere)
        worksheets: sheets,
      });
    }
  }

  return { clusters, days, bySlug, order };
}

// CLI: validate and print the curriculum order — what the site will present.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const s = loadSchedule();
    for (const c of s.clusters) {
      console.log(`${c.label}  (/${c.urlSlug}/)`);
      for (const d of s.days.filter((d) => d.cluster === c.id)) {
        const sheets = d.worksheets.length ? d.worksheets.join(", ") : `— not ported (${d.source.kind})`;
        console.log(`  ${d.code.padEnd(4)} ${d.title}\n       ${sheets}`);
      }
    }
    console.log(`\nschedule.yaml ok: ${s.clusters.length} clusters, ${s.days.length} days, ${s.order.length} worksheets`);
  } catch (e) {
    console.error(e instanceof ScheduleError ? `✗ ${e.message}` : e);
    process.exit(1);
  }
}
