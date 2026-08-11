import Link from "next/link";
import { notFound } from "next/navigation";
import { listIntensives, formatDay, formatRange } from "@/lib/intensives";
import { listIndex } from "@/lib/content";
import { listClusters, listDays } from "@/lib/cluster-store";
import { pagePath } from "@/lib/clusters";

/**
 * /intensives/<slug> — one programme's calendar: a row per day, and links to
 * the material taught that day.
 *
 * The material column is read from content/index.json, so it lists what the
 * site has actually built rather than what the schedule hopes for. A day whose
 * worksheets aren't ported yet still gets its row — it is taught either way —
 * and says so instead of quietly rendering an empty cell.
 */

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await listIntensives()).map((it) => ({ intensive: it.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ intensive: string }>;
}) {
  const { intensive } = await params;
  const it = (await listIntensives()).find((x) => x.slug === intensive);
  if (!it) return {};
  return {
    title: `${it.title}, ${it.location} — Iliad`,
    description: `Day-by-day schedule: ${it.location}, ${formatRange(it.starts, it.ends)}.`,
  };
}

const TH = "border-b border-zinc-300 pb-2 text-left font-sans text-xs uppercase tracking-[0.12em] text-zinc-500";
const TD = "border-b border-zinc-200 py-3 align-top";

export default async function IntensivePage({
  params,
}: {
  params: Promise<{ intensive: string }>;
}) {
  const { intensive } = await params;

  const [all, modules, clusterList, days] = await Promise.all([
    listIntensives(),
    listIndex(),
    listClusters(),
    listDays(),
  ]);

  const it = all.find((x) => x.slug === intensive);
  if (!it) notFound();

  /** The worksheets built for a teaching day, in curriculum order. */
  const materialFor = (code: string) =>
    modules
      .filter((m) => m.day === code)
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  const dayTitle = (code: string) => days.find((d) => d.code === code)?.title;

  return (
    <main className="mx-auto px-6 py-10" style={{ maxWidth: 720 }}>
      <header className="mb-10">
        <Link
          href="/intensives"
          className="font-sans text-[0.8rem] text-zinc-500 hover:text-zinc-800"
        >
          ← Intensives
        </Link>
        <h1
          className="mt-3 font-serif tracking-tight leading-[1.1] text-[2.5rem]"
          style={{ fontWeight: 600 }}
        >
          {it.title}
        </h1>
        <p className="mt-3 font-sans text-[0.95rem] text-zinc-500">
          {it.location} · {formatRange(it.starts, it.ends)}
        </p>
      </header>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[7.5rem]`}>Date</th>
            <th className={`${TH} w-[3.5rem]`}>Day</th>
            <th className={TH}>Material</th>
          </tr>
        </thead>
        <tbody>
          {it.days.map((d) => {
            const sheets = d.code ? materialFor(d.code) : [];
            return (
              <tr key={d.date}>
                <td className={`${TD} pr-3 font-sans text-[0.9rem] whitespace-nowrap text-zinc-600`}>
                  {formatDay(d.date)}
                </td>
                <td className={`${TD} pr-3 font-sans text-[0.8rem] tracking-[0.06em] text-zinc-400`}>
                  {d.code}
                </td>
                <td className={TD}>
                  {sheets.length > 0 ? (
                    <ul className="space-y-1">
                      {sheets.map((m) => (
                        <li key={m.slug}>
                          <Link
                            href={pagePath(m.cluster, m.slug, clusterList)}
                            // Same reason as the homepage: prefetching every
                            // linked worksheet's RSC payload is tens of MB for
                            // pages the reader has not chosen yet.
                            prefetch={false}
                            className="font-serif text-[1.05rem] leading-snug hover:text-[var(--link)]"
                          >
                            {m.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    // Either a day with no curriculum material (arrival,
                    // wrap-up) or a teaching day nobody has ported yet. Both
                    // read as plain text; only the second admits to a gap.
                    <span className="font-serif text-[1.05rem] text-zinc-500">
                      {d.title ?? dayTitle(d.code!) ?? d.code}
                      {d.code && (
                        <span className="ml-2 font-sans text-[0.78rem] text-zinc-400">
                          not yet published
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
