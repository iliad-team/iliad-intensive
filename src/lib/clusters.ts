/**
 * Pure cluster helpers. Client + server safe — no fs imports here. The
 * server-only loader that reads the cluster table out of schedule.yaml lives in
 * ./cluster-store.ts so client components like SidebarNav can import the
 * helpers without dragging node:fs/promises into the browser bundle.
 */

/** Display order is list order — schedule.yaml has no sort key. */
export type Cluster = {
  id: string;
  label: string;
  urlSlug: string;
};

export const DEFAULT_CLUSTERS: Cluster[] = [
  { id: "0", label: "Foundations", urlSlug: "foundations" },
  { id: "A", label: "Cluster A — Alignment", urlSlug: "alignment" },
  { id: "B", label: "Cluster B — Learning", urlSlug: "learning" },
  { id: "C", label: "Cluster C — Abstractions, Representations, and Interpretability", urlSlug: "interpretability" },
  { id: "D", label: "Cluster D — Agency", urlSlug: "agency" },
  { id: "E", label: "Cluster E — Safety Guarantees and their Limits", urlSlug: "safety" },
];

export function clusterUrlSlug(
  cluster: string | null | undefined,
  list: Cluster[] = DEFAULT_CLUSTERS,
): string {
  if (!cluster) return "page";
  return list.find((c) => c.id === cluster)?.urlSlug ?? cluster.toLowerCase();
}

export function urlSlugToCluster(
  slug: string,
  list: Cluster[] = DEFAULT_CLUSTERS,
): string | undefined {
  return list.find((c) => c.urlSlug === slug)?.id;
}

export function pagePath(
  cluster: string | null | undefined,
  slug: string,
  list: Cluster[] = DEFAULT_CLUSTERS,
): string {
  return `/${clusterUrlSlug(cluster, list)}/${slug}`;
}

export function clusterLabel(
  cluster: string | null | undefined,
  list: Cluster[] = DEFAULT_CLUSTERS,
): string {
  if (!cluster) return "Other";
  return list.find((c) => c.id === cluster)?.label ?? `Cluster ${cluster}`;
}

/**
 * How a worksheet's teaching day is *displayed*: "D.3" for a day with one
 * worksheet, "D.3.1" / "D.3.2" for one taught in several parts.
 *
 * Only days that actually have parts get numbered. A dotted code then always
 * means "part n of several", and the ~15 single-worksheet days aren't implied to
 * be part one of a series that doesn't exist.
 *
 * This is presentation only. The canonical code stays undotted ("D.3") — that's
 * what schedule.yaml, /admin/status, the issue titles and the project board all
 * speak, and a second identity for the same day would be one too many.
 */
export function dayCode(
  day: string | null | undefined,
  part?: number,
  parts?: number,
): string | null {
  if (!day) return null;
  return parts && parts > 1 && part ? `${day}.${part}` : day;
}
