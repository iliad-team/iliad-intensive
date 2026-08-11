import type { ReactNode } from "react";
import Link from "next/link";
import { readStatus, type Day, type Deck, type SourceKind } from "@/lib/status";
import { listClusters } from "@/lib/cluster-store";
import { clusterLabel, pagePath } from "@/lib/clusters";
import { BUILT_AT, COMMIT_SHA, CommitLink } from "@/components/BuildStamp";
import {
  InFlightProvider, InFlightCell, InFlightCount, InFlightRest, InFlightTd, StatusFreshness,
} from "@/components/InFlight";
// From its own module, not from InFlight.tsx: a server component importing a
// value out of a "use client" file gets undefined. See flight-tone.ts.
import { FLIGHT } from "@/components/flight-tone";
import type { Cluster } from "@/lib/clusters";

/**
 * /admin/status — one row per teaching day: is the material live, is there a
 * deck, where's the Doc tab, where's the source.
 *
 * Everything observable is observed by the build (scripts/build-status.mjs)
 * rather than ticked off by hand, so a row can't claim a worksheet or a deck
 * that doesn't exist. The only hand-kept input is schedule.yaml — the
 * curriculum itself, which the build has no way to infer.
 *
 * "admin" is a naming convention, not access control: this is a static page on
 * a public site. Keep schedule.yaml free of anything you wouldn't publish.
 *
 * One exception to "observed by the build", and it is marked as one: open pull
 * requests, and whether this page's own commit is still main's tip, are fetched
 * from GitHub in the reader's browser (components/InFlight.tsx). A branch that
 * hasn't merged is not a property of a build from main, so no build could
 * observe it. That source never contradicts the build: it adds the PR chips and
 * the tally, and it splits the outstanding tint in two (amber for a day nobody
 * has picked up, violet for one an open PR claims) without touching a cell's
 * glyph or wording. If the fetch fails the page is exactly what the build
 * produced.
 */
export const metadata = {
  title: "Material status — Iliad Intensive",
  description: "Per-day status of the Iliad Intensive material: worksheets, slides, source.",
};

// ---------------------------------------------------------------- atoms ----

/**
 * Four status tones, each a tinted cell background — scannable down a column
 * without reading a word. Reserved for state, and never the whole story: every
 * tinted cell also carries a glyph and the status in words, so the colour is
 * the third encoding rather than the only one. Bold tints with dark ink (large
 * blocks, no saturated fills), and there's a legend under the table.
 *
 *   good     done, here, working        ok    in hand elsewhere / not ours
 *   wait     a gap worth seeing         gone  nothing to build from
 *
 * `none` is not a status — it is the neutral tint for a chip that carries no
 * state (the Doc-tab link), and the fallback border for Chip.
 */
const TONE = {
  good: { cell: "bg-emerald-200 text-emerald-900", chip: "border-emerald-300", glyph: "✓" },
  ok: { cell: "bg-sky-200 text-sky-900", chip: "border-sky-300", glyph: "→" },
  wait: { cell: "bg-amber-200 text-amber-900", chip: "border-amber-300", glyph: "!" },
  none: { cell: "bg-zinc-200 text-zinc-900", chip: "border-zinc-300", glyph: "·" },
  gone: { cell: "bg-rose-200 text-rose-900", chip: "border-rose-300", glyph: "✕" },
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
  partial: { text: "partial", tone: "wait" },
  missing: { text: "no source", tone: "gone" },
};

