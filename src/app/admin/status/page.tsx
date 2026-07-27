import type { ReactNode } from "react";
import Link from "next/link";
import { readStatus, type Day, type Deck, type SourceKind } from "@/lib/status";
import { listClusters } from "@/lib/cluster-store";
import { clusterLabel, pagePath } from "@/lib/clusters";
import { BUILT_AT, COMMIT_SHA, CommitLink } from "@/components/BuildStamp";
import type { Cluster } from "@/lib/clusters";

/**
 * /admin/status — one row per teaching day: is the material live, is there a
 * deck, where's the Doc tab, where's the source.
 *
 * Everything observable is observed by the build (scripts/build-status.mjs)
 * rather than ticked off by hand, so a row can't claim a worksheet or a deck
 * that doesn't exist. The only hand-kept input is content/days.yml — the day
 * roster itself, which the build has no way to infer.
 *
 * "admin" is a naming convention, not access control: this is a static page on
 * a public site. Keep content/days.yml free of anything you wouldn't publish.
 */
export const metadata = {
  title: "Material status — Iliad Intensive",
  description: "Per-day status of the Iliad Intensive material: worksheets, slides, source.",
};

// ---------------------------------------------------------------- atoms ----

/**
 * Five status tones, each a tinted cell background — scannable down a column
 * without reading a word. Reserved for state, and never the whole story: every
 * tinted cell also carries a glyph and the status in words, so the colour is
 * the third encoding rather than the only one. Light tints with dark ink
 * (large blocks, so no saturated fills), and there's a legend under the table.
 *
 *   good     done, here, working        ok    in hand elsewhere / not ours
 *   wait     a gap worth seeing         none  not applicable, by design
 *   gone     nothing to build from
 */
const TONE = {
  good: { cell: "bg-emerald-50 text-emerald-900", chip: "border-emerald-200", glyph: "✓" },
  ok: { cell: "bg-sky-50 text-sky-900", chip: "border-sky-200", glyph: "→" },
  wait: { cell: "bg-amber-50 text-amber-900", chip: "border-amber-200", glyph: "!" },
  none: { cell: "bg-zinc-50 text-zinc-500", chip: "border-zinc-200", glyph: "·" },
  gone: { cell: "bg-rose-50 text-rose-900", chip: "border-rose-200", glyph: "✕" },
} as const;
type Tone = keyof typeof TONE;

/** Glyph + status word. The tint lives on the cell around it. */
function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-medium">
      <span aria-hidden className="opacity-70">{TONE[tone].glyph}</span>
      {children}
    </span>
  );
}

/** A small bordered action link — same affordance as the download boxes.
 *  Sits on a tinted cell, so it borrows the tone's border and a white wash. */
function Chip({
  href, children, external, tone = "none",
}: { href: string; children: ReactNode; external?: boolean; tone?: Tone }) {
  const attrs = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <a
      href={href}
      {...attrs}
      className={`rounded border ${TONE[tone].chip} bg-white/70 px-1.5 py-0.5 text-[0.7rem] lowercase text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900`}
    >
      {children}
    </a>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <span className="font-normal opacity-70">{children}</span>
);

// ----------------------------------------------------------------- cells ---
// Each returns its tone with its content, so the <td> can wear the tint —
// a whole column reads at a glance before a single word is parsed.

type Cell = { tone: Tone; node: ReactNode };

const SOURCE_LABEL: Record<SourceKind, { text: string; tone: Tone }> = {
  "in-repo": { text: "in repo", tone: "good" },
  ready: { text: "ready to port", tone: "ok" },
  readings: { text: "reading day", tone: "none" },
  partial: { text: "partial", tone: "wait" },
  missing: { text: "no source", tone: "gone" },
};

function materialCell(day: Day, clusters: Cluster[], basePath: string): Cell {
  if (!day.modules.length) {
    // A reading day has no worksheet by design — grey, not a gap. Any other
    // day without one is work outstanding.
    return day.source.declared === "readings"
      ? { tone: "none", node: <State tone="none">no worksheet — by design</State> }
      : { tone: "wait", node: <State tone="wait">not ported</State> };
  }
  const tone: Tone = day.modules.every((m) => m.unlisted) ? "wait" : "good";
  return {
    tone,
    node: (
      <ul className="flex flex-col gap-1">
        {day.modules.map((m) => (
          <li key={m.slug} className="flex flex-wrap items-center gap-1.5">
            <State tone={m.unlisted ? "wait" : "good"}>
              <Link href={pagePath(m.cluster, m.slug, clusters)} className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
                {m.title}
              </Link>
            </State>
            {m.pdf && <Chip tone={tone} href={`${basePath}/downloads/${m.slug}/${m.slug}.pdf`}>pdf</Chip>}
            {m.unlisted && <Muted>unlisted</Muted>}
          </li>
        ))}
      </ul>
    ),
  };
}

