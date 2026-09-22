import type { IndexEntry } from "@/lib/content";
import { clusterLabel, dayCode, type Cluster } from "@/lib/clusters";
import { isChanged } from "@/lib/preview";
import { ModuleLink } from "@/components/ModuleLink";

const CLUSTER_ORDER = ["0", "A", "B", "C", "D", "E", "Other"];

// h2 = no indent, h3 = one step, h4 = two steps.
const HEADING_INDENT: Record<number, string> = {
  2: "pl-2",
  3: "pl-5",
  4: "pl-8",
};

/**
 * Server-rendered; always in the markup, shown/hidden by the #page-shell rules
 * in globals.css (keyed on the `nav-open` class on <html>). The old
 * close-on-mobile click behaviour lives in public/site.js, delegated from the
 * #module-sidebar id — no React on the client.
 */
export function SidebarNav({
  modules,
  activeSlug,
  clusters: clusterList = [],
}: {
  modules: IndexEntry[];
  activeSlug?: string;
  clusters?: Cluster[];
}) {
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

  return (
    <nav
      id="module-sidebar"
      aria-label="Modules"
      className="w-full max-w-xs shrink-0 self-start lg:sticky lg:top-[calc(var(--top-h)+1rem)] lg:max-h-[calc(100vh-var(--top-h)-2rem)] lg:overflow-y-auto pr-4"
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
                // On a PR preview the worksheets the PR touched are tinted
                // green, the same mark the homepage gives them; the active
                // page's grey wins nothing over it — a changed page that is
                // also the one you are on is greener still.
                const changed = isChanged(p.slug);
                const tone = active
                  ? (changed ? "bg-emerald-200 text-black font-medium" : "bg-zinc-200 text-black font-medium")
                  : changed
                    ? "bg-emerald-100 text-zinc-800 hover:bg-emerald-200 hover:text-black"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-black";
                return (
                  <li key={p.slug}>
                    <ModuleLink
                      cluster={p.cluster}
                      slug={p.slug}
                      clusters={clusterList}
                      className={`block rounded px-2 py-1 leading-snug ${tone}`}
                      title={changed ? "Changed in this pull request" : undefined}
                    >
                      {/* The part code as a chip rather than a nesting level:
                          this list already nests cluster → page → headings, and
                          a fourth tier for the few multi-part days would cost
                          more than it explains. "D.3.1" inline says it. */}
                      {dayCode(p.day, p.part, p.parts) && (
                        <span className="mr-1.5 text-[0.7rem] tracking-[0.06em] text-zinc-400">
                          {dayCode(p.day, p.part, p.parts)}
                        </span>
                      )}
                      {p.title}
                    </ModuleLink>
                    {headings.length > 0 && (
                      <ul
                        className="mt-1 mb-2 border-l border-zinc-200"
                        aria-label={`Sections of ${p.title}`}
                      >
                        {headings.map((h, i) => (
                          <li key={`${h.slug}-${i}`}>
                            <a
                              href={`#${h.slug}`}
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
