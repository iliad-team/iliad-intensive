import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CLUSTERS, type Cluster } from "./clusters";

const SCHEDULE_FILE = path.join(process.cwd(), "schedule.yaml");

/**
 * The cluster table from schedule.yaml — the hand-kept curriculum, validated by
 * the build (scripts/schedule.mjs). List order is display order; there is no
 * sort key. Falls back to DEFAULT_CLUSTERS if the file is missing.
 * SERVER-ONLY — the `server-only` import above breaks the build if a
 * client bundle tries to pull this in.
 */
export async function listClusters(): Promise<Cluster[]> {
  try {
    const doc = YAML.parse(await readFile(SCHEDULE_FILE, "utf8")) as
      { clusters?: { id: string; label: string; urlSlug: string }[] } | null;
    const parsed = doc?.clusters;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((c) => ({ id: String(c.id), label: String(c.label), urlSlug: String(c.urlSlug) }));
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_CLUSTERS;
}
