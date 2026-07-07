/**
 * Pure cluster helpers. Client + server safe — no fs imports here. The
 * server-only loader that reads content/clusters.json lives in
 * ./cluster-store.ts so client components like SidebarNav can import the
 * helpers without dragging node:fs/promises into the browser bundle.
 */

export type Cluster = {
  id: string;
  label: string;
  urlSlug: string;
  position: number;
};

export const DEFAULT_CLUSTERS: Cluster[] = [
  { id: "0", label: "Foundations", urlSlug: "foundations", position: 0 },
  { id: "A", label: "Cluster A — Alignment", urlSlug: "alignment", position: 10 },
  { id: "B", label: "Cluster B — Learning", urlSlug: "learning", position: 20 },
  { id: "C", label: "Cluster C — Abstractions, Representations, and Interpretability", urlSlug: "interpretability", position: 30 },
  { id: "D", label: "Cluster D — Agency", urlSlug: "agency", position: 40 },
  { id: "E", label: "Cluster E — Safety Guarantees and their Limits", urlSlug: "safety", position: 50 },
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
