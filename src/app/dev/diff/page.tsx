import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { ModulePageShell } from "@/components/ModulePageShell";
import { DiffControls } from "@/components/DiffControls";

/**
 * /dev/diff — any two historical versions of a worksheet page, side by side,
 * through the same diff view PR previews use (public/diff.js).
 *
 * The versions are not built here. iliad-team/iliad-intensive-snapshots holds
 * every (page, tex/<slug>/ tree) version pre-rendered to HTML, plus an
 * index.json listing them; public/dev-diff.js reads both from GitHub in the
 * reader's browser (raw.githubusercontent.com sends
 * access-control-allow-origin: *), so this page is one static shell and costs
 * the site build nothing.
 *
 * The state is the query string, ?page=<slug>&from=<tree>&to=<tree> (trees may
 * be abbreviated), so a comparison is a link that can be shared. The pickers
 * are a plain GET form: changing one reloads the page with the new query.
 */

export const metadata: Metadata = {
  title: "Page history — Iliad",
  // A developer tool on a public site: nothing here for a search engine.
  robots: { index: false, follow: false },
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// Where the snapshots are served from; overridable to test against a local copy.
const SNAPSHOTS =
  process.env.NEXT_PUBLIC_SNAPSHOTS_URL ??
  "https://raw.githubusercontent.com/iliad-team/iliad-intensive-snapshots/main/";

const select =
  "min-w-0 max-w-full rounded border border-zinc-300 bg-white px-2 py-1 font-sans text-sm text-zinc-800";

export default function DevDiffPage() {
  return (
    <ModulePageShell sidebar={null}>
      <header className="not-prose mb-6 border-b border-zinc-200 pb-4 font-sans">
        <h1 className="font-serif text-[2.1rem] leading-[1.15] tracking-tight" style={{ fontWeight: 600 }}>
          Page history
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Any two versions of a worksheet page, each rendered with today&apos;s pipeline from the
          commit that produced it. Figures show today&apos;s version. The compiled pages are served
          from{" "}
          <a
            href="https://github.com/iliad-team/iliad-intensive-snapshots"
            className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900"
          >
            iliad-team/iliad-intensive-snapshots
          </a>
          , which renders every new version within minutes of a push.
        </p>
        <form id="dd-form" method="get" className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
          <label htmlFor="dd-page" className="self-center text-zinc-500">page</label>
          <select id="dd-page" name="page" className={select} disabled />
          <label htmlFor="dd-from" className="self-center text-red-700">from</label>
          <select id="dd-from" name="from" className={select} disabled />
          <label htmlFor="dd-to" className="self-center text-green-700">to</label>
          <select id="dd-to" name="to" className={select} disabled />
        </form>
        <div id="dd-info" className="mt-3 grid gap-3 text-xs text-zinc-600 sm:grid-cols-2" />
        <p id="dd-status" className="mt-3 text-sm italic text-zinc-500">loading the list of versions…</p>
        {/* Wrapped so dev-diff.js can tell this row from a preview banner's,
            which uses the same ids. */}
        <div id="dd-controls">
          <DiffControls
            label="diff"
            className="mt-3 rounded bg-amber-100"
            toggleData={{ "data-key": "iliad.devDiff", "data-autostart": "" }}
          />
        </div>
      </header>
      {/* dev-diff.js puts the "to" version's article here as `.prose`. Absent
          until then, so on a preview build the layout's own diff.js finds no
          article at load and stays out of the way. */}
      <article id="dd-article" />
      <script
        defer
        src={`${BASE_PATH}/dev-diff.js`}
        data-src={SNAPSHOTS}
        data-diff-js={`${BASE_PATH}/diff.js`}
      />
    </ModulePageShell>
  );
}
