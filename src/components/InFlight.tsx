"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { FLIGHT } from "./flight-tone";

/**
 * The one part of /admin/status that is NOT read off the build: open pull
 * requests, and whether the deployed commit is still the tip of main.
 *
 * Why it can't be a build input. The site is a static export built from main
 * (next.config.ts: output "export"), so at build time it has no knowledge of
 * work sitting on a branch — and baking a snapshot in would mean a PR opened
 * after the last merge stays invisible until the next one. Since in-flight work
 * changes far more often than main does, that snapshot would be wrong most of
 * the time it mattered. So this reads GitHub from the reader's browser instead.
 * The repo is public, so the endpoints need no token and the API answers a
 * cross-origin request (`access-control-allow-origin: *`); the unauthenticated
 * limit is 60/hour per viewer's own IP, and we spend 2 per page load.
 *
 * STRICTLY ADDITIVE. The table is server-rendered from status.json and is
 * complete before any of this runs. JS off, offline, rate-limited, or the repo
 * turned private → every component here renders nothing and the page is exactly
 * what the build produced. Nothing below is allowed to remove or contradict a
 * fact the build established.
 *
 * The join key is the day code in the PR title — "[D.4] Agent Foundations +
 * [D.5] Decision Theory" claims both days. That convention is already
 * universal in this repo's PRs, and it fails safe: a PR with no code (a CI or
 * docs change) matches no day rather than landing on the wrong row.
 */

const REPO = "iliad-team/iliad-intensive";
const API = `https://api.github.com/repos/${REPO}`;

/**
 * Set only on per-PR preview deploys (see .github/workflows/site.yml). A
 * preview is built from the PR's own branch, so it is *supposed* to differ from
 * main — comparing them would put a warning on every preview page for doing
 * exactly what a preview does. So we name the branch instead, and skip the
 * compare request. NEXT_PUBLIC_* is inlined at build time, which is what makes
 * it readable here under `output: export`.
 */
const PREVIEW_PR = process.env.NEXT_PUBLIC_PREVIEW_PR;

export type LivePr = {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  /** Day codes claimed by the title, in order of appearance. */
  codes: string[];
};

/**
 * Is the deployed commit still main's tip? The two negative cases are NOT the
 * same and must not share wording — "we haven't asked yet" is the state the
 * prerendered HTML ships in, and claiming a failed check there would be a lie
 * on every first paint.
 *
 *   checking     request in flight (or about to be) — the initial state
 *   unavailable  asked, didn't get an answer
 *   unknown      nothing to ask about: no commit stamp (a local dev build; only
 *                `npm run ci` and CI inject NEXT_PUBLIC_COMMIT_SHA)
 */
type Drift =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "unknown" }
  | { kind: "current" }
  | { kind: "behind"; by: number; url: string }
  | { kind: "diverged"; url: string };

type Phase = "loading" | "ready" | "error";

type Ctx = {
  phase: Phase;
  error: string | null;
  /** Open PRs that claim at least one day on the roster. */
  byDay: Map<string, LivePr[]>;
  /** Claims a day code no day uses — a typo worth seeing, not swallowing. */
  stray: LivePr[];
  /** No day code at all: infrastructure, docs, tooling. */
  other: LivePr[];
  matchedCount: number;
  fetchedAt: Date | null;
  drift: Drift;
  refresh: () => void;
};

const Ctx = createContext<Ctx | null>(null);

export function useInFlight(): Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInFlight must be used inside <InFlightProvider>");
  return v;
}

/** Day codes are cluster id + "." + number (schedule.yaml: a cluster id is a
 *  single letter or digit), so "[B.4]" and "[D.10]" both parse. */
const DAY_CODE = /\[([A-Z0-9]\.\d+)\]/g;

export function dayCodesIn(title: string): string[] {
  return [...title.matchAll(DAY_CODE)].map((m) => m[1]);
}