function materialCell(day: Day, clusters: Cluster[], basePath: string): Cell {
  // No worksheet built for this day — every day needs one, so this is work
  // outstanding, the same for a reading day as for any other.
  if (!day.modules.length) {
    return { tone: "wait", node: <State tone="wait">not ported</State> };
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

  // Group by cluster, in schedule.yaml's cluster order, so the table reads like
  // the schedule rather than one flat 19-row block.
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
    // The provider is a client component wrapping server-rendered children:
    // the table below is still built and rendered on the server, and the
    // client leaves inside it (InFlightCell &c.) read the fetched PRs from
    // context once they arrive.
    <InFlightProvider dayCodes={status.days.map((d) => d.code)} deployedSha={COMMIT_SHA}>
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-[2.1rem] leading-[1.15] tracking-tight" style={{ fontWeight: 600 }}>
          Material status
        </h1>
        <p className="mt-4 max-w-[60ch] font-serif text-[1.02rem] leading-relaxed text-zinc-700">
          One row per teaching day. The <em>material</em> and <em>slides</em> columns are read
          off each build — a worksheet shows up here because the build produced it, so this
          table can&apos;t drift from what the site actually serves. The day roster, which
          worksheets are each day&apos;s material, the Doc tabs, and where the source lives for
          a day nobody has ported yet are the hand-kept part, in <code>schedule.yaml</code>.
          Open pull requests are the one live input, read from GitHub when you load the
          page rather than baked in by the build: they add the PR links, and they turn an
          outstanding cell violet where a branch is already claiming the day.
        </p>
        {/* Tallies in the same tones as the column they summarise. */}
        <dl className="mt-5 flex flex-wrap gap-2 font-sans text-[0.8rem]">
          {([
            [`${counts.live} of ${counts.days}`, "days live", "good"],
            [counts.decksBuilt, `deck${counts.decksBuilt === 1 ? "" : "s"} built here`, "good"],
            [counts.decksHosted, `deck${counts.decksHosted === 1 ? "" : "s"} hosted elsewhere`, "ok"],
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
          {/* Appears only once the fetch lands — the build can't count these. */}
          <InFlightCount />
        </dl>
      </header>

      <StatusFreshness builtAt={BUILT_AT} />

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
          {/* Day and Lead are labels, not content: left to size themselves they
              held a whole line each ("Decision Theory and Reinforcement
              Learning", "Kai + Matthew Farrugia-Roberts") and starved the four
              columns that actually carry status. Pinned narrow here and allowed
              to wrap instead — the slack goes to Material and Source. */}
          <colgroup>
            <col className="w-[9.5rem]" />
            <col className="w-[7rem]" />
          </colgroup>
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
                    <td className={td}>
                      <span className="text-zinc-400">{day.code}</span>{" "}
                      {dayTitle}
                    </td>
                    <td className={`${td} text-zinc-600`}>{day.lead}</td>
                    {/* Both cells keep the build's wording — an open PR doesn't
                        make a worksheet or a deck exist. The tint is the one
                        thing the live fetch may change, and only in one
                        direction: outstanding + an open PR claims the day goes
                        violet instead of amber, so what stays amber is what
                        nobody is on. */}
                    <InFlightTd
                      code={day.code}
                      className={td}
                      tint={TONE[material.tone].cell}
                      flightable={material.tone === "wait"}
                    >
                      {material.node}
                      <InFlightCell code={day.code} />
                    </InFlightTd>
                    <InFlightTd
                      code={day.code}
                      className={td}
                      tint={TONE[slides.tone].cell}
                      flightable={slides.tone === "wait"}
                    >
                      {slides.node}
                    </InFlightTd>
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
          ["wait", "outstanding, and nobody is on it — not ported yet, or no deck"],
          ["gone", "nothing buildable exists — only compiled PDFs"],
        ] as [Tone, string][]).map(([tone, meaning]) => (
          <span key={tone} className={`rounded px-2 py-1 ${TONE[tone].cell}`}>
            <dt className="inline font-medium" aria-hidden>{TONE[tone].glyph}</dt>{" "}
            <dd className="inline opacity-80">{meaning}</dd>
          </span>
        ))}
        {/* The live tone, described in the same breath as the four the build
            derives — it comes from the in-browser fetch, not the build. */}
        <span className={`rounded px-2 py-1 ${FLIGHT.cell}`}>
          <dt className="inline font-medium" aria-hidden>{FLIGHT.glyph}</dt>{" "}
          <dd className="inline opacity-80">
            in flight — an open PR claims this day, so its outstanding cells wear this
            instead of amber. Day-level: it says someone is on the day, not that the
            branch carries a deck.
          </dd>
        </span>
      </dl>

      <InFlightRest />

      <footer className="mt-12 border-t border-zinc-200 pt-4 font-sans text-xs leading-relaxed text-zinc-500">
        <p>
          Generated by <code>scripts/build-status.mjs</code> on every build. Every row, and
          every worksheet in it, comes from <code>schedule.yaml</code> — edit that to add a day
          or to file a worksheet under one. Not linked from the site — but public, like every
          other page here.
        </p>
        <p className="mt-2">
          Built {BUILT_AT}
          {COMMIT_SHA ? <> · <CommitLink /></> : null}.
        </p>
      </footer>
    </main>
    </InFlightProvider>
  );
}
