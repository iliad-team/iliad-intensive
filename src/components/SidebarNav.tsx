"use client";

import Link from "next/link";
import { useNav } from "./NavContext";
import type { IndexEntry } from "@/lib/content";
import { clusterLabel, pagePath, type Cluster } from "@/lib/clusters";

const CLUSTER_ORDER = ["0", "A", "B", "C", "D", "E", "Other"];

// h2 = no indent, h3 = one step, h4 = two steps.
const HEADING_INDENT: Record<number, string> = {
  2: "pl-2",
  3: "pl-5",
  4: "pl-8",
};

export function SidebarNav({
  modules,
  activeSlug,
  clusters: clusterList = [],
}: {
  modules: IndexEntry[];
  activeSlug?: string;
  clusters?: Cluster[];
}) {
  const { open, setOpen } = useNav();
  if (!open) return null;

  const byCluster = new Map<string, IndexEntry[]>();
  for (const m of modules) {
    const k = m.cluster ?? "Other";
    if (!byCluster.has(k)) byCluster.set(k, []);
    byCluster.get(k)!.push(m);
  }
  for (const list of byCluster.values()) {
    list.sort(
      (a, b) =>
        (a.position ?? Number.POSITIVE_INFINITY) -
          (b.position ?? Number.POSITIVE_INFINITY) ||
        a.slug.localeCompare(b.slug),
    );
  }
  const orderedClusters = CLUSTER_ORDER.filter((c) => byCluster.has(c)).concat(
    [...byCluster.keys()].filter((c) => !CLUSTER_ORDER.includes(c)),
  );

  const closeOnMobile = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) setOpen(false);
  };

  return (
    <nav
      aria-label="Modules"
      className="w-full max-w-xs shrink-0 self-start lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto pr-4"
    >
      <div className="space-y-5 font-sans text-sm">
        {orderedClusters.map((cluster) => (
          <section key={cluster}>
            <h3 className="mb-2 text-[0.68rem] uppercase tracking-[0.15em] text-zinc-500">
              {clusterLabel(cluster, clusterList)}
            </h3>
            <ul className="space-y-1">
              {byCluster.get(cluster)!.map((p) => {
                const active = p.slug === activeSlug;
                const headings = active ? p.headings ?? [] : [];
                return (
                  <li key={p.slug}>
                    <Link
                      href={pagePath(p.cluster, p.slug, clusterList)}
                      onClick={closeOnMobile}
                      className={
                        "block rounded px-2 py-1 leading-snug " +
                        (active
                          ? "bg-zinc-200 text-black font-medium"
                          : "text-zinc-700 hover:bg-zinc-100 hover:text-black")
                      }
                    >
                      {p.title}
                    </Link>
                    {headings.length > 0 && (
                      <ul
                        className="mt-1 mb-2 border-l border-zinc-200"
                        aria-label={`Sections of ${p.title}`}
                      >
                        {headings.map((h, i) => (
                          <li key={`${h.slug}-${i}`}>
                            <a
                              href={`#${h.slug}`}
                              onClick={closeOnMobile}
                              className={
                                "block py-0.5 leading-snug text-[0.82rem] text-zinc-600 hover:text-black hover:bg-zinc-50 rounded-r " +
                                (HEADING_INDENT[h.level] ?? "pl-2")
                              }
                            >
                              {h.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
