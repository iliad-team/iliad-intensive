import Link from "next/link";
import { listIndex } from "@/lib/content";
import { clusterLabel, dayCode, pagePath } from "@/lib/clusters";
import { listClusters, listDays } from "@/lib/cluster-store";
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

/**
 * Consecutive worksheets of the same teaching day, in curriculum order. A day
 * with one worksheet stays a bare row; only a day taught in several parts grows
 * a heading, so the ~15 single-sheet days don't each pay for a subheading and a
 * single child.
 */
function byDay<T extends { day?: string }>(items: T[]): { day?: string; items: T[] }[] {
  const groups: { day?: string; items: T[] }[] = [];
  for (const p of items) {
    const last = groups[groups.length - 1];
    if (last && last.day === p.day && p.day) last.items.push(p);
    else groups.push({ day: p.day, items: [p] });
  }
  return groups;
}

export default async function Home() {
  const [items, clusterList, days] = await Promise.all([listIndex(), listClusters(), listDays()]);
  const dayTitle = (code?: string) => days.find((d) => d.code === code)?.title;
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
                {byDay(sortedItems(byCluster.get(cluster)!)).map((group) => (
                  <li key={group.items[0].slug} className="py-3">
                    {/* A day taught in several parts announces itself once, then
                        lists its parts — so two worksheets read as one day's
                        material rather than as neighbours that happen to share a
                        code. A one-worksheet day skips the heading entirely. */}
                    {group.items.length > 1 && (
                      // The id is what a part page's day breadcrumb links back to.
                      <h3 id={group.day} className="mb-2 scroll-mt-24 font-sans text-[0.78rem] tracking-[0.06em] text-zinc-500">
                        <span className="text-zinc-400">{group.day}</span>
                        {dayTitle(group.day) && <span className="ml-2">{dayTitle(group.day)}</span>}
                      </h3>
                    )}
                    <ul className={group.items.length > 1 ? "space-y-3 border-l border-zinc-200 pl-4" : ""}>
                      {group.items.map((p) => (
                        <li key={p.slug}>
                          <Link
                            href={pagePath(p.cluster, p.slug, clusterList)}
                            className="block font-serif text-[1.25rem] leading-snug hover:text-[var(--link)]"
                            style={{ fontWeight: 500 }}
                          >
                            {dayCode(p.day, p.part, p.parts) && (
                              <span className="mr-2 align-[0.1em] font-sans text-[0.72rem] tracking-[0.08em] text-zinc-400">
                                {dayCode(p.day, p.part, p.parts)}
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