function DeckChips({ deck, basePath, tone }: { deck: Deck; basePath: string; tone: Tone }) {
  if (deck.kind === "built") {
    // The deck's LaTeX source is in the repo. `pdf` is false only in a
    // --check run, which compiles nothing.
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {deck.pdf
          ? <Chip tone={tone} href={`${basePath}/downloads/${deck.slug}/${deck.slug}-slides.pdf`}>pdf</Chip>
          : <Muted>not built in this run</Muted>}
        {deck.tex && <Chip tone={tone} href={`${basePath}/downloads/${deck.slug}/${deck.slug}-slides.tex`}>tex</Chip>}
      </span>
    );
  }
  if (deck.kind === "external") return <Chip tone={tone} href={deck.url} external>hosted&nbsp;↗</Chip>;
  return null;
}

function slidesCell(day: Day, basePath: string): Cell {
  // No deck at all is a real gap (the content build advises on it too), so it
  // shows as one rather than as a neutral blank.
  if (day.slides.kind === "none") return { tone: "wait", node: <State tone="wait">no deck</State> };
  const tone: Tone = day.slides.kind === "built" ? "good" : "ok";
  return {
    tone,
    node: (
      <div className="flex flex-col gap-1">
        <State tone={tone}>{tone === "good" ? "built here" : "hosted elsewhere"}</State>
        {day.slides.decks.map((deck, i) => (
          <DeckChips key={deck.slug ?? i} deck={deck} basePath={basePath} tone={tone} />
        ))}
      </div>
    ),
  };
}

function sourceCell(day: Day): Cell {
  const { text, tone } = SOURCE_LABEL[day.source.kind];
  return {
    tone,
    node: (
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <State tone={tone}>{text}</State>
          {day.source.url && <Chip tone={tone} href={day.source.url} external>upstream&nbsp;↗</Chip>}
        </span>
        {/* A ported reading day is still a reading day — say so, or the row
            looks like a worksheet day that only shipped an overview page. */}
        {day.source.kind !== "readings" && day.source.declared === "readings" && (
          <Muted>reading day</Muted>
        )}
        {day.source.note && <span className="text-[0.7rem] font-normal leading-snug opacity-75">{day.source.note}</span>}
      </div>
    ),
  };
}

// ------------------------------------------------------------------ page ---

