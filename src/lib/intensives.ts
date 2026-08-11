import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { listDays } from "./cluster-store";

/**
 * intensives/*.yaml — one file per programme ILIAD runs: a place, a set of
 * dates, and a calendar over the curriculum.
 *
 * The split with schedule.yaml is the point. schedule.yaml owns what the
 * material IS — teaching days and which worksheets are a day's material. An
 * intensive owns only WHEN a day is taught, by referencing its code. So a
 * worksheet added to day B.3 appears on every programme that teaches B.3
 * without anyone editing a second file, and no programme can disagree with the
 * curriculum about what B.3 contains.
 *
 * The filename is the URL segment: intensives/aug2026-sf.yaml is served at
 * /intensives/aug2026-sf/. There is no `slug:` key — two sources for one
 * identity is one too many.
 *
 * SERVER-ONLY, like cluster-store.ts, and for the same reason: it reads the
 * filesystem at build time.
 *
 * Unlike cluster-store.ts, malformed data here THROWS rather than falling back
 * to empty. That loader can degrade safely — a listing that loses its day
 * headings still tells the truth. This one cannot: a dropped day or a date off
 * by one is a published schedule that is quietly wrong, and someone plans
 * their week around it. `next build` prerenders these pages, so a throw fails
 * the build, which is the outcome we want.
 */

export type IntensiveDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** A teaching day in schedule.yaml, e.g. "B.3". Null for a `title` day. */
  code: string | null;
  /** A day with no curriculum material (arrival, wrap-up). Null for a `code` day. */
  title: string | null;
};

export type Intensive = {
  /** Filename without extension — the URL segment. */
  slug: string;
  title: string;
  location: string;
  /** Derived from the day list, never declared, so they cannot drift from it. */
  starts: string;
  ends: string;
  days: IntensiveDay[];
};

const DIR = path.join(process.cwd(), "intensives");

class IntensiveError extends Error {}

/** A real calendar date, not merely a well-shaped string ("2026-02-30" is not). */
function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type RawDay = { date?: unknown; code?: unknown; title?: unknown };

/**
 * Every programme, newest first — the run someone is looking for is nearly
 * always the current or next one, and an archive grows downwards.
 *
 * No intensives/ directory is not an error: a checkout that runs no programmes
 * still builds a site, and the pages simply have nothing to list.
 */
export async function listIntensives(): Promise<Intensive[]> {
  let files: string[];
  try {
    files = (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    return [];
  }

  const days = await listDays();
  const known = new Set(days.map((d) => d.code));

  const out: Intensive[] = [];
  for (const file of files) {
    const where = `intensives/${file}`;
    const bad = (msg: string): never => {
      throw new IntensiveError(`${where}: ${msg}`);
    };
    const slug = file.replace(/\.ya?ml$/, "");
    // The filename becomes a URL path segment verbatim.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      bad("filename is the URL segment, so it must be lowercase letters, digits and hyphens (e.g. aug2026-sf.yaml)");
    }

    let doc: { title?: unknown; location?: unknown; days?: unknown } | null;
    try {
      doc = YAML.parse(await readFile(path.join(DIR, file), "utf8"));
    } catch (e) {
      return bad(`not valid YAML: ${String((e as Error).message).split("\n")[0]}`);
    }
    if (!doc || typeof doc !== "object") bad("is empty");
    if (!doc!.title) bad("missing required key `title`");
    if (!doc!.location) bad("missing required key `location`");
    if (!Array.isArray(doc!.days) || doc!.days.length === 0) {
      bad("`days` must be a non-empty list — a programme with no days has nothing to publish");
    }

    const parsed: IntensiveDay[] = [];
    const seenCode = new Set<string>();
    let prev = "";
    for (const [i, d] of (doc!.days as RawDay[]).entries()) {
      const at = `days[${i}]`;
      if (!isDate(d?.date)) bad(`${at}: \`date\` must be a real YYYY-MM-DD date (got ${JSON.stringify(d?.date)})`);
      const date = d.date as string;
      // ISO dates sort as strings, so this rules out duplicates too.
      if (date <= prev) bad(`${at}: ${date} does not come after ${prev} — days are listed in the order they are taught`);
      prev = date;

      const hasCode = d.code !== undefined && d.code !== null;
      const hasTitle = d.title !== undefined && d.title !== null;
      if (hasCode === hasTitle) {
        bad(`${at}: give exactly one of \`code\` (a teaching day from schedule.yaml) or \`title\` (a day with no curriculum material)`);
      }
      if (hasCode) {
        const code = String(d.code);
        // Guarded on `known.size`: cluster-store returns [] if schedule.yaml is
        // unreadable, and "every code is unknown" would be a misleading error.
        if (known.size > 0 && !known.has(code)) {
          bad(`${at}: day code "${code}" is not in schedule.yaml — known codes: ${[...known].join(", ")}`);
        }
        if (seenCode.has(code)) bad(`${at}: day "${code}" is already taught on another date`);
        seenCode.add(code);
        parsed.push({ date, code, title: null });
      } else {
        parsed.push({ date, code: null, title: String(d.title) });
      }
    }

    out.push({
      slug,
      title: String(doc!.title),
      location: String(doc!.location),
      starts: parsed[0].date,
      ends: parsed[parsed.length - 1].date,
      days: parsed,
    });
  }

  out.sort((a, b) => b.starts.localeCompare(a.starts));
  return out;
}

// ------------------------------------------------------------- dates ----
// Always formatted in UTC. A bare "2026-08-17" parses as UTC midnight, so
// formatting it in a western timezone would render it as the 16th.

const utc = (d: string) => new Date(`${d}T00:00:00Z`);

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});
const RANGE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

/** "Mon 17 Aug" — en-GB puts a comma after the weekday; drop it. */
export const formatDay = (date: string): string => DAY_FMT.format(utc(date)).replace(",", "");

/** "17–27 Aug 2026", or "17 Aug – 11 Sept 2026" across a month boundary. */
export const formatRange = (starts: string, ends: string): string =>
  RANGE_FMT.formatRange(utc(starts), utc(ends));