export function InFlightProvider({
  dayCodes, deployedSha, children,
}: {
  /** The roster, from the build — lets us tell a typo'd code from a real one. */
  dayCodes: string[];
  deployedSha?: string;
  children: React.ReactNode;
}) {
  const roster = useMemo(() => new Set(dayCodes), [dayCodes]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [prs, setPrs] = useState<LivePr[]>([]);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  // Derived from build-time values only, so the server prerender and the client
  // hydration agree.
  const initialDrift = (): Drift =>
    deployedSha && !PREVIEW_PR ? { kind: "checking" } : { kind: "unknown" };
  const [drift, setDrift] = useState<Drift>(initialDrift);
  // Bumped by refresh() to re-run the effect without a page reload.
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    const headers = { Accept: "application/vnd.github+json" };

    (async () => {
      setPhase("loading");
      setError(null);
      setDrift(initialDrift());   // a refresh re-asks rather than keeping a verdict
      try {
        const res = await fetch(`${API}/pulls?state=open&per_page=100`, {
          signal: ac.signal, headers,
        });
        if (!res.ok) {
          // 403 with the limit exhausted is the only failure a reader can act
          // on (wait), so it gets its own words instead of a bare status code.
          throw new Error(
            res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0"
              ? "GitHub's hourly rate limit for your IP is used up — try again later"
              : `GitHub API returned ${res.status}`,
          );
        }
        const raw: Array<{ number: number; title: string; html_url: string; draft?: boolean }> =
          await res.json();
        setPrs(raw.map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          draft: p.draft === true,
          codes: dayCodesIn(p.title),
        })));

        // Second call, and a soft one: the drift check is a bonus, so a failure
        // here degrades to `unavailable` and never throws — the PR data that
        // already arrived is worth more than this line.
        if (deployedSha && !PREVIEW_PR) {
          try {
            const cmp = await fetch(`${API}/compare/${deployedSha}...main`, {
              signal: ac.signal, headers,
            });
            if (cmp.ok) {
              const j: { status: string; ahead_by: number; behind_by: number } = await cmp.json();
              const url = `https://github.com/${REPO}/compare/${deployedSha}...main`;
              // base...head is deployed...main, so `ahead_by` counts commits
              // main has that production does not.
              if (j.status === "identical") setDrift({ kind: "current" });
              else if (j.ahead_by > 0 && j.behind_by === 0) setDrift({ kind: "behind", by: j.ahead_by, url });
              else setDrift({ kind: "diverged", url });
            } else {
              setDrift({ kind: "unavailable" });
            }
          } catch {
            if (!ac.signal.aborted) setDrift({ kind: "unavailable" });
          }
        }

        setFetchedAt(new Date());
        setPhase("ready");
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "could not reach GitHub");
        setPhase("error");
        // GitHub is unreachable, so the compare never ran either — don't leave
        // the drift line spinning on "checking" forever.
        setDrift((d) => (d.kind === "checking" ? { kind: "unavailable" } : d));
      }
    })();

    return () => ac.abort();
  }, [deployedSha, nonce]);

  const value = useMemo<Ctx>(() => {
    const byDay = new Map<string, LivePr[]>();
    const stray: LivePr[] = [];
    const other: LivePr[] = [];
    let matchedCount = 0;
    for (const pr of prs) {
      const known = pr.codes.filter((c) => roster.has(c));
      if (known.length) {
        matchedCount += 1;
        for (const c of known) byDay.set(c, [...(byDay.get(c) ?? []), pr]);
      } else if (pr.codes.length) stray.push(pr);
      else other.push(pr);
    }
    return { phase, error, byDay, stray, other, matchedCount, fetchedAt, drift, refresh };
  }, [prs, roster, phase, error, fetchedAt, drift, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------------ bits ----

function PrChip({ pr }: { pr: LivePr }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={pr.title}
      className={`inline-flex items-baseline gap-1 whitespace-nowrap rounded border ${FLIGHT.chip} bg-white/70 px-1.5 py-0.5 text-[0.7rem] font-medium text-violet-800 transition-colors hover:border-violet-500 hover:text-violet-950`}
    >
      <span aria-hidden className="opacity-70">{FLIGHT.glyph}</span>
      PR #{pr.number}
      {pr.draft && <span className="font-normal opacity-70">draft</span>}
      <span aria-hidden>↗</span>
    </a>
  );
}

/** Sits in a day's Material cell. Renders nothing until (and unless) the
 *  fetch succeeds, so the cell's build-derived tint and wording stand alone. */
export function InFlightCell({ code }: { code: string }) {
  const { phase, byDay } = useInFlight();
  const prs = byDay.get(code);
  if (phase !== "ready" || !prs?.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {prs.map((pr) => <PrChip key={pr.number} pr={pr} />)}
    </span>
  );
}

/** A tally chip for the header, in the same shape as the build's own. */
export function InFlightCount() {
  const { phase, matchedCount } = useInFlight();
  if (phase !== "ready" || !matchedCount) return null;
  return (
    <span className={`whitespace-nowrap rounded px-2 py-1 ${FLIGHT.cell}`}>
      <dt className="inline font-medium">{matchedCount}</dt>{" "}
      <dd className="inline opacity-80">
        in flight — open PR{matchedCount === 1 ? "" : "s"}
      </dd>
    </span>
  );
}

function ago(then: Date, now: number): string {
  const s = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/**
 * How current is what you're looking at — the two answers being different
 * questions:
 *
 *   the TABLE is as old as the last production build (and, if a deploy was
 *     lost, older than main — which is exactly how a merge went unpublished
 *     seven times before the concurrency fix, silently, while every check was
 *     green)
 *   the PR CHIPS are as old as this page load
 *
 * `builtAt` arrives as a prop rather than importing BUILT_AT: that constant is
 * `new Date()` at module scope, which in a client bundle would evaluate on the
 * reader's machine at page load and report the wrong thing.
 */
export function StatusFreshness({ builtAt }: { builtAt: string }) {
  const { phase, error, matchedCount, fetchedAt, drift, refresh } = useInFlight();
  // Only re-renders the relative label; no network, no polling for new data
  // (a reload is the way to get that).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const driftNote = () => {
    if (PREVIEW_PR) {
      return (
        <a
          href={`https://github.com/${REPO}/pull/${PREVIEW_PR}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-800 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600"
        >
          from the branch of PR #{PREVIEW_PR}, not main
        </a>
      );
    }
    switch (drift.kind) {
      case "current":
        return <span className="text-emerald-700">✓ current with main</span>;
      case "behind":
        return (
          <a href={drift.url} target="_blank" rel="noopener noreferrer" className="text-amber-800 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600">
            ⚠ {drift.by} commit{drift.by === 1 ? "" : "s"} behind main — this page predates them
          </a>
        );
      case "diverged":
        return (
          <a href={drift.url} target="_blank" rel="noopener noreferrer" className="text-amber-800 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600">
            ⚠ diverged from main
          </a>
        );
      case "checking":
        return <span className="opacity-60">checking against main…</span>;
      case "unavailable":
        return <span className="opacity-60">could not check against main</span>;
      default:
        return <span className="opacity-60">no commit stamp (dev build)</span>;
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded border border-zinc-200 bg-zinc-50/70 px-3 py-2 font-sans text-[0.75rem] text-zinc-600">
      <span>
        <span className="font-medium text-zinc-700">Table</span> built {builtAt} · {driftNote()}
      </span>
      <span aria-hidden className="text-zinc-300">|</span>
      <span>
        <span className="font-medium text-zinc-700">Open PRs</span>{" "}
        {phase === "loading" && <span className="opacity-60">loading…</span>}
        {phase === "error" && <span className="text-amber-800">unavailable — {error}</span>}
        {phase === "ready" && fetchedAt && (
          <>
            fetched {ago(fetchedAt, now)} · {matchedCount} matched to a day
          </>
        )}
        {phase !== "loading" && (
          <button
            type="button"
            onClick={refresh}
            className="ml-2 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[0.7rem] lowercase transition-colors hover:border-zinc-500 hover:text-zinc-900"
          >
            refresh
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Open PRs the table can't place. Listed rather than dropped, for the same
 * reason build-status.mjs makes an unscheduled worksheet fatal: a page that
 * quietly loses work is worse than one that says it has some it can't file.
 */
export function InFlightRest() {
  const { phase, stray, other } = useInFlight();
  if (phase !== "ready" || (!stray.length && !other.length)) return null;
  const li = "flex flex-wrap items-baseline gap-x-2 gap-y-1";
  return (
    <section className="mt-8 font-sans text-[0.78rem] text-zinc-600">
      {stray.length > 0 && (
        <>
          <h2 className="font-medium uppercase tracking-[0.12em] text-[0.68rem] text-amber-800">
            Open PRs claiming a day that isn&apos;t on the roster
          </h2>
          <p className="mt-1 max-w-[70ch] opacity-80">
            The bracketed code in the title matches no day in <code>schedule.yaml</code> — a
            typo in one or the other.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {stray.map((pr) => (
              <li key={pr.number} className={li}>
                <PrChip pr={pr} />
                <span className="opacity-80">{pr.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {other.length > 0 && (
        <>
          <h2 className={`${stray.length ? "mt-5 " : ""}font-medium uppercase tracking-[0.12em] text-[0.68rem] text-zinc-500`}>
            Other open PRs
          </h2>
          <p className="mt-1 max-w-[70ch] opacity-80">
            No day code in the title — tooling, docs or site work rather than a day&apos;s
            material.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {other.map((pr) => (
              <li key={pr.number} className={li}>
                <PrChip pr={pr} />
                <span className="opacity-80">{pr.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