export default async function StatusPage() {
  const [status, clusters] = await Promise.all([readStatus(), listClusters()]);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (!status) {
    return (
      <main className="mx-auto w-full max-w-[960px] px-6 py-10">
        <h1 className="font-serif text-[2.1rem] tracking-tight" style={{ fontWeight: 600 }}>
          Material status
        </h1>
        <p className="mt-4 font-sans text-sm text-zinc-600">
          No <code>content/status.json</code> — run <code>./run.sh content</code> to generate it.
        </p>
      </main>
    );
  }

  const { counts } = status;
  const th = "px-3 py-2 text-left align-bottom font-sans text-[0.68rem] font-medium uppercase tracking-[0.12em] text-zinc-500";
  const td = "px-3 py-3 align-top font-sans text-[0.8rem] text-zinc-700";

  // Group by cluster, in clusters.json order, so the table reads like the
  // schedule rather than one flat 19-row block.
  const byCluster = new Map<string, Day[]>();
  for (const d of status.days) {
    if (!byCluster.has(d.cluster)) byCluster.set(d.cluster, []);
    byCluster.get(d.cluster)!.push(d);
  }
  const order = clusters
    .map((c) => c.id)
    .filter((id) => byCluster.has(id))
    .concat([...byCluster.keys()].filter((id) => !clusters.some((c) => c.id === id)));

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-[2.1rem] leading-[1.15] tracking-tight" style={{ fontWeight: 600 }}>
          Material status
        </h1>
        <p className="mt-4 max-w-[60ch] font-serif text-[1.02rem] leading-relaxed text-zinc-700">
          One row per teaching day. The <em>material</em> and <em>slides</em> columns are read
          off each build — a worksheet shows up here because the build produced it, so this
          table can&apos;t drift from what the site actually serves. The day roster, the Doc
          tabs, and where the source lives for a day nobody has ported yet are the hand-kept
          part, in <code>content/days.yml</code>.
        </p>
        {/* Tallies in the same tones as the column they summarise. */}
        <dl className="mt-5 flex flex-wrap gap-2 font-sans text-[0.8rem]">
          {([
            [`${counts.live} of ${counts.days}`, "days live", "good"],
            [counts.decksBuilt, `deck${counts.decksBuilt === 1 ? "" : "s"} built here`, "good"],
            [counts.decksHosted, `deck${counts.decksHosted === 1 ? "" : "s"} hosted elsewhere`, "ok"],
            [counts.readingDays, `reading day${counts.readingDays === 1 ? "" : "s"}`, "none"],
            [counts.awaitingSource, "awaiting source", "gone"],
          ] as [string | number, string, Tone][]).map(([n, label, tone]) => (
            <span
              key={label}
              className={`whitespace-nowrap rounded px-2 py-1 ${TONE[tone].cell}`}
            >
              <dt className="inline font-medium">{n}</dt>{" "}
              <dd className="inline opacity-80">{label}</dd>
            </span>
          ))}
        </dl>
      </header>

      {status.checkOnly && (
        <p className="mb-6 border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2 font-sans text-[0.8rem] leading-relaxed text-zinc-700">
          Built from a <code>--check</code> run (the watch / preview loop), which compiles no
          PDFs — so the PDF and slides columns understate what a full build produces. Run{" "}
          <code>./run.sh content</code> for the real picture.
        </p>
      )}

      {/* Wide table: scrolls inside its own box so the page body never does. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-zinc-300">
              <th className={th}>Day</th>
              <th className={th}>Lead</th>
              <th className={th}>Material</th>
              <th className={th}>Slides</th>
              <th className={th}>Google Doc</th>
              <th className={th}>Source</th>
            </tr>
          </thead>
          {order.map((cluster) => (
            <tbody key={cluster}>
              <tr>
                <th
                  colSpan={6}
                  className="border-y border-zinc-200 bg-zinc-100 px-3 py-1.5 text-left font-sans text-[0.68rem] font-medium uppercase tracking-[0.12em] text-zinc-500"
                >
                  {clusterLabel(cluster, clusters)}
                </th>
              </tr>
              {byCluster.get(cluster)!.map((day) => {
                // The day itself links to its material when there is any.
                const first = day.modules.find((m) => !m.unlisted) ?? day.modules[0];
                const dayTitle = first ? (
                  <Link
                    href={pagePath(first.cluster, first.slug, clusters)}
                    className="text-[var(--link)] hover:underline"
                  >
                    {day.title}
                  </Link>
                ) : (
                  <span className="text-zinc-500">{day.title}</span>
                );
                const material = materialCell(day, clusters, basePath);
                const slides = slidesCell(day, basePath);
                const source = sourceCell(day);
                return (
                  <tr key={day.code} className="border-b border-zinc-200">
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="text-zinc-400">{day.code}</span>{" "}
                      <span className="font-serif text-[0.95rem]">{dayTitle}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-zinc-600`}>{day.lead}</td>
                    <td className={`${td} ${TONE[material.tone].cell}`}>{material.node}</td>
                    <td className={`${td} ${TONE[slides.tone].cell}`}>{slides.node}</td>
                    <td className={td}>
                      <Chip href={day.doc} external>tab&nbsp;↗</Chip>
                    </td>
                    <td className={`${td} ${TONE[source.tone].cell}`}>{source.node}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      {/* The tint is the third encoding (glyph + word carry it too), but the
          legend is what makes a column scannable without reading cells. */}
      <dl className="mt-4 flex flex-wrap gap-2 font-sans text-[0.72rem]">
        {([
          ["good", "here and working — worksheet live, deck compiled, source in repo"],
          ["ok", "in hand, but not ours to build — upstream source, deck hosted elsewhere"],
          ["wait", "outstanding — not ported yet, or no deck"],
          ["gone", "nothing buildable exists — only compiled PDFs"],
          ["none", "not applicable by design — a reading day"],
        ] as [Tone, string][]).map(([tone, meaning]) => (
          <span key={tone} className={`rounded px-2 py-1 ${TONE[tone].cell}`}>
            <dt className="inline font-medium" aria-hidden>{TONE[tone].glyph}</dt>{" "}
            <dd className="inline opacity-80">{meaning}</dd>
          </span>
        ))}
      </dl>

      {status.unassigned.length > 0 && (
        <section className="mt-8">
          <h2 className="font-sans text-[0.68rem] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Built, but not claimed by any day
          </h2>
          <p className="mt-2 max-w-[60ch] font-sans text-[0.8rem] leading-relaxed text-zinc-600">
            These worksheets are on the site but declare no{" "}
            <code>day:</code> in their frontmatter, so they belong to no row above. Add one
            (a day code from <code>content/days.yml</code>) to file them.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-[0.8rem]">
            {status.unassigned.map((m) => (
              <li key={m.slug}>
                <Link
                  href={pagePath(m.cluster, m.slug, clusters)}
                  className="text-[var(--link)] underline decoration-zinc-300 underline-offset-2"
                >
                  {m.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-4 font-sans text-xs leading-relaxed text-zinc-500">
        <p>
          Generated by <code>scripts/build-status.mjs</code> on every build. To change a row:
          edit <code>content/days.yml</code> for the roster, or add{" "}
          <code>day: {status.days[0]?.code ?? "B.4"}</code> to a worksheet&apos;s frontmatter to
          attach it to its day. Not linked from the site — but public, like every other page here.
        </p>
        <p className="mt-2">
          Built {BUILT_AT}
          {COMMIT_SHA ? <> · <CommitLink /></> : null}.
        </p>
      </footer>
    </main>
  );
}
