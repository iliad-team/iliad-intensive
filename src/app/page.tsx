import Link from "next/link";
import { listIndex } from "@/lib/content";
import { clusterLabel, pagePath } from "@/lib/clusters";
import { listClusters } from "@/lib/cluster-store";
import { BuildStamp } from "@/components/BuildStamp";

const HERO_SUMMARY =
  "The Iliad Intensive is a month-long, full-time AI alignment course for students with strong mathematics, physics, or theoretical-CS backgrounds. These are the materials from the April 2026 cohort — mathematical exercises, self-contained lecture notes on topics from singular learning theory to debate, and pointers for further study. About 20 contributors developed them. We share them to invite feedback and enable independent study.";

/**
 * Curriculum order, not alphabetical: `position` comes from schedule.yaml (see
 * scripts/schedule.mjs) — cluster order, then teaching-day order, then the
 * order a day lists its own worksheets. Falling back to the slug would only
 * matter for an entry the build somehow left unpositioned.
 */
function sortedItems<T extends { slug: string; position?: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.position ?? Number.POSITIVE_INFINITY) -
        (b.position ?? Number.POSITIVE_INFINITY) ||
      a.slug.localeCompare(b.slug),
  );
}

export default async function Home() {
  const [items, clusterList] = await Promise.all([listIndex(), listClusters()]);
  const byCluster = new Map<string, typeof items>();
  for (const p of items) {
    const k = p.cluster ?? "Other";
    if (!byCluster.has(k)) byCluster.set(k, []);
    byCluster.get(k)!.push(p);
  }
  // Cluster order: the clusters of schedule.yaml, in the order it lists them,
  // then any ids present in `items` that aren't in the cluster table, then
  // "Other".
  const known = clusterList.map((c) => c.id);
  const orderedClusters = known
    .filter((c) => byCluster.has(c))
    .concat([...byCluster.keys()].filter((c) => !known.includes(c)));
  return (
    <main className="mx-auto px-6 py-10" style={{ maxWidth: 720 }}>
      <header className="mb-10">
        <h1
          className="font-serif tracking-tight leading-[1.1] text-[2.5rem]"
          style={{ fontWeight: 600 }}
        >
          Iliad Intensive Curriculum
        </h1>
        <p className="mt-5 font-serif text-[1.08rem] leading-relaxed text-zinc-700">
          {HERO_SUMMARY}
        </p>
      </header>
      {items.length === 0 ? (
        <p className="font-serif text-zinc-500">No public modules yet.</p>
      ) : (
        <div className="space-y-8">
          {orderedClusters.map((cluster) => (
            <section key={cluster}>
              <h2 className="font-sans text-xs uppercase tracking-[0.15em] text-zinc-500 mb-3">
                {clusterLabel(cluster, clusterList)}
              </h2>
              <ul className="divide-y divide-zinc-200 border-y border-zinc-200">
                {sortedItems(byCluster.get(cluster)!).map((p) => (
                  <li key={p.slug} className="py-3">
                    <Link
                      href={pagePath(p.cluster, p.slug, clusterList)}
                      className="block font-serif text-[1.25rem] leading-snug hover:text-[var(--link)]"
                      style={{ fontWeight: 500 }}
                    >
                      {/* The teaching day, so the list reads as the schedule it
                          is. Two worksheets may share a day (D.3 is Solomonoff
                          Induction then AIXI) — both show its code. */}
                      {p.day && (
                        <span className="mr-2 align-[0.1em] font-sans text-[0.72rem] tracking-[0.08em] text-zinc-400">
                          {p.day}
                        </span>
                      )}
                      {p.title}
                    </Link>
                    {p.frontmatter?.summary && (
                      <p className="mt-1 font-serif text-[1rem] text-zinc-600 leading-relaxed">
                        {p.frontmatter.summary}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <footer className="mt-16 border-t border-zinc-200 pt-4 font-sans text-xs text-zinc-500">
        Source:{" "}
        <a
          href="https://github.com/iliad-team/iliad-intensive"
          className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800"
        >
          github.com/iliad-team/iliad-intensive
        </a>
        {" · "}Contact:{" "}
        <a
          href="mailto:feedback@iliad.ac"
          className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800"
        >
          feedback@iliad.ac
        </a>
        <br />
        <BuildStamp />
      </footer>
    </main>
  );
}
