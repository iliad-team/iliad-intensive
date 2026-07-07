import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CLUSTERS, type Cluster } from "./clusters";

const CLUSTERS_FILE = path.join(process.cwd(), "content", "clusters.json");

/**
 * Load the editable cluster list shipped by the admin exporter at
 * content/clusters.json. Falls back to DEFAULT_CLUSTERS if missing.
 * SERVER-ONLY — the `server-only` import above breaks the build if a
 * client bundle tries to pull this in.
 */
export async function listClusters(): Promise<Cluster[]> {
  try {
    const raw = await readFile(CLUSTERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Cluster[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* fall through */
  }
  return DEFAULT_CLUSTERS;
}
